// Pure quest reward math, extracted verbatim from quests.js (collectQuest) so the exact
// same logic can be driven by the economy simulation (scripts/quest-economy-sim.js) without
// a DB, AND so the balance constants live in ONE place that both production and the sim import.
//
// Nothing here touches ctx/Mongo or broadcasts anything — all randomness is supplied by the
// caller's seeded rng so outcomes stay reproducible/verifiable on-chain (see shared/rng.js).
//
// Every function accepts an optional `cfg` override used only by the simulation to sweep
// candidate balance values. When `cfg` is omitted the production defaults below apply, so
// requiring this module from collectQuest is behaviour-preserving.

// ── Rarity weights per quest type. Tier shift applied at runtime by getLootTable(). ──────────
// Fortune has only a modest edge on rarity — its advantage is in AMOUNT variance.
const BASE_LOOT_PROFILES = {
    combat:  [{ r: 'legendary', w: 1  }, { r: 'epic', w: 5  }, { r: 'rare', w: 20 }, { r: 'uncommon', w: 38 }, { r: 'common', w: 36 }],
    salvage: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 3  }, { r: 'rare', w: 12 }, { r: 'uncommon', w: 43 }, { r: 'common', w: 41 }],
    stealth: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 5  }, { r: 'rare', w: 18 }, { r: 'uncommon', w: 39 }, { r: 'common', w: 37 }],
    fortune: [{ r: 'legendary', w: 2  }, { r: 'epic', w: 7  }, { r: 'rare', w: 20 }, { r: 'uncommon', w: 36 }, { r: 'common', w: 35 }],
    defense: [{ r: 'legendary', w: 1  }, { r: 'epic', w: 4  }, { r: 'rare', w: 15 }, { r: 'uncommon', w: 41 }, { r: 'common', w: 39 }],
};

// Amount range per relic rarity — fractional, Diablo-style random quantity per draw.
const AMOUNT_BASE = {
    common:    { min: 0.01, max: 1.49 },  // avg 0.75
    uncommon:  { min: 0.01, max: 1.01 },  // avg 0.51
    rare:      { min: 0.01, max: 0.60 },  // avg 0.305
    epic:      { min: 0.01, max: 0.37 },  // avg 0.19
    legendary: { min: 0.01, max: 0.53 },  // avg 0.27
};

// Inverse tier scale: higher tiers give FEWER relics per draw but FAR better rarity.
// T1=0.70 (most relics/draw, all common/uncommon) → T5=0.32 (fewest/draw, 15.7% legendary).
const TIER_SCALE = { 1: 0.70, 2: 0.58, 3: 0.48, 4: 0.40, 5: 0.32 };

// 2% per-draw jackpot: bumps rarity one tier + 3× amount. Pure RNG, uses a separate seed.
const JACKPOT_CHANCE = 0.02;
const RARITY_BUMP = { common: 'uncommon', uncommon: 'rare', rare: 'epic', epic: 'legendary', legendary: 'legendary' };

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Low-tier rarity collapse (anti-farm Lever A2). Multiplies the post-shift legendary/epic/rare
// weights at low tiers so cheaply-farmed T1/T2 quests yield almost entirely common/uncommon relics
// (preserving relic COUNT for new-player gear progression while killing cheap FLUX/legendaries).
// Ramps back to full rarity by T4/T5 — the intended home for legendary loot. cfg.rarityTierMult overrides.
const LOW_TIER_RARITY_MULT = {
    1: { legendary: 0,    epic: 0.05, rare: 0.30 },
    2: { legendary: 0.10, epic: 0.30, rare: 0.55 },
    3: { legendary: 0.55, epic: 0.80 },
};

