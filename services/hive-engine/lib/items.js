const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { forgeWebhook } = require('./webhooks');

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (Array.isArray(obj)) return obj.reduce((arr, item, i) => { arr[i] = deepClone(item); return arr; }, []);
    if (obj instanceof Object) return Object.keys(obj).reduce((newObj, key) => { newObj[key] = deepClone(obj[key]); return newObj; }, {});
    throw new Error(`Unable to copy object: ${obj}`);
}

function deepEqual(a, b) {
    a = Number.isNaN(a) ? 0 : a;
    b = Number.isNaN(b) ? 0 : b;
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
}

async function applyItemStats(username) {
    const result = await ctx.db.collection('players').findOne({ username: username });
    for (const itemName in result.items) {
        const item = result.items[itemName];
        const originalItem = await ctx.db.collection('items').findOne({ item_number: item.item_number });
        if (!deepEqual(item.attributes, originalItem.attributes)) {
            result.items[itemName].attributes = deepClone(originalItem.attributes);
        }
    }
    await ctx.db.collection('players').updateOne({ username: username }, { $set: { items: result.items } });
}

async function upgradeItem(username, item_number, quantity) {
    try {
        const collection = ctx.db.collection('items');
        item_number = parseInt(item_number);
        const item = await collection.findOne({ owner: username, item_number: item_number });

        if (!item) {
            console.log('Item: ' + item_number + ' does not exist or does not belong to: ' + username);
            return false;
        }
        if (item.owner != username) {
            console.log('Item: ' + item_number + ' does not belong to: ' + username);
            return false;
        }

        const value = item.attributes.damage / 2 + item.attributes.defense / 2
            + item.attributes.engineering * 5 + item.attributes.dodge * 5
            + item.attributes.crit * 5 + item.attributes.luck * 10;
        console.log('Item: ' + item_number + ' salvage value: ' + value);

        if (item.level == undefined || isNaN(item.level)) {
            await collection.updateOne({ item_number: item_number }, { $set: { level: 1 } });
            item.level = 1;
        }

        if (quantity < value * 0.0498 * item.level) {
            console.log('User: ' + username + ' sent insufficient FLUX for item: ' + item_number);
            return false;
        }

        if (item.salvaged != undefined && item.salvaged == true) {
            console.log('Item: ' + item_number + ' has already been salvaged');
            return false;
        }

        await collection.updateOne({ item_number: item_number }, {
            $set: {
                attributes: {
                    damage:      item.attributes.damage      * 1.05,
                    defense:     item.attributes.defense     * 1.05,
                    engineering: item.attributes.engineering * 1.05,
                    dodge:       item.attributes.dodge       * 1.05,
                    crit:        item.attributes.crit        * 1.05,
                    luck:        item.attributes.luck        * 1.05,
                },
                level: item.level + 1,
            },
        });
        await ctx.db.collection('forge-log').insertOne({ username: username, item: item, flux: quantity, time: new Date() });
        await ctx.db.collection('stats').updateOne({ date: new Date().toISOString().split('T')[0] }, { $inc: { flux_burned_forge: parseFloat(quantity) } });
        forgeWebhook('Item Upgraded', 'Item #' + item_number + ' upgraded to level ' + (item.level + 1) + ' by ' + username + ' using ' + quantity + ' FLUX');
        await applyItemStats(username);
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

module.exports = { applyItemStats, upgradeItem };
