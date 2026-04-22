const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook3, webhook4 } = require('./webhooks');
const { createSeed, rollDice, adjustedRoll } = require('./combat');

async function issue(username, type, amount) {
    try {
        const collection = ctx.db.collection('relics');
        const player = await collection.findOne({ username: username, type: type });
        if (!player) {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
        } else {
            await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return true; }
    }
}

async function selectQuest(round, user) {
    try {
        const quests = await ctx.db.collection('quest-template').find({}).toArray();
        const random_quest = quests[Math.floor(Math.random() * quests.length)];

        let availableAttributes = ['damage', 'defense', 'engineering', 'dodge', 'crit', 'luck'];
        const attribute_one = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
        availableAttributes = availableAttributes.filter(item => item !== attribute_one);
        const attribute_two = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];

        const base_stats = { damage: 20 * round, defense: 20 * round, engineering: 2 * round, dodge: round, crit: round, luck: round };
        let success_chance = 0.80;
        for (let i = 1; i < round; i++) { success_chance -= 0.01; }
        const multiplier = round * 2;

        for (const key in user.stats) {
            if ((key == attribute_one || key == attribute_two) && user.stats[key] > base_stats[key]) {
                success_chance += 0.1;
            }
        }

        let common_relics = 0, uncommon_relics = 0, rare_relics = 0, epic_relics = 0, legendary_relics = 0;

        if (round > 0) {
            let roll = rollDice(1);
            let relic_types = 1;

            if (round > 18) {
                if      (roll < 0.80) relic_types = 2;
                else if (roll < 0.60) relic_types = 3;
                else if (roll < 0.40) relic_types = 4;
                else if (roll < 0.20) relic_types = 5;
                const floor_roll = 1000;
                for (let i = 0; i < relic_types; i++) {
                    roll = rollDice(1);
                    if      (roll <= 0.05) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.15) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.35) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.65) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll -  64 + 1)) +  64; uncommon_relics  = (roll * 10) * multiplier / d; }
                    else                  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll -  64 + 1)) +  64; common_relics    = (roll * 10) * multiplier / d; }
                }
            } else if (round > 15) {
                if      (roll < 0.95) relic_types = 1;
                else if (roll < 0.75) relic_types = 2;
                else if (roll < 0.25) relic_types = 3;
                const floor_roll = 750;
                for (let i = 0; i < relic_types; i++) {
                    roll = rollDice(1);
                    if      (roll <= 0.05) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.15) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.35) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.65) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll -  64 + 1)) +  64; uncommon_relics  = (roll * 10) * multiplier / d; }
                    else                  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll -  64 + 1)) +  64; common_relics    = (roll * 10) * multiplier / d; }
                }
            } else if (round > 9) {
                if      (roll < 0.75) relic_types = 1;
                else if (roll < 0.50) relic_types = 2;
                const floor_roll = 500;
                for (let i = 0; i < relic_types; i++) {
                    roll = rollDice(1);
                    if      (roll <= 0.025) { const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; legendary_relics = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.1)   { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; epic_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.25)  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; rare_relics      = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.525) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 256 + 1)) + 256; uncommon_relics  = (roll * 10) * multiplier / d; }
                    else                   { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; common_relics    = (roll * 10) * multiplier / d; }
                }
            } else if (round > 4) {
                if (roll < 0.5) relic_types = 2;
                const floor_roll = 192;
                for (let i = 0; i < relic_types; i++) {
                    roll = rollDice(1);
                    if      (roll <= 0.04) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; epic_relics     = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.19) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; rare_relics     = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.41) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; uncommon_relics = (roll * 10) * multiplier / d; }
                    else                  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 128 + 1)) + 128; common_relics   = (roll * 10) * multiplier / d; }
                }
            } else {
                const floor_roll = 96;
                for (let i = 0; i < relic_types; i++) {
                    roll = rollDice(1);
                    if      (roll <= 0.05) { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; epic_relics     = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.2)  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 64 + 1)) + 64; rare_relics     = (roll * 10) * multiplier / d; }
                    else if (roll <= 0.5)  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 32 + 1)) + 32; uncommon_relics = (roll * 10) * multiplier / d; }
                    else                  { roll = rollDice(1); const d = Math.floor(Math.random() * (floor_roll - 16 + 1)) + 16; common_relics   = (roll * 10) * multiplier / d; }
                }
            }
        }

        console.log('------------------------------------------------------');
        console.log('Round: ' + round + ' Success: ' + success_chance + ' User: ' + user.username);
        console.log('Relics — C:' + common_relics + ' U:' + uncommon_relics + ' R:' + rare_relics + ' E:' + epic_relics + ' L:' + legendary_relics);

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
        const collection = ctx.db.collection('active-quests');
        const quest = await collection.findOne({ username: username });
        const player = await ctx.db.collection('players').findOne({ username: username });

        if (!quest) {
            console.log('User ' + username + ' does not have a quest');
            return false;
        }

        if (!quest.time) {
            quest.time = Date.now();
            await collection.updateOne({ username: username }, { $set: { time: quest.time } });
        }

        if (quest.time + 3000 > Date.now()) {
            console.log('Quest for ' + username + ' has not been 3 seconds since last progress');
            return false;
        }

        const seed = createSeed(blockId, trxId, quest.round.toString());
        const roll = quest.round > 10
            ? adjustedRoll(1, 0.25, seed)
            : rollDice(1, seed);

        if (roll < quest.success_chance) {
            console.log('Quest successful for ' + username + ' — roll: ' + roll.toFixed(2) + ' chance: ' + quest.success_chance.toFixed(2));
            if (!player) {
                console.log('User ' + username + ' does not exist');
                return false;
            }
            const activeQuest = await selectQuest(quest.round + 1, player);
            activeQuest.common_relics    += quest.common_relics;
            activeQuest.uncommon_relics  += quest.uncommon_relics;
            activeQuest.rare_relics      += quest.rare_relics;
            activeQuest.epic_relics      += quest.epic_relics;
            activeQuest.legendary_relics += quest.legendary_relics;
            await collection.replaceOne({ username: username }, activeQuest);
            await ctx.db.collection('quest-log').insertOne({ username: username, action: 'progress', quest: activeQuest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date() });
            return true;
        } else {
            console.log('Quest failed for ' + username + ' — roll: ' + roll.toFixed(2) + ' chance: ' + quest.success_chance.toFixed(2));
            await ctx.db.collection('quest-log').insertOne({ username: username, action: 'failed', quest: quest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date() });
            await collection.deleteOne({ username: username });
            webhook4('Quest Failed', 'Quest Failed for ' + username + ' with a roll of ' + roll.toFixed(2) + ' and a success chance of ' + quest.success_chance.toFixed(2));
            return false;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return false; }
    }
}