// Gear-based investment factor config (anti-farm Lever B). Bare accounts (no equipped gear in the
// quest slot) earn `floor` of the relics; equipping rarer, higher-forge-level gear ramps to full.
// collectQuest passes this explicitly; computeInvestmentFactor with no cfg is a no-op (factor 1.0).
const DEFAULT_INVESTMENT = {
    floor: 0.30,
    rarityWeight: { none: 0, common: 0.10, uncommon: 0.30, rare: 0.60, epic: 0.85, legendary: 1.0 },
    levelFull: 10,
    levelBase: 0.6,
};

function r2(n) { return Math.round(n * 100) / 100; }  // round to 2dp, prevent float drift

// Affinity bonus: item's primary stat attribute contributes 0–1 extra draw.
// Raw = attribute × 4, capped at 1.0. Split into floor (guaranteed) + fractional (probabilistic).
// Cap is critical — damage/defense attrs are stored at 10× scale (range 6–60), luck/dodge
// are 1× scale (range 0.6–6). Without the cap, a weapon with damage_attr=9.6 would give
// 38 bonus draws, completely breaking rewards.
function getAffinityBonus(itemAttributeValue) {
    if (!itemAttributeValue || itemAttributeValue <= 0) return 0;
    return Math.min(itemAttributeValue * 4, 1.0);
}

// Build the loot weight table for a quest type + tier.
// shift = (tier-1)*2 buffs legendary (×2) and epic (×1) while nerfing uncommon/common with tier.
// Optional cfg.rarityTierMult[tier] = { legendary: m, epic: m, ... } multiplies specific weights
// AFTER the shift (and may drop a weight below 1, even to 0) — used to deflate low-tier rarity.
function getLootTable(questType, tier, cfg) {
    const profiles = (cfg && cfg.baseLootProfiles) || BASE_LOOT_PROFILES;
    const base = profiles[questType] || profiles.combat;
    const shift = (tier - 1) * 2;
    let table = base.map((entry, i) => ({
        rarity: entry.r,
        w: Math.max(1, i === 0 ? entry.w + shift * 2 : i === 1 ? entry.w + shift : i >= 3 ? entry.w - shift : entry.w),
    }));
    // Low-tier rarity collapse. cfg.rarityTierMult overrides the built-in LOW_TIER_RARITY_MULT
    // (pass an empty object to disable, e.g. for modelling pre-rebalance behaviour).
    const mult = (cfg && cfg.rarityTierMult) ? cfg.rarityTierMult[tier] : LOW_TIER_RARITY_MULT[tier];
    if (mult) {
        table = table.map(e => ({
            rarity: e.rarity,
            w: mult[e.rarity] != null ? e.w * mult[e.rarity] : e.w,
        }));
    }
    return table;
}

function weightedDraw(rng, table) {
    const total = table.reduce((s, e) => s + e.w, 0);
    let roll = rng() * total;
    for (const entry of table) {
        if (entry.w <= 0) continue;   // never select a zero-weight rarity (e.g. legendary at T1 under LOW_TIER_RARITY_MULT)
        roll -= entry.w;
        if (roll <= 0) return entry.rarity;
    }
    return table[table.length - 1].rarity;
}

// Roll a seeded fractional relic amount for one draw.
// rng has already advanced once (for the rarity draw), so subsequent calls continue the same seed sequence.
// cfg.tierScale overrides TIER_SCALE (Lever A); cfg.amountBase overrides AMOUNT_BASE.
function drawAmount(rng, rarity, tier, questType, cfg) {
    const tierScale = (cfg && cfg.tierScale) || TIER_SCALE;
    const amountBase = (cfg && cfg.amountBase) || AMOUNT_BASE;
    const scale = tierScale[tier] || 0.70;
    const base  = amountBase[rarity];
    const raw   = base.min + rng() * (base.max - base.min);
    const fortuneVariance = 0.20 + rng() * 1.60; // all quest types, avg=1.0, range 0.20–1.80
    return Math.round(raw * scale * fortuneVariance * 100) / 100;
}

