const { MongoTopologyClosedError, ObjectId } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { createSeed, rollDice } = require('../../../shared/rng');
const { webhook3 } = require('./webhooks');
const { logError } = require('../../../shared/error-logger');
const {
    getLootTable, weightedDraw, drawAmount, getAffinityBonus,
    computeEffectiveRoll, computeDrawCount, computeInvestmentFactor, DEFAULT_INVESTMENT,
    JACKPOT_CHANCE, RARITY_BUMP, r2,
} = require('./quest-loot');

const TIER_STAT_REQ      = { 1: 10,  2: 50,  3: 100, 4: 200, 5: 500 };
const TIER_STAT_REQ_ITEM = { 1: 2,   2: 5,   3: 12,  4: 20,  5: 40  }; // luck/dodge — item-only stats
const TIER_XP            = { 1: 25,  2: 50,  3: 100, 4: 200, 5: 400 };

const PRIMARY_STAT   = { combat:'damage', salvage:'engineering', stealth:'dodge', fortune:'luck', defense:'defense' };
const ITEM_ONLY_STATS = new Set(['luck', 'dodge']);

const RARITY_BONUS = { common: 5, uncommon: 10, rare: 20, epic: 35, legendary: 50 };
const LEVEL_SCALE  = { common: 0.5, uncommon: 0.8, rare: 1.2, epic: 1.8, legendary: 2.5 };

