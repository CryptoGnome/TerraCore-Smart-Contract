const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');

function rollDice(index) {
    return Math.random() * (index - 0.01 * index) + 0.01 * index;
}

async function startQuest(username) {
    try {
        const collection = ctx.db.collection('active-quests');
        const existing = await collection.findOne({ username: username });
        const player = await ctx.db.collection('players').findOne({ username: username });
        await ctx.db.collection('players').updateOne({ username: username }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1, experience: 50 } });

        if (!player) {
            console.log('User ' + username + ' does not exist');
            return false;
        }
        if (existing) {
            console.log('User ' + username + ' already has a quest');
            return false;
        }

        const activeQuest = await selectQuest(1, player);
        await collection.insertOne(activeQuest);
        await ctx.db.collection('quest-log').insertOne({ username: username, action: 'start', quest: activeQuest, time: new Date() });
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

async function selectQuest(round, user) {
    try {
        const quests = await ctx.db.collection('quest-template').find({}).toArray();
        const random_quest = quests[Math.floor(Math.random() * quests.length)];

        let availableAttributes = ['damage', 'defense', 'engineering', 'dodge', 'crit', 'luck'];
        const attribute_one = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
        availableAttributes = availableAttributes.filter(a => a !== attribute_one);
        const attribute_two = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];

        const base_stats = {
            damage: 20 * round, defense: 20 * round, engineering: 2 * round,
            dodge: round, crit: round, luck: round,
        };

        let success_chance = 0.85;
        for (let i = 0; i < round; i++) success_chance -= 0.05;
        for (const key in user.stats) {
            if ((key == attribute_one || key == attribute_two) && user.stats[key] > base_stats[key]) {
                success_chance += 0.1;
            }
        }

        let common_relics = 0, uncommon_relics = 0, rare_relics = 0, epic_relics = 0, legendary_relics = 0;
        if (round > 0) {
            let roll = rollDice(1);
            if (roll <= 0.7) {
                common_relics = (rollDice(1) * 10) * round / 8;
            } else {
                uncommon_relics = (rollDice(1) * 10) * round / 8;
            }
        }

        console.log('------------------------------------------------------');
        console.log('Round: ' + round + ' | Success: ' + success_chance + ' | User: ' + user.username);
        console.log('Relics — Common: ' + common_relics + ' Uncommon: ' + uncommon_relics);

        return {
            username: user.username, name: random_quest.name, description: random_quest.description,
            image: random_quest.image, round: round, success_chance: success_chance,
            attribute_one: attribute_one, attribute_two: attribute_two,
            attribute_one_value: base_stats[attribute_one], attribute_two_value: base_stats[attribute_two],
            common_relics: common_relics, uncommon_relics: uncommon_relics, rare_relics: rare_relics,
            epic_relics: epic_relics, legendary_relics: legendary_relics, time: Date.now(),
        };
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

module.exports = { rollDice, startQuest, selectQuest };
