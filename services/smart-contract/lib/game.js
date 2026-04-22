const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { webhook, webhook2, webhook3, webhook4 } = require('./webhooks');

async function scrapStaked(username) {
    try {
        let collection = ctx.db.collection('players');
        let player = await collection.findOne({ username: username });
        return player ? player.hiveEngineStake : 0;
    } catch (error) {
        console.log(error);
    }
}

async function payReferrer(referrer, username, amount) {
    try {
        console.log('Paying ' + referrer + ' for referring ' + username + ' ' + amount + ' HIVE');
        const xfer = new Object();
        xfer.from = "terracore";
        xfer.to = referrer;
        xfer.amount = amount;
        xfer.memo = 'Here is your Refferal Bonus for inviting ' + username + ' to TerraCore!';
        await ctx.hive.broadcast.transfer(ctx.wif, xfer.from, xfer.to, xfer.amount, xfer.memo, function (err, result) {
            if (err) { console.log(err); } else { console.log(result); }
        });
        let collection = ctx.db.collection('referrers');
        await collection.insertOne({ referrer: referrer, username: username, amount: amount, time: Date.now() });
        return;
    } catch (error) {
        console.log(error);
    }
}

async function register(username, referrer, amount) {
    try {
        let registration_fee_query = await ctx.db.collection('price_feed').findOne({ date: "global" });
        let registration_fee = registration_fee_query.registration_fee;
        let referrer_fee = registration_fee_query.referral_fee;

        registration_fee = parseFloat(registration_fee.split(' ')[0]).toFixed(3);
        amount = parseFloat(amount.split(' ')[0]).toFixed(3);

        console.log('Amount: ' + amount + ' Registration Fee: ' + registration_fee);
        if (amount < registration_fee) {
            console.log('Amount does not match registration fee');
            return false;
        }

        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });
        if (user) {
            console.log(username + ' already exists');
            return false;
        }
        await collection.insertOne({ username: username, favor: 0, scrap: 1, health: 10, damage: 10, defense: 10, engineering: 1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now(), registrationTime: Date.now(), lastBattle: Date.now() });
        console.log('New User ' + username + ' now registered');

        collection = ctx.db.collection('stats');
        const bulkOps = [
            { updateOne: { filter: { date: 'global' }, update: { $inc: { players: 1 } } } },
            { updateOne: { filter: { date: new Date().toISOString().slice(0, 10) }, update: { $inc: { players: 1 } }, upsert: true } }
        ];
        await collection.bulkWrite(bulkOps);

        if (referrer != 'terracore' && referrer != username && referrer !== undefined) {
            webhook2('A New Citizen of Terracore has Registered', username + ' was invited by ' + referrer, 0x00ff00);
            payReferrer(referrer, username, referrer_fee);
        } else {
            webhook2('A New Citizen of Terracore has Registered', username, 0x00ff00);
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

async function storeRegistration(hash, username) {
    try {
        let collection = ctx.db.collection('registrations');
        await collection.insertOne({ hash: hash, username: username, time: Date.now() });
        console.log('Hash ' + hash + ' stored');
        return;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function storeClaim(username, qty) {
    try {
        let collection = ctx.db.collection('claims');
        await collection.insertOne({ username: username, qty: qty, time: Date.now() });
        return;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

function checkDodge(_target) {
    var roll = Math.floor(Math.random() * 100) + 1;
    return roll < _target.stats.dodge;
}

function rollAttack(_player, seed) {
    var rng = seedrandom(seed);
    var roll = rng();
    var steal = roll * (100 - _player.stats.crit + 1) + _player.stats.crit;
    if (steal > 100) steal = 100;
    return steal;
}

async function createSeed(blockId, trxId, hash) {
    var seed = blockId + '@' + trxId + '@' + hash;
    return seed;
}

async function adjustedRoll(index, adjustment = 0, seed = null) {
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

async function rollDice(index, seed = null) {
    if (seed !== null) {
        const rng = seedrandom(seed.toString(), { state: true });
        return rng() * (index - 0.01 * index) + 0.01 * index;
    }
    return Math.random() * (index - 0.01 * index) + 0.01 * index;
}

async function performUpdate(collection, username, user) {
    while (true) {
        const updateResult = await collection.findOneAndUpdate(
            { username, claims: { $gt: 0 }, lastPayout: { $lt: Date.now() - 30000 } },
            {
                $set: { scrap: 0, claims: user.claims - 1, lastPayout: Date.now() },
                $inc: { version: 1 }
            },
            { returnOriginal: false }
        );
        if (updateResult.value) return true;
    }
}

async function claim(username) {
    try {
        const collection = ctx.db.collection('players');
        const user = await collection.findOne({ username });

        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }
        if (user.claims === 0) {
            console.log('User ' + username + ' has no claims left');
            return true;
        }
        if (!user.lastPayout) {
            await collection.updateOne({ username }, { $set: { lastPayout: Date.now() - 60000 } });
        }
        if ((Date.now() - user.lastPayout) < 30000) {
            return true;
        }

        const qty = user.scrap.toFixed(8);
        const data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: { symbol: 'SCRAP', to: username, quantity: qty.toString(), memo: 'terracore_claim_mint' }
        };

        const claimSuccess = await ctx.hive.broadcast.customJsonAsync(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));

        if (!claimSuccess) {
            await collection.insertOne({ username: username, qty: 'failed', time: Date.now() });
            return true;
        }

        await performUpdate(collection, username, user);
        await storeClaim(username, qty);
        webhook("Scrap Claimed", `${username} claimed ${qty} SCRAP`, '#6130ff');
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        }
        return false;
    }
}

async function battle(username, _target, blockId, trxId, hash) {
    try {
        if (username == _target) {
            console.log('Error : Battle User: ' + username + ' tried to battle themselves');
            return true;
        }
        var collection = ctx.db.collection('players');
        var result = await collection.find({ $or: [{ username: username }, { username: _target }] }).toArray();

        var user = result.find(entry => entry.username === username);
        var target = result.find(entry => entry.username === _target);

        if (!user) { console.log('User ' + username + ' does not exist'); return true; }
        if (!target) { console.log('Target ' + _target + ' does not exist'); return true; }

        if (target.registrationTime) {
            if (Date.now() - target.registrationTime < 86400000) {
                await collection.updateOne({ username: username }, { $inc: { attacks: -1, version: 1 } });
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, timestamp: Date.now() });
                webhook("New User Protection", "User " + username + " tried to attack " + _target + " but they have new user protection", '#ff6eaf');
                return true;
            }
        }

        if (target.consumables.protection > 0) {
            if (Date.now() - target.consumables.protection_times[0] < 86400000) {
                await collection.updateOne({ username: username }, { $inc: { attacks: -1, version: 1 } });
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, timestamp: Date.now() });
                webhook("Protection Potion Active!", "User " + username + " tried to attack " + _target + " but they have protection", '#ff6eaf');
                return true;
            }
        }

        if (!target.lastBattle) {
            target.lastBattle = Date.now() - 60000;
            await collection.updateOne({ username: _target }, { $set: { lastBattle: target.lastBattle }, $inc: { version: 1 } });
        }

        if (Date.now() - target.lastBattle < 60000) {
            await collection.updateOne({ username: username }, { $inc: { attacks: -1, version: 1 } });
            await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, timestamp: Date.now() });
            return true;
        }

        if (user.stats.damage > target.stats.defense && user.attacks > 0 || user.consumables.focus > 0 && user.attacks > 0) {
            var staked = await scrapStaked(username);
            var seed = await createSeed(blockId, trxId, hash);
            var roll = await rollAttack(user, seed);
            var scrapToSteal = target.scrap * (roll / 100);

            if (checkDodge(target) && user.consumables.focus == 0) {
                await collection.updateOne({ username: username }, { $inc: { attacks: -1, version: 1 } });
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, seed: seed, roll: roll, dodged: true, timestamp: Date.now() });
                webhook("Attack Dodged", "User " + username + " tried to attack " + _target + " but they dodged the attack", '#ff6eaf');
                return true;
            }

            if (user.consumables.focus > 0) {
                await collection.updateOne({ username: username }, { $inc: { 'consumables.focus': -1, version: 1 } });
            }

            if (scrapToSteal > target.scrap) scrapToSteal = target.scrap;
            if (user.scrap + scrapToSteal > staked + 1) scrapToSteal = (staked + 1) - user.scrap;

            if (isNaN(scrapToSteal)) {
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is NaN, please try again", '#6385ff');
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, timestamp: Date.now() });
                return true;
            }
            if (scrapToSteal <= 0) {
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is less than or = 0, please try again", '#6385ff');
                await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: 0, dodged: false, timestamp: Date.now() });
                return true;
            }

            try {
                let newScrap = user.scrap + scrapToSteal;
                let newTargetScrap = target.scrap - scrapToSteal;
                let newAttacks = user.attacks - 1;
                let maxAttempts = 3;
                let delay = 700;
                for (let i = 0; i < maxAttempts; i++) {
                    const bulkOps = [
                        { updateOne: { filter: { username: _target }, update: { $set: { scrap: newTargetScrap }, $inc: { version: 1 } } } },
                        { updateOne: { filter: { username: username }, update: { $set: { scrap: newScrap, attacks: newAttacks, lastBattle: Date.now() }, $inc: { version: 1 } } } }
                    ];
                    const res = await collection.bulkWrite(bulkOps);
                    if (res.modifiedCount == 2) {
                        await ctx.db.collection('battle_logs').insertOne({ username: username, attacked: _target, scrap: scrapToSteal, seed: seed, roll: roll, timestamp: Date.now() });
                        webhook("New Battle Log", 'User ' + username + ' stole ' + scrapToSteal.toString() + ' scrap from ' + _target + ' with a ' + roll.toFixed(2).toString() + '% roll chance', '#f55a42');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.2;
                }
                return true;
            } catch (e) {
                webhook("New Error", " Error: " + e, '#6385ff');
                return true;
            }
        } else {
            return true;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
            webhook("New Error", " Line: 681 Error: " + err, '#6385ff');
            return true;
        }
    }
}

