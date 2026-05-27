// Engineering softcap: above this level, each additional level gives 50% of normal income gain.
// Calibrated so that a player doing 5×T5 quests daily is exactly break-even at eng 333.
const ENG_SOFTCAP      = 333;
const ENG_SOFTCAP_RATE = 0.5;

// Gentle mine rate decay based on last sink action (quest start, boss fight, upgrade, item forge).
// Battles and claims do NOT reset decay — redistribution is not a sink.
// 14-day grace period, then 10% reduction per 7 days, floor at 25%.
function computeDecayMultiplier(lastUpgradeTime) {
    if (lastUpgradeTime == null) return 1.0;
    const daysSince = Math.max(0, (Date.now() - lastUpgradeTime) / 86400000);
    if (daysSince <= 14) return 1.0;
    const weeks = Math.floor((daysSince - 14) / 7);
    return Math.max(Math.pow(0.90, weeks), 0.25);
}

function computeMineRate(engineeringLevel, lastUpgradeTime) {
    const effective       = engineeringLevel > ENG_SOFTCAP
        ? ENG_SOFTCAP + (engineeringLevel - ENG_SOFTCAP) * ENG_SOFTCAP_RATE
        : engineeringLevel;
    const nextUpgradeCost   = Math.pow(effective + 1, 2);
    const timeToNextUpgrade = 48 * 60 * 60;
    const baseRate          = nextUpgradeCost / timeToNextUpgrade;
    return baseRate * computeDecayMultiplier(lastUpgradeTime);
}

function computeCurrentScrap(user) {
    const mineRate       = computeMineRate(user.stats?.engineering || 0, user.last_upgrade_time);
    const stashsize      = (user.hiveEngineStake || 0) + 1;
    const secondsElapsed = Math.max((Date.now() - (user.cooldown || Date.now())) / 1000, 0);
    const accumulated    = (user.scrap || 0) + mineRate * secondsElapsed;
    return Math.min(accumulated, stashsize);
}

module.exports = { computeMineRate, computeCurrentScrap, computeDecayMultiplier, ENG_SOFTCAP };
