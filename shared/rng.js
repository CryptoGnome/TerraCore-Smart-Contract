var seedrandom = require('seedrandom');

function createSeed(blockId, trxId, hash) {
    return blockId + '@' + trxId + '@' + hash;
}

// Deterministic when seed provided, random otherwise. Lower bound: 1% of index.
function rollDice(index, seed = null) {
    if (seed !== null) {
        const rng = seedrandom(seed.toString(), { state: true });
        return rng() * (index - 0.01 * index) + 0.01 * index;
    }
    return Math.random() * (index - 0.01 * index) + 0.01 * index;
}

function adjustedRoll(index, adjustment = 0, seed = null) {
    let roll;
    if (seed !== null) {
        const rng = seedrandom(seed.toString(), { state: true });
        roll = rng();
    } else {
        roll = Math.random();
    }
    let result = roll * (index - 0.01 * index) + 0.01 * index;
    if (adjustment !== 0) {
        result = Math.min(Math.max(result + adjustment, 0.01 * index), 0.99 * index);
    }
    return result;
}

// Integer in [0, 99999] seeded deterministically — used for NFT item generation.
function generateRandomNumber(seed) {
    const rng = seedrandom(seed.toString(), { state: true });
    return Math.floor(rng() * 100000);
}

module.exports = { createSeed, rollDice, adjustedRoll, generateRandomNumber };
