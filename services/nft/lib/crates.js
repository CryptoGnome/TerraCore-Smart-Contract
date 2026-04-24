const { MongoTopologyClosedError } = require('mongodb');
var seedrandom = require('seedrandom');
const ctx = require('../context');
const { webhook3 } = require('./webhooks');
const { createSeed, generateRandomNumber } = require('../../../shared/rng');

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

        var rarity = 'common';
        if (_rarity == 'common') {
            if (roll <= 90000)       rarity = 'common';
            else if (roll <= 99000)  rarity = 'uncommon';
            else if (roll <= 99750)  rarity = 'rare';
            else if (roll <= 99950)  rarity = 'epic';
            else                     rarity = 'legendary';
        } else if (_rarity == 'uncommon') {
            if (roll <= 95000)       rarity = 'uncommon';
            else if (roll <= 99000)  rarity = 'rare';
            else if (roll <= 99900)  rarity = 'epic';
            else                     rarity = 'legendary';
        } else if (_rarity == 'rare') {
            if (roll < 95000)        rarity = 'rare';
            else if (roll < 99000)   rarity = 'epic';
            else                     rarity = 'legendary';
        } else if (_rarity == 'epic') {
            if (roll < 98000)        rarity = 'epic';
            else                     rarity = 'legendary';
        } else if (_rarity == 'legendary') {
            rarity = 'legendary';
        }

        let range = ranges[types.indexOf(type)];
        let item_id = Math.floor(rng() * (range[1] - range[0] + 1)) + range[0];
        let find = await collection.findOne({ id: item_id });

        var attributes = ["damage", "defense", "engineering", "dodge", "crit", "luck"];

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

            let rarity_index = 1;
            if (rarity == 'uncommon') {
                rarity_index = 2;
            } else if (rarity == 'rare') {
                rarity_index = 3;
            } else if (rarity == 'epic') {
                let roll = Math.floor(rng() * 100) + 1;
                rarity_index = (roll <= 50) ? 4 : 5;
            } else if (rarity == 'legendary') {
                rarity_index = 6;
            }

            var attributes_chosen = [];
            let att_count = 0;
            for (var i = 0; i < rarity_index; i++) {
                if (i == 0) {
                    if (type == 'weapon') {
                        attributes_chosen.push('damage');
                        attributes.splice(0, 1);
                    } else if (type == 'armor') {
                        attributes_chosen.push('defense');
                        attributes.splice(1, 1);
                    } else if (type == 'ship') {
                        let roll = Math.floor(rng() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    } else if (type == 'special') {
                        let roll = Math.floor(rng() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    } else if (type == 'avatar') {
                        let roll = Math.floor(rng() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    }
                } else {
                    var roll = Math.floor(rng() * attributes.length);
                    attributes_chosen.push(attributes[roll]);
                    attributes.splice(roll, 1);
                }
            }

            let attribute_list = new Object();
            for (var i = 0; i < attributes_chosen.length; i++) {
                if (attributes_chosen[i] == 'damage') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.damage = (roll * 10);
                    att_count += 1;
                } else if (attributes_chosen[i] == 'defense') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.defense = (roll * 10);
                    att_count += 1;
                } else if (attributes_chosen[i] == 'engineering') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.engineering = roll;
                    att_count += 1;
                } else if (attributes_chosen[i] == 'dodge') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.dodge = roll;
                    att_count += 1;
                } else if (attributes_chosen[i] == 'crit') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.crit = roll;
                    att_count += 1;
                } else if (attributes_chosen[i] == 'luck') {
                    let roll = rng() * (rarity_index - 0.10 * rarity_index) + 0.10 * rarity_index;
                    attribute_list.luck = roll;
                    att_count += 1;
                }
            }

            if (attribute_list.damage == null)      attribute_list.damage = 0;
            if (attribute_list.defense == null)     attribute_list.defense = 0;
            if (attribute_list.engineering == null) attribute_list.engineering = 0;
            if (attribute_list.dodge == null)       attribute_list.dodge = 0;
            if (attribute_list.crit == null)        attribute_list.crit = 0;
            if (attribute_list.luck == null)        attribute_list.luck = 0;

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