async function issue(username, type, amount) {
    try {
        const collection = ctx.db.collection('relics');
        const existing = await collection.findOne({ username, type });
        if (!existing) {
            await collection.insertOne({ username, version: 1, type, amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
        } else {
            await collection.updateOne({ username, type }, { $inc: { amount } });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { ctx.client.close(); process.exit(1); }
        else { console.log(err); return true; }
    }
}

async function collectQuest(username, questId, blockId, trxId) {
    try {
        const db = ctx.db;

        let objectId;
        try { objectId = new ObjectId(questId); }
        catch {
            console.log(`[SC] quest-collect: invalid questId '${questId}' for ${username}`);
            return false;
        }

        const quest = await db.collection('active-quests').findOne({ _id: objectId, username });
        if (!quest) { console.log(`[SC] quest-collect: quest ${questId} not found for ${username}`); return false; }
        if (quest.collected) { console.log(`[SC] quest-collect: already collected by ${username}`); return false; }
        if (quest.completes_at > Date.now()) {
            console.log(`[SC] quest-collect: ${username} not ready (${Math.ceil((quest.completes_at - Date.now()) / 60000)}m remaining)`);
            return false;
        }

        const tier       = quest.tier;
        const primaryStat = PRIMARY_STAT[quest.quest_type] || 'damage';
        const statReq    = ITEM_ONLY_STATS.has(primaryStat)
            ? (TIER_STAT_REQ_ITEM[tier] || 3)
            : (TIER_STAT_REQ[tier] || 10);

        // ── Effective roll ─────────────────────────────────────────────────────
        // statMod: wider denominator (4×req) + lower cap (0.75) so maxing requires
        // significantly more than the bare minimum stat.
        // Item rarity/level now drives direct draw bonuses, not roll inflation.
        const seed      = createSeed(blockId, trxId, username);
        const baseRoll  = rollDice(100, seed);
        // effectiveRoll: stat skill only (item gives draw count bonus separately below)
        const effectiveRoll = computeEffectiveRoll(
            baseRoll, quest.effective_primary_stat, statReq, quest.secondary_stat_value
        );

        // ── Draw count ──────────────────────────────────────────────────────────
        // effectiveRoll range: 0–183 (100 × 1.75 + 8). Brackets tuned accordingly.
        const baseRolls = quest.base_rolls || 2;
        const drawInfo = computeDrawCount(effectiveRoll, baseRolls);
        const guaranteedLegendary = drawInfo.guaranteedLegendary;
        const shiftRareUp         = drawInfo.shiftRareUp;
        let drawCount             = drawInfo.drawCount;

        // Item draw bonus: two independent components.
        // 1. Rarity base: rare/epic/legendary grant +1 guaranteed draw.
        // 2. Level bonus: every forge level above 1 adds 5% chance of one more draw (capped at 100%).
        //    This makes every forge meaningful regardless of rarity.
        const itemRarity  = quest.equipped_item_rarity;
        const itemLevel   = quest.equipped_item_level || 1;
        const rarityBase  = ['rare', 'epic', 'legendary'].includes(itemRarity) ? 1 : 0;
        const levelChance = itemRarity ? Math.min((itemLevel - 1) * 0.05, 1.0) : 0;
        drawCount += rarityBase;
        const lvlRng = seedrandom(createSeed(blockId, trxId, username + '_lvl'));
        if (levelChance > 0 && lvlRng() < levelChance) drawCount += 1;

        // Affinity bonus: fractional extra draws — floor guaranteed, remainder is a probability roll
        const rawAff     = getAffinityBonus(quest.item_attribute_value);
        const affGuar    = Math.floor(rawAff);
        const affFrac    = rawAff - affGuar;
        const affRng     = seedrandom(createSeed(blockId, trxId, username + '_aff'));
        const bonusDraws = affGuar + (affFrac > 0 && affRng() < affFrac ? 1 : 0);
        if (bonusDraws > 0) {
            drawCount += bonusDraws;
            console.log(`[SC] quest-collect: ${username} affinity +${bonusDraws} draws (attr=${quest.item_attribute_value?.toFixed(3)} raw=${rawAff.toFixed(2)})`);
        }

        // ── Loot draws ───────────────────────────────────────
        const lootTable = getLootTable(quest.quest_type, tier);
        const relics    = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };

        for (let i = 0; i < drawCount; i++) {
            const drawSeed = createSeed(blockId, trxId, username + '_drop_' + i);
            const rng      = seedrandom(drawSeed);

            let table = lootTable;
            if (shiftRareUp && i === drawCount - 1) {
                table = lootTable.map(e => ({
                    rarity: e.rarity,
                    w: ['legendary', 'epic', 'rare'].includes(e.rarity) ? e.w * 3 : e.w,
                }));
            }

            let rarity = weightedDraw(rng, table);  // consumes rng() once
            // Jackpot: separate seed so it never shifts the main draw rng stream
            const jpRng   = seedrandom(createSeed(blockId, trxId, username + '_jp_' + i));
            const jackpot = jpRng() < JACKPOT_CHANCE;
            if (jackpot) rarity = RARITY_BUMP[rarity] || rarity;
            const amount      = drawAmount(rng, rarity, tier, quest.quest_type);  // consumes rng() once or twice
            const finalAmount = jackpot ? r2(amount * 3) : amount;
            relics[rarity] = r2((relics[rarity] || 0) + finalAmount);
        }

        // Guaranteed legendary draw at 100+ effective roll (also fractional)
        if (guaranteedLegendary) {
            const legSeed = createSeed(blockId, trxId, username + '_leg_bonus');
            const legRng  = seedrandom(legSeed);
            const legAmt  = drawAmount(legRng, 'legendary', tier, quest.quest_type);
            relics.legendary = r2((relics.legendary || 0) + legAmt);
        }

        // ── Gear-based investment factor (anti-farm) ──────────
        // Scales the relics awarded by the gear equipped in this quest's slot (snapshotted at
        // start). A bare account earns the floor; rarer + higher-forge-level gear ramps to full —
        // so a perpetually-ungeared farm account contributes like the low-investment account it is.
        const invFactor = computeInvestmentFactor(quest.equipped_item_rarity, quest.equipped_item_level, DEFAULT_INVESTMENT);
        if (invFactor < 1) {
            for (const k of Object.keys(relics)) relics[k] = r2(relics[k] * invFactor);
        }

        // ── Issue relics ──────────────────────────────────────
        for (const [rarity, amount] of Object.entries(relics)) {
            if (amount > 0) await issue(username, rarity + '_relics', amount);
        }

        // ── XP + mark collected ───────────────────────────────
        const xpGain = TIER_XP[tier] || 25;
        await db.collection('players').updateOne({ username }, { $inc: { experience: xpGain, version: 1 } });
        await db.collection('active-quests').updateOne({ _id: objectId }, { $set: { collected: true, collected_at: Date.now() } });

        // ── Quest log ─────────────────────────────────────────
        await db.collection('quest-log').insertOne({
            username,
            action: 'complete',
            quest_type: quest.quest_type,
            tier,
            name: quest.name,
            board_date: quest.board_date,
            base_roll: baseRoll,
            effective_roll: effectiveRoll,
            draw_count: drawCount,
            rewards: relics,
            xp: xpGain,
            seed,
            time: new Date(),
        });

        // ── Daily stats ───────────────────────────────────────
        const statDate = new Date().toISOString().slice(0, 10);
        await db.collection('stats').updateOne({ date: statDate }, { $inc: { quests_collected: 1 } }, { upsert: true });

        // ── Discord ───────────────────────────────────────────
        const relicSummary = Object.entries(relics)
            .filter(([, c]) => c > 0)
            .map(([r, c]) => `${c} ${r}`)
            .join(', ');
        webhook3(quest, username, effectiveRoll, drawCount, relics, quest.scrap_paid);

        console.log(`[SC] quest-collect: ${username} "${quest.name}" T${tier} — roll=${effectiveRoll.toFixed(1)} draws=${drawCount} inv=${invFactor.toFixed(2)} relics: ${relicSummary}`);
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            logError('SYS_MONGO_CLOSED', err, { fn: 'collectQuest', service: 'SC' }, 'FATAL');
            ctx.client.close();
            process.exit(1);
        } else {
            logError('SC_QUEST_COLLECT_FAIL', err, { fn: 'collectQuest', username, questId });
            return false;
        }
    }
}

module.exports = { issue, collectQuest, getLootTable };
