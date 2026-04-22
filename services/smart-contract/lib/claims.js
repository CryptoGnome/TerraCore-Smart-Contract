const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook } = require('./webhooks');

async function storeClaim(username, qty) {
    try {
        await ctx.db.collection('claims').insertOne({ username: username, qty: qty, time: Date.now() });
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
        webhook('Scrap Claimed', `${username} claimed ${qty} SCRAP`, '#6130ff');
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

module.exports = { storeClaim, performUpdate, claim };
