var hive = require('@hiveio/hive-js');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const ctx = require('./context');
const { runCycle } = require('./cycle');
const { sleep } = require('../../shared/retry');

// Populate context
ctx.hive = hive;
ctx.wif  = process.env.ACTIVE_KEY;

const client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });
ctx.client = client;

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
