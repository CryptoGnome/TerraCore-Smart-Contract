const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook, marketWebhook, bossWebhook, bossWebhook2, forgeWebhook } = require('./webhooks');

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (Array.isArray(obj)) {
        return obj.reduce((arr, item, i) => { arr[i] = deepClone(item); return arr; }, []);
    }
    if (obj instanceof Object) {
        return Object.keys(obj).reduce((newObj, key) => { newObj[key] = deepClone(obj[key]); return newObj; }, {});
    }
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
    for (let key of keysA) {
        if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
}

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

async function mintCrate(owner, _planet, droproll, luck) {
    try {
        var roll = Math.floor(Math.random() * 1001);
        console.log('Item Roll: ' + roll);
        var roll2 = Math.floor(Math.random() * 1001);
        console.log('Crate Roll: ' + roll2);

        const planetConfig = {
            Terracore:   { rarityThresholds: [950, 985, 995, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [900, 1000],  dropValues: ['consumable', 'crate'] },
            Oceana:      { rarityThresholds: [949, 983, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000],  dropValues: ['consumable', 'crate'] },
            Celestia:    { rarityThresholds: [948, 982, 992, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000],  dropValues: ['consumable', 'crate'] },
            Arborealis:  { rarityThresholds: [947.5, 981, 991, 1000],   rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [500, 1000],  dropValues: ['consumable', 'crate'] },
            Neptolith:   { rarityThresholds: [947, 980.5, 990.5, 1000], rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000],  dropValues: ['consumable', 'crate'] },
            Solisar:     { rarityThresholds: [930, 975, 993, 1000],     rarityValues: ['uncommon', 'rare', 'epic', 'legendary'], dropThresholds: [750, 1000],  dropValues: ['consumable', 'crate'] },
        };

        function getRarityAndDrop(planet, roll, roll2) {
            const config = planetConfig[planet];
            if (!config) throw new Error('Invalid planet');
            const rarity = config.rarityValues.find((value, index) => roll <= config.rarityThresholds[index]);
            const drop = config.dropValues.find((value, index) => roll2 <= config.dropThresholds[index]);
            return { rarity, drop };
        }

        const { rarity, drop } = getRarityAndDrop(_planet, roll, roll2);
        console.log('Drop: ' + drop);

        if (drop == 'crate') {
            let count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });
            let crate = {
                name: rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate',
                rarity: rarity,
                owner: owner,
                item_number: count.count + 1,
                image: 'https://terracore.herokuapp.com/images/' + rarity + '_crate.png',
                equiped: false,
                market: { listed: false, price: 0, seller: null, created: 0, expires: 0, sold: 0 },
            };
            ctx.db.collection('crates').insertOne(crate);
            console.log('Minted crate: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
            bossWebhook('Crate Dropped!', crate.name + ' with rarity: ' + crate.rarity + ' has dropped from a boss for ' + crate.owner + '! Item Number: ' + crate.item_number, crate.rarity, _planet);
            await ctx.db.collection('crate-count').updateOne({ supply: 'total' }, { $inc: { count: 1 } });
            await ctx.db.collection('boss-log').insertOne({ username: crate.owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: crate.rarity, drop: 'crate', time: Date.now() });
            await ctx.db.collection('nft-drops').insertOne({ name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: false, time: new Date() });
            return drop;
        } else if (drop == 'consumable') {
            var type;
            if (rarity == 'uncommon') {
                var types = ['attack', 'claim', 'crit', 'damage', 'dodge'];
                type = types[Math.floor(Math.random() * types.length)];
            } else if (rarity == 'rare') {
                var types = ['rage', 'impenetrable', 'overload', 'rogue', 'battle', 'fury'];
                type = types[Math.floor(Math.random() * types.length)];
            } else {
                var types = ['protection', 'focus'];
                type = types[Math.floor(Math.random() * types.length)];
            }

            let consumables = ctx.db.collection('consumables');
            let player = await consumables.findOne({ username: owner, type: type + '_consumable' });
            await ctx.db.collection('boss-log').insertOne({ username: owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: rarity, drop: type + '_consumable', time: Date.now() });

            if (!player) {
                await consumables.insertOne({ username: owner, version: 1, type: type + '_consumable', amount: 1, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
                bossWebhook2('Consumable Dropped!', 'A ' + rarity + ' ' + type + ' consumable has dropped for ' + owner + '!', rarity, _planet, type + '_consumable');
                await ctx.db.collection('nft-drops').insertOne({ name: type + '_consumable', rarity: rarity, owner: owner, item_number: null, purchased: false, time: new Date() });
                return drop;
            }
            await consumables.updateOne({ username: owner, type: type + '_consumable' }, { $inc: { amount: 1 } });
            bossWebhook2('Consumable Dropped!', 'A ' + rarity + ' ' + type + ' consumable has dropped for ' + owner + '!', rarity, _planet, type + '_consumable');
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
        let collection = ctx.db.collection('relics');
        let player = await collection.findOne({ username: username, type: type });
        if (!player) {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
            await ctx.db.collection('nft-drops').insertOne({ name: type, rarity: rarity, owner: username, amount: amount, item_number: null, purchased: false, time: new Date() });
            bossWebhook2('Relic Dropped!', `${amount} ${type}  have dropped for ${username}!`, rarity, planet, type);
            return true;
        }
        await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
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

async function bossFight(username, _planet) {
    try {
        await ctx.db.collection('players').updateOne({ username: username }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1, experience: 100 } });
        let collection = ctx.db.collection('players');
        let user = await collection.findOne({ username: username });

        if (user == null) {
            console.log('User: ' + username + ' does not exist');
            return false;
        }

        let luck = user.stats.luck;
        let level = user.level;
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

        if (Date.now() - user.boss_data[index].lastBattle < 14400000) {
            console.log('User: ' + username + ' has already battled the boss in the last 4 hours');
            return false;
        }

        let roll = Math.random() * 100;

        if (roll > luck) {
            console.log('------  BOSS MISSED: Boss Drop Roll: ' + roll + ' | Drop Max Roll: ' + luck + ' ------');
            await collection.updateOne({ username: username }, { $set: { ['boss_data.' + index + '.lastBattle']: Date.now() } });

            let luck_mod = luck / 5;
            let minThreshold = 0.1;
            let roll2 = Math.random() * 100;
            if (_planet == 'Terracore') luck_mod = luck_mod / 2;

            let rarity, amount;
            if (roll2 <= 70) {
                rarity = 'common';
                amount = Math.max((Math.random() * 1.25 * luck_mod) + 1, minThreshold);
            } else if (roll2 <= 90) {
                rarity = 'uncommon';
                amount = Math.max((Math.random() * 1 * luck_mod) + 1, minThreshold);
            } else if (roll2 <= 98) {
                rarity = 'rare';
                amount = Math.max((Math.random() * 0.75 * luck_mod) + 1, minThreshold);
            } else if (roll2 <= 99) {
                rarity = 'epic';
                amount = Math.max((Math.random() * 0.5 * luck_mod) + 1, minThreshold);
            } else {
                rarity = 'legendary';
                amount = Math.max(0.1 * luck_mod, minThreshold);
            }
            await issue(username, rarity + '_relics', amount, rarity, _planet);
            await ctx.db.collection('boss-log').insertOne({ username: username, planet: _planet, result: false, roll: roll, luck: luck, drop: rarity + '_relics', amount: amount, time: Date.now() });
            return false;
        } else {
            console.log('------  ITEM FOUND: Boss Drop Roll: ' + roll + ' | Drop Max Roll: ' + luck + ' ------');
            await collection.updateOne({ username: username }, { $set: { ['boss_data.' + index + '.lastBattle']: Date.now() } });
            await mintCrate(username, _planet, roll, luck);
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

async function rollDice(index) {
    return Math.random() * (index - 0.01 * index) + 0.01 * index;
}

async function startQuest(username) {
    try {
        let collection = ctx.db.collection('active-quests');
        let user = await collection.findOne({ username: username });
        let _username = await ctx.db.collection('players').findOne({ username: username });
        await ctx.db.collection('players').updateOne({ username: username }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1, experience: 50 } });

        if (!_username) {
            console.log('User ' + username + ' does not exist');
            return false;
        }
        if (user) {
            console.log('User ' + username + ' already has a quest');
            return false;
        }

        let activeQuest = await selectQuest(1, _username);
        await collection.insertOne(activeQuest);
        await ctx.db.collection('quest-log').insertOne({ username: username, action: 'start', quest: activeQuest, time: new Date() });
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

async function selectQuest(round, user) {
    try {
        let collection = ctx.db.collection('quest-template');
        let quests = await collection.find({}).toArray();
        let random_quest = quests[Math.floor(Math.random() * quests.length)];

        let availableAttributes = ['damage', 'defense', 'engineering', 'dodge', 'crit', 'luck'];
        let attribute_one = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
        availableAttributes = availableAttributes.filter(item => item !== attribute_one);
        let attribute_two = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];

        let base_stats = {
            damage: 20 * round, defense: 20 * round, engineering: 2 * round,
            dodge: round, crit: round, luck: round,
        };

        let success_chance = 0.85;
        for (let i = 0; i < round; i++) success_chance -= 0.05;

        for (let key in user.stats) {
            if ((key == attribute_one || key == attribute_two) && user.stats[key] > base_stats[key]) {
                success_chance += 0.1;
            }
        }

        let common_relics = 0, uncommon_relics = 0, rare_relics = 0, epic_relics = 0, legendary_relics = 0;

        if (round > 0) {
            let roll = await rollDice(1);
            if (roll <= 0.7) {
                roll = await rollDice(1);
                common_relics = (roll * 10) * round / 8;
            } else {
                roll = await rollDice(1);
                uncommon_relics = (roll * 10) * round / 8;
            }
        }

        console.log('------------------------------------------------------');
        console.log('Round: ' + round + ' Success Chance: ' + success_chance + ' for user: ' + user.username);
        console.log('Common Relics: ' + common_relics);
        console.log('Uncommon Relics: ' + uncommon_relics);
        console.log('Rare Relics: ' + rare_relics);
        console.log('Epic Relics: ' + epic_relics);
        console.log('Legendary Relics: ' + legendary_relics);

        return {
            username: user.username, name: random_quest.name, description: random_quest.description,
            image: random_quest.image, round: round, success_chance: success_chance,
            attribute_one: attribute_one, attribute_two: attribute_two,
            attribute_one_value: base_stats[attribute_one], attribute_two_value: base_stats[attribute_two],
            common_relics: common_relics, uncommon_relics: uncommon_relics, rare_relics: rare_relics,
            epic_relics: epic_relics, legendary_relics: legendary_relics, time: Date.now(),
        };
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            ctx.client.close();
            process.exit(1);
        } else {
            console.log(err);
            return false;
        }
    }
}

async function buy_crate(owner, quantity) {
    try {
        let price = await ctx.db.collection('price_feed').findOne({ date: 'global' });
        if (quantity != price.price) return true;

        let rarity = 'common';
        let count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });
        let crate = {
            name: rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate',
            rarity: rarity, owner: owner, item_number: count.count + 1,
            image: 'https://terracore.herokuapp.com/images/' + rarity + '_crate.png',
            equiped: false,
            market: { listed: false, price: 0, seller: null, created: 0, expires: 0, sold: 0 },
        };
        await ctx.db.collection('crates').insertOne(crate);
        console.log('Crate Purchased: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
        marketWebhook('Crate Purchased', crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number, '#00ff00');
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

async function applyItemStats(username) {
    let result = await ctx.db.collection('players').findOne({ username: username });
    for (const itemName in result.items) {
        const item = result.items[itemName];
        let originalItem = await ctx.db.collection('items').findOne({ item_number: item.item_number });
        if (!deepEqual(item.attributes, originalItem.attributes)) {
            result.items[itemName].attributes = deepClone(originalItem.attributes);
        }
    }
    await ctx.db.collection('players').updateOne({ username: username }, { $set: { items: result.items } });
}

async function upgradeItem(username, item_number, quantity) {
    try {
        let collection = ctx.db.collection('items');
        item_number = parseInt(item_number);
        let item = await collection.findOne({ owner: username, item_number: item_number });
        if (item == null) {
            console.log('Item: ' + item_number + ' does not exist or does not belong to user: ' + username);
            return false;
        }
        if (item.owner != username) {
            console.log('Item: ' + item_number + ' does not belong to user: ' + username);
            return false;
        }

        let value = item.attributes.damage / 2 + item.attributes.defense / 2 + item.attributes.engineering * 5 + item.attributes.dodge * 5 + item.attributes.crit * 5 + item.attributes.luck * 10;
        console.log('Item: ' + item_number + ' has a salvage value of: ' + value);

        if (item.level == undefined || isNaN(item.level)) {
            await collection.updateOne({ item_number: item_number }, { $set: { level: 1 } });
            item.level = 1;
        }

        if (quantity < value * 0.0498 * item.level) {
            console.log('User: ' + username + ' did not send the correct amount of flux to upgrade item: ' + item_number);
            return false;
        }

        if (item.salvaged == undefined || item.salvaged == false) {
            await collection.updateOne({ item_number: item_number }, {
                $set: {
                    attributes: {
                        damage: item.attributes.damage * 1.05, defense: item.attributes.defense * 1.05,
                        engineering: item.attributes.engineering * 1.05, dodge: item.attributes.dodge * 1.05,
                        crit: item.attributes.crit * 1.05, luck: item.attributes.luck * 1.05,
                    },
                    level: item.level + 1,
                },
            });
            await ctx.db.collection('forge-log').insertOne({ username: username, item: item, flux: quantity, time: new Date() });
            await ctx.db.collection('stats').updateOne({ date: new Date().toISOString().split('T')[0] }, { $inc: { flux_burned_forge: parseFloat(quantity) } });
            forgeWebhook('Item Upgraded', 'Item: ' + item_number + ' has been upgraded to level: ' + (item.level + 1) + ' by ' + username + ' using ' + quantity + ' FLUX');
            await applyItemStats(username);
            return true;
        } else {
            console.log('Item: ' + item_number + ' has already been salvaged');
            return false;
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

module.exports = {
    deepClone, deepEqual,
    storeHash, storeRejectedHash,
    engineering, defense, damage, contribute, globalFavorUpdate,
    mintCrate, issue, bossFight,
    rollDice, startQuest, selectQuest,
    buy_crate, applyItemStats, upgradeItem,
};
