const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { engineering, defense, damage, contribute } = require('./upgrades');
const { bossFight: _bossFight, buy_crate, issue: _issue } = require('./boss');
const { upgradeItem } = require('./items');
const { storeHash, checkHash } = require('./hashes');

async function sendTransaction(username, quantity, type, hash) {
    try {
        let collection = ctx.db.collection('he-transactions');

        // Reject already-queued or already-processed hashes
        const inQueue = await collection.findOne({ hash: hash });
        if (inQueue) {
            console.warn(`[HE] duplicate tx skipped (in queue): hash=${hash} type=${type} user=${username}`);
            return;
        }
        if (await checkHash(hash)) {
            console.warn(`[HE] duplicate tx skipped (already processed): hash=${hash} type=${type} user=${username}`);
            return;
        }

        let result = await collection.insertOne({ username: username, quantity: quantity, type: type, hash: hash, time: new Date() });
        console.log('Transaction ' + result.insertedId + ' added to queue');
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
        let collection = ctx.db.collection('he-transactions');
        let transactions = await collection.find({}).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            const tx = transactions[i];

            if (tx.type == 'engineering') {
                const result = await engineering(tx.username, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'contribute') {
                const result = await contribute(tx.username, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'defense') {
                const result = await defense(tx.username, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'damage') {
                const result = await damage(tx.username, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'buy_crate') {
                const result = await buy_crate(tx.username, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else if (tx.type == 'forge') {
                const item_number = tx.hash.split('-')[1];
                console.log('Item #' + item_number + ' sent to forge');
                const result = await upgradeItem(tx.username, item_number, tx.quantity);
                if (result) await storeHash(tx.hash, tx.username, tx.quantity);
                await collection.deleteOne({ _id: tx._id });
            } else {
                console.log('Unknown transaction type: ' + tx.type);
                await collection.deleteOne({ _id: tx._id });
            }
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
    const done = await sendTransactions();
    if (done) {
        ctx.lastCheck = Date.now();
        setTimeout(checkTransactions, 1000);
    }
}

module.exports = { sendTransaction, sendTransactions, checkTransactions };
