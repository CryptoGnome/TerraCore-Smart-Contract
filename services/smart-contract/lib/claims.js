const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook } = require('./webhooks');
const { computeCurrentScrap } = require('../../../shared/mining');

async function storeClaim(username, qty, status = 'success') {
    try {
        await ctx.db.collection('claims').insertOne({ username: username, qty: qty, status: status, time: Date.now() });
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

function computeCurrentClaims(user) {
    const stored       = user.claims   || 0;
    const hoursSince   = Math.floor((Date.now() - (user.lastclaim || 0)) / 3600000);
    const regenAmount  = Math.floor(hoursSince / 4);
    const current      = Math.min(stored + regenAmount, 5);
    const newLastclaim = regenAmount > 0
        ? (user.lastclaim || 0) + regenAmount * 4 * 3600000
        : (user.lastclaim || 0);
    return { current, newLastclaim };
}

async function claim(username) {
    try {
        const collection = ctx.db.collection('players');
        const user = await collection.findOne({ username });

        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }

        const { current: currentClaims, newLastclaim } = computeCurrentClaims(user);

        if (currentClaims === 0) {
            console.log('User ' + username + ' has no claims left');
            return true;
        }
        if (!user.lastPayout) {
            await collection.updateOne({ username }, { $set: { lastPayout: Date.now() - 60000 } });
        }

        const currentScrap = computeCurrentScrap(user);
        const qty = currentScrap.toFixed(8);

        // Atomic reserve: decrement claims and lock lastPayout BEFORE broadcasting.
        // A concurrent claim will fail this update because lastPayout will already be now.
        const now = Date.now();
        const reserved = await collection.findOneAndUpdate(
            { username, lastPayout: { $lt: now - 30000 } },
            { $set: { scrap: 0, cooldown: now, lastPayout: now, claims: currentClaims - 1, lastclaim: newLastclaim }, $inc: { version: 1 } },
            { returnOriginal: false }
        );

        if (!reserved.value) {
            console.log('[SC] claim: conditions not met for ' + username + ' (cooldown or no claims)');
            await storeClaim(username, 0, 'rejected');
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
                $set: { scrap: user.scrap, cooldown: user.cooldown || 0, lastPayout: user.lastPayout || 0, claims: currentClaims, lastclaim: user.lastclaim || 0 },
                $inc: { version: 1 }
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

module.exports = { storeClaim, claim };
