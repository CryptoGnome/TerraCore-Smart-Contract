const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { open_crate } = require('./crates');
const { equipItem, unequipItem } = require('./items');
const { forgeCrate, useConsumable } = require('./economy');

async function sendTransaction(username, amount, type) {
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
        let transactions = await collection.find({}).toArray();

        for (let i = 0; i < transactions.length; i++) {
            ctx.lastCheck = Date.now();
            // Delete by _id before broadcasting to prevent double-sends if the process restarts mid-loop
            const deleted = await collection.findOneAndDelete({ _id: transactions[i]._id });
            if (!deleted.value) continue; // already processed by a concurrent cycle

            const xfer = new Object();
            xfer.from = "terracore.market";
            xfer.to = deleted.value.username;
            xfer.amount = deleted.value.amount;
            xfer.memo = deleted.value.type;
            await ctx.hive.broadcast.transfer(ctx.wif, xfer.from, xfer.to, xfer.amount, xfer.memo, function (err, result) {
                if (err) {
                    console.log(err);
                } else {
                    console.log(result);
                }
            });
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
        setTimeout(checkTransactions, 1000);
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