async function completeQuest(username) {
    try {
        const collection = ctx.db.collection('active-quests');
        const user = await collection.findOne({ username: username });
        console.log(user);
        if (!user) {
            console.log('User ' + username + ' does not have a quest');
            return false;
        }

        await ctx.db.collection('quest-log').insertOne({ username: username, action: 'complete', rewards: user, time: new Date() });
        if (user.common_relics    > 0) await issue(username, 'common_relics',    user.common_relics);
        if (user.uncommon_relics  > 0) await issue(username, 'uncommon_relics',  user.uncommon_relics);
        if (user.rare_relics      > 0) await issue(username, 'rare_relics',      user.rare_relics);
        if (user.epic_relics      > 0) await issue(username, 'epic_relics',      user.epic_relics);
        if (user.legendary_relics > 0) await issue(username, 'legendary_relics', user.legendary_relics);

        await collection.deleteOne({ username: username });
        webhook3('User ' + username + ' completed their quest at round ' + user.round, user.common_relics.toString(), user.uncommon_relics.toString(), user.rare_relics.toString(), user.epic_relics.toString(), user.legendary_relics.toString());
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); ctx.client.close(); process.exit(1); }
        else { console.log(err); return false; }
    }
}

module.exports = { issue, selectQuest, progressQuest, completeQuest };
