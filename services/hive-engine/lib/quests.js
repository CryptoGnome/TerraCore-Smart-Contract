const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { logError } = require('../../../shared/error-logger');
const { questStartWebhook } = require('./webhooks');

const TIER_LEVEL_REQ  = { 1: 1,   2: 10,  3: 25,  4: 50,  5: 100 };
// Upgradeable stats (damage, defense, engineering) — linear SCRAP progression
const TIER_STAT_REQ      = { 1: 10, 2: 50,  3: 100, 4: 200, 5: 500 };
// Item-only stats (luck, dodge) — can only be raised via NFT items + FLUX forging.
// Thresholds recalibrated after fixing double-count bug (API was writing itemLuck into
// player.stats, causing SC to count it twice). Values now match single-counted item totals.
// mirafun (best luck/dodge player, 47.13/43.94) is the only player who currently qualifies
// for T5 fortune/stealth, which is the intended endgame gate for dedicated luck/dodge builds.
const TIER_STAT_REQ_ITEM = { 1: 2,  2: 5,   3: 12,  4: 20,  5: 40  };
const ITEM_ONLY_STATS    = new Set(['luck', 'dodge']);

// T1/T2 raised (10→20, 50→100) as part of the low-tier anti-farm rebalance: low quests were a
// ~100× cheaper SCRAP→FLUX path than T5. NOTE: the frontend must send the new amount and the API
// version must be bumped in lockstep, or quest starts will be rejected as underpaid.
const TIER_BASE_COST  = { 1: 20,  2: 100, 3: 235, 4: 985, 5: 4010 };
const TIER_DURATION   = { 1: 1,   2: 4,   3: 12,  4: 24,  5: 48  };
const TIER_BASE_ROLLS = { 1: 2,   2: 3,   3: 4,   4: 6,   5: 10  };

// Maps quest type → primary stat, secondary stat, required item slot
const QUEST_TYPE_MAP = {
    combat:  { primary: 'damage',      secondary: 'crit',  item: 'weapon'  },
    salvage: { primary: 'engineering', secondary: null,    item: 'special' },
    stealth: { primary: 'dodge',       secondary: 'luck',  item: 'armor'   },
    fortune: { primary: 'luck',        secondary: 'crit',  item: 'avatar'  },
    defense: { primary: 'defense',     secondary: null,    item: 'ship'    },
};

// For luck/dodge we sum across ALL equipped item slots — these stats can't be
// upgraded directly so the full loadout should count, not just the quest item.
function getItemAttributeBonus(player, questType) {
    const mapping = QUEST_TYPE_MAP[questType];
    if (!mapping) return 0;
    const primaryStat = mapping.primary;
    if (ITEM_ONLY_STATS.has(primaryStat)) {
        let total = 0;
        if (player.items) {
            for (const slot of Object.values(player.items)) {
                if (slot && slot.attributes) total += slot.attributes[primaryStat] || 0;
            }
        }
        return total;
    }
    const item = player.items && player.items[mapping.item];
    if (!item || !item.attributes) return 0;
    return item.attributes[primaryStat] || 0;
}

function tierStatReq(tier, primaryStat) {
    return ITEM_ONLY_STATS.has(primaryStat) ? TIER_STAT_REQ_ITEM[tier] : TIER_STAT_REQ[tier];
}

