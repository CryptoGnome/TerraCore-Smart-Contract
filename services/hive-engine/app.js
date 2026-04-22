const SSC = require('sscjs');
const { MongoClient } = require('mongodb');
const { Webhook } = require('discord-webhook-node');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const ctx = require('./context');
const { checkTransactions } = require('./lib/queue');
const { handleTransaction } = require('./lib/handlers');
const { findNode, updateNodesFromBeacon } = require('../../shared/he-node');

// Populate context
ctx.wif = process.env.ACTIVE_KEY;
ctx.hook        = new Webhook(process.env.HE_DISCORD_WEBHOOK);
ctx.market_hook = new Webhook(process.env.HE_MARKET_WEBHOOK);
ctx.boss_hook   = new Webhook(process.env.HE_BOSS_WEBHOOK);
ctx.forge_hook  = new Webhook(process.env.HE_FORGE_WEBHOOK);

const client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30000 });
ctx.client = client;
ctx.db = client.db('terracore');

async function listen(node) {
    checkTransactions();
    const ssc = new SSC(node);
    ssc.stream((err, res) => {
        try {
            if (!res['transactions']) {
                console.log('No transactions');
                return;
            }
            ctx.lastevent = Date.now();
            try {
                for (let i = 0; i < res['transactions'].length; i++) {
                    handleTransaction(res['transactions'][i]);
                }
            } catch (err) {
                console.log(err);
            }
        } catch (err) {
            if (!(err instanceof TypeError)) {
                console.log(err);
            }
        }
    });
}

async function main() {
    await client.connect();
    console.log('-------------------------------------------------------');
    console.log('Starting to listen for Hive Engine events...');
    console.log('-------------------------------------------------------');
    const node = await findNode();
    listen(node);
}

main().catch(err => console.log(err));

setInterval(function () {
    console.log('Last event: ' + (Date.now() - ctx.lastevent) + ' ms ago');
    if (Date.now() - ctx.lastevent > 20000) {
        console.log('No events received in 20 seconds, shutting down so pm2 can restart');
        client.close();
        process.exit(1);
    }
}, 1000);

setInterval(function () {
    if (Date.now() - ctx.lastCheck > 20000) {
        console.log('Error : No events received in 20 seconds, shutting down so PM2 can restart & try to reconnect...');
        client.close();
        process.exit(1);
    }
}, 1000);

setInterval(function () {
    updateNodesFromBeacon().catch(err => {
        console.log('Background node update failed:', err.message);
    });
}, 1800000);
