const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { webhook } = require('./webhooks');
const { createSeed, rollDice, adjustedRoll } = require('../../../shared/rng');
const { logError } = require('../../../shared/error-logger');
const { computeCurrentScrap } = require('../../../shared/mining');

function checkDodge(_target, seed) {
    const rng  = seedrandom(seed + '-dodge');
    const roll = Math.floor(rng() * 100) + 1;
    return roll <= _target.stats.dodge;
}

function rollAttack(_player, seed) {
    const rng = seedrandom(seed);
    const roll = rng();
    let steal = roll * (100 - _player.stats.crit + 1) + _player.stats.crit;
    if (steal > 100) steal = 100;
    return steal;
}

async function scrapStaked(username) {
    try {
        const player = await ctx.db.collection('players').findOne({ username: username });
        return player ? player.hiveEngineStake : 0;
    } catch (error) {
        console.log(error);
    }
}

function computeCurrentAttacks(user) {
    const stored       = user.attacks    || 0;
    const maxAtks      = 8;
    const daysSince    = Math.floor((Date.now() - (user.last_upgrade_time || 0)) / (3600000 * 24));
    const weeksDecay   = Math.floor(daysSince / 5);
    const effectiveMax = Math.max(1, maxAtks - weeksDecay);
    const hoursSince   = Math.floor((Date.now() - (user.lastregen || 0)) / 3600000);
    const regenAmount  = Math.floor(hoursSince / 4);
    const current      = Math.min(stored + regenAmount, effectiveMax);
    const newLastregen = regenAmount > 0
        ? (user.lastregen || 0) + regenAmount * 4 * 3600000
        : (user.lastregen || 0);
    return { current, newLastregen };
}