// Stat-skill component of the roll (item gives draw-count bonus separately).
// statMod: wider denominator (4×req) + lower cap (0.75) so maxing requires significantly
// more than the bare minimum stat. effectiveRoll range: 0–183 (100 × 1.75 + 8).
function computeEffectiveRoll(baseRoll, effectivePrimaryStat, statReq, secondaryStatValue) {
    const statMod = Math.max(0, Math.min(
        (effectivePrimaryStat - statReq) / (statReq * 4), 0.75
    ));
    const secBonus = secondaryStatValue != null
        ? Math.min((secondaryStatValue / Math.max(statReq, 1)) * 8, 8) : 0;
    return baseRoll * (1 + statMod) + secBonus;
}

// Map effectiveRoll → number of loot draws, plus the rareUp/guaranteed-legendary flags.
// Brackets tuned to the 0–183 effectiveRoll range.
function computeDrawCount(effectiveRoll, baseRolls) {
    let drawCount;
    let guaranteedLegendary = false;
    let shiftRareUp = false;

    if      (effectiveRoll <  35) { drawCount = Math.max(1, Math.floor(baseRolls * 0.50)); }
    else if (effectiveRoll <  65) { drawCount = baseRolls; }
    else if (effectiveRoll < 100) { drawCount = Math.ceil(baseRolls * 1.50); }
    else if (effectiveRoll < 130) { drawCount = baseRolls * 2; }
    else if (effectiveRoll < 155) { drawCount = Math.ceil(baseRolls * 2.5); shiftRareUp = true; }
    else if (effectiveRoll < 175) { drawCount = baseRolls * 3; }
    else                          { drawCount = baseRolls * 3; guaranteedLegendary = true; }

    return { drawCount, guaranteedLegendary, shiftRareUp };
}

// Gear-based investment factor (Lever B). Multiplies the relics a quest awards by how much
// real, leveled NFT gear the account has equipped in the quest's slot. Bare farm accounts
// running gear-free T1/T2 sit at the floor; well-geared accounts earn the full reward.
//
// Returns 1.0 (no-op) when cfg is omitted, so it is safe to leave un-wired during the refactor.
// cfg = { floor, rarityWeight: {none,common,...,legendary}, levelFull, levelBase }
//   gearScore = rarityWeight[rarity] × (levelBase + (1-levelBase)·levelComponent)
//   factor    = floor + (1 - floor) × gearScore     (clamped to [floor, 1])
function computeInvestmentFactor(itemRarity, itemLevel, cfg) {
    if (!cfg) return 1.0;
    const floor = cfg.floor != null ? cfg.floor : 1.0;
    const rarityWeight = cfg.rarityWeight || { none: 0, common: 0.15, uncommon: 0.35, rare: 0.6, epic: 0.8, legendary: 1.0 };
    const levelFull = cfg.levelFull || 10;
    const levelBase = cfg.levelBase != null ? cfg.levelBase : 0.6;

    const rw = itemRarity && rarityWeight[itemRarity] != null ? rarityWeight[itemRarity] : (rarityWeight.none || 0);
    const lvl = Math.max(1, itemLevel || 1);
    const levelComponent = levelFull > 1 ? Math.min((lvl - 1) / (levelFull - 1), 1) : 1;
    const gearScore = Math.min(rw * (levelBase + (1 - levelBase) * levelComponent), 1);
    const factor = floor + (1 - floor) * gearScore;
    return Math.min(Math.max(factor, floor), 1);
}

module.exports = {
    BASE_LOOT_PROFILES,
    AMOUNT_BASE,
    TIER_SCALE,
    JACKPOT_CHANCE,
    RARITY_BUMP,
    RARITY_ORDER,
    LOW_TIER_RARITY_MULT,
    DEFAULT_INVESTMENT,
    r2,
    getAffinityBonus,
    getLootTable,
    weightedDraw,
    drawAmount,
    computeEffectiveRoll,
    computeDrawCount,
    computeInvestmentFactor,
};