async function selectQuest(round, user) {
    try {
        let collection = ctx.db.collection('quest-template');
        let quests = await collection.find({}).toArray();
        var random_quest = quests[Math.floor(Math.random() * quests.length)];

        var availableAttributes = ["damage", "defense", "engineering", "dodge", "crit", "luck"];
        var attribute_one = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
        availableAttributes = availableAttributes.filter(item => item !== attribute_one);
        var attribute_two = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];

        var base_stats = { "damage": 20 * round, "defense": 20 * round, "engineering": 2 * round, "dodge": round, "crit": round, "luck": round };
        var success_chance = 0.80;
        for (let i = 1; i < round; i++) { success_chance -= 0.01; }
        var multiplier = round * 2;

        for (var key in user.stats) {
            if (key == attribute_one || key == attribute_two) {
                if (user.stats[key] > base_stats[key]) { success_chance += 0.1; }
            }
        }

        var common_relics = 0, uncommon_relics = 0, rare_relics = 0, epic_relics = 0, legendary_relics = 0;

        if (round > 0) {
            var roll = await rollDice(1);
            var relic_types = 1;

            if (round > 4) {
                if (roll < 0.5) relic_types = 2;
                var floor_roll = 192;
                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    if (roll <= 0.04) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; epic_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.19) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.41) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; uncommon_relics = (roll * 10) * multiplier / divisor; }
                    else { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; common_relics = (roll * 10) * multiplier / divisor; }
                }
            }
            if (round > 9) {
                if (roll < 0.75) relic_types = 1;
                else if (roll < 0.5) relic_types = 2;
                var floor_roll = 500;
                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    if (roll <= 0.025) { var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.1) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.25) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; rare_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.525) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; uncommon_relics = (roll * 10) * multiplier / divisor; }
                    else { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; common_relics = (roll * 10) * multiplier / divisor; }
                }
            }
            if (round > 15) {
                relic_types = 1;
                if (roll < 0.95) relic_types = 1;
                else if (roll < 0.75) relic_types = 2;
                else if (roll < 0.25) relic_types = 3;
                var floor_roll = 750;
                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    if (roll <= 0.05) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.15) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.35) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.65) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; uncommon_relics = (roll * 10) * multiplier / divisor; }
                    else { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; common_relics = (roll * 10) * multiplier / divisor; }
                }
            }
            if (round > 18) {
                relic_types = 1;
                if (roll < 0.80) relic_types = 2;
                else if (roll < 0.60) relic_types = 3;
                else if (roll < 0.40) relic_types = 4;
                else if (roll < 0.20) relic_types = 5;
                var floor_roll = 1000;
                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    if (roll <= 0.05) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.15) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.35) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.65) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; uncommon_relics = (roll * 10) * multiplier / divisor; }
                    else { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; common_relics = (roll * 10) * multiplier / divisor; }
                }
            } else {
                relic_types = 1;
                var floor_roll = 96;
                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    if (roll <= 0.05) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; epic_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.2) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; rare_relics = (roll * 10) * multiplier / divisor; }
                    else if (roll <= 0.5) { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 32 + 1)) + 32; uncommon_relics = (roll * 10) * multiplier / divisor; }
                    else { roll = await rollDice(1); var divisor = Math.floor(Math.random() * (floor_roll - 16 + 1)) + 16; common_relics = (roll * 10) * multiplier / divisor; }
                }
            }
        }

        console.log('------------------------------------------------------');
        console.log('Round: ' + round.toString() + ' Success Chance: ' + success_chance.toString() + ' for user: ' + user.username);
        console.log('Common Relics: ' + common_relics.toString());
        console.log('Uncommon Relics: ' + uncommon_relics.toString());
        console.log('Rare Relics: ' + rare_relics.toString());
        console.log('Epic Relics: ' + epic_relics.toString());
        console.log('Legendary Relics: ' + legendary_relics.toString());

        return {
            username: user.username, name: random_quest.name, description: random_quest.description,
            image: random_quest.image, round: round, success_chance: success_chance,
            attribute_one: attribute_one, attribute_two: attribute_two,
            attribute_one_value: base_stats[attribute_one], attribute_two_value: base_stats[attribute_two],
            common_relics: common_relics, uncommon_relics: uncommon_relics, rare_relics: rare_relics,
            epic_relics: epic_relics, legendary_relics: legendary_relics, time: Date.now()
        };
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return false; }
    }
}

