var hive = require('@hiveio/hive-js');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const ctx = require('./context');
const { runCycle, generateQuestBoard } = require('./cycle');
const { sleep } = require('../../shared/retry');

// Populate context
ctx.hive = hive;
ctx.wif  = process.env.ACTIVE_KEY;

const client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });
ctx.client = client;

async function boardWatcher() {
    while (true) {
        try {
            await generateQuestBoard(true);
        } catch (err) {
            console.error('[QuestBoard] watcher error:', err.message);
        }
        await sleep(30000);
    }
}

async function run() {
    console.log('='.repeat(60));
    console.log('lb-rewards started at ' + new Date().toISOString());
    console.log('='.repeat(60));

    try {
        await client.connect();
        console.log('✓ MongoDB connected');
    } catch (err) {
        console.error('FATAL: MongoDB connection failed:', err.message);
        process.exit(1);
    }

    // The board must roll over promptly at 00:00 UTC. The main cycle only comes round every 15
    // minutes and generates the board as its last step, which left a window after midnight where
    // players saw the previous day's missions and spent SCRAP on them — the smart contract then
    // rejects the start, and a burn to `null` cannot be refunded. generateQuestBoard() returns
    // immediately when the board is already current, so polling it is cheap.
    boardWatcher();

    let iterationCount = 0;

    while (true) {
        iterationCount++;
        const startTime = Date.now();
        console.log('\n' + '='.repeat(60));
        console.log(`Iteration #${iterationCount} started at ${new Date().toISOString()}`);
        console.log('='.repeat(60));

        try {
            await runCycle();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log('\n' + '='.repeat(60));
            console.log(`✓ Iteration #${iterationCount} completed in ${duration}s`);
            console.log('Sleeping for 15 minutes...');
            console.log('='.repeat(60));
            await sleep(900000);
        } catch (err) {
            console.error('\n' + '!'.repeat(60));
            console.error(`ERROR in iteration #${iterationCount}:`);
            console.error(err.stack);
            console.error('!'.repeat(60));
            console.log('Waiting 2 minutes before retry...');
            await sleep(120000);
        }
    }
}

run();
