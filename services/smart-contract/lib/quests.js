const { MongoTopologyClosedError, ObjectId } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { createSeed, rollDice } = require('../../../shared/rng');
const { webhook3 } = require('./webhooks');
const { logError } = require('../../../shared/error-logger');

const TIER_STAT_REQ   = { 1: 10,  2: 50,  3: 100, 4: 200, 5: 500 };
const TIER_XP         = { 1: 25,  2: 50,  3: 100, 4: 200, 5: 400 };

const RARITY_BONUS = { common: 5, uncommon: 10, rare: 20, epic: 35, legendary: 50 };
const LEVEL_SCALE  = { common: 0.5, uncommon: 0.8, rare: 1.2, epic: 1.8, legendary: 2.5 };

// Rarity weights per quest type. Tier shift applied at runtime.
// Fortune has only a modest edge on rarity — its advantage is in AMOUNT variance.
const BASE_LOOT_PROFILES = {
    combat:  [{ r: 'legendary', w: 1  }, { r: 'epic', w: 5  }, { r: 'rare', w: 20 }, { r: 'uncommon', w: 38 }, { r: 'common', w: 36 }],
    salvage: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 3  }, { r: 'rare', w: 12 }, { r: 'uncommon', w: 43 }, { r: 'common', w: 41 }],
    stealth: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 5  }, { r: 'rare', w: 18 }, { r: 'uncommon', w: 39 }, { r: 'common', w: 37 }],
    fortune: [{ r: 'legendary', w: 2  }, { r: 'epic', w: 7  }, { r: 'rare', w: 20 }, { r: 'uncommon', w: 36 }, { r: 'common', w: 35 }],
    defense: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 4  }, { r: 'rare', w: 15 }, { r: 'uncommon', w: 41 }, { r: 'common', w: 39 }],
};

// Amount range per relic rarity — fractional, Diablo-style random quantity per draw.
// Tier scale multiplied on top: T1×0.60, T2×0.95, T3×1.30, T4×1.65, T5×2.00
// Fortune Hunt also gets a per-draw variance multiplier (0.30×–3.00×) for true gambling feel.
const AMOUNT_BASE = {
    common:    { min: 0.40, max: 3.20 },
    uncommon:  { min: 0.25, max: 2.20 },
    rare:      { min: 0.12, max: 1.40 },
    epic:      { min: 0.06, max: 0.85 },
    legendary: { min: 0.08, max: 2.00 },
};

// Fractional affinity: attribute × 4 = expected extra draws (0–4 for attr 0–1.0).
// e.g. attr 0.51 → 2.04 raw → 2 guaranteed draws + 4% chance of a third.
// Caller must split into floor (guaranteed) + fractional (probabilistic) parts.
function getAffinityBonus(itemAttributeValue) {
    if (!itemAttributeValue || itemAttributeValue <= 0) return 0;
    return itemAttributeValue * 4;
}

function getLootTable(questType, tier) {
    const base = BASE_LOOT_PROFILES[questType] || BASE_LOOT_PROFILES.combat;
    const shift = (tier - 1) * 2;
    return base.map((entry, i) => ({
        rarity: entry.r,
        w: Math.max(1, i === 0 ? entry.w + shift * 2 : i === 1 ? entry.w + shift : i >= 3 ? entry.w - shift : entry.w),
    }));
}

function weightedDraw(rng, table) {
    const total = table.reduce((s, e) => s + e.w, 0);
    let roll = rng() * total;
    for (const entry of table) {
        roll -= entry.w;
        if (roll <= 0) return entry.rarity;
    }
    return table[table.length - 1].rarity;
}

// Roll a seeded fractional relic amount for one draw.
// rng has already advanced once (for the rarity draw), so subsequent calls continue the same seed sequence.
function drawAmount(rng, rarity, tier, questType) {
    const scale = 0.60 + (tier - 1) * 0.35;           // T1:0.60 T2:0.95 T3:1.30 T4:1.65 T5:2.00
    const base  = AMOUNT_BASE[rarity];
    const raw   = base.min + rng() * (base.max - base.min);
    const fortuneVariance = questType === 'fortune' ? 0.30 + rng() * 2.70 : 1.0;
    return Math.round(raw * scale * fortuneVariance * 100) / 100;
}

function r2(n) { return Math.round(n * 100) / 100; }  // round to 2dp, prevent float drift

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

        const tier    = quest.tier;
        const statReq = TIER_STAT_REQ[tier] || 10;

        // ── Effective roll ────────────────────────────────────
        const seed        = createSeed(blockId, trxId, username);
        const baseRoll    = rollDice(100, seed);
        const statMod     = Math.min((quest.effective_primary_stat - statReq) / statReq, 1.0);
        const secBonus    = quest.secondary_stat_value != null
            ? Math.min((quest.secondary_stat_value / statReq) * 10, 10) : 0;
        const itemBonus   = quest.equipped_item_rarity
            ? (RARITY_BONUS[quest.equipped_item_rarity] || 0) + (quest.equipped_item_level * (LEVEL_SCALE[quest.equipped_item_rarity] || 0))
            : 0;
        const effectiveRoll = baseRoll * (1 + statMod) + secBonus + itemBonus;

        // ── Draw count (split plateau for smoother progression) ──
        const baseRolls = quest.base_rolls || 2;
        let drawCount;
        let guaranteedLegendary = false;
        let shiftRareUp = false;

        if      (effectiveRoll <  30) { drawCount = Math.max(1, Math.floor(baseRolls * 0.50)); }
        else if (effectiveRoll <  50) { drawCount = Math.max(1, Math.floor(baseRolls * 0.75)); }
        else if (effectiveRoll <  65) { drawCount = baseRolls; }
        else if (effectiveRoll <  80) { drawCount = Math.ceil(baseRolls * 1.50); }
        else if (effectiveRoll <  91) { drawCount = baseRolls * 2; }
        else if (effectiveRoll <  96) { drawCount = baseRolls * 2 + 1; shiftRareUp = true; }
        else if (effectiveRoll < 100) { drawCount = baseRolls * 3; }
        else                          { drawCount = baseRolls * 3 + 1; guaranteedLegendary = true; }

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

            const rarity = weightedDraw(rng, table);  // consumes rng() once
            const amount = drawAmount(rng, rarity, tier, quest.quest_type);  // consumes rng() once or twice (fortune)
            relics[rarity] = r2((relics[rarity] || 0) + amount);
        }

        // Guaranteed legendary draw at 100+ effective roll (also fractional)
        if (guaranteedLegendary) {
            const legSeed = createSeed(blockId, trxId, username + '_leg_bonus');
            const legRng  = seedrandom(legSeed);
            const legAmt  = drawAmount(legRng, 'legendary', tier, quest.quest_type);
            relics.legendary = r2((relics.legendary || 0) + legAmt);
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
        webhook3(
            `${username} completed "${quest.name}" (T${tier} ${quest.quest_type}) — roll ${effectiveRoll.toFixed(1)}, ${drawCount} draws`,
            String(relics.common), String(relics.uncommon), String(relics.rare), String(relics.epic), String(relics.legendary)
        );

        console.log(`[SC] quest-collect: ${username} "${quest.name}" T${tier} — roll=${effectiveRoll.toFixed(1)} draws=${drawCount} relics: ${relicSummary}`);
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