async function startQuest(username, questType, tier, paidAmount) {
    try {
        const db = ctx.db;

        // price_feed holds quest_cost_multiplier — required for payment validation below
        const priceFeed = await db.collection('price_feed').findOne({ date: 'global' });
        if (!priceFeed) {
            console.log(`[HE] quest-start: price_feed missing, rejecting ${username}`);
            return false;
        }

        const mapping = QUEST_TYPE_MAP[questType];
        if (!mapping) {
            console.log(`[HE] quest-start: unknown quest type '${questType}' for ${username}`);
            return false;
        }
        if (!TIER_BASE_COST[tier]) {
            console.log(`[HE] quest-start: invalid tier ${tier} for ${username}`);
            return false;
        }

        // Fetch and validate current board
        const board = await db.collection('quest-board').findOne({});
        const todayDate = new Date().toISOString().slice(0, 10);
        if (!board || board.date !== todayDate) {
            console.log(`[HE] quest-start: quest board not current (board=${board ? board.date : 'none'}, today=${todayDate}) for ${username}`);
            return false;
        }
        const slot = board.slots.find(s => s.quest_type === questType && s.tier === tier);
        if (!slot) {
            console.log(`[HE] quest-start: no board slot for type=${questType} tier=${tier} for ${username}`);
            return false;
        }

        // Load template
        const { ObjectId } = require('mongodb');
        const template = await db.collection('quest-templates').findOne({ _id: new ObjectId(String(slot.template_id)) });
        if (!template) {
            console.log(`[HE] quest-start: template ${slot.template_id} not found for ${username}`);
            return false;
        }

        // Load player
        const player = await db.collection('players').findOne({ username });
        if (!player) {
            console.log(`[HE] quest-start: player ${username} not found`);
            return false;
        }

        // Level check
        const levelReq = TIER_LEVEL_REQ[tier];
        const playerLevel = player.level || 1;
        if (playerLevel < levelReq) {
            console.log(`[HE] quest-start: ${username} level ${playerLevel} < required ${levelReq} for tier ${tier}`);
            return false;
        }

        // Effective primary stat check (luck/dodge use item-specific thresholds + all-slot sum)
        // For item-only stats the base is always 0 — the API writes item luck/dodge into
        // player.stats which would double-count if we added itemBonus on top.
        const baseStats = player.stats || {};
        const itemBonus = getItemAttributeBonus(player, questType);
        const basePrimary = ITEM_ONLY_STATS.has(mapping.primary) ? 0 : (baseStats[mapping.primary] || 0);
        const effectivePrimary = basePrimary + itemBonus;
        const statReq = tierStatReq(tier, mapping.primary);
        if (effectivePrimary < statReq) {
            console.log(`[HE] quest-start: ${username} effective ${mapping.primary}=${effectivePrimary.toFixed(2)} < required ${statReq} for tier ${tier}`);
            return false;
        }

        // Item requirement (Tier 3+)
        // Player items are stored as { item_number, item_equipped, rarity, attributes, ... }
        // Check item_number (truthy = something is in that slot) not the legacy 'equipped' flag.
        if (tier >= 3) {
            const equippedItem = player.items && player.items[mapping.item];
            if (!equippedItem || !equippedItem.item_number) {
                console.log(`[HE] quest-start: ${username} missing equipped ${mapping.item} for tier ${tier}`);
                return false;
            }
        }

        // Slot lock: can't start same type+tier twice on same board date
        const existingSlotLock = await db.collection('active-quests').findOne({
            username,
            board_date: todayDate,
            quest_type: questType,
            tier,
        });
        if (existingSlotLock) {
            console.log(`[HE] quest-start: ${username} already started ${questType} tier ${tier} today`);
            return false;
        }

        // SCRAP payment validation (1% slippage tolerance)
        const multiplier = priceFeed.quest_cost_multiplier || 1.0;
        const expectedCost = Math.ceil(TIER_BASE_COST[tier] * multiplier);
        const minAccepted = Math.floor(expectedCost * 0.99);
        const paid = parseFloat(paidAmount);
        if (paid < minAccepted) {
            console.log(`[HE] quest-start: ${username} paid ${paid} SCRAP for tier ${tier}, expected >=${minAccepted} (base=${TIER_BASE_COST[tier]} × ${multiplier.toFixed(4)})`);
            return false;
        }

        // Snapshot item data at start time
        const equippedItem = player.items && player.items[mapping.item];
        const equippedItemRarity = equippedItem ? (equippedItem.rarity || null) : null;
        const equippedItemLevel = equippedItem ? (equippedItem.level || 1) : 1;
        // Item's specific primary-stat attribute — used for affinity draw bonus at collect time
        const itemAttributeValue = equippedItem && equippedItem.attributes ? (equippedItem.attributes[mapping.primary] || 0) : 0;
        const secondaryStatValue = mapping.secondary ? (baseStats[mapping.secondary] || 0) : null;

        const now = Date.now();
        const durationHours = TIER_DURATION[tier];
        const completesAt = now + durationHours * 3600000;
        const expiresAt = completesAt + 30 * 24 * 3600000;

        const activeQuest = {
            username,
            template_id: template._id,
            board_date: todayDate,
            quest_type: questType,
            tier,
            name: template.name,
            image_url: template.image_url || '',
            primary_stat: mapping.primary,
            secondary_stat: mapping.secondary,
            required_item_type: mapping.item,
            equipped_item_rarity: equippedItemRarity,
            equipped_item_level: equippedItemLevel,
            item_attribute_value: itemAttributeValue,
            effective_primary_stat: effectivePrimary,
            secondary_stat_value: secondaryStatValue,
            base_rolls: TIER_BASE_ROLLS[tier],
            scrap_paid: paid,
            multiplier_applied: multiplier,
            started_at: now,
            completes_at: completesAt,
            expires_at: expiresAt,
            collected: false,
        };

        await db.collection('active-quests').insertOne(activeQuest);

        // Reset last_upgrade_time on quest start
        await db.collection('players').updateOne(
            { username },
            { $set: { last_upgrade_time: now }, $inc: { version: 1 } }
        );

        // Log
        await db.collection('quest-log').insertOne({
            username,
            action: 'start',
            quest_type: questType,
            tier,
            name: template.name,
            board_date: todayDate,
            started_at: now,
            completes_at: completesAt,
            scrap_paid: paid,
            time: new Date(),
        });

        // Daily stats
        const statDate = todayDate;
        await db.collection('stats').updateOne(
            { date: statDate },
            { $inc: { quests_started: 1, scrap_burned_quests: paid } },
            { upsert: true }
        );

        console.log(`[HE] quest-start: ${username} started ${questType} tier ${tier} "${template.name}" (${durationHours}h, paid ${paid} SCRAP)`);
        questStartWebhook(username, template.name, tier, questType, durationHours, paid, template.image_url || '');
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            logError('SYS_MONGO_CLOSED', err, { fn: 'startQuest', service: 'HE' }, 'FATAL');
            ctx.client.close();
            process.exit(1);
        } else {
            logError('HE_QUEST_START_FAIL', err, { fn: 'startQuest', username, questType, tier });
            return false;
        }
    }
}

module.exports = { startQuest };