async function battle(username, _target, blockId, trxId, hash) {
    try {
        if (username == _target) {
            console.log('Error : Battle User: ' + username + ' tried to battle themselves');
            return true;
        }

        const collection = ctx.db.collection('players');
        const result = await collection.find({ $or: [{ username: username }, { username: _target }] }).toArray();
        const user   = result.find(e => e.username === username);
        const target = result.find(e => e.username === _target);

        if (!user)   { console.log('User ' + username + ' does not exist'); return true; }
        if (!target) { console.log('Target ' + _target + ' does not exist'); return true; }

        let { current: currentAttacks, newLastregen } = computeCurrentAttacks(user);
        let userCurrentScrap   = computeCurrentScrap(user);
        let targetCurrentScrap = computeCurrentScrap(target);

        if (target.registrationTime && Date.now() - target.registrationTime < 86400000) {
            await collection.updateOne({ username: username }, { $set: { attacks: currentAttacks - 1, lastregen: newLastregen }, $inc: { version: 1 } });
            await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'new_user_protection', timestamp: Date.now() });
            webhook('New User Protection', 'User ' + username + ' tried to attack ' + _target + ' but they have new user protection', '#ff6eaf');
            return true;
        }

        if (target.consumables.protection > 0 && Date.now() - target.consumables.protection_times[0] < 86400000) {
            await collection.updateOne({ username: username }, { $set: { attacks: currentAttacks - 1, lastregen: newLastregen }, $inc: { version: 1 } });
            await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'protection_potion', timestamp: Date.now() });
            webhook('Protection Potion Active!', 'User ' + username + ' tried to attack ' + _target + ' but they have protection', '#ff6eaf');
            return true;
        }

        if (!target.lastBattle) {
            target.lastBattle = Date.now() - 60000;
            await collection.updateOne({ username: _target }, { $set: { lastBattle: target.lastBattle }, $inc: { version: 1 } });
        }

        if (Date.now() - target.lastBattle < 60000) {
            await collection.updateOne({ username: username }, { $set: { attacks: currentAttacks - 1, lastregen: newLastregen }, $inc: { version: 1 } });
            await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'cooldown', timestamp: Date.now() });
            return true;
        }

        if ((user.stats.damage > target.stats.defense || user.consumables.focus > 0) && currentAttacks > 0) {
            const staked = await scrapStaked(username);
            const seed   = createSeed(blockId, trxId, hash);
            const roll   = rollAttack(user, seed);
            let scrapToSteal = targetCurrentScrap * (roll / 100);

            if (checkDodge(target, seed) && user.consumables.focus == 0) {
                await collection.updateOne({ username: username }, { $set: { attacks: currentAttacks - 1, lastregen: newLastregen }, $inc: { version: 1 } });
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, seed: seed, roll: roll, dodged: true, reason: 'dodge', timestamp: Date.now() });
                webhook('Attack Dodged', 'User ' + username + ' tried to attack ' + _target + ' but they dodged', '#ff6eaf');
                return true;
            }

            if (user.consumables.focus > 0) {
                await collection.updateOne({ username: username }, { $inc: { 'consumables.focus': -1, version: 1 } });
            }

            if (scrapToSteal > targetCurrentScrap) scrapToSteal = targetCurrentScrap;
            if (userCurrentScrap + scrapToSteal > staked + 1) scrapToSteal = (staked + 1) - userCurrentScrap;

            if (isNaN(scrapToSteal)) {
                logError('SC_BATTLE_SCRAP_NAN', new Error('scrapToSteal is NaN'), { fn: 'battle', username, blockId });
                webhook('New Error', 'User ' + username + ' attacked ' + _target + ' but scrapToSteal is NaN', '#6385ff');
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'error', timestamp: Date.now() });
                return true;
            }
            if (scrapToSteal <= 0) {
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'stash_full', timestamp: Date.now() });
                return true;
            }

            try {
                let maxAttempts = 3;
                let delay = 700;
                let currentUser   = user;
                let currentTarget = target;
                let currentSteal  = parseFloat(scrapToSteal.toFixed(3));

                if (currentSteal <= 0) {
                    await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, reason: 'stash_full', timestamp: Date.now() });
                    return true;
                }

                for (let i = 0; i < maxAttempts; i++) {
                    if (i > 0) {
                        // Re-read on retry to get fresh scrap values and versions
                        const fresh = await collection.find({ $or: [{ username: username }, { username: _target }] }).toArray();
                        currentUser   = fresh.find(e => e.username === username);
                        currentTarget = fresh.find(e => e.username === _target);
                        if (!currentUser || !currentTarget) break;
                        ({ current: currentAttacks, newLastregen } = computeCurrentAttacks(currentUser));
                        userCurrentScrap   = computeCurrentScrap(currentUser);
                        targetCurrentScrap = computeCurrentScrap(currentTarget);
                        currentSteal = targetCurrentScrap * (roll / 100);
                        if (currentSteal > targetCurrentScrap) currentSteal = targetCurrentScrap;
                        if (userCurrentScrap + currentSteal > staked + 1) currentSteal = (staked + 1) - userCurrentScrap;
                        currentSteal = parseFloat(currentSteal.toFixed(3));
                        if (currentSteal <= 0) break;
                    }

                    const newScrap       = parseFloat((userCurrentScrap + currentSteal).toFixed(3));
                    const newTargetScrap = parseFloat(Math.max(targetCurrentScrap - currentSteal, 0).toFixed(3));

                    const battleNow = Date.now();
                    const bulkOps = [
                        { updateOne: { filter: { username: _target,  version: currentTarget.version }, update: { $set: { scrap: newTargetScrap, cooldown: battleNow, lastBattle: battleNow }, $inc: { version: 1 } } } },
                        { updateOne: { filter: { username: username, version: currentUser.version   }, update: { $set: { scrap: newScrap, cooldown: battleNow, attacks: currentAttacks - 1, lastregen: newLastregen, lastBattle: battleNow }, $inc: { version: 1 } } } }
                    ];
                    const res = await collection.bulkWrite(bulkOps);
                    if (res.modifiedCount === 2) {
                        await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: currentSteal, seed: seed, roll: roll, timestamp: Date.now() });
                        webhook('New Battle Log', 'User ' + username + ' stole ' + currentSteal.toString() + ' scrap from ' + _target + ' with a ' + roll.toFixed(2) + '% roll', '#f55a42');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.2;
                }
                return true;
            } catch (e) {
                logError('SC_BATTLE_BULK_WRITE_FAIL', e, { fn: 'battle', username, blockId });
                webhook('New Error', 'Error: ' + e, '#6385ff');
                return true;
            }
        } else {
            return true;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            logError('SYS_MONGO_CLOSED', err, { fn: 'battle', username, service: 'SC' }, 'FATAL');
            ctx.client.close();
            process.exit(1);
        } else {
            logError('SC_BATTLE_UNEXPECTED', err, { fn: 'battle', username, blockId });
            webhook('New Error', 'Error in battle: ' + err, '#6385ff');
            return true;
        }
    }
}

module.exports = { createSeed, rollDice, adjustedRoll, checkDodge, rollAttack, battle };