async function progressQuest(username, blockId, trxId) {
    try {
        let collection = ctx.db.collection('active-quests');
        let quest = await collection.findOne({ username: username });
        let _username = await ctx.db.collection('players').findOne({ username: username });

        if (quest) {
            if (!quest.time) {
                quest.time = Date.now();
                await collection.updateOne({ username: username }, { $set: { time: quest.time } });
            }

            if (quest.time + 3000 < Date.now()) {
                var seed = await createSeed(blockId, trxId, quest.round.toString());
                var roll;
                if (quest.round > 10) {
                    roll = await adjustedRoll(1, 0.25, seed);
                } else {
                    roll = await rollDice(1, seed);
                }

                if (roll < quest.success_chance) {
                    console.log('Quest was successful for user ' + username, ' with a roll of ' + roll.toFixed(2).toString() + ' and a success chance of ' + quest.success_chance.toFixed(2).toString());
                    if (_username) {
                        var activeQuest = await selectQuest(quest.round + 1, _username);
                        activeQuest.common_relics += quest.common_relics;
                        activeQuest.uncommon_relics += quest.uncommon_relics;
                        activeQuest.rare_relics += quest.rare_relics;
                        activeQuest.epic_relics += quest.epic_relics;
                        activeQuest.legendary_relics += quest.legendary_relics;
                        collection.replaceOne({ username: username }, activeQuest);
                        await ctx.db.collection('quest-log').insertOne({ username: username, action: 'progress', quest: activeQuest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date() });
                        return true;
                    } else {
                        console.log('User ' + username + ' does not exist');
                        return false;
                    }
                } else {
                    console.log('Quest failed for user ' + username, ' with a roll of ' + roll.toFixed(2).toString() + ' and a success chance of ' + quest.success_chance.toFixed(2).toString());
                    await ctx.db.collection('quest-log').insertOne({ username: username, action: 'failed', quest: quest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date() });
                    await collection.deleteOne({ username: username });
                    webhook4("Quest Failed", "Quest Failed for " + username + " with a roll of " + roll.toFixed(2).toString() + " and a success chance of " + quest.success_chance.toFixed(2).toString());
                    return false;
                }
            } else {
                console.log('Quest for user ' + username + ' has not been 3 seconds since last progress');
                return false;
            }
        } else {
            console.log('User ' + username + ' does not have a quest yet please use startQuest');
            return false;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return false; }
    }
}

