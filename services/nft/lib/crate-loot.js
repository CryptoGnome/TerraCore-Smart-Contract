// Pure crate→item→salvage math, extracted verbatim from open_crate (crates.js) and
// salvageNFT (items.js) so the economy simulation (scripts/quest-economy-sim.js) can compute
// the FLUX value of a crate without a DB, and so the tunable crate upgrade odds live in ONE
// place that both production and the sim import.
//
// Nothing here touches ctx/Mongo. All randomness is supplied by the caller's seeded rng, and
// `roll` is the integer in [0,99999] produced by generateRandomNumber() in shared/rng.js.
// Each function takes an optional `cfg` override used only by the sim to sweep candidate
// balance values; with cfg omitted the production defaults apply (behaviour-preserving).

// Crate-rarity → item-rarity upgrade ladder. First entry whose `roll <= max` wins.
// These thresholds are EXACTLY equivalent to the original if/else in open_crate for integer
// rolls in [0,99999] (the original used `<` for rare/epic crates, so those maxes are -1).
//   common  crate: 90% common, 9% uncommon, 0.75% rare, 0.20% epic, 0.05% legendary
//   uncommon crate: 95% uncommon, 4% rare, 0.90% epic, 0.10% legendary
//   rare crate: 95% rare, 4% epic, 1% legendary
//   epic crate: 98% epic, 2% legendary
//   legendary crate: 100% legendary
// Left UNCHANGED by the low-tier rebalance: the sim showed the crate-upgrade backdoor is already a
// dead path once relic rarity is collapsed at T1/T2 (a legendary via common crates costs ~48M SCRAP
// vs ~2.7M to farm a legendary relic legitimately at T3). cfg.ladders can still override (sim/tuning).
const DEFAULT_LADDERS = {
    common:    [{ max: 90000, r: 'common' }, { max: 99000, r: 'uncommon' }, { max: 99750, r: 'rare' }, { max: 99950, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    uncommon:  [{ max: 95000, r: 'uncommon' }, { max: 99000, r: 'rare' }, { max: 99900, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    rare:      [{ max: 94999, r: 'rare' }, { max: 98999, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    epic:      [{ max: 97999, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    legendary: [{ max: Infinity, r: 'legendary' }],
};

// Resolve the item rarity an opened crate produces. cfg.ladders overrides DEFAULT_LADDERS (Lever C).
function rollItemRarity(crateRarity, roll, cfg) {
    const ladders = (cfg && cfg.ladders) || DEFAULT_LADDERS;
    const ladder = ladders[crateRarity];
    if (!ladder) return crateRarity;
    for (const step of ladder) {
        if (roll <= step.max) return step.r;
    }
    return ladder[ladder.length - 1].r;
}

// Generate an item's attribute set for a given type + rarity, consuming `rng` in the exact
// order open_crate did (epic 4/5 roll → attribute selection → value rolls). Returns the
// rarity_index, the attribute_list (all six keys, zero-filled), and att_count.
function rollItemAttributes(type, rarity, rng) {
    const attributes = ['damage', 'defense', 'engineering', 'dodge', 'crit', 'luck'];

    let rarity_index = 1;
    if (rarity == 'uncommon') {
        rarity_index = 2;
    } else if (rarity == 'rare') {
        rarity_index = 3;
    } else if (rarity == 'epic') {
        let roll = Math.floor(rng() * 100) + 1;
        rarity_index = (roll <= 50) ? 4 : 5;
    } else if (rarity == 'legendary') {
        rarity_index = 6;
    }

    var attributes_chosen = [];
    let att_count = 0;
    for (var i = 0; i < rarity_index; i++) {
        if (i == 0) {
            if (type == 'weapon') {
                attributes_chosen.push('damage');
                attributes.splice(0, 1);
            } else if (type == 'armor') {
                attributes_chosen.push('defense');
                attributes.splice(1, 1);
            } else if (type == 'ship') {
                let roll = Math.floor(rng() * attributes.length);
                attributes_chosen.push(attributes[roll]);
                attributes.splice(roll, 1);
            } else if (type == 'special') {
                let roll = Math.floor(rng() * attributes.length);
                attributes_chosen.push(attributes[roll]);
                attributes.splice(roll, 1);
            } else if (type == 'avatar') {
                let roll = Math.floor(rng() * attributes.length);
                attributes_chosen.push(attributes[roll]);
                attributes.splice(roll, 1);
            }
        } else {
            var roll = Math.floor(rng() * attributes.length);
            attributes_chosen.push(attributes[roll]);
            attributes.splice(roll, 1);
        }
    }

    let attribute_list = new Object();
    for (var j = 0; j < attributes_chosen.length; j++) {
        if (attributes_chosen[j] == 'damage') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.damage = (roll * 10);
            att_count += 1;
        } else if (attributes_chosen[j] == 'defense') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.defense = (roll * 10);
            att_count += 1;
        } else if (attributes_chosen[j] == 'engineering') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.engineering = roll;
            att_count += 1;
        } else if (attributes_chosen[j] == 'dodge') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.dodge = roll;
            att_count += 1;
        } else if (attributes_chosen[j] == 'crit') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.crit = roll;
            att_count += 1;
        } else if (attributes_chosen[j] == 'luck') {
            let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
            attribute_list.luck = roll;
            att_count += 1;
        }
    }

    if (attribute_list.damage == null)      attribute_list.damage = 0;
    if (attribute_list.defense == null)     attribute_list.defense = 0;
    if (attribute_list.engineering == null) attribute_list.engineering = 0;
    if (attribute_list.dodge == null)       attribute_list.dodge = 0;
    if (attribute_list.crit == null)        attribute_list.crit = 0;
    if (attribute_list.luck == null)        attribute_list.luck = 0;

    return { rarity_index, attributes: attribute_list, att_count };
}

// FLUX value of salvaging an item — exact formula from salvageNFT (items.js).
function salvageValue(attributes) {
    return attributes.damage / 2 + attributes.defense / 2 + attributes.engineering * 5
        + attributes.dodge * 5 + attributes.crit * 5 + attributes.luck * 10;
}

module.exports = { DEFAULT_LADDERS, rollItemRarity, rollItemAttributes, salvageValue };
