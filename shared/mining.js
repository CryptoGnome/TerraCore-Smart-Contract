function computeMineRate(engineeringLevel) {
    const nextUpgradeCost   = Math.pow(engineeringLevel + 1, 2);
    const timeToNextUpgrade = 48 * 60 * 60;
    return nextUpgradeCost / timeToNextUpgrade;
}

function computeCurrentScrap(user) {
    const mineRate       = computeMineRate(user.stats?.engineering || 0);
    const stashsize      = (user.hiveEngineStake || 0) + 1;
    const secondsElapsed = Math.max((Date.now() - (user.cooldown || Date.now())) / 1000, 0);
    const accumulated    = (user.scrap || 0) + mineRate * secondsElapsed;
    return Math.min(accumulated, stashsize);
}

module.exports = { computeMineRate, computeCurrentScrap };
