const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { crateDropWebhook, consumableDropWebhook, relicDropWebhook, marketWebhook } = require('./webhooks');

const FALLBACK_CONFIG = {
    Terracore:   { flux: 1, rarityThresholds: [950, 985, 995, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [900, 1000], dropValues: ['consumable', 'crate'] },
    Oceana:      { flux: 2, rarityThresholds: [949, 983, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Celestia:    { flux: 2, rarityThresholds: [948, 982, 992, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Arborealis:  { flux: 2, rarityThresholds: [947.5, 981, 991, 1000],   rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [500, 1000], dropValues: ['consumable', 'crate'] },
    Neptolith:   { flux: 2, rarityThresholds: [947, 980.5, 990.5, 1000], rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
    Solisar:     { flux: 2, rarityThresholds: [930, 975, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000], dropValues: ['consumable', 'crate'] },
};

let planetConfig = { ...FALLBACK_CONFIG };
let configLastLoaded = 0;
const CONFIG_TTL = 5 * 60 * 1000; // 5 minutes

async function refreshPlanetConfig() {
    try {
        const docs = await ctx.db.collection('planet-config').find({}).toArray();
        if (!docs || docs.length === 0) return; // DB empty — keep fallback
        const fresh = { ...FALLBACK_CONFIG };   // always start from fallback so existing planets stay safe
        for (const doc of docs) {
            fresh[doc.name] = {
                flux:             doc.flux ?? fresh[doc.name]?.flux ?? null,
                rarityThresholds: doc.rarityThresholds,
                rarityValues:     doc.rarityValues,
                dropThresholds:   doc.dropThresholds,
                dropValues:       doc.dropValues
            };
        }
        planetConfig = fresh;
        configLastLoaded = Date.now();
    } catch (err) {
        console.error('[boss] Failed to refresh planet config from DB:', err);
        // keep existing cache — no fight disruption
    }
}

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
            crateDropWebhook(crate.owner, crate.name, crate.item_number, crate.rarity, _planet);
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
            consumableDropWebhook(owner, type, rarity, _planet);
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
        relicDropWebhook(username, type, amount, rarity, planet);
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
    if (Date.now() - configLastLoaded > CONFIG_TTL) {
        await refreshPlanetConfig();
    }
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

const CRATE_USD_DEFAULTS = { common: 5.0, uncommon: 10.0, rare: 20.0, epic: 35.0 };
const PURCHASABLE_RARITIES = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_COLORS = { common: '#aaaaaa', uncommon: '#4caf50', rare: '#2196f3', epic: '#9c27b0' };

async function buy_crate(owner, quantity, rarity = 'common') {
    try {
        if (!PURCHASABLE_RARITIES.includes(rarity)) {
            console.log(`[HE] buy_crate: forbidden rarity '${rarity}' for ${owner}`);
            return true;
        }

        const price = await ctx.db.collection('price_feed').findOne({ date: 'global' });
        if (!price) {
            console.error('[HE] buy_crate: price_feed missing, rejecting purchase for ' + owner);
            return false;
        }

        let expectedCost;
        if (rarity === 'common') {
            expectedCost = price.price;
        } else {
            if (!price.scrap_usd || price.scrap_usd <= 0) {
                console.error(`[HE] buy_crate: scrap_usd invalid (${price.scrap_usd}), cannot price ${rarity} crate for ${owner}`);
                return false;
            }
            const usdTarget = price[`${rarity}_crate_usd`] ?? CRATE_USD_DEFAULTS[rarity];
            expectedCost = Math.ceil(usdTarget / price.scrap_usd);
        }

        if (parseFloat(quantity) !== expectedCost) {
            console.log(`[HE] buy_crate: ${owner} paid ${quantity} SCRAP for ${rarity} crate, expected ${expectedCost}`);
            return true;
        }

        const count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });
        const crateName = rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate';
        const crate = {
            name: crateName, rarity: rarity, owner: owner,
            item_number: count.count + 1,
            image: `https://api.terracoregame.com/images/${rarity}_crate.png`,
            equiped: false,
            market: { listed: false, price: 0, seller: null, created: 0, expires: 0, sold: 0 },
        };
        await ctx.db.collection('crates').insertOne(crate);
        console.log(`Crate Purchased: ${crate.name} for ${crate.owner} #${crate.item_number}`);
        marketWebhook('Crate Purchased', `${crate.name} for ${crate.owner} #${crate.item_number}`, RARITY_COLORS[rarity] ?? '#aaaaaa');
        await ctx.db.collection('crate-count').updateOne({ supply: 'total' }, { $inc: { count: 1 } });
        await ctx.db.collection('nft-drops').insertOne({ name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: true, cost: expectedCost, time: new Date() });
        await ctx.db.collection('players').updateOne({ username: owner }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1 } });

        if (rarity !== 'common') {
            const today = new Date().toISOString().split('T')[0];
            await ctx.db.collection('stats').updateOne(
                { date: today },
                { $inc: { [`crates_purchased_${rarity}`]: 1 } },
                { upsert: true }
            );
        }

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

async function getExpectedFluxCost(planet) {
    if (Date.now() - configLastLoaded > CONFIG_TTL) {
        await refreshPlanetConfig();
    }
    const cfg = planetConfig[planet];
    return cfg?.flux ?? null;
}

module.exports = { mintCrate, issue, bossFight, buy_crate, getExpectedFluxCost };
