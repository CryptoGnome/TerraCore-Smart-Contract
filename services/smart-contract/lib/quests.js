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

// Per-type loot profiles — weights are relative, not percentages
// Higher tiers shift +2 weight per tier toward rarer outcomes
const BASE_LOOT_PROFILES = {
    combat:  [{ rarity: 'legendary', w: 2 }, { rarity: 'epic', w: 8  }, { rarity: 'rare', w: 20 }, { rarity: 'uncommon', w: 35 }, { rarity: 'common', w: 35 }],
    salvage: [{ rarity: 'legendary', w: 1 }, { rarity: 'epic', w: 5  }, { rarity: 'rare', w: 14 }, { rarity: 'uncommon', w: 40 }, { rarity: 'common', w: 40 }],
    stealth: [{ rarity: 'legendary', w: 2 }, { rarity: 'epic', w: 8  }, { rarity: 'rare', w: 20 }, { rarity: 'uncommon', w: 35 }, { rarity: 'common', w: 35 }],
    fortune: [{ rarity: 'legendary', w: 5 }, { rarity: 'epic', w: 15 }, { rarity: 'rare', w: 25 }, { rarity: 'uncommon', w: 30 }, { rarity: 'common', w: 25 }],
    defense: [{ rarity: 'legendary', w: 1 }, { rarity: 'epic', w: 6  }, { rarity: 'rare', w: 18 }, { rarity: 'uncommon', w: 38 }, { rarity: 'common', w: 37 }],
};

function getLootTable(questType, tier) {
    const base = BASE_LOOT_PROFILES[questType] || BASE_LOOT_PROFILES.combat;
    // Shift weights toward rarer tiers by tier level (tier 1 = no shift, tier 5 = +8 to legendary/epic)
    const shift = (tier - 1) * 2;
    const rarities = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    const shifted = base.map((entry, i) => {
        let w = entry.w;
        if (i === 0) w += shift * 2;       // legendary gets biggest boost
        else if (i === 1) w += shift;       // epic gets moderate boost
        else if (i >= 3) w = Math.max(1, w - shift); // uncommon/common shed weight
        return { rarity: entry.rarity, w: Math.max(1, w) };
    });
    return shifted;
}

function weightedDraw(rng, table) {
    const total = table.reduce((sum, e) => sum + e.w, 0);
    let roll = rng() * total;
    for (const entry of table) {
        roll -= entry.w;
        if (roll <= 0) return entry.rarity;
    }
    return table[table.length - 1].rarity;
}

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

        // Fetch the quest
        let objectId;
        try {
            objectId = new ObjectId(questId);
        } catch {
            console.log(`[SC] quest-collect: invalid questId '${questId}' for ${username}`);
            return false;
        }

        const quest = await db.collection('active-quests').findOne({ _id: objectId, username });
        if (!quest) {
            console.log(`[SC] quest-collect: quest ${questId} not found for ${username}`);
            return false;
        }
        if (quest.collected) {
            console.log(`[SC] quest-collect: quest ${questId} already collected by ${username}`);
            return false;
        }

        // Timer check
        if (quest.completes_at > Date.now()) {
            console.log(`[SC] quest-collect: quest ${questId} not ready for ${username} (${Math.ceil((quest.completes_at - Date.now()) / 60000)}m remaining)`);
            return false;
        }

        const tier = quest.tier;
        const statReq = TIER_STAT_REQ[tier] || 10;

        // Compute effective roll
        const seed = createSeed(blockId, trxId, username);
        const baseRoll = rollDice(100, seed); // 0–100

        const statModifier = Math.min((quest.effective_primary_stat - statReq) / statReq, 1.0);
        const secondaryBonus = quest.secondary_stat_value != null
            ? Math.min((quest.secondary_stat_value / statReq) * 10, 10)
            : 0;
        const itemBonus = quest.equipped_item_rarity
            ? (RARITY_BONUS[quest.equipped_item_rarity] || 0) + (quest.equipped_item_level * (LEVEL_SCALE[quest.equipped_item_rarity] || 0))
            : 0;
        const effectiveRoll = baseRoll * (1 + statModifier) + secondaryBonus + itemBonus;

        // Map effective roll to draw count
        const baseRolls = quest.base_rolls || 2;
        let drawCount;
        let guaranteedLegendary = false;
        let shiftRareUp = false;

        if (effectiveRoll < 40) {
            drawCount = Math.max(1, Math.floor(baseRolls * 0.5));
        } else if (effectiveRoll < 65) {
            drawCount = baseRolls;
        } else if (effectiveRoll < 80) {
            drawCount = Math.ceil(baseRolls * 1.5);
        } else if (effectiveRoll < 91) {
            drawCount = baseRolls * 2;
        } else if (effectiveRoll < 96) {
            drawCount = baseRolls * 2 + 1;
            shiftRareUp = true;
        } else if (effectiveRoll < 100) {
            drawCount = baseRolls * 3;
        } else {
            drawCount = baseRolls * 3 + 1;
            guaranteedLegendary = true;
        }

        // Execute loot draws
        const lootTable = getLootTable(quest.quest_type, tier);
        const relics = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };

        for (let i = 0; i < drawCount; i++) {
            const drawSeed = createSeed(blockId, trxId, username + '_drop_' + i);
            const rng = seedrandom(drawSeed);

            let table = lootTable;
            // For the rare-shifted draw (effectiveRoll 91-95), boost rare+
            if (shiftRareUp && i === drawCount - 1) {
                table = lootTable.map(e => ({
                    rarity: e.rarity,
                    w: ['legendary', 'epic', 'rare'].includes(e.rarity) ? e.w * 3 : e.w,
                }));
            }

            const rarity = weightedDraw(rng, table);
            relics[rarity] = (relics[rarity] || 0) + 1;
        }

        // Guaranteed legendary draw on 100+ roll
        if (guaranteedLegendary) {
            relics.legendary = (relics.legendary || 0) + 1;
        }

        // Issue relics
        for (const [rarity, count] of Object.entries(relics)) {
            if (count > 0) {
                await issue(username, rarity + '_relics', count);
            }
        }

        // Award XP
        const xpGain = TIER_XP[tier] || 25;
        await db.collection('players').updateOne(
            { username },
            { $inc: { experience: xpGain, version: 1 } }
        );

        // Mark quest collected
        await db.collection('active-quests').updateOne(
            { _id: objectId },
            { $set: { collected: true, collected_at: Date.now() } }
        );

        // Log
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

        // Daily stats
        const statDate = new Date().toISOString().slice(0, 10);
        await db.collection('stats').updateOne(
            { date: statDate },
            { $inc: { quests_collected: 1 } },
            { upsert: true }
        );

        // Discord notification
        const relicSummary = Object.entries(relics)
            .filter(([, c]) => c > 0)
            .map(([r, c]) => `${c}× ${r}`)
            .join(', ');
        webhook3(
            `${username} collected quest "${quest.name}" (T${tier} ${quest.quest_type})`,
            relics.common.toString(),
            relics.uncommon.toString(),
            relics.rare.toString(),
            relics.epic.toString(),
            relics.legendary.toString()
        );

        console.log(`[SC] quest-collect: ${username} completed "${quest.name}" T${tier} — roll=${effectiveRoll.toFixed(1)} draws=${drawCount} relics: ${relicSummary}`);
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
