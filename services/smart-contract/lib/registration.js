const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook2 } = require('./webhooks');

async function payReferrer(referrer, username, amount) {
    try {
        console.log('Paying ' + referrer + ' for referring ' + username + ' ' + amount + ' HIVE');
        await ctx.hive.broadcast.transferAsync(ctx.wif, 'terracore', referrer, amount, 'Here is your Refferal Bonus for inviting ' + username + ' to TerraCore!');
        await ctx.db.collection('referrers').insertOne({ referrer: referrer, username: username, amount: amount, time: Date.now() });
    } catch (error) {
        console.log(error);
    }
}

async function register(username, referrer, amount) {
    try {
        let registration_fee_query = await ctx.db.collection('price_feed').findOne({ date: 'global' });
        let registration_fee = parseFloat(registration_fee_query.registration_fee.split(' ')[0]).toFixed(3);
        let referrer_fee = registration_fee_query.referral_fee;
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

        await collection.insertOne({ username: username, favor: 0, scrap: 1, health: 10, damage: 10, defense: 10, engineering: 1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now(), registrationTime: Date.now(), lastBattle: Date.now(), stats: { damage: 10, defense: 10, engineering: 1, dodge: 0, crit: 0, luck: 0 }, consumables: { protection: 0, protection_times: [], focus: 0 }, hiveEngineStake: 0, items: {} });
        console.log('New User ' + username + ' now registered');

        const bulkOps = [
            { updateOne: { filter: { date: 'global' }, update: { $inc: { players: 1 } } } },
            { updateOne: { filter: { date: new Date().toISOString().slice(0, 10) }, update: { $inc: { players: 1 } }, upsert: true } }
        ];
        await ctx.db.collection('stats').bulkWrite(bulkOps);

        if (referrer != 'terracore' && referrer != username && referrer !== undefined) {
            webhook2('A New Citizen of Terracore has Registered', username + ' was invited by ' + referrer, 0x00ff00);
            await payReferrer(referrer, username, referrer_fee);
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
        await ctx.db.collection('registrations').insertOne({ hash: hash, username: username, time: Date.now() });
        console.log('Hash ' + hash + ' stored');
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

module.exports = { payReferrer, register, storeRegistration };
