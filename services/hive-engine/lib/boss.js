const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { bossWebhook, bossWebhook2, marketWebhook } = require('./webhooks');

const planetConfig = {
    Terracore:   { rarityThresholds: [950, 985, 995, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [900, 1000], dropValues: ['consumable', 'crate'] },
    Oceana:      { rarityThresholds: [949, 983, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Celestia:    { rarityThresholds: [948, 982, 992, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Arborealis:  { rarityThresholds: [947.5, 981, 991, 1000],   rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [500, 1000], dropValues: ['consumable', 'crate'] },
    Neptolith:   { rarityThresholds: [947, 980.5, 990.5, 1000], rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Solisar:     { rarityThresholds: [930, 975, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
};

function getRarityAndDrop(planet, roll, roll2) {
    const config = planetConfig[planet];
    if (!config) throw new Error('Invalid planet: ' + planet);
    const rarity = config.rarityValues.find((value, index) => roll <= config.rarityThresholds[index]);
    const drop = config.dropValues.find((value, index) => roll2 <= config.dropThresholds[index]);
    return { rarity, drop };
}

async function mintCrate(owner, _planet, droproll, luck, seed) {
    try {
        const rng   = seedrandom(seed + '-crate');
        const roll  = Math.floor(rng() * 1001);
        const roll2 = Math.floor(rng() * 1001);
        console.log('Item Roll: ' + roll + ' | Crate Roll: ' + roll2);

        const { rarity, drop } = getRarityAndDrop(_planet, roll, roll2);
        console.log('Drop: ' + drop);

        if (drop == 'crate') {
            let count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });
            let crate = {
                name: rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate',
                rarity: rarity, owner: owner, item_number: count.count + 1,
                image: 'https://terracore.herokuapp.com/images/' + rarity + '_crate.png',
                equiped: false,
                market: { listed: false, price: 0, seller: null, created: 0, expires: 0, sold: 0 },
            };
            await ctx.db.collection('crates').insertOne(crate);
            console.log('Minted crate: ' + crate.name + ' for ' + crate.owner + ' #' + crate.item_number);
            bossWebhook('Crate Dropped!', crate.name + ' has dropped for ' + crate.owner + '! Item #' + crate.item_number, crate.rarity, _planet);
            await ctx.db.collection('crate-count').updateOne({ supply: 'total' }, { $inc: { count: 1 } });
            await ctx.db.collection('boss-log').insertOne({ username: crate.owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: crate.rarity, drop: 'crate', time: Date.now() });
            await ctx.db.collection('nft-drops').insertOne({ name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: false, time: new Date() });
            return drop;
        }

        if (drop == 'consumable') {
            let type;
            if (rarity == 'uncommon') {
                const types = ['attack', 'claim', 'crit', 'damage', 'dodge'];
                type = types[Math.floor(rng() * types.length)];
            } else if (rarity == 'rare') {
                const types = ['rage', 'impenetrable', 'overload', 'rogue', 'battle', 'fury'];
                type = types[Math.floor(rng() * types.length)];
            } else {
                const types = ['protection', 'focus'];
                type = types[Math.floor(rng() * types.length)];
            }

            const consumables = ctx.db.collection('consumables');
            const player = await consumables.findOne({ username: owner, type: type + '_consumable' });
            await ctx.db.collection('boss-log').insertOne({ username: owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: rarity, drop: type + '_consumable', time: Date.now() });

            if (!player) {
                await consumables.insertOne({ username: owner, version: 1, type: type + '_consumable', amount: 1, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
            } else {
                await consumables.updateOne({ username: owner, type: type + '_consumable' }, { $inc: { amount: 1 } });
            }
            bossWebhook2('Consumable Dropped!', 'A ' + rarity + ' ' + type + ' consumable dropped for ' + owner + '!', rarity, _planet, type + '_consumable');
            await ctx.db.collection('nft-drops').insertOne({ name: type + '_consumable', rarity: rarity, owner: owner, item_number: null, purchased: false, time: new Date() });
            return drop;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function issue(username, type, amount, rarity, planet) {
    try {
        console.log('Issuing ' + amount + ' ' + type + ' to ' + username);
        const collection = ctx.db.collection('relics');
        const player = await collection.findOne({ username: username, type: type });
        if (!player) {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
        } else {
            await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
        }
        await ctx.db.collection('nft-drops').insertOne({ name: type, rarity: rarity, owner: username, amount: amount, item_number: null, purchased: false, time: new Date() });
        bossWebhook2('Relic Dropped!', `${amount} ${type} have dropped for ${username}!`, rarity, planet, type);
        return true;
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

async function bossFight(username, _planet, seed) {
    try {
        const collection = ctx.db.collection('players');
        const user = await collection.findOne({ username: username });

        if (!user) {
            console.log('User: ' + username + ' does not exist');
            return false;
        }

        if (!planetConfig[_planet]) {
            console.error(`[HE] bossFight: invalid planet '${_planet}' for user ${username}`);
            return false;
        }

        const luck  = user.stats.luck;
        const level = user.level;
        let found = false;
        let index = 0;

        for (let i = 0; i < user.boss_data.length; i++) {
            if (user.boss_data[i].name == _planet && level >= user.boss_data[i].level) {
                found = true;
                index = i;
            }
        }

        if (!found) {
            console.log('User: ' + username + ' does not have access to planet: ' + _planet);
            return false;
        }

        // Atomically claim the cooldown slot, grant experience, and set lastBattle.
        // A concurrent or replayed fight will fail because lastBattle will already be now.
        const now = Date.now();
        const reserved = await collection.findOneAndUpdate(
            {
                username,
                $or: [
                    { [`boss_data.${index}.lastBattle`]: { $exists: false } },
                    { [`boss_data.${index}.lastBattle`]: { $lt: now - 14400000 } }
                ]
            },
            {
                $set: { [`boss_data.${index}.lastBattle`]: now, last_upgrade_time: now },
                $inc: { version: 1, experience: 100 }
            },
            { returnOriginal: false }
        );

        if (!reserved.value) {
            console.log('User: ' + username + ' already battled boss in the last 4 hours');
            return false;
        }

        const rng  = seedrandom(seed + '-boss');
        const roll = rng() * 100;

        if (roll > luck) {
            console.log('------  BOSS MISSED: Roll: ' + roll + ' | Max: ' + luck + ' ------');

            let luck_mod = luck / 5;
            const minThreshold = 0.1;
            const roll2 = rng() * 100;
            if (_planet == 'Terracore') luck_mod = luck_mod / 2;

            let rarity, amount;
            if      (roll2 <= 70) { rarity = 'common';    amount = Math.max((rng() * 1.25 * luck_mod) + 1, minThreshold); }
            else if (roll2 <= 90) { rarity = 'uncommon';  amount = Math.max((rng() *  1   * luck_mod) + 1, minThreshold); }
            else if (roll2 <= 98) { rarity = 'rare';      amount = Math.max((rng() * 0.75 * luck_mod) + 1, minThreshold); }
            else if (roll2 <= 99) { rarity = 'epic';      amount = Math.max((rng() * 0.5  * luck_mod) + 1, minThreshold); }
            else                  { rarity = 'legendary'; amount = Math.max(0.1 * luck_mod, minThreshold); }
            amount = parseFloat(amount.toFixed(3));

            await issue(username, rarity + '_relics', amount, rarity, _planet);
            await ctx.db.collection('boss-log').insertOne({ username: username, planet: _planet, result: false, roll: roll, luck: luck, drop: rarity + '_relics', amount: amount, time: Date.now() });
            return false;
        } else {
            console.log('------  ITEM FOUND: Roll: ' + roll + ' | Max: ' + luck + ' ------');
            await mintCrate(username, _planet, roll, luck, seed);
            return true;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

async function buy_crate(owner, quantity) {
    try {
        const price = await ctx.db.collection('price_feed').findOne({ date: 'global' });
        if (quantity != price.price) return true;

        const rarity = 'common';
        const count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });
        const crate = {
            name: 'Common Loot Crate', rarity: rarity, owner: owner,
            item_number: count.count + 1,
            image: 'https://terracore.herokuapp.com/images/common_crate.png',
            equiped: false,
            market: { listed: false, price: 0, seller: null, created: 0, expires: 0, sold: 0 },
        };
        await ctx.db.collection('crates').insertOne(crate);
        console.log('Crate Purchased: ' + crate.name + ' for ' + crate.owner + ' #' + crate.item_number);
        marketWebhook('Crate Purchased', crate.name + ' for ' + crate.owner + ' #' + crate.item_number, '#00ff00');
        await ctx.db.collection('crate-count').updateOne({ supply: 'total' }, { $inc: { count: 1 } });
        await ctx.db.collection('nft-drops').insertOne({ name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: true, time: new Date() });
        await ctx.db.collection('players').updateOne({ username: owner }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1 } });
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

module.exports = { mintCrate, issue, bossFight, buy_crate };
