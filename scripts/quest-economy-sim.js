/* eslint-disable no-console */
//
// quest-economy-sim.js — Monte Carlo model of the TerraCore quest → relic → crate → item →
// salvage → FLUX pipeline, used to diagnose the low-tier FLUX arbitrage and tune the rebalance.
//
// It imports the SAME pure functions production uses (services/smart-contract/lib/quest-loot.js
// and services/nft/lib/crate-loot.js), so the model can't drift from the game. Candidate balance
// changes are passed as a `cfg` override object (see SCENARIOS below) — exactly the shape the
// pure functions accept — so "tuned in the sim" == "shipped in prod".
//
// Usage:
//   node scripts/quest-economy-sim.js                 # baseline + all tuned scenarios
//   node scripts/quest-economy-sim.js --scenario baseline
//   node scripts/quest-economy-sim.js --iters 200000
//   node scripts/quest-economy-sim.js --verify-parity # confirm the extraction didn't change behaviour
//
const QL = require('../services/smart-contract/lib/quest-loot');
const CL = require('../services/nft/lib/crate-loot');

// Self-contained deterministic PRNG (mulberry32) so the sim has no external deps. Production uses
// seedrandom, but a Monte Carlo EV only needs a good uniform stream, not bit-identical sequences.
function makeRng(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Tier constants mirrored from services/hive-engine/lib/quests.js (T1/T2 raised by the rebalance) ──
const TIER_BASE_COST  = { 1: 20, 2: 100, 3: 235, 4: 985, 5: 4010 };
const TIER_BASE_ROLLS = { 1: 2,  2: 3,  3: 4,   4: 6,   5: 10  };
const TIER_STAT_REQ      = { 1: 10, 2: 50, 3: 100, 4: 200, 5: 500 };
const TIER_STAT_REQ_ITEM = { 1: 2,  2: 5,  3: 12,  4: 20,  5: 40  };
const QUEST_TYPE_MAP = {
    combat:  { primary: 'damage',      secondary: 'crit' },
    salvage: { primary: 'engineering', secondary: null   },
    stealth: { primary: 'dodge',       secondary: 'luck' },
    fortune: { primary: 'luck',        secondary: 'crit' },
    defense: { primary: 'defense',     secondary: null   },
};
const ITEM_ONLY = new Set(['luck', 'dodge']);
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const TYPES = ['avatar', 'armor', 'weapon', 'special', 'ship'];

// Oracle peg: 3.0 HIVE/FLUX ÷ 0.0003 HIVE/SCRAP = 10,000 SCRAP per FLUX (the "fair" rate).
const ORACLE_SCRAP_PER_FLUX = 10000;

function statReqFor(tier, questType) {
    const primary = QUEST_TYPE_MAP[questType].primary;
    return ITEM_ONLY.has(primary) ? TIER_STAT_REQ_ITEM[tier] : TIER_STAT_REQ[tier];
}

// ── Account profiles ─────────────────────────────────────────────────────────────────────────
// statMult: effective primary stat = statReq × statMult (1 = bare minimum → statMod 0; 4 = capped 0.75).
// secMult:  secondary stat value   = statReq × secMult.
// gear:     equipped item in the quest slot {rarity, level, attr} (attr = primary-stat attribute value).
const PROFILES = {
    // The abuse case: brand-new bot, no gear, minimum stat to qualify.
    farm:    { statMult: 1, secMult: 0,   gear: { rarity: null,        level: 1,  attr: 0  } },
    // Legit newcomer with a first common drop equipped.
    new:     { statMult: 1, secMult: 0,   gear: { rarity: 'common',    level: 1,  attr: 5  } },
    // Mid-game player, decent gear + some stat investment.
    mid:     { statMult: 2, secMult: 0.5, gear: { rarity: 'epic',      level: 5,  attr: 25 } },
    // Endgame player: maxed stats + leveled legendary gear (hits draw multipliers + guaranteed leg).
    endgame: { statMult: 4, secMult: 1,   gear: { rarity: 'legendary', level: 10, attr: 40 } },
};

// ── Expected salvage FLUX per crate rarity (Monte Carlo over open_crate's pure logic) ──────────
// A relic of rarity X forges a crate of rarity X (forgeCrate), so FLUX per relic = EV[crate X] / 100.
function crateFluxEV(rng, cfg, iters) {
    const perCrate = {};
    const upgradeDist = {};
    for (const cr of RARITIES) {
        let s = 0;
        const dist = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
        for (let k = 0; k < iters; k++) {
            const type = TYPES[Math.floor(rng() * TYPES.length)];
            const roll = Math.floor(rng() * 100000);
            const itemRarity = CL.rollItemRarity(cr, roll, cfg && cfg.crate);
            dist[itemRarity]++;
            const attrs = CL.rollItemAttributes(type, itemRarity, rng).attributes;
            s += CL.salvageValue(attrs);
        }
        perCrate[cr] = s / iters;
        for (const r of RARITIES) dist[r] /= iters;
        upgradeDist[cr] = dist;
    }
    const perRelic = {};
    for (const cr of RARITIES) perRelic[cr] = perCrate[cr] / 100;
    return { perCrate, perRelic, upgradeDist };
}

// ── Simulate collecting one quest tier/type for a profile, averaged over `iters` runs ──────────
function simulateQuest(tier, questType, profileName, cfg, perRelic, rng, iters) {
    const profile = PROFILES[profileName];
    const baseRolls = TIER_BASE_ROLLS[tier];
    const statReq = statReqFor(tier, questType);
    const effPrimary = statReq * profile.statMult;
    const secondary = QUEST_TYPE_MAP[questType].secondary ? statReq * profile.secMult : null;
    const { rarity: itemRarity, level: itemLevel, attr: itemAttr } = profile.gear;

    const relicTotals = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    let totalFlux = 0;
    let totalDraws = 0;

    for (let it = 0; it < iters; it++) {
        const baseRoll = rng() * 99 + 1; // rollDice(100): rng()*(100-0.01*100)+0.01*100
        const effRoll = QL.computeEffectiveRoll(baseRoll, effPrimary, statReq, secondary);
        const di = QL.computeDrawCount(effRoll, baseRolls);
        let drawCount = di.drawCount;

        // Item draw bonuses (same as collectQuest)
        if (['rare', 'epic', 'legendary'].includes(itemRarity)) drawCount += 1;
        const levelChance = itemRarity ? Math.min((itemLevel - 1) * 0.05, 1.0) : 0;
        if (levelChance > 0 && rng() < levelChance) drawCount += 1;
        const rawAff = QL.getAffinityBonus(itemAttr);
        const affGuar = Math.floor(rawAff);
        const affFrac = rawAff - affGuar;
        drawCount += affGuar + (affFrac > 0 && rng() < affFrac ? 1 : 0);

        const lootTable = QL.getLootTable(questType, tier, cfg && cfg.loot);
        const relics = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };

        for (let i = 0; i < drawCount; i++) {
            let table = lootTable;
            if (di.shiftRareUp && i === drawCount - 1) {
                table = lootTable.map(e => ({ rarity: e.rarity, w: ['legendary', 'epic', 'rare'].includes(e.rarity) ? e.w * 3 : e.w }));
            }
            let rarity = QL.weightedDraw(rng, table);
            const jackpot = rng() < QL.JACKPOT_CHANCE;
            if (jackpot) rarity = QL.RARITY_BUMP[rarity] || rarity;
            const amount = QL.drawAmount(rng, rarity, tier, questType, cfg && cfg.amount);
            const finalAmount = jackpot ? QL.r2(amount * 3) : amount;
            relics[rarity] = QL.r2((relics[rarity] || 0) + finalAmount);
        }
        if (di.guaranteedLegendary) {
            const legAmt = QL.drawAmount(rng, 'legendary', tier, questType, cfg && cfg.amount);
            relics.legendary = QL.r2((relics.legendary || 0) + legAmt);
        }

        // Lever B: gear-based investment factor (no-op when cfg.investment is undefined)
        const factor = QL.computeInvestmentFactor(itemRarity, itemLevel, cfg && cfg.investment);
        totalDraws += drawCount;
        for (const r of RARITIES) {
            const amt = relics[r] * factor;
            relicTotals[r] += amt;
            totalFlux += amt * perRelic[r];
        }
    }

    const relicsAvg = {};
    for (const r of RARITIES) relicsAvg[r] = relicTotals[r] / iters;
    const totalRelics = RARITIES.reduce((s, r) => s + relicsAvg[r], 0);
    const fluxPerQuest = totalFlux / iters;
    const cost = (cfg && cfg.tierCost && cfg.tierCost[tier]) || TIER_BASE_COST[tier];
    return {
        tier, questType, profile: profileName,
        relicsAvg,
        totalRelics,
        drawsAvg: totalDraws / iters,
        fluxPerQuest,
        cost,
        scrapPerFlux: fluxPerQuest > 0 ? cost / fluxPerQuest : Infinity,
    };
}

