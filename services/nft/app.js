const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');
var hive = require('@hiveio/hive-js');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const chalk = require('chalk');

const ctx = require('./context');
const { checkTransactions } = require('./lib/queue');
const { purchaseItem, listItem, cancelItem, transferItem } = require('./lib/marketplace');
const { queOpenCrates, queEquip, queCombine, queUse } = require('./lib/queue');
const { salvageNFT } = require('./lib/items');

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

const nodes = ['https://api.deathwing.me', 'https://api.hive.blog', 'https://anyx.io', 'https://api.openhive.network', 'https://techcoderx.com', 'https://api.c0ff33a.uk', 'https://hiveapi.actifit.io'];
let lastUsedNode = '';

async function testNodeEndpoints(nodes) {
    let fastestEndpoint = '';
    let fastestResponseTime = Infinity;
    let availableNodes = nodes.filter(node => node !== lastUsedNode);

    if (availableNodes.length === 0) {
        availableNodes = nodes;
    }

    const testPromises = availableNodes.map(endpoint => {
        return new Promise((resolve) => {
            hive.api.setOptions({ url: endpoint });
            const startTime = Date.now();
            hive.api.getState('/', (err, result) => {
                if (err) {
                    console.error(`${endpoint} error: ${err.message}`);
                    resolve(null);
                } else {
                    const responseTime = Date.now() - startTime;
                    console.log(`${endpoint}: ${responseTime}ms`);
                    resolve({ endpoint, responseTime });
                }
            });
        });
    });

    const results = await Promise.all(testPromises);
    const validResults = results.filter(result => result !== null);

    if (validResults.length > 0) {
        const fastest = validResults.reduce((min, p) => p.responseTime < min.responseTime ? p : min);
        fastestEndpoint = fastest.endpoint;
        fastestResponseTime = fastest.responseTime;

        console.log(`Fastest endpoint: ${fastestEndpoint} (${fastestResponseTime}ms)`);

        const json = { "action": "test-tx" };
        const data = JSON.stringify(json);
        try {
            await hive.broadcast.customJsonAsync(ctx.wif, ['terracore.market'], [], 'test-tx', data);
            console.log(`${fastestEndpoint} transaction successful`);
            lastUsedNode = fastestEndpoint;
        } catch (err) {
            console.error(`${fastestEndpoint} transaction error: ${err.message}`);
        }
    } else {
        console.error('No valid endpoints found');
    }

    return fastestEndpoint;
}

async function changeNode() {
    const newNode = await testNodeEndpoints(nodes);
    if (newNode) {
        hive.api.setOptions({ url: newNode });
        console.log(`Switched to node: ${newNode}`);
    } else {
        console.error('Failed to change node');
    }
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
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            // ignore — needs active key
                        } else {
                            user = operation[1].required_auths[0];
                            await listItem(data, user);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_cancel') {
                        var data = JSON.parse(operation[1].json);
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        } else {
                            user = operation[1].required_auths[0];
                        }
                        await cancelItem(data, user);
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_transfer') {
                        var data = JSON.parse(operation[1].json);
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            // ignore — needs active key
                        } else {
                            user = operation[1].required_auths[0];
                            await transferItem(data, user);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_open_crate') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (let i = 0; i < data.length; i++) {
                                var user;
                                if (operation[1].required_auths[0] == undefined) {
                                    user = operation[1].required_posting_auths[0];
                                } else {
                                    user = operation[1].required_auths[0];
                                }
                                var collection = ctx.db.collection('crates');
                                var rarity = data.crate_type;
                                let item = collection.findOne({ owner: user, crate_type: rarity });
                                if (item != null) {
                                    queOpenCrates(user, rarity, blockId, trxId, Date.now());
                                }
                            }
                        } else {
                            var user;
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            } else {
                                user = operation[1].required_auths[0];
                            }
                            var collection = ctx.db.collection('crates');
                            var rarity = data.crate_type;
                            let item = collection.findOne({ owner: user, crate_type: rarity });
                            if (item != null) {
                                queOpenCrates(user, rarity, blockId, trxId, hash);
                            }
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_equip') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (var i = 0; i < data.length; i++) {
                                var user;
                                if (operation[1].required_auths[0] == undefined) {
                                    user = operation[1].required_posting_auths[0];
                                } else {
                                    user = operation[1].required_auths[0];
                                }
                                queEquip(user, data[i].item_number, 'equip');
                            }
                        } else {
                            var user;
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            } else {
                                user = operation[1].required_auths[0];
                            }
                            queEquip(user, data.item_number, 'equip');
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_unequip') {
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined) {
                            for (var i = 0; i < data.length; i++) {
                                var user;
                                if (operation[1].required_auths[0] == undefined) {
                                    user = operation[1].required_posting_auths[0];
                                } else {
                                    user = operation[1].required_auths[0];
                                }
                                queEquip(user, data[i].item_number, 'unequip');
                            }
                        } else {
                            var user;
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            } else {
                                user = operation[1].required_auths[0];
                            }
                            queEquip(user, data.item_number, 'unequip');
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_salvage') {
                        var data = JSON.parse(operation[1].json);
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            // ignore — needs active key
                        } else {
                            user = operation[1].required_auths[0];
                            salvageNFT(user, data.item_number);
                        }
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_combine') {
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            // ignore — needs active key
                        } else {
                            user = operation[1].required_auths[0];
                        }
                        queCombine(user, type);
                    }

                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_use_consumable') {
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        var user;
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        } else {
                            user = operation[1].required_auths[0];
                        }
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
