const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook2 } = require('./webhooks');
const { mintFLUX } = require('./economy');

function handleMongoError(err) {
    if (err instanceof MongoTopologyClosedError) {
        console.log('MongoDB connection is closed');
        process.exit(1);
    } else {
        console.log(err);
    }
}

async function hasItem(username, item_number) {
    try {
        var collection = ctx.db.collection('items');
        let item = await collection.findOne({ owner: username, item_number: item_number });
        return item ? true : false;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function equipItem(username, item_number) {
    try {
        const collection = ctx.db.collection('players');
        const user = await collection.findOne({ username: username });

        if (user) {
            item_number = parseInt(item_number);
            if (await hasItem(username, item_number)) {
                const item = await ctx.db.collection('items').findOne({ item_number: item_number });

                if (item.market.listed) {
                    console.log(`User: ${username} item is listed in marketplace, cannot equip!`);
                    return;
                }

                if (user.items[item.type].item_equipped) {
                    console.log(`User: ${username} already has item equipped, unequipping item: ${user.items[item.type].item_number}`);
                    await unequipItem(username, user.items[item.type].item_number);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (item.salvaged) {
                    console.log(`User: ${username} item has already been salvaged, cannot equip!`);
                    return;
                }

                user.items[item.type] = {
                    item_number: item_number,
                    item_id: item.id,
                    item_equipped: true,
                    rarity: item.rarity,
                    attributes: item.attributes
                };

                await ctx.db.collection('players').updateOne(
                    { username: username },
                    { $set: { items: user.items }, $inc: { version: 1 } }
                );

                const updateResult = await ctx.db.collection('items').updateOne(
                    { item_number: item_number },
                    { $set: { equiped: true }, $inc: { version: 1 } }
                );

                if (updateResult.modifiedCount > 0) {
                    console.log(`User: ${username} equipped item: ${item_number}`);
                } else {
                    console.log(`Failed to update item: ${item_number} as equipped.`);
                }
            } else {
                console.log(`User: ${username} does not have item: ${item_number}`);
            }
        } else {
            console.log(`User: ${username} does not exist`);
        }
    } catch (err) {
        handleMongoError(err);
    }
}

async function unequipItem(username, item_number) {
    try {
        const collection = ctx.db.collection('players');
        const user = await collection.findOne({ username: username });

        if (user) {
            item_number = parseInt(item_number);
            const item = await ctx.db.collection('items').findOne({ item_number: item_number });

            if (item && user.items[item.type].item_number === item_number) {
                user.items[item.type] = {
                    item_number: null,
                    item_id: null,
                    item_equipped: false,
                    attributes: {
                        damage: 0,
                        defense: 0,
                        engineering: 0,
                        dodge: 0,
                        crit: 0,
                        luck: 0
                    }
                };

                await ctx.db.collection('players').updateOne(
                    { username: username },
                    { $set: { items: user.items }, $inc: { version: 1 } }
                );

                await ctx.db.collection('items').updateOne(
                    { item_number: item_number },
                    { $set: { equiped: false }, $inc: { version: 1 } }
                );

                console.log(`User: ${username} unequipped item: ${item_number}`);
            } else {
                console.log(`User: ${username} does not have item: ${item_number}`);
            }
        } else {
            console.log(`User: ${username} does not exist`);
        }
    } catch (err) {
        handleMongoError(err);
    }
}

async function salvageNFT(username, item_number) {
    try {
        let collection = ctx.db.collection('items');
        item_number = parseInt(item_number);
        let item = await collection.findOne({ owner: username, item_number: item_number });

        if (item == null) {
            console.log('Item: ' + item_number + ' does not exist or does not belong to user: ' + username);
            return false;
        }
        if (item.equiped == true) {
            console.log('Item: ' + item_number + ' is equiped and cannot be salvaged');
            return;
        }
        if (item.market.listed == true) {
            console.log('Item: ' + item_number + ' is listed in the market and cannot be salvaged');
            return;
        }
        if (item.owner != username) {
            console.log('Item: ' + item_number + ' does not belong to user: ' + username);
            return false;
        }

        let value = item.attributes.damage / 2 + item.attributes.defense / 2 + item.attributes.engineering * 5 + item.attributes.dodge * 5 + item.attributes.crit * 5 + item.attributes.luck * 10;
        console.log('Item: ' + item_number + ' has a salvage value of: ' + value);

        if (item.salvaged == undefined || item.salvaged == false) {
            console.log('Item: ' + item_number + ' has not been salvaged yet');
            let mint = await mintFLUX(username, value);
            if (mint) {
                await collection.updateOne({ item_number: item_number }, { $set: { salvaged: true, equiped: false, owner: null, market: { listed: false, price: 0 } } });
                await ctx.db.collection('salvage-log').insertOne({ username: username, item_number: item_number, value: value, time: Date.now() });
                console.log(`[NFT] salvage success: ${username} salvaged item #${item_number} (${item.rarity} ${item.type}) for ${value} FLUX`);
                webhook2("Item #" + item_number + " Salvaged", "User: " + username + " salvaged a " + item.rarity + " " + item.type + " item for " + value + " $FLUX", "#00ff00");
                return true;
            } else {
                return false;
            }
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

module.exports = { hasItem, equipItem, unequipItem, salvageNFT };