async function completeQuest(username) {
    try {
        let collection = ctx.db.collection('active-quests');
        let user = await collection.findOne({ username: username });
        console.log(user);
        if (user) {
            await ctx.db.collection('quest-log').insertOne({ username: username, action: 'complete', rewards: user, time: new Date() });
            if (user.common_relics > 0)    await issue(username, 'common_relics', user.common_relics);
            if (user.uncommon_relics > 0)  await issue(username, 'uncommon_relics', user.uncommon_relics);
            if (user.rare_relics > 0)      await issue(username, 'rare_relics', user.rare_relics);
            if (user.epic_relics > 0)      await issue(username, 'epic_relics', user.epic_relics);
            if (user.legendary_relics > 0) await issue(username, 'legendary_relics', user.legendary_relics);
        } else {
            console.log('User ' + username + ' does not have a quest yet please use startQuest');
            return false;
        }
        await collection.deleteOne({ username: username });
        webhook3('User ' + username + ' has completed their quest at round ' + user.round.toString(), user.common_relics.toString(), user.uncommon_relics.toString(), user.rare_relics.toString(), user.epic_relics.toString(), user.legendary_relics.toString());
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return false; }
    }
}

async function issue(username, type, amount) {
    try {
        var collection = ctx.db.collection('relics');
        let player = await collection.findOne({ username: username, type: type });
        if (!player) {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
            return true;
        }
        await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return true; }
    }
}

async function clearTransactions() {
    try {
        let collection = ctx.db.collection('transactions');
        await collection.deleteMany({});
        return;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); process.exit(1); }
        else { console.log(err); }
    }
}

async function clearFirst() {
    try {
        let collection = ctx.db.collection('transactions');
        await collection.deleteOne({});
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); process.exit(1); }
        else { console.log(err); }
    }
}

module.exports = {
    scrapStaked, payReferrer, register, storeRegistration, storeClaim,
    checkDodge, rollAttack, createSeed, adjustedRoll, rollDice, performUpdate,
    claim, battle, selectQuest, progressQuest, completeQuest, issue,
    clearTransactions, clearFirst
};
