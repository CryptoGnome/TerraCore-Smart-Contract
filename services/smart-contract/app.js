var hive = require('@hiveio/hive-js');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
const { Webhook } = require('discord-webhook-node');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const ctx = require('./context');
const { checkTransactions } = require('./lib/queue');
const { handleOperation } = require('./lib/handlers');

// Populate context
ctx.hive = hive;
ctx.wif  = process.env.ACTIVE_KEY;
ctx.hook  = new Webhook(process.env.SC_DISCORD_WEBHOOK);
ctx.hook2 = new Webhook(process.env.SC_DISCORD_WEBHOOK_2);
ctx.hook3 = new Webhook(process.env.SC_DISCORD_WEBHOOK_3);

const client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000 });
ctx.client = client;
ctx.db = client.db('terracore');

const nodes = ['https://api.deathwing.me', 'https://api.hive.blog', 'https://hived.emre.sh', 'https://api.openhive.network', 'https://techcoderx.com', 'https://hive-api.arcange.eu'];

async function getLastUsedEndpoint() {
    const collection = ctx.db.collection('lastUsedEndpoint');
    const lastUsed = await collection.findOne({}, { sort: { _id: -1 } });
    return lastUsed ? lastUsed.endpoint : null;
}

async function updateLastUsedEndpoint(endpoint) {
    const collection = ctx.db.collection('lastUsedEndpoint');
    await collection.insertOne({ endpoint: endpoint, timestamp: new Date() });
}

async function testNodeEndpoints(nodes) {
    let fastestEndpoint = '';
    let fastestResponseTime = Infinity;
    const lastUsedEndpoint = await getLastUsedEndpoint();
    let endpointsToTest = nodes.filter(endpoint => endpoint !== lastUsedEndpoint);

    for (const endpoint of endpointsToTest) {
        const startTime = Date.now();
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }),
                headers: { 'Content-Type': 'application/json' }
            });
            await response.json();
            if (response.ok) {
                const responseTime = Date.now() - startTime;
                console.log(`${endpoint}: ${responseTime}ms`);
                if (responseTime < fastestResponseTime) {
                    fastestResponseTime = responseTime;
                    fastestEndpoint = endpoint;
                }
            } else {
                throw new Error(`Response error: ${response.statusText}`);
            }
        } catch (error) {
            console.log(`${endpoint} error: ${error.message}`);
        }
    }

    if (fastestEndpoint) {
        console.log(`Fastest endpoint: ${fastestEndpoint} (${fastestResponseTime}ms)`);
        await updateLastUsedEndpoint(fastestEndpoint);
    } else {
        let remainingEndpoints = nodes.filter(endpoint => endpoint !== lastUsedEndpoint);
        fastestEndpoint = remainingEndpoints[Math.floor(Math.random() * remainingEndpoints.length)];
        console.log(`No fastest endpoint found. Randomly selected: ${fastestEndpoint}`);
        await updateLastUsedEndpoint(fastestEndpoint);
    }

    hive.api.setOptions({ url: fastestEndpoint });
}

async function changeNode() {
    (async () => { await testNodeEndpoints(nodes); })();
}

// Expose changeNode via context so queue.js can call it when backlogged
ctx.changeNode = changeNode;

async function listen() {
    changeNode();
    checkTransactions();

    hive.api.streamBlock(async function (err, result) {
        try {
            if (!result || !result.transactions || !result.block_id) return;
            const blockId = result.block_id;

            for (const transaction of result.transactions) {
                const trxId = transaction.transaction_id;
                for (const operation of transaction.operations) {
                    await handleOperation(operation, blockId, trxId);
                }
            }
        } catch (err) {
            console.log(err);
        }
    });
}

async function main() {
    await client.connect();
    console.log('-------------------------------------------------------');
    console.log('Starting to Listening for events on HIVE...');
    console.log('-------------------------------------------------------');
    listen();
}

main().catch(err => console.log(err));

setInterval(function () {
    if (Date.now() - ctx.lastevent > 30000) {
        console.log('No events received in 30 seconds, shutting down so pm2 can restart');
        client.close();
        process.exit();
    }
}, 1000);

var heartbeat = 0;
setInterval(function () {
    heartbeat++;
    if (heartbeat == 5) {
        console.log('HeartBeat: ' + (Date.now() - ctx.lastCheck) + 'ms ago');
        heartbeat = 0;
    }
    if (Date.now() - ctx.lastCheck > 60000) {
        console.log('Error : No events received in 60 seconds, shutting down so PM2 can restart...');
        client.close();
        process.exit();
    }
}, 1000);
