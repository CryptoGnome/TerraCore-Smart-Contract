const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');
var hive = require('@hiveio/hive-js');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const chalk = require('chalk');
const { findNode: findL1Node } = require('../../shared/l1-node');

const ctx = require('./context');
const { checkTransactions } = require('./lib/queue');
const { purchaseItem, listItem, cancelItem, transferItem } = require('./lib/marketplace');
const { queOpenCrates, queEquip, queCombine, queUse } = require('./lib/queue');
const { salvageNFT } = require('./lib/items');

function extractUser(op) {
    const auths = Array.isArray(op.required_auths) ? op.required_auths : [];
    const posting = Array.isArray(op.required_posting_auths) ? op.required_posting_auths : [];
    return auths[0] || posting[0] || null;
}

// Populate shared context
ctx.hive = hive;
ctx.wif  = process.env.NFT_ACTIVE_KEY;
ctx.wif2 = process.env.ACTIVE_KEY2;
ctx.hook  = new Webhook(process.env.NFT_DISCORD_WEBHOOK);
ctx.hook2 = new Webhook(process.env.NFT_DISCORD_WEBHOOK2);
ctx.hook3 = new Webhook(process.env.NFT_DISCORD_WEBHOOK3);
ctx.hook4 = new Webhook(process.env.NFT_DISCORD_WEBHOOK4);

const client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30000 });
ctx.client = client;

async function establishConnection() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

establishConnection();
ctx.db = client.db('terracore');

async function changeNode() {
    const newNode = await findL1Node();
    hive.api.setOptions({ url: newNode });
    console.log(`L1 switched to: ${newNode}`);
}

async function listen() {
    await changeNode();
    checkTransactions();

    hive.api.streamBlock(async function (err, result) {
        try {
            const blockId = result.block_id;

            if (!result || !result.transactions) {
                console.error('Block without transactions !!');
                return;
            }

            var hash = -1;
            for (const transaction of result.transactions) {
                const trxId = transaction.transaction_id;

                for (const operation of transaction.operations) {
                    hash = hash + 1;
                    lastevent = Date.now();

                    if (operation[0] == 'transfer' && operation[1].to == 'terracore.market') {
                        try {
                            var memo = JSON.parse(operation[1].memo);
                            if (memo.action.includes('tm_purchase')) {
                                if (operation[1].to == 'terracore.market') {
                                    await purchaseItem(memo, operation[1].amount, operation[1].from);
                                }
                            }
                        } catch (err) {
                            // memo is not JSON
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_create') {
                        var data = JSON.parse(operation[1].json);
                        const auths_create = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
                        if (auths_create[0]) {
                            await listItem(data, auths_create[0]);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_cancel') {
                        var data = JSON.parse(operation[1].json);
                        var user;
                        user = extractUser(operation[1]);
                        await cancelItem(data, user);
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_transfer') {
                        var data = JSON.parse(operation[1].json);
                        const auths_transfer = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
                        if (auths_transfer[0]) {
                            await transferItem(data, auths_transfer[0]);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_open_crate') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (let i = 0; i < data.length; i++) {
                                var user = extractUser(operation[1]);
                                if (!user) continue;
                                var collection = ctx.db.collection('crates');
                                var rarity = data.crate_type;
                                let item = await collection.findOne({ owner: user, crate_type: rarity });
                                if (item != null) {
                                    queOpenCrates(user, rarity, blockId, trxId, Date.now());
                                }
                            }
                        } else {
                            var user = extractUser(operation[1]);
                            if (user) {
                                var collection = ctx.db.collection('crates');
                                var rarity = data.crate_type;
                                let item = await collection.findOne({ owner: user, crate_type: rarity });
                                if (item != null) {
                                    queOpenCrates(user, rarity, blockId, trxId, hash);
                                }
                            }
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_equip') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (var i = 0; i < data.length; i++) {
                                var user = extractUser(operation[1]);
                                if (!user) continue;
                                queEquip(user, data[i].item_number, 'equip');
                            }
                        } else {
                            var user = extractUser(operation[1]);
                            if (user) queEquip(user, data.item_number, 'equip');
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_unequip') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (var i = 0; i < data.length; i++) {
                                var user = extractUser(operation[1]);
                                if (!user) continue;
                                queEquip(user, data[i].item_number, 'unequip');
                            }
                        } else {
                            var user = extractUser(operation[1]);
                            if (user) queEquip(user, data.item_number, 'unequip');
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_salvage') {
                        var data = JSON.parse(operation[1].json);
                        const auths_salvage = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
                        if (auths_salvage[0]) {
                            salvageNFT(auths_salvage[0], data.item_number);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_combine') {
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        const auths_combine = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
                        if (auths_combine[0]) {
                            queCombine(auths_combine[0], type);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_use_consumable') {
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        var user;
                        user = extractUser(operation[1]);
                        queUse(user, type);
                    }
                }
            }
        } catch (err) {
            console.log(err);
        }
    });
}

var lastevent = Date.now();

try {
    listen();
} catch (err) {
    console.log(err);
}

setInterval(function () {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 30000) {
        console.log('No events received in 30 seconds, shutting down so pm2 can restart');
        process.exit();
    }
}, 3000);

var heartbeat = 0;
setInterval(function () {
    heartbeat++;
    if (heartbeat == 5) {
        heartbeat = 0;
    }
    if (Date.now() - ctx.lastCheck > 30000) {
        console.log('Error : No events received in 30 seconds, shutting down so PM2 can restart & try to reconnect to Resolve...');
        client.close();
        process.exit();
    }
}, 1000);
