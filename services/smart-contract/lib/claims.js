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
        else return false;
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

        const qty = user.scrap.toFixed(8);

        // Atomic reserve: decrement claims and lock lastPayout BEFORE broadcasting.
        // A concurrent claim will fail this update because lastPayout will already be now.
        const now = Date.now();
        const reserved = await collection.findOneAndUpdate(
            { username, claims: { $gt: 0 }, lastPayout: { $lt: now - 30000 } },
            { $set: { scrap: 0, lastPayout: now }, $inc: { claims: -1, version: 1 } },
            { returnOriginal: false }
        );

        if (!reserved.value) {
            console.log('[SC] claim: conditions not met for ' + username + ' (cooldown or no claims)');
            return true;
        }

        const data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: { symbol: 'SCRAP', to: username, quantity: qty.toString(), memo: 'terracore_claim_mint' }
        };

        const claimSuccess = await ctx.hive.broadcast.customJsonAsync(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));

        if (!claimSuccess) {
            // Revert the atomic reserve so the player can retry
            await collection.updateOne({ username }, {
                $set: { scrap: user.scrap, lastPayout: user.lastPayout || 0 },
                $inc: { claims: 1, version: 1 }
            });
            console.error('[SC] claim broadcast failed for ' + username);
            await ctx.db.collection('claims').insertOne({ username: username, qty: 0, status: 'failed', time: Date.now() });
            return true;
        }

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
