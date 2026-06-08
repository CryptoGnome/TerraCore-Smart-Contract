const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');

async function storeHash(memo, username, amount, trxId) {
    try {
        let collection = ctx.db.collection('hashes');
        // `hash` keeps the human-readable memo (consumed by the API's daily favor/skills/staked
        // stats and useful for audit). `trxId` is the replay-dedup key (Hive Engine transaction id).
        await collection.insertOne({ hash: memo, username: username, amount: parseFloat(amount), time: Date.now(), trxId: trxId });
        console.log('Hash stored (trxId=' + trxId + ', memo=' + memo + ')');
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

async function checkHash(trxId) {
    try {
        // Defense-in-depth: never query with a falsy key. A missing trxId would serialize to
        // { trxId: null } and match the legacy (pre-trxId) docs, falsely flagging a paid op as a
        // duplicate. Callers already pass `trxId || memo`, but guard here so checkHash is safe for
        // any caller. Fail open (treat as not-seen) — dropping a paid op is the worse outcome.
        if (!trxId) return false;
        const collection = ctx.db.collection('hashes');
        const existing = await collection.findOne({ trxId: trxId });
        return !!existing;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

module.exports = { storeHash, storeRejectedHash, checkHash };
