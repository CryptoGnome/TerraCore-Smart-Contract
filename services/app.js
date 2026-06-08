const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

var hive = require('@hiveio/hive-js');
const SSC = require('sscjs');
const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');
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

// L1 node selection
const { findNode: findL1Node, updateNodesFromBeacon: updateL1Nodes, trackError: trackL1Error, recordSuccess: recordL1Success, track429: trackL1_429, disableNode: disableL1Node, getCurrentNode: getL1Node, isNodeDisabled: isL1NodeDisabled } = require('../shared/l1-node');

// Error logging
const errorLogger = require('../shared/error-logger');
const { logError } = require('../shared/error-logger');

let isChangingL1Node = false;
let l1NodeChangePromise = Promise.resolve();
function changeL1Node() {
    if (isChangingL1Node) return l1NodeChangePromise;
    isChangingL1Node = true;
    l1NodeChangePromise = (async () => {
        try {
            const selectedNode = await findL1Node();
            hive.api.setOptions({ url: selectedNode });
        } finally {
            isChangingL1Node = false;
        }
    })();
    return l1NodeChangePromise;
}

async function handleL1NodeError(err, context) {
    const currentNode = getL1Node();
    // Rate-limit responses won't recover by retrying the same node — disable it now
    // so the next poll routes through findL1Node to a different endpoint.
    if (err && /429|too many requests/i.test(err.message || '')) {
        trackL1_429(currentNode);
        disableL1Node(currentNode);
    } else {
        trackL1Error(currentNode);
    }
    // Await rotation so the next poll can't fire against the disabled URL.
    if (isL1NodeDisabled(currentNode)) await changeL1Node();
    logError('SYS_L1_STREAM_ERR', err, { fn: context, service: 'SYS' });
}

// Self-paced L1 block poller. hive-js's built-in streamBlock polls
// getDynamicGlobalProperties every 200ms (5 req/s) and tears down the loop on
// any error — which causes public RPC nodes to 429 us and leaves no recovery
// path. This poller hits the node ~once per block (3s), survives errors by
// switching nodes via handleL1NodeError, and keeps lastL1Event fresh on every
// successful tick so the heartbeat doesn't kill the process during recovery.
async function startL1Stream() {
    await changeL1Node();
    let lastProcessedBlock = 0;
    const POLL_INTERVAL_MS = 3000;

    const poll = async () => {
        try {
            const props = await hive.api.getDynamicGlobalPropertiesAsync();
            recordL1Success(getL1Node());
            globalCtx.lastL1Event = Date.now();
            const head = props.head_block_number;

            if (lastProcessedBlock === 0) {
                lastProcessedBlock = head - 1;
            }

            while (lastProcessedBlock < head) {
                const blockNum = lastProcessedBlock + 1;
                const block = await hive.api.getBlockAsync(blockNum);
                if (!block) break;
                const blockId = block.block_id;
                let opHash = -1;
                for (const transaction of block.transactions) {
                    const trxId = transaction.transaction_id;
                    for (const operation of transaction.operations) {
                        opHash++;
                        await scHandleOp(operation, blockId, trxId);
                        await nftHandleOp(operation, blockId, trxId, opHash);
                    }
                }
                lastProcessedBlock = blockNum;
                globalCtx.lastL1Event = Date.now();
            }
        } catch (err) {
            await handleL1NodeError(err, 'startL1Stream:poll');
        } finally {
            setTimeout(poll, POLL_INTERVAL_MS);
        }
    };

    poll();
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

    // Ensure the HE replay-dedup lookup (hashes.trxId) is indexed. checkHash() runs on every
    // Hive Engine op; without an index it full-scans the large, ever-growing hashes collection.
    // Fire-and-forget (NOT awaited): a slow build over ~1.5M docs must not delay stream startup,
    // or the 30s heartbeat below would process.exit before the streams begin. checkHash falls back
    // to a collection scan until the build finishes — same as before this change. The partial
    // filter keeps the index to docs that actually carry trxId (legacy docs predate the field).
    db.collection('hashes')
        .createIndex({ trxId: 1 }, { partialFilterExpression: { trxId: { $exists: true } } })
        .then(() => console.log('✓ hashes.trxId index ensured'))
        .catch((err) => console.warn('hashes.trxId index build skipped:', err.message));

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
    heCtx.quest_hook  = new Webhook(process.env.SC_DISCORD_WEBHOOK_3); // same channel as quest completions

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

// Refresh L1 node list from beacon every 30 minutes
setInterval(function () {
    updateL1Nodes().catch(err => logError('SYS_L1_BEACON_UPDATE_FAIL', err, { fn: 'l1BeaconRefresh', service: 'SYS' }));
}, 1800000);
