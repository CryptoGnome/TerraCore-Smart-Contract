const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

var hive = require('@hiveio/hive-js');
const SSC = require('sscjs');
const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');
const fetch = require('node-fetch');

// Per-service contexts
const scCtx  = require('./smart-contract/context');
const nftCtx = require('./nft/context');
const heCtx  = require('./hive-engine/context');
const lbCtx  = require('./lb-rewards/context');

// Global heartbeat state
const globalCtx = require('./context');

// Handlers
const { handleOperation: scHandleOp }  = require('./smart-contract/lib/handlers');
const { handleOperation: nftHandleOp } = require('./nft/lib/handlers');
const { handleTransaction: heHandleOp } = require('./hive-engine/lib/handlers');

// Queue processors
const { checkTransactions: scCheckTx }  = require('./smart-contract/lib/queue');
const { checkTransactions: nftCheckTx } = require('./nft/lib/queue');
const { checkTransactions: heCheckTx }  = require('./hive-engine/lib/queue');

// lb-rewards
const { runCycle } = require('./lb-rewards/cycle');
const { sleep }    = require('../shared/retry');

// HE node selection
const { findNode, updateNodesFromBeacon } = require('../shared/he-node');

// Error logging
const errorLogger = require('../shared/error-logger');
const { logError } = require('../shared/error-logger');

// L1 Hive nodes
const l1Nodes = ['https://api.deathwing.me', 'https://api.hive.blog', 'https://hived.emre.sh', 'https://api.openhive.network', 'https://techcoderx.com', 'https://hive-api.arcange.eu'];

async function getLastUsedL1Endpoint() {
    const collection = scCtx.db.collection('lastUsedEndpoint');
    const lastUsed = await collection.findOne({}, { sort: { _id: -1 } });
    return lastUsed ? lastUsed.endpoint : null;
}

async function testL1Nodes() {
    let fastestEndpoint = '';
    let fastestResponseTime = Infinity;
    const lastUsed = await getLastUsedL1Endpoint();
    const toTest = l1Nodes.filter(ep => ep !== lastUsed);

    for (const endpoint of toTest) {
        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 }),
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
            await response.json();
            if (response.ok) {
                const t = Date.now() - start;
                console.log(`L1 ${endpoint}: ${t}ms`);
                if (t < fastestResponseTime) {
                    fastestResponseTime = t;
                    fastestEndpoint = endpoint;
                }
            }
        } catch (err) {
            console.log(`L1 ${endpoint} error: ${err.message}`);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    if (!fastestEndpoint) {
        const remaining = l1Nodes.filter(ep => ep !== lastUsed);
        fastestEndpoint = remaining[Math.floor(Math.random() * remaining.length)];
        console.log(`No fastest L1 endpoint, randomly selected: ${fastestEndpoint}`);
    } else {
        console.log(`Fastest L1 endpoint: ${fastestEndpoint} (${fastestResponseTime}ms)`);
    }

    const collection = scCtx.db.collection('lastUsedEndpoint');
    await collection.insertOne({ endpoint: fastestEndpoint, timestamp: new Date() });
    hive.api.setOptions({ url: fastestEndpoint });
}

function changeL1Node() {
    (async () => { await testL1Nodes(); })();
}

async function startL1Stream() {
    changeL1Node();
    hive.api.streamBlock(async function (err, result) {
        try {
            if (!result || !result.transactions || !result.block_id) return;
            globalCtx.lastL1Event = Date.now();
            const blockId = result.block_id;

            let opHash = -1;
            for (const transaction of result.transactions) {
                const trxId = transaction.transaction_id;
                for (const operation of transaction.operations) {
                    opHash++;
                    await scHandleOp(operation, blockId, trxId);
                    await nftHandleOp(operation, blockId, trxId, opHash);
                }
            }
        } catch (err) {
            logError('SYS_L1_STREAM_STALE', err, { fn: 'startL1Stream', service: 'SYS' });
        }
    });
}

async function startHEStream(node) {
    const ssc = new SSC(node);
    ssc.stream(async (err, res) => {
        try {
            if (!res['transactions']) {
                console.log('HE: No transactions');
                return;
            }
            globalCtx.lastHEEvent = Date.now();
            try {
                for (let i = 0; i < res['transactions'].length; i++) {
                    await heHandleOp(res['transactions'][i]);
                }
            } catch (err) {
                logError('SYS_HE_STREAM_STALE', err, { fn: 'startHEStream', service: 'SYS' });
            }
        } catch (err) {
            if (!(err instanceof TypeError)) console.log(err);
        }
    });
}

