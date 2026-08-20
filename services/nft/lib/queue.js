const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { open_crate } = require('./crates');
const { equipItem, unequipItem } = require('./items');
const { forgeCrate, useConsumable } = require('./economy');
const { logError } = require('../../../shared/error-logger');
const { sleep } = require('../../../shared/retry');
const { track429, disableNode, getCurrentNode } = require('../../../shared/l1-node');

// Hive blocks are 3s, so firing a bulk sale's payouts back-to-back buys nothing and is
// exactly what gets us rate-limited (a single 18-row sale on 2026-08-19 broadcast at
// ~30/s and produced a 3-minute 429 window). Space them out instead.
const BROADCAST_SPACING_MS = 400;
const MIN_CYCLE_MS = 1000;
const MAX_CYCLE_MS = 60000;
let cycleDelayMs = MIN_CYCLE_MS;

// A rate limit or gateway error is the node's problem, not this row's: the same transfer
// will succeed once we move off the bad node. Retrying it must not consume the row's
// dead-letter budget, or an RPC outage permanently parks a valid payout.
function isInfraError(message) {
    return /\b(429|50[0234])\b|too many requests|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|fetch failed/i.test(message);
}

async function sendTransaction(username, amount, type) {
    // Hive rejects zero-value transfers outright ("Cannot transfer a negative amount"),
    // so a 0.000 fee row can never succeed — it would just burn five broadcast attempts
    // and dead-letter. Drop it at the door.
    if (!(parseFloat(amount) > 0)) {
        console.log(`[NFT] Skipping zero-value payout to ${username}: ${amount} (${type})`);
        return;
    }
    try {
        let collection = ctx.db.collection('market-transactions');
        await collection.insertOne({ username: username, amount: amount, type: type, time: Date.now() });
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function sendTransactions() {
    try {
        let collection = ctx.db.collection('market-transactions');
        // Skip dead-lettered rows so a permanently-failing payout can't loop forever.
        let transactions = await collection.find({ failed: { $ne: true } }).sort({ time: 1 }).toArray();

        // Queue drained — whatever throttled us is behind us, so drop back to the fast cycle.
        if (transactions.length === 0) {
            cycleDelayMs = MIN_CYCLE_MS;
            return true;
        }

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            const tx = transactions[i];

            if (i > 0) await sleep(BROADCAST_SPACING_MS);

            try {
                // Promise form (transferAsync) — genuinely awaited, unlike the callback form.
                // This makes payouts broadcast one at a time (no same-block burst that the node
                // would reject) and lets us catch a failure instead of losing it to a dropped callback.
                await ctx.hive.broadcast.transferAsync(ctx.wif, 'terracore.market', tx.username, tx.amount, tx.type);
                // Broadcast confirmed — only now is it safe to remove the row from the queue.
                await collection.deleteOne({ _id: tx._id });
                cycleDelayMs = MIN_CYCLE_MS;
            } catch (err) {
                const message = (err && err.message) ? err.message : String(err);
                // A duplicate-transaction rejection means this exact transfer already landed
                // on-chain (e.g. response timed out after the tx was accepted, or a crash after
                // broadcast but before delete). Treat it as sent so the recipient isn't paid twice.
                // The detail is often nested below err.message, so scan the serialized error too.
                let haystack = message;
                try { haystack += ' ' + JSON.stringify(err); } catch (_) { /* non-serializable error */ }
                if (/duplicate.{0,2}transaction/i.test(haystack)) {
                    await collection.deleteOne({ _id: tx._id });
                    continue;
                }
                if (isInfraError(haystack)) {
                    // The node is throttling or down. Leave the row untouched (no attempts
                    // increment), abandon the rest of the batch instead of driving it into
                    // the same wall, and rotate off the bad node before the next cycle.
                    if (/\b429\b|too many requests/i.test(haystack)) {
                        const badNode = getCurrentNode();
                        track429(badNode);
                        disableNode(badNode);
                        if (ctx.changeNode) await ctx.changeNode();
                    }
                    await collection.updateOne({ _id: tx._id }, { $set: { lastError: message } });
                    cycleDelayMs = Math.min(cycleDelayMs * 2, MAX_CYCLE_MS);
                    // WARN by default (console + error-log, no Discord). Only a throttle that
                    // has already backed off to the cap is worth waking someone for.
                    logError('NFT_PAYOUT_NODE_THROTTLED', err, { fn: 'sendTransactions', service: 'NFT', username: tx.username, extra: { amount: tx.amount, memo: tx.type, deferred: transactions.length - i, nextCycleMs: cycleDelayMs } },
                             cycleDelayMs >= MAX_CYCLE_MS ? 'ERROR' : null);
                    return true;
                }

                const attempts = (tx.attempts || 0) + 1;
                if (attempts >= 5) {
                    // Poison row (bad recipient, unfundable currency, ...): stop retrying and
                    // surface the stuck funds for manual review instead of spamming forever.
                    await collection.updateOne({ _id: tx._id }, { $set: { failed: true, attempts: attempts, lastError: message } });
                    logError('NFT_PAYOUT_DEADLETTER', err, { fn: 'sendTransactions', service: 'NFT', username: tx.username, extra: { amount: tx.amount, memo: tx.type, attempts: attempts } });
                } else {
                    // Leave the row in the queue — the next cycle retries it.
                    await collection.updateOne({ _id: tx._id }, { $set: { attempts: attempts, lastError: message } });
                    logError('NFT_PAYOUT_BROADCAST_FAIL', err, { fn: 'sendTransactions', service: 'NFT', username: tx.username, extra: { amount: tx.amount, memo: tx.type, attempt: attempts } });
                }
            }
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            logError('NFT_QUEUE_TX_FAIL', err, { fn: 'sendTransactions', service: 'NFT' });
            return true;
        }
    }
}

async function queOpenCrates(username, rarity, blockId, trxId, hash) {
    try {
        let collection = ctx.db.collection('crate-transactions');
        await collection.insertOne({ username: username, rarity: rarity, blockId: blockId, trxId: trxId, hash: hash, time: Date.now() });
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function sendOpenCrates() {
    try {
        let collection = ctx.db.collection('crate-transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            await open_crate(transactions[i].username, transactions[i].rarity, transactions[i].blockId, transactions[i].trxId, transactions[i].hash);
            await collection.deleteOne({ _id: transactions[i]._id });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
            return true;
        }
    }
}

async function checkTransactions() {
    let done = await sendTransactions();
    await sendOpenCrates();
    await sendEquip();
    await sendCombine();
    await sendUse();
    if (done) {
        ctx.lastCheck = Date.now();
        setTimeout(checkTransactions, cycleDelayMs);
    }
}

async function clearTransactions() {
    try {
        let collection = ctx.db.collection('market-transactions');
        await collection.deleteMany({});
        collection = ctx.db.collection('crate-transactions');
        await collection.deleteMany({});
        return;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function queEquip(username, item_number, type) {
    try {
        let collection = ctx.db.collection('equip-transactions');
        await collection.insertOne({ username: username, item: item_number, type: type, time: Date.now() });
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function sendEquip() {
    try {
        let collection = ctx.db.collection('equip-transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            if (transactions[i].type == 'equip') {
                await equipItem(transactions[i].username, transactions[i].item);
            } else if (transactions[i].type == 'unequip') {
                await unequipItem(transactions[i].username, transactions[i].item);
            }
            await collection.deleteOne({ _id: transactions[i]._id });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
            return true;
        }
    }
}

async function queCombine(username, type) {
    try {
        let collection = ctx.db.collection('combine-transactions');
        await collection.insertOne({ username: username, type: type, time: Date.now() });
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function sendCombine() {
    try {
        let collection = ctx.db.collection('combine-transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            await forgeCrate(transactions[i].username, transactions[i].type);
            await collection.deleteOne({ _id: transactions[i]._id });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
            return true;
        }
    }
}

async function queUse(username, type) {
    try {
        let collection = ctx.db.collection('use-transactions');
        await collection.insertOne({ username: username, type: type, time: Date.now() });
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function sendUse() {
    try {
        let collection = ctx.db.collection('use-transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            await useConsumable(transactions[i].username, transactions[i].type);
            await collection.deleteOne({ _id: transactions[i]._id });
        }
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
            return true;
        }
    }
}

module.exports = {
    sendTransaction, sendTransactions,
    queOpenCrates, sendOpenCrates,
    checkTransactions, clearTransactions,
    queEquip, sendEquip,
    queCombine, sendCombine,
    queUse, sendUse
};
