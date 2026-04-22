const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { engineering, defense, damage, contribute, buy_crate, upgradeItem, storeHash } = require('./game');

async function sendTransaction(username, quantity, type, hash) {
    try {
        let collection = ctx.db.collection('he-transactions');
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
            let transaction = transactions[i];

            if (transaction.type == 'engineering') {
                let result = await engineering(transaction.username, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else if (transaction.type == 'contribute') {
                let result = await contribute(transaction.username, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else if (transaction.type == 'defense') {
                let result = await defense(transaction.username, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else if (transaction.type == 'damage') {
                let result = await damage(transaction.username, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else if (transaction.type == 'buy_crate') {
                let result = await buy_crate(transaction.username, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else if (transaction.type == 'forge') {
                let item_number = transaction.hash.split('-')[1];
                console.log('Item Number: ' + item_number + ' Sent to forge');
                let result = await upgradeItem(transaction.username, item_number, transaction.quantity);
                if (result) await storeHash(transaction.hash, transaction.username, transaction.quantity);
                await collection.deleteOne({ _id: transaction._id });
            } else {
                console.log('unknown transaction type');
                await collection.deleteOne({ _id: transaction._id });
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
    let done = await sendTransactions();
    if (done) {
        ctx.lastCheck = Date.now();
        setTimeout(checkTransactions, 1000);
    }
}

module.exports = { sendTransaction, sendTransactions, checkTransactions };