async function runLbRewards() {
    let iterationCount = 0;
    while (true) {
        iterationCount++;
        console.log(`\n[lb-rewards] Iteration #${iterationCount} at ${new Date().toISOString()}`);
        try {
            await runCycle();
            console.log('[lb-rewards] Sleeping 15 minutes...');
            await sleep(900000);
        } catch (err) {
            logError('LB_CYCLE_FAIL', err, { fn: 'runLbRewards', service: 'LB' });
            await sleep(120000);
        }
    }
}

async function main() {
    const client = new MongoClient(process.env.MONGO_URL, {
        connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000,
    });
    await client.connect();
    const db = client.db('terracore');

    if (process.env.ERROR_DISCORD_WEBHOOK) {
        errorLogger.setErrorHook(new Webhook(process.env.ERROR_DISCORD_WEBHOOK));
    }
    errorLogger.setErrorDb(db);

    console.log('-------------------------------------------------------');
    console.log('TerraCore unified process starting...');
    console.log('-------------------------------------------------------');

    // Wire smart-contract context
    scCtx.db     = db;
    scCtx.client = client;
    scCtx.hive   = hive;
    scCtx.wif    = process.env.ACTIVE_KEY;
    scCtx.hook   = new Webhook(process.env.SC_DISCORD_WEBHOOK);
    scCtx.hook2  = new Webhook(process.env.SC_DISCORD_WEBHOOK_2);
    scCtx.hook3  = new Webhook(process.env.SC_DISCORD_WEBHOOK_3);
    scCtx.changeNode = changeL1Node;

    // Wire NFT context
    nftCtx.db     = db;
    nftCtx.client = client;
    nftCtx.hive   = hive;
    nftCtx.wif    = process.env.NFT_ACTIVE_KEY;
    nftCtx.wif2   = process.env.ACTIVE_KEY2;
    nftCtx.hook   = new Webhook(process.env.NFT_DISCORD_WEBHOOK);
    nftCtx.hook2  = new Webhook(process.env.NFT_DISCORD_WEBHOOK2);
    nftCtx.hook3  = new Webhook(process.env.NFT_DISCORD_WEBHOOK3);
    nftCtx.hook4  = new Webhook(process.env.NFT_DISCORD_WEBHOOK4);

    // Wire Hive Engine context
    heCtx.db          = db;
    heCtx.client      = client;
    heCtx.wif         = process.env.ACTIVE_KEY;
    heCtx.hook        = new Webhook(process.env.HE_DISCORD_WEBHOOK);
    heCtx.market_hook = new Webhook(process.env.HE_MARKET_WEBHOOK);
    heCtx.boss_hook   = new Webhook(process.env.HE_BOSS_WEBHOOK);
    heCtx.forge_hook  = new Webhook(process.env.HE_FORGE_WEBHOOK);

    // Wire lb-rewards context
    lbCtx.client = client;
    lbCtx.hive   = hive;
    lbCtx.wif    = process.env.ACTIVE_KEY;

    // Start queue processors
    scCheckTx();
    nftCheckTx();
    heCheckTx();

    // Start Hive L1 stream (SC + NFT share one websocket)
    startL1Stream();

    // Start Hive Engine stream
    const heNode = await findNode();
    startHEStream(heNode);

    // Start lb-rewards cycle in the background
    runLbRewards().catch(err => logError('LB_CYCLE_FAIL', err, { fn: 'runLbRewards', service: 'LB' }, 'FATAL'));

    console.log('-------------------------------------------------------');
    console.log('All services started — single process tc-terracore');
    console.log('-------------------------------------------------------');
}

main().catch(err => { logError('SYS_STARTUP_FAIL', err, { fn: 'main', service: 'SYS' }, 'FATAL'); process.exit(1); });

// Unified heartbeat — restart if either stream is silent > 30s
setInterval(function () {
    const l1Age = Date.now() - globalCtx.lastL1Event;
    const heAge = Date.now() - globalCtx.lastHEEvent;
    if (l1Age > 30000) {
        logError('SYS_L1_STREAM_STALE', new Error(`L1 stream silent for ${l1Age}ms`), { fn: 'heartbeat', service: 'SYS' }, 'FATAL');
        process.exit(1);
    }
    if (heAge > 30000) {
        logError('SYS_HE_STREAM_STALE', new Error(`HE stream silent for ${heAge}ms`), { fn: 'heartbeat', service: 'SYS' }, 'FATAL');
        process.exit(1);
    }
}, 3000);

// Refresh HE node list from beacon every 30 minutes
setInterval(function () {
    updateNodesFromBeacon().catch(err => logError('SYS_BEACON_UPDATE_FAIL', err, { fn: 'beaconRefresh', service: 'SYS' }));
}, 1800000);
