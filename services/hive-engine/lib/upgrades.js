const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook } = require('./webhooks');

async function engineering(username, quantity) {
    try {
        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });
        if (!user) return true;

        let cost = Math.pow(user.engineering, 2);
        let newEngineer = user.engineering + 1;

        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost) {
                let update = await collection.updateOne({ username: username }, { $set: { engineering: newEngineer, last_upgrade_time: Date.now() }, $inc: { version: 1, experience: parseFloat(cost) } });
                if (update.acknowledged == true && update.modifiedCount == 1) {
                    webhook('Engineering Upgrade', username + ' upgraded engineering to level ' + newEngineer, 0x00ff00);
                    return true;
                }
            } else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5;
        }
        return false;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            webhook('Error', 'Error upgrading engineering for ' + username + ' ' + err, '#ff0000');
        }
    }
}

async function defense(username, quantity) {
    try {
        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });
        if (!user) return true;

        let cost = Math.pow(user.defense / 10, 2);
        let newDefense = user.defense + 10;

        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost) {
                let update = await collection.updateOne({ username: username }, { $set: { defense: newDefense, last_upgrade_time: Date.now() }, $inc: { version: 1, experience: parseFloat(cost) } });
                if (update.acknowledged == true && update.modifiedCount == 1) {
                    webhook('Defense Upgrade', username + ' upgraded defense to ' + newDefense, '#00ff00');
                    return true;
                }
            } else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5;
        }
        return false;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function damage(username, quantity) {
    try {
        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });
        if (!user) return true;

        let cost = Math.pow(user.damage / 10, 2);
        let newDamage = user.damage + 10;

        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost) {
                let update = await collection.updateOne({ username: username }, { $set: { damage: newDamage, last_upgrade_time: Date.now() }, $inc: { version: 1, experience: parseFloat(quantity) } });
                if (update.acknowledged == true && update.modifiedCount == 1) {
                    webhook('Damage Upgrade', username + ' upgraded damage to ' + newDamage, '#00ff00');
                    return true;
                }
            } else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5;
        }
        return false;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function contribute(username, quantity) {
    try {
        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });
        if (!user) return true;

        let qty = parseFloat(quantity);
        let newFavor = user.favor + qty;

        let maxAttempts = 3;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            let update = await collection.updateOne({ username: username }, { $set: { favor: newFavor }, $inc: { version: 1, experience: qty } });
            if (update.acknowledged == true && update.modifiedCount == 1) {
                webhook('Contributor', username + ' contributed ' + qty + ' favor', '#00ff00');
                await globalFavorUpdate(qty);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5;
        }
        return false;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function globalFavorUpdate(qty) {
    const stats = ctx.db.collection('stats');
    let maxAttempts = 3;
    let delay = 500;
    for (let i = 0; i < maxAttempts; i++) {
        const result = await stats.updateOne({ date: 'global' }, { $inc: { currentFavor: qty } });
        if (result.acknowledged == true && result.modifiedCount == 1) return true;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2.5;
    }
    return false;
}

module.exports = { engineering, defense, damage, contribute, globalFavorUpdate };
