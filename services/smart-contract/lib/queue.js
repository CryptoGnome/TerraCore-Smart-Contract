const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { claim } = require('./claims');
const { battle } = require('./combat');
const { progressQuest, completeQuest } = require('./quests');
const { logError } = require('../../../shared/error-logger');

async function sendTransaction(username, type, target, blockId, trxId, hash) {
    try {
        let collection = ctx.db.collection('transactions');
        if (blockId !== undefined && trxId !== undefined) {
            const existing = await collection.findOne({ blockId: blockId, trxId: trxId });
            if (existing) {
                console.warn(`[SC] duplicate transaction skipped: blockId=${blockId} trxId=${trxId} type=${type} user=${username}`);
                return;
            }
        }
        let result = await collection.insertOne({ username: username, type: type, target: target, blockId: blockId, trxId: trxId, hash: hash, time: Date.now() });
        console.log('Transaction ' + result.insertedId + ' added to queue');
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            logError('SYS_MONGO_CLOSED', err, { fn: 'sendTransaction', service: 'SC' }, 'FATAL');
            ctx.client.close();
            process.exit(1);
        } else {
            logError('SC_QUEUE_TX_FAIL', err, { fn: 'sendTransaction', service: 'SC' });
        }
    }
}

async function sendTransactions() {
    try {
        ctx.lastCheck = Date.now();
        let collection = ctx.db.collection('transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        if (transactions.length > 25 && ctx.changeNode) {
            ctx.changeNode();
        }

        if (transactions.length === 0) return true;

        console.log('-------------------------------------------------------');
        console.log('Sending ' + transactions.length + ' transactions');
        console.log('-------------------------------------------------------');

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            const tx = transactions[i];
            console.log('Sending ' + tx.type + ' transaction ' + (i + 1) + ' of ' + transactions.length);

            if (tx.type == 'claim') {
                while (true) {
                    const result = await claim(tx.username);
                    if (result) {
                        let maxAttempts = 3;
                        let delay = 3000;
                        for (let j = 0; j < maxAttempts; j++) {
                            const clear = await collection.deleteOne({ _id: tx._id });
                            if (clear.deletedCount == 1) break;
                            await new Promise(resolve => setTimeout(resolve, delay));
                            delay *= 1.2;
                        }
                    }
                    break;
                }
            } else if (tx.type == 'battle') {
                while (true) {
                    const result = await battle(tx.username, tx.target, tx.blockId, tx.trxId, tx.hash);
                    if (result) {
                        let maxAttempts = 3;
                        let delay = 3000;
                        for (let j = 0; j < maxAttempts; j++) {
                            const clear = await collection.deleteOne({ _id: tx._id });
                            if (clear.deletedCount == 1) break;
                            await new Promise(resolve => setTimeout(resolve, delay));
                            delay *= 1.2;
                        }
                    }
                    break;
                }
            } else if (tx.type == 'progress') {
                await progressQuest(tx.username, tx.blockId, tx.trxId);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'complete') {
                await completeQuest(tx.username);
                await collection.deleteOne({ _id: tx._id });
            }
        }

        console.log('Completed Sending Transactions');
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            logError('SYS_MONGO_CLOSED', err, { fn: 'sendTransactions', service: 'SC' }, 'FATAL');
            ctx.client.close();
            process.exit(1);
        } else {
            logError('SC_QUEUE_TX_FAIL', err, { fn: 'sendTransactions', service: 'SC' });
            return true;
        }
    }
}

async function checkTransactions() {
    try {
        const done = await sendTransactions();
        if (done) {
            setTimeout(checkTransactions, 200);
        }
    } catch (err) {
        ctx.client.close();
        process.exit(1);
    }
}

async function clearTransactions() {
    try {
        await ctx.db.collection('transactions').deleteMany({});
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); process.exit(1); }
        else { console.log(err); }
    }
}

async function clearFirst() {
    try {
        await ctx.db.collection('transactions').deleteOne({});
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) { console.log('MongoDB connection closed'); process.exit(1); }
        else { console.log(err); }
    }
}

module.exports = { sendTransaction, sendTransactions, checkTransactions, clearTransactions, clearFirst };
