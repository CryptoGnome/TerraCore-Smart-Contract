// One-off recovery script: replay a range of Hive Engine blocks through the HE handlers.
//
// Context: on 2026-07-04 the HE stream node (enginerpc.com) froze at block 60791744
// (06:14 UTC) and the process crash-looped until ~12:50 UTC, so every HE op in that
// window (quest starts, boss fights, upgrades, forges, crate buys, stakes) was never
// processed. sscjs streams from the node's CURRENT head, so missed blocks are skipped
// forever unless replayed. All handlers dedup on the HE transactionId (checkHash /
// sendTransaction dedupKey), so overlapping with already-processed blocks is safe.
//
// Usage: node scripts/replay-he-blocks.js <startBlock> [endBlock]
//   endBlock defaults to the node's current head at script start.
//
// Run while tc-terracore is up: queued ops (upgrades/forges/crates) are inserted into
// he-transactions here and drained by the live process's checkTransactions loop.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SSC = require('sscjs');
const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');

const ctx = require('../services/hive-engine/context');
const { handleTransaction } = require('../services/hive-engine/lib/handlers');
const { findNode } = require('../shared/he-node');

async function main() {
    const startBlock = parseInt(process.argv[2], 10);
    if (!startBlock) {
        console.error('Usage: node scripts/replay-he-blocks.js <startBlock> [endBlock]');
        process.exit(1);
    }

    const client = new MongoClient(process.env.MONGO_URL, {
        connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000,
    });
    await client.connect();

    ctx.db          = client.db('terracore');
    ctx.client      = client;
    ctx.wif         = process.env.ACTIVE_KEY;
    ctx.hook        = new Webhook(process.env.HE_DISCORD_WEBHOOK);
    ctx.market_hook = new Webhook(process.env.HE_MARKET_WEBHOOK);
    ctx.boss_hook   = new Webhook(process.env.HE_BOSS_WEBHOOK);
    ctx.forge_hook  = new Webhook(process.env.HE_FORGE_WEBHOOK);
    ctx.quest_hook  = new Webhook(process.env.SC_DISCORD_WEBHOOK_3);

    const node = await findNode();
    const ssc = new SSC(node);

    let endBlock = parseInt(process.argv[3], 10);
    if (!endBlock) {
        const latest = await ssc.getLatestBlockInfo();
        endBlock = latest.blockNumber;
    }

    console.log(`Replaying HE blocks ${startBlock} → ${endBlock} (${endBlock - startBlock + 1} blocks) via ${node}`);

    let processed = 0;
    let txSeen = 0;
    for (let n = startBlock; n <= endBlock; n++) {
        let block;
        for (let attempt = 1; ; attempt++) {
            try {
                block = await ssc.getBlockInfo(n);
                break;
            } catch (err) {
                if (attempt >= 5) throw err;
                console.warn(`Block ${n} fetch failed (attempt ${attempt}): ${err.message} — retrying`);
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
        if (block && block.transactions) {
            for (const tx of block.transactions) {
                txSeen++;
                try {
                    await handleTransaction(tx);
                } catch (err) {
                    console.error(`Handler error in block ${n} trx ${tx.transactionId}: ${err.message}`);
                }
            }
        }
        processed++;
        if (processed % 500 === 0) {
            console.log(`...${processed}/${endBlock - startBlock + 1} blocks, ${txSeen} transactions seen (at block ${n})`);
        }
    }

    console.log(`Done. ${processed} blocks replayed, ${txSeen} transactions passed to handler.`);
    // Give queued webhook sends a moment to flush before exiting
    await new Promise(r => setTimeout(r, 5000));
    await client.close();
    process.exit(0);
}

main().catch(err => { console.error('Replay failed:', err); process.exit(1); });
