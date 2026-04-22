const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');

async function storeHash(hash, username, amount) {
    try {
        let collection = ctx.db.collection('hashes');
        await collection.insertOne({ hash: hash, username: username, amount: parseFloat(amount), time: Date.now() });
        console.log('Hash ' + hash + ' stored');
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function storeRejectedHash(hash, username) {
    try {
        let collection = ctx.db.collection('rejectedHashes');
        await collection.insertOne({ hash: hash, username: username, time: Date.now() });
        console.log('Rejected Hash ' + hash + ' stored');
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

module.exports = { storeHash, storeRejectedHash };
