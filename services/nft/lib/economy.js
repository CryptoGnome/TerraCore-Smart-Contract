const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { questHook } = require('./webhooks');

async function mintFLUX(username, value) {
    try {
        let qty = value.toFixed(8);
        var data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol: 'FLUX',
                to: username,
                quantity: qty.toString(),
                memo: 'terracore_salvage_flux'
            }
        };

        const result = await ctx.hive.broadcast.customJsonAsync(ctx.wif2, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));
        if (result.id) {
            console.log("Minted " + qty + " FLUX for user: " + username);
            return true;
        } else {
            console.log("No result id");
            return false;
        }
    } catch (err) {
        console.log(err);
        return false;
    }
}

async function forgeCrate(owner, type) {
    try {
        var collection = ctx.db.collection('relics');
        let player = await collection.findOne({ username: owner, type: type });
        if (player == null) {
            console.log('User: ' + owner + ' does not exist');
            return false;
        }

        var rarity = type.replace('_relics', '');

        if (player.amount < 100) {
            console.log('User: ' + owner + ' does not have enough ' + type + ' relics to forge crate');
            return false;
        }

        collection = ctx.db.collection('crates');
        let count = await ctx.db.collection('crate-count').findOne({ supply: 'total' });

        let crate = new Object();
        crate.name = rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate';
        crate.rarity = rarity;
        crate.owner = owner;
        crate.item_number = count.count + 1;
        crate.image = "https://terracore.herokuapp.com/images/" + rarity + '_crate.png';
        crate.equiped = false;

        let market = new Object();
        market.listed = false;
        market.price = 0;
        market.seller = null;
        market.created = 0;
        market.expires = 0;
        market.sold = 0;
        crate.market = market;

        await collection.insertOne(crate);
        console.log('Minted crate: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
        await ctx.db.collection('crate-count').updateOne({ supply: 'total' }, { $inc: { count: 1 } });
        await ctx.db.collection('relics').updateOne({ username: owner, type: type }, { $inc: { amount: -100 } });
        await ctx.db.collection('nft-drops').insertOne({ name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: false, relic: true, time: new Date() });

        let color;
        switch (rarity) {
            case 'common':    color = '#bbc0c7'; break;
            case 'uncommon':  color = '#538a62'; break;
            case 'rare':      color = '#2a2cbd'; break;
            case 'epic':      color = '#7c04cc'; break;
            case 'legendary': color = '#d98b16'; break;
        }

        questHook("New Crate Forged", owner + " forged a " + crate.rarity + " crate", color, crate.image);
        return crate;

    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function useConsumable(username, type) {
    try {
        var collection = ctx.db.collection('consumables');
        var player = await collection.findOne({ username: username, type: type });
        if (player == null) {
            console.log('User: ' + username + ' does not exist');
            return false;
        }

        if (player.amount < 1) {
            console.log('User: ' + username + ' does not have enough ' + type + ' consumables');
            return false;
        }

        await ctx.db.collection('consumables').updateOne({ username: username, type: type }, { $inc: { amount: -1 } });
        console.log('Removed 1 ' + type + ' consumable from user: ' + username);

        switch (type) {
            case 'attack_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { attacks: 1, version: 1 } }, { upsert: true });
                console.log('Added 1 attack to user: ' + username);
                break;
            case 'claim_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { claims: 1, version: 1 } }, { upsert: true });
                console.log('Added 1 claim to user: ' + username);
                break;
            case 'crit_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.crit': 1, version: 1 }, $push: { 'consumables.crit_times': Date.now() } }, { upsert: true });
                console.log('Added 1 crit to user: ' + username);
                break;
            case 'dodge_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.dodge': 1, version: 1 }, $push: { 'consumables.dodge_times': Date.now() } }, { upsert: true });
                console.log('Added 1 dodge to user: ' + username);
                break;
            case 'damage_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.damage': 1, version: 1 }, $push: { 'consumables.damage_times': Date.now() } }, { upsert: true });
                console.log('Added 1 damage to user: ' + username);
                break;
            case 'protection_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.protection': 1, version: 1 }, $push: { 'consumables.protection_times': Date.now() } }, { upsert: true });
                console.log('Added 1 protection to user: ' + username);
                break;
            case 'focus_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.focus': 1, version: 1 }, $push: { 'consumables.focus_times': Date.now() } }, { upsert: true });
                console.log('Added 1 focus to user: ' + username);
                break;
            case 'rage_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.rage': 1, version: 1 }, $push: { 'consumables.rage_times': Date.now() } }, { upsert: true });
                console.log('Added 1 rage to user: ' + username);
                break;
            case 'impenetrable_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.impenetrable': 1, version: 1 }, $push: { 'consumables.impenetrable_times': Date.now() } }, { upsert: true });
                console.log('Added 1 impenetrable to user: ' + username);
                break;
            case 'overload_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.overload': 1, version: 1 }, $push: { 'consumables.overload_times': Date.now() } }, { upsert: true });
                console.log('Added 1 overload to user: ' + username);
                break;
            case 'rogue_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { 'consumables.rogue': 1, version: 1 }, $push: { 'consumables.rogue_times': Date.now() } }, { upsert: true });
                console.log('Added 1 rogue to user: ' + username);
                break;
            case 'battle_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $set: { 'boss_data.$[].lastBattle': Date.now() - 14400000 } });
                console.log('Reset all boss_data lastBattle cooldowns for user: ' + username);
                break;
            case 'fury_consumable':
                await ctx.db.collection('players').updateOne({ username: username }, { $inc: { attacks: 4, version: 1 } }, { upsert: true });
                console.log('Added 4 attacks to user: ' + username);
                break;
            default:
                console.log('Invalid consumable type: ' + type);
                return false;
        }
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

module.exports = { mintFLUX, forgeCrate, useConsumable };
