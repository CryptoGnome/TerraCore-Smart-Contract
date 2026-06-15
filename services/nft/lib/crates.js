const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { webhook3 } = require('./webhooks');
const { createSeed, generateRandomNumber } = require('../../../shared/rng');
const { rollItemRarity, rollItemAttributes } = require('./crate-loot');

async function open_crate(owner, _rarity, blockId, trxId, hash, depth = 0) {
    try {
        if (depth > 5) {
            console.log('open_crate: max reroll depth reached for ' + owner + ' rarity=' + _rarity);
            return;
        }
        let types = ['avatar', 'armor', 'weapon', 'special', 'ship'];
        let ranges = [[0, 43], [1000, 1012], [2000, 2019], [3000, 3014], [4000, 4016]];
        let collection = ctx.db.collection('item-templates');

        var seed = await createSeed(blockId, trxId, hash);
        const rng = seedrandom(seed + '-' + depth);
        var roll = await generateRandomNumber(seed);
        const originalRandom = roll;

        let type = types[Math.floor(rng() * types.length)];

        var rarity = rollItemRarity(_rarity, roll);

        let range = ranges[types.indexOf(type)];
        let item_id = Math.floor(rng() * (range[1] - range[0] + 1)) + range[0];
        let find = await collection.findOne({ id: item_id });

        if (find != null) {
            collection = ctx.db.collection('items');

            let item = new Object();
            item.name = find.name;
            item.id = find.id;
            item.edition = find.edition;
            item.print = await collection.countDocuments({ id: find.id }) + 1;
            item.max_supply = find.max_supply;
            if (item.print > find.max_supply) {
                console.log('Item ' + item_id + ' at max supply, rerolling');
                open_crate(owner, rarity, blockId, trxId, hash, depth + 1);
                return;
            }
            item.description = find.description;
            item.image = find.image;
            item.owner = owner;
            item.type = type;
            item.rarity = rarity;
            item.equiped = false;
            item.burnt = false;

            const itemAttrs    = rollItemAttributes(type, rarity, rng);
            const rarity_index = itemAttrs.rarity_index;
            const attribute_list = itemAttrs.attributes;
            const att_count    = itemAttrs.att_count;

            if (att_count < rarity_index) {
                console.log(rarity + ' ||  Attributes: ' + JSON.stringify(attribute_list) + '                    ||  Not enough attributes, rerolling');
                open_crate(owner, rarity, blockId, trxId, hash, depth + 1);
                return;
            }

            item.attributes = attribute_list;
            item.market = find.market;

            let check = await ctx.db.collection('crates').findOne({ owner: owner, rarity: _rarity, 'market.listed': false });
            if (check != null) {
                console.log("Minted item: " + item.name + " with id: " + item.id + " with rarity: " + item.rarity + " with attributes: " + JSON.stringify(item.attributes));
                let count = await ctx.db.collection('item-count').findOne({ supply: 'total' });
                var new_count = count.count += 1;
                item.item_number = new_count;
                let check2 = await ctx.db.collection('items').findOne({ item_number: new_count });
                if (check2 == null) {
                    await ctx.db.collection('item-count').updateOne({ supply: "total" }, { $set: { count: new_count } });
                    await ctx.db.collection('crates').deleteOne({ owner: owner, rarity: _rarity, 'market.listed': false });
                    await ctx.db.collection('items').insertOne(item);
                    webhook3('New Item Minted', item.name + ' NFT #' + item.item_number.toString() + ' has been minted by: ' + owner, item.rarity, item.attributes, '#a538ff', item.id);
                    await ctx.db.collection('nft-mints').insertOne({ item_id: item.id, item_number: item.item_number, rarity: rarity, owner: owner, type: type, attributes: item.attributes, edition: item.edition, seed: seed, roll: originalRandom, timestamp: Date.now() });
                } else {
                    console.log('Item number: ' + new_count + ' already taken');
                    return;
                }
            } else {
                console.log("No crate found for user: " + owner + " with rarity: " + rarity);
                return;
            }
        } else {
            console.log('Base item' + item_id + ' not found in item templates');
            return;
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

module.exports = { createSeed, generateRandomNumber, open_crate };
