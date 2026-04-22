const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { claim, battle, progressQuest, completeQuest } = require('./game');

async function sendTransaction(username, type, target, blockId, trxId, hash) {
    try {
        let collection = ctx.db.collection('transactions');
        let result = await collection.insertOne({ username: username, type: type, target: target, blockId: blockId, trxId: trxId, hash: hash, time: Date.now() });
        console.log('Transaction ' + result.insertedId + ' added to queue');
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

async function sendTransactions() {
    try {
        ctx.lastCheck = Date.now();
        let collection = ctx.db.collection('transactions');
        let transactions = await collection.find({}).sort({ time: 1 }).toArray();

        if (transactions.length > 25 && ctx.changeNode) {
            ctx.changeNode();
        }

        if (transactions.length != 0) {
            console.log('-------------------------------------------------------');
            console.log('Sending ' + transactions.length + ' transactions');
            console.log('-------------------------------------------------------');

            for (let i = 0; i < transactions.length; i++) {
                ctx.lastCheck = Date.now();
                let transaction = transactions[i];
                console.log('Sending ' + transaction.type + ' transaction ' + (i + 1).toString() + ' of ' + transactions.length.toString());

                if (transaction.type == 'claim') {
                    while (true) {
                        const result = await claim(transaction.username);
                        if (result) {
                            let maxAttempts = 3;
                            let delay = 3000;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if (clear.deletedCount == 1) break;
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.2;
                            }
                        }
                        break;
                    }
                } else if (transaction.type == 'battle') {
                    while (true) {
                        var result2 = await battle(transaction.username, transaction.target, transaction.blockId, transaction.trxId, transaction.hash);
                        if (result2) {
                            let maxAttempts = 3;
                            let delay = 3000;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if (clear.deletedCount == 1) break;
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.2;
                            }
                        }
                        break;
                    }
                } else if (transaction.type == 'progress') {
                    await progressQuest(transaction.username, transaction.blockId, transaction.trxId);
                    await collection.deleteOne({ _id: transaction._id });
                } else if (transaction.type == 'complete') {
                    await completeQuest(transaction.username);
                    await collection.deleteOne({ _id: transaction._id });
                }
            }
            console.log('Completed Sending Transactions');
            return true;
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
            return true;
        }
    }
}

async function checkTransactions() {
    try {
        let done = await sendTransactions();
        if (done) {
            setTimeout(checkTransactions, 200);
        }
    } catch (err) {
        ctx.client.close();
        process.exit(1);
    }
}

module.exports = { sendTransaction, sendTransactions, checkTransactions };