function fmt(n, d = 2) { return Number(n).toFixed(d); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function reportScenario(name, cfg, iters, rng) {
    console.log('\n' + '='.repeat(96));
    console.log('SCENARIO: ' + name);
    console.log('='.repeat(96));

    const ev = crateFluxEV(rng, cfg, Math.max(50000, Math.floor(iters / 2)));
    console.log('\nFLUX per crate (avg salvage of opened item) / per relic [=crate/100]:');
    console.log('  ' + RARITIES.map(r => `${r}: ${fmt(ev.perCrate[r], 1)} (${fmt(ev.perRelic[r], 4)}/relic)`).join('   '));
    console.log('  common-crate item upgrade dist: ' +
        RARITIES.map(r => `${r} ${fmt(ev.upgradeDist.common[r] * 100, 3)}%`).join('  '));

    // Headline arbitrage table: min-stat / no-gear (the farm case), combat.
    console.log('\nArbitrage table — profile=farm (min stat, no gear), combat:');
    console.log('  ' + pad('Tier', 6) + padl('SCRAP', 7) + padl('FLUX/quest', 12) + padl('SCRAP/FLUX', 12) + padl('vs peg', 8) + padl('relics/q', 10) + padl('leg/q', 9));
    const farmRows = [];
    for (let t = 1; t <= 5; t++) {
        const r = simulateQuest(t, 'combat', 'farm', cfg, ev.perRelic, rng, iters);
        farmRows.push(r);
        const vsPeg = r.scrapPerFlux / ORACLE_SCRAP_PER_FLUX;
        console.log('  ' + pad('T' + t, 6) + padl(r.cost, 7) + padl(fmt(r.fluxPerQuest, 4), 12) +
            padl(fmt(r.scrapPerFlux, 0), 12) + padl(fmt(vsPeg, 2) + '×', 8) + padl(fmt(r.totalRelics, 3), 10) + padl(fmt(r.relicsAvg.legendary, 5), 9));
    }
    const spread = Math.max(...farmRows.map(r => r.scrapPerFlux)) / Math.min(...farmRows.map(r => r.scrapPerFlux));
    console.log('  → SCRAP/FLUX spread across tiers (max/min): ' + fmt(spread, 1) + '×   (1× = perfectly flat)');

    // Profile comparison at T1 and T5 (combat): shows investment factor effect & player health.
    console.log('\nProfile comparison (combat) — FLUX/quest and SCRAP/FLUX:');
    console.log('  ' + pad('Profile', 10) + pad('|', 2) +
        ['T1', 'T2', 'T3', 'T4', 'T5'].map(t => padl(t + ' f/q', 11) + padl(t + ' s/f', 9)).join(''));
    for (const p of ['farm', 'new', 'mid', 'endgame']) {
        let line = '  ' + pad(p, 10) + pad('|', 2);
        for (let t = 1; t <= 5; t++) {
            const r = simulateQuest(t, 'combat', p, cfg, ev.perRelic, rng, Math.floor(iters / 2));
            line += padl(fmt(r.fluxPerQuest, 3), 11) + padl(fmt(r.scrapPerFlux, 0), 9);
        }
        console.log(line);
    }

    // New-player on-ramp health: relic COUNT + rarity must stay usable for gear progression.
    console.log('\nNew-player on-ramp (profile=new, combat) — total relics/quest & rarity split:');
    for (let t = 1; t <= 2; t++) {
        const r = simulateQuest(t, 'combat', 'new', cfg, ev.perRelic, rng, Math.floor(iters / 2));
        console.log('  T' + t + ': ' + padl(fmt(r.totalRelics, 3), 6) + ' relics/q  [' +
            RARITIES.map(rr => `${rr[0]}:${fmt(r.relicsAvg[rr], 3)}`).join(' ') + ']  FLUX/q=' + fmt(r.fluxPerQuest, 4));
    }

    // Cheap-legendary metrics (the "getting legendaries for real cheap" complaint).
    console.log('\nCheap-legendary cost (farm profile, combat):');
    const pCommonToLeg = ev.upgradeDist.common.legendary;
    const pCommonToEpic = ev.upgradeDist.common.epic;
    for (let t = 1; t <= 5; t++) {
        const r = farmRows[t - 1];
        const scrapPerLegRelic = r.relicsAvg.legendary > 0 ? r.cost / r.relicsAvg.legendary : Infinity;
        // 100 legendary relics → 1 legendary crate → legendary item:
        const scrapPerLegItemDirect = scrapPerLegRelic * 100;
        console.log('  T' + t + ': ' + padl(fmt(scrapPerLegRelic, 0), 10) + ' SCRAP/legendary-relic   ' +
            padl(fmt(scrapPerLegItemDirect, 0), 12) + ' SCRAP per legendary item (100-relic path)');
    }
    // Backdoor: cheapest legendary item via farming common relics and upgrading common crates.
    const scrapPerCommonRelicT1 = farmRows[0].relicsAvg.common > 0 ? farmRows[0].cost / farmRows[0].relicsAvg.common : Infinity;
    const scrapPerCommonCrate = scrapPerCommonRelicT1 * 100;
    const scrapPerLegViaBackdoor = pCommonToLeg > 0 ? scrapPerCommonCrate / pCommonToLeg : Infinity;
    const scrapPerEpicViaBackdoor = pCommonToEpic > 0 ? scrapPerCommonCrate / pCommonToEpic : Infinity;
    console.log('  Backdoor (farm T1 common relics → common crates → upgrade):');
    console.log('    SCRAP per common crate: ' + fmt(scrapPerCommonCrate, 0) +
        '   → SCRAP per EPIC item: ' + fmt(scrapPerEpicViaBackdoor, 0) +
        '   → SCRAP per LEGENDARY item: ' + fmt(scrapPerLegViaBackdoor, 0));

    // 100-account farm daily issuance vs a single endgame player.
    console.log('\nDaily issuance — 100-account farm (5×T1/day each, all quest types) vs 1 endgame player (5×T5/day):');
    let farmFlux = 0, farmScrap = 0;
    for (const qt of Object.keys(QUEST_TYPE_MAP)) {
        const r = simulateQuest(1, qt, 'farm', cfg, ev.perRelic, rng, Math.floor(iters / 2));
        farmFlux += r.fluxPerQuest; farmScrap += r.cost;
    }
    farmFlux *= 100; farmScrap *= 100;
    let playerFlux = 0, playerScrap = 0;
    for (const qt of Object.keys(QUEST_TYPE_MAP)) {
        const r = simulateQuest(5, qt, 'endgame', cfg, ev.perRelic, rng, Math.floor(iters / 2));
        playerFlux += r.fluxPerQuest; playerScrap += r.cost;
    }
    console.log('  100-acct farm: ' + fmt(farmFlux, 1) + ' FLUX/day, ' + fmt(farmScrap, 0) + ' SCRAP/day burned → ' + fmt(farmScrap / farmFlux, 0) + ' SCRAP/FLUX');
    console.log('  1 endgame plr: ' + fmt(playerFlux, 2) + ' FLUX/day, ' + fmt(playerScrap, 0) + ' SCRAP/day burned → ' + fmt(playerScrap / playerFlux, 0) + ' SCRAP/FLUX');

    return { farmRows, ev };
}

// ── Scenarios ──────────────────────────────────────────────────────────────────────────────────
// The shipped rebalance lives in the production DEFAULTS of quest-loot.js (A2 low-tier rarity
// collapse); crate-loot.js ladders are UNCHANGED from the original, so `production` just uses them —
// plus the gear investment factor (applied by collectQuest) and the T1/T2 cost bump (TIER_BASE_COST).
// `baseline` reconstructs the PRE-rebalance economy via explicit cfg overrides, for comparison.
const ORIGINAL_LADDERS = {
    common:    [{ max: 90000, r: 'common' },   { max: 99000, r: 'uncommon' }, { max: 99750, r: 'rare' }, { max: 99950, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    uncommon:  [{ max: 95000, r: 'uncommon' }, { max: 99000, r: 'rare' },     { max: 99900, r: 'epic' }, { max: Infinity, r: 'legendary' }],
    rare:      [{ max: 94999, r: 'rare' },     { max: 98999, r: 'epic' },     { max: Infinity, r: 'legendary' }],
    epic:      [{ max: 97999, r: 'epic' },     { max: Infinity, r: 'legendary' }],
    legendary: [{ max: Infinity, r: 'legendary' }],
};

const SCENARIOS = {
    // Pre-rebalance: disable A2 (empty rarityTierMult), original crate ladders, no investment factor, original costs.
    baseline:   { loot: { rarityTierMult: {} }, crate: { ladders: ORIGINAL_LADDERS }, tierCost: { 1: 10, 2: 50, 3: 235, 4: 985, 5: 4010 } },
    // Shipped: A2 low-tier rarity collapse (library default) + gear investment factor + T1/T2 cost bump.
    // Crate item-drop odds are deliberately UNCHANGED — the sim showed the relic-side fix alone closes
    // the cheap-legendary path (backdoor legendary item ≈ 48M SCRAP, a dead lottery, not an exploit).
    production: { investment: QL.DEFAULT_INVESTMENT },
};

function verifyParity() {
    console.log('Parity check: rollItemRarity vs original inline if/else (exhaustive 0..99999)...');
    function ref(cr, roll) {
        let rar = 'common';
        if (cr == 'common') { if (roll <= 90000) rar = 'common'; else if (roll <= 99000) rar = 'uncommon'; else if (roll <= 99750) rar = 'rare'; else if (roll <= 99950) rar = 'epic'; else rar = 'legendary'; }
        else if (cr == 'uncommon') { if (roll <= 95000) rar = 'uncommon'; else if (roll <= 99000) rar = 'rare'; else if (roll <= 99900) rar = 'epic'; else rar = 'legendary'; }
        else if (cr == 'rare') { if (roll < 95000) rar = 'rare'; else if (roll < 99000) rar = 'epic'; else rar = 'legendary'; }
        else if (cr == 'epic') { if (roll < 98000) rar = 'epic'; else rar = 'legendary'; }
        else if (cr == 'legendary') { rar = 'legendary'; }
        return rar;
    }
    // DEFAULT_LADDERS equals the original odds (Lever C was dropped), so this confirms the extracted
    // function reproduces the old inline if/else when fed the original ladders explicitly.
    let mism = 0;
    for (const cr of RARITIES) for (let roll = 0; roll < 100000; roll++) if (CL.rollItemRarity(cr, roll, { ladders: ORIGINAL_LADDERS }) !== ref(cr, roll)) mism++;
    console.log('  ' + (mism === 0 ? 'OK (500k cases identical, given original ladders)' : 'FAIL: ' + mism + ' mismatches'));

    console.log('Parity check: computeDrawCount vs original bracket ladder...');
    function refDraw(effectiveRoll, baseRolls) {
        let drawCount, guaranteedLegendary = false, shiftRareUp = false;
        if (effectiveRoll < 35) drawCount = Math.max(1, Math.floor(baseRolls * 0.50));
        else if (effectiveRoll < 65) drawCount = baseRolls;
        else if (effectiveRoll < 100) drawCount = Math.ceil(baseRolls * 1.50);
        else if (effectiveRoll < 130) drawCount = baseRolls * 2;
        else if (effectiveRoll < 155) { drawCount = Math.ceil(baseRolls * 2.5); shiftRareUp = true; }
        else if (effectiveRoll < 175) drawCount = baseRolls * 3;
        else { drawCount = baseRolls * 3; guaranteedLegendary = true; }
        return { drawCount, guaranteedLegendary, shiftRareUp };
    }
    let dmism = 0;
    for (const br of [2, 3, 4, 6, 10]) for (let er = 0; er <= 200; er++) {
        const a = QL.computeDrawCount(er, br), b = refDraw(er, br);
        if (a.drawCount !== b.drawCount || a.guaranteedLegendary !== b.guaranteedLegendary || a.shiftRareUp !== b.shiftRareUp) dmism++;
    }
    console.log('  ' + (dmism === 0 ? 'OK (all bracket cases identical)' : 'FAIL: ' + dmism + ' mismatches'));
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--verify-parity')) { verifyParity(); return; }
    const itersArg = args.indexOf('--iters');
    const iters = itersArg >= 0 ? parseInt(args[itersArg + 1], 10) : 100000;
    const scenArg = args.indexOf('--scenario');
    const which = scenArg >= 0 ? [args[scenArg + 1]] : Object.keys(SCENARIOS);

    console.log('TerraCore quest economy simulation — iters=' + iters + ' (oracle peg ' + ORACLE_SCRAP_PER_FLUX + ' SCRAP/FLUX)');
    for (const name of which) {
        if (!(name in SCENARIOS)) { console.log('Unknown scenario: ' + name + ' (have: ' + Object.keys(SCENARIOS).join(', ') + ')'); continue; }
        const rng = makeRng('terracore-econ-' + name); // deterministic per scenario
        reportScenario(name, SCENARIOS[name], iters, rng);
    }
}

main();
