const { MongoClient, MongoTopologyClosedError } = require('mongodb');
var hive = require('@hiveio/hive-js');
require('dotenv').config();
const fetch = require('node-fetch');
const SSC = require('sscjs');


const wif = process.env.ACTIVE_KEY;
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });

var ssc;

//HE NODE MANAGEMENT WITH BEACON API INTEGRATION
const fallbackNodes = [
    "https://engine.deathwing.me",
    "https://he.splex.gg",
    "https://enginerpc.com",
    "https://ha.herpc.dtools.dev",
    "https://herpc.tribaldex.com",
    "https://ctpmain.com",
    "https://engine.hive.pizza",
    "https://he.atexoras.com:2083",
    "https://api2.hive-engine.com/rpc",
    "https://api.primersion.com",
    "https://engine.beeswap.tools",
    "https://herpc.dtools.dev",
    "https://api.hive-engine.com/rpc",
    "https://he.sourov.dev"
];

var nodes = [...fallbackNodes];
var node;
var lastNodeUpdate = 0;
var isUpdatingNodes = false;

// Update nodes from beacon API in background
async function updateNodesFromBeacon() {
    if (isUpdatingNodes) return;
    if (Date.now() - lastNodeUpdate < 1800000) return; // 30 minutes

    isUpdatingNodes = true;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('https://beacon.peakd.com/api/he/nodes', {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error('Beacon unavailable');

        const data = await response.json();

        const healthyNodes = data
            .filter(n => n &&
                        typeof n.score === 'number' &&
                        n.score >= 85 &&
                        n.endpoint &&
                        n.endpoint.startsWith('https://'))
            .sort((a, b) => b.score - a.score)
            .map(n => n.endpoint);

        if (healthyNodes.length > 0) {
            nodes = healthyNodes;
            console.log(`✓ Updated to ${healthyNodes.length} healthy nodes from beacon`);
            lastNodeUpdate = Date.now();
        }
    } catch (error) {
        console.log('Beacon unavailable, using current node list');
    } finally {
        isUpdatingNodes = false;
    }
}

function fetchWithTimeout(url, timeout = 3500) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        )
    ]);
}

function checkNode(node) {
    return new Promise((resolve) => {
        const start = Date.now();
        fetchWithTimeout(node)
            .then(response => {
                const duration = Date.now() - start;
                if (response.ok) {
                    resolve({ node, duration, status: 'Success' });
                } else {
                    resolve({ node, duration, status: 'Failed: Response not OK' });
                }
            })
            .catch(error => resolve({ node, duration: Date.now() - start, status: 'Failed: ' + error.message }));
    });
}

async function findNode() {
    // Try to update nodes in background (non-blocking)
    updateNodesFromBeacon().catch(() => {});

    // Only test top 5 nodes for speed
    const nodesToTest = nodes.slice(0, 5);
    const promises = nodesToTest.map(node => checkNode(node));

    try {
        const results = await Promise.allSettled(promises);

        // Print all results
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                console.log(`${result.value.node}: ${result.value.status}, Time: ${result.value.duration}ms`);
            } else {
                console.log(`Error: ${result.reason}`);
            }
        });

        const successfulResults = results
            .filter(result => result.status === 'fulfilled' && result.value.status === 'Success')
            .map(result => result.value);

        if (successfulResults.length === 0) {
            // Try next batch of 5 nodes
            console.log('First 5 nodes failed, trying next batch...');
            const nextBatch = nodes.slice(5, 10);
            if (nextBatch.length > 0) {
                const retryResults = await Promise.allSettled(nextBatch.map(n => checkNode(n)));
                const retrySuccess = retryResults
                    .filter(r => r.status === 'fulfilled' && r.value.status === 'Success')
                    .map(r => r.value);

                if (retrySuccess.length > 0) {
                    const fastestRetry = retrySuccess.sort((a, b) => a.duration - b.duration)[0];
                    node = fastestRetry.node;
                    console.log('Fastest node (retry): ' + node + ' (' + fastestRetry.duration + 'ms)');
                    return node;
                }
            }

            // Last resort: use first fallback node
            console.error('WARNING: All nodes failed, using first fallback node as last resort');
            node = fallbackNodes[0];
            return node;
        }

        // Set the fastest node
        const fastestNode = successfulResults.sort((a, b) => a.duration - b.duration)[0];
        node = fastestNode.node;
        console.log('Fastest node is: ' + node + ' (' + fastestNode.duration + 'ms)');
        return node;
    } catch (error) {
        console.error('Error finding the fastest node:', error.message);
        // Fallback to first node
        node = fallbackNodes[0];
        console.log('Using fallback node:', node);
        return node;
    }
}


//LB
//sleep function
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

//retry with exponential backoff
async function retryWithBackoff(fn, options = {}) {
    const {
        maxAttempts = 3,
        initialDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        functionName = 'unknown'
    } = options;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) {
                console.error(`[${functionName}] All ${maxAttempts} attempts failed`);
                throw error;
            }

            const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
            console.log(`[${functionName}] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }
    throw lastError;
}

//validate node URL
function validateNode(nodeUrl, functionName = 'unknown') {
    if (!nodeUrl || typeof nodeUrl !== 'string') {
        throw new Error(`[${functionName}] Invalid node: ${nodeUrl}`);
    }
    if (!nodeUrl.startsWith('https://') && !nodeUrl.startsWith('http://')) {
        throw new Error(`[${functionName}] Node must be a valid URL: ${nodeUrl}`);
    }
    return true;
}

//ensure MongoDB connection is healthy
async function ensureMongoConnection() {
    try {
        await client.db('admin').command({ ping: 1 });
        return true;
    } catch (err) {
        console.error('MongoDB connection lost, attempting reconnect...');
        try {
            await client.connect();
            console.log('MongoDB reconnected successfully');
            return true;
        } catch (reconnectErr) {
            console.error('MongoDB reconnect failed:', reconnectErr.message);
            throw new Error('MongoDB connection unavailable');
        }
    }
}

//distriubte rewards
async function distributeRewards(user) {
    //mint scrap to the user
    var adjusted = user.reward;
    var reward = adjusted.toFixed(8);
    console.log("Distributing " + reward + " to " + user.username);
    
    try {
        var data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol: 'SCRAP',
                to: user.username,
                quantity: reward,
                memo: 'terracore_reward_mint'
            }
        };

        //broadcast claim
        await hive.broadcast.customJsonAsync(wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));
        return;
    
        
    } 
    catch (err) {
            console.log(err);
    }
}

//call lb api to get rewards for top 200 players
async function getRewards() {
    return await retryWithBackoff(async () => {
        // Ensure MongoDB connection is healthy
        await ensureMongoConnection();

        const response = await fetchWithTimeout('https://api.terracoregame.com/leaderboard', 10000);
        const json = await response.json();

        const db = client.db('terracore');
        const collection = db.collection('stats');
        const stats = await collection.findOne({ date: "global" });

        if (!stats) {
            throw new Error('No global stats found in database');
        }

        const rewardTime = stats.rewardtime;

        if (Date.now() < rewardTime) {
            console.log("Not Time to Distribute Rewards");
            return;
        }

        console.log(`Processing rewards for ${json.length} players...`);
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < json.length; i++) {
            try {
                const collection = db.collection('players');
                const player = await collection.findOne({ username: json[i].username });

                if (!player) {
                    console.log(`Player ${json[i].username} not found in database`);
                    continue;
                }

                if (player.lastRewardTime && player.lastRewardTime >= rewardTime) {
                    console.log("Player " + json[i].username + " already received rewards");
                    continue;
                }

                await distributeRewards(json[i]);
                await collection.updateOne(
                    { username: json[i].username },
                    { $set: { lastRewardTime: rewardTime }, $inc: { version: 1 } }
                );
                successCount++;
                await sleep(500);
            } catch (err) {
                errorCount++;
                console.error(`Error processing reward for ${json[i].username}: ${err.message}`);
                // Continue with next player
            }
        }

        const newRewardTime = Date.now() + 86400000;
        await db.collection('stats').updateOne(
            { date: "global" },
            { $set: { rewardtime: newRewardTime } }
        );

        console.log(`Leaderboard Rewards Distribution Complete: ${successCount} successful, ${errorCount} errors`);
    }, {
        maxAttempts: 2,
        initialDelay: 3000,
        functionName: 'getRewards'
    }).catch(err => {
        console.error(`getRewards failed after all retries: ${err.stack}`);
        console.log('Skipping reward distribution for this iteration');
    });
}

/////////////////////////////////////
//// Game Revenue Distribution //////
////////////////////////////////////
//HIVE
async function checkBalance() {
    try {
        var balance = await hive.api.getAccountsAsync(['terracore']);
        var hiveBalance = balance[0].balance;
        //remove HIVE from balance
        hiveBalance = hiveBalance.split(' ')[0];
        //remove any spaces
        hiveBalance = hiveBalance.replace(/\s/g, '');
        console.log("Current Hive Balance: " + hiveBalance);
        return hiveBalance;
    } catch (err) {
        console.log(err.stack);
    }
}

//function to send hive
async function sendHive(to, amount, memo) {
    console.log("Sending " + amount + " HIVE to " + to);
    hive.broadcast.transfer(wif, 'terracore', to, amount + ' HIVE', memo, function (err, result) {
        if (err) {
            console.log(err);
        }
        else {
            console.log(result);
        }
    });
}

async function withdrawSwapHive() {
    return await retryWithBackoff(async () => {
        console.log("Processing SWAP.HIVE");
        const amount = await engineBalance('terracore', 'SWAP.HIVE');
        const parsedAmount = parseFloat(amount.toFixed(3));
        console.log("Current SWAP.HIVE Balance: " + parsedAmount);

        if (parsedAmount > 1) {
            let halfAmount = (parsedAmount / 2).toFixed(3);

            await swapTokens(parseFloat(halfAmount));
            await sleep(30000);

            halfAmount = (halfAmount - 0.01).toFixed(3);
            const json = {
                "contractName": "hivepegged",
                "contractAction": "withdraw",
                "contractPayload": {
                    "quantity": halfAmount
                }
            };

            const data = JSON.stringify(json);

            await new Promise((resolve, reject) => {
                hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function(err, result) {
                    if (err) {
                        console.error('Withdrawal broadcast error:', err);
                        reject(err);
                    } else {
                        console.log('Withdrawal successful:', result);
                        resolve(result);
                    }
                });
            });

            await sleep(120000);
            console.log("SWAP.HIVE processing completed successfully");
        } else {
            console.log("Not enough SWAP.HIVE to process");
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'withdrawSwapHive'
    }).catch(err => {
        console.error(`withdrawSwapHive failed after all retries: ${err.message}`);
        console.log('Skipping SWAP.HIVE processing for this iteration');
    });
}

// Updated function to swap tokens
async function swapTokens(amount) {
    console.log(`Swapping ${amount} SWAP.HIVE for SCRAP`);
    const amountNumber = parseFloat(amount);
    if (isNaN(amountNumber)) {
        throw new Error('Invalid amount: ' + amount);
    }
    const json = {
        "contractName": "marketpools",
        "contractAction": "swapTokens",
        "contractPayload": {
            "tokenPair": "SWAP.HIVE:SCRAP",
            "tokenSymbol": "SWAP.HIVE",
            "tokenAmount": amountNumber.toFixed(8),
            "tradeType": "exactInput",
            "maxSlippage": "5.000",
            "beeswap": "3.1.4"
        }
    };

    const data = JSON.stringify(json);

    return new Promise((resolve, reject) => {
        hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function(err, result) {
            if (err) {
                console.error("Error swapping tokens:", err);
                reject(err);
            } else {
                console.log("Swap successful:", result);
                resolve(result);
            }
        });
    });
}

async function distributeRevenue() {
    return await retryWithBackoff(async () => {
        // Ensure MongoDB connection for any potential DB operations
        await ensureMongoConnection();

        const hive_balance = await checkBalance();
        const balance = parseFloat(hive_balance);

        if (balance > 10) {
            const swapAmount = balance * 0.5;

            try {
                await swap_keychain_hive(swapAmount.toFixed(3), 'HIVE', 'SCRAP', 'terracore');
                await sleep(60000);
            } catch (err) {
                console.error(`Keychain swap failed: ${err.message}`);
                console.log('Continuing with revenue distribution despite swap failure');
                await sleep(5000);
            }

            const hive_balance_after = await checkBalance();
            const balance_after = parseFloat(hive_balance_after);

            const gnome = balance_after * 0.7;
            const asgarth = balance_after * 0.3;

            await sendHive('crypt0gnome', gnome.toFixed(3), 'terracore_revenue_distribution');
            await sleep(3000);
            await sendHive('asgarth', asgarth.toFixed(3), 'terracore_revenue_distribution');

            console.log("Revenue distribution completed successfully");
        } else {
            console.log("Not enough Hive to distribute");
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'distributeRevenue'
    }).catch(err => {
        console.error(`distributeRevenue failed after all retries: ${err.message}`);
        console.log('Skipping revenue distribution for this iteration');
    });
}

async function swap_keychain_hive(amount, symbol, symbol2, account) {
    try {
        // Convert amount to a number and fix to 3 decimal places
        const fixedAmount = parseFloat(amount).toFixed(3);
        
        const data = await fetchWithJson(`https://swap.hive-keychain.com/token-swap/estimate/${symbol}/${symbol2}/${fixedAmount}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }); 
        console.log(data);
        const data2 = await fetchWithJson('https://swap.hive-keychain.com/token-swap/estimate/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "slipperage": 15,
                "steps": data.result,
                "startToken": symbol,
                "endToken": symbol2,
                "amount": fixedAmount,
                "username": account
            }),
        });

        return new Promise((resolve, reject) => {
            hive.broadcast.transfer(wif, account, "keychain.swap", `${fixedAmount} HIVE`, data2.result.estimateId, function(err, result) {
                if (err) {
                    console.error("Error swapping HIVE:", err);
                    reject(err);
                } else {
                    console.log("HIVE swap successful:", result);
                    resolve(result);
                }
            });
        });
    } catch(err) {
        console.error("Error in swap_keychain_hive:", err);
        throw err;
    }
}

// Helper function for fetch with JSON
async function fetchWithJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

async function engineBalance(username, token) {
    return await retryWithBackoff(async () => {
        const nodes = [
            "https://engine.rishipanthee.com",
            "https://herpc.dtools.dev",
            "https://api.primersion.com"
        ];
        let selectedNode = null;

        // Try each node until one works
        for (let i = 0; i < nodes.length; i++) {
            try {
                const response = await fetchWithTimeout(nodes[i], 3500);
                await response.json(); // Validate response is valid JSON
                selectedNode = nodes[i];
                console.log(`engineBalance using node: ${selectedNode}`);
                break;
            } catch (error) {
                console.log(`engineBalance node ${nodes[i]} failed: ${error.message}`);
            }
        }

        // CRITICAL: Validate node before use
        if (!selectedNode) {
            throw new Error('All engineBalance nodes failed');
        }

        const response = await fetch(selectedNode + "/contracts", {
            method: "POST",
            headers: {'Content-type': 'application/json'},
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "find",
                params: {
                    contract: "tokens",
                    table: "balances",
                    query: {
                        "account": username,
                        "symbol": token
                    }
                },
                "id": 1,
            })
        });

        const data = await response.json();

        if (!data.result) {
            throw new Error(`Invalid response format from ${selectedNode}`);
        }

        if (data.result.length > 0) {
            return parseFloat(data.result[0].balance);
        } else {
            return 0;
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'engineBalance'
    }).catch(err => {
        console.error(`engineBalance failed after all retries: ${err.message}`);
        console.error(`This occurred while checking ${username}'s ${token} balance`);
        return 0; // Return 0 instead of crashing
    });
}

async function transfer(to, amount, account) {
    const json = {
        "contractName": "tokens",
        "contractAction": "transfer",
        "contractPayload": {
            "symbol": "FLUX",
            "to": to,
            "quantity": amount.toFixed(8).toString(),
            "memo": "Burn $FLUX"
        }
    };

    //convert json to string
    const data = JSON.stringify(json);

    hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function(err, result) {
    });

}

//Dex
async function place_order(price, quantity, side, symbol){
    try {
        console.log("Placing order for " + quantity + " at " + price);
        const op = {
            contractName: 'market',
            contractAction: side,
            contractPayload: {
                symbol: symbol,
                quantity: quantity.toString(),
                price: price.toString()
            }
        };
       await hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(op));
    }
    catch (err) {
        console.log(err);
    }
}
async function fetch_prices(symbol) {
    return await retryWithBackoff(async () => {
        // Validate global node exists
        if (!node) {
            console.error('Global node is undefined, attempting to find node');
            await findNode();
        }

        validateNode(node, 'fetch_prices');

        const response = await fetch(`${node}/contracts`, {
            method: 'POST',
            body: JSON.stringify({
                "jsonrpc": "2.0",
                "method": "find",
                "params": {
                    "contract": "market",
                    "table": "metrics",
                    "query": {"symbol": symbol },
                    "limit": 1000,
                    "offset": 0,
                    "indexes": []
                },
                "id": 6969
            }),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!data.result || data.result.length === 0) {
            throw new Error(`No price data found for ${symbol}`);
        }

        const bid = data.result[0].highestBid;
        const ask = data.result[0].lowestAsk;

        if (!bid || !ask) {
            throw new Error(`Invalid price data for ${symbol}: bid=${bid}, ask=${ask}`);
        }

        return {bid: bid, ask: ask};
    }, {
        maxAttempts: 3,
        initialDelay: 1500,
        functionName: 'fetch_prices'
    });
}

async function manageFlux() {
    return await retryWithBackoff(async () => {
        const flux = await engineBalance('terracore', 'FLUX');
        console.log("Current FLUX Balance: " + flux);

        if (flux > 5) {
            const burn = flux * .25;
            await transfer('null', burn, 'terracore');

            const amount = flux * .75;
            const prices = await fetch_prices('FLUX');
            const bid = parseFloat(prices.bid);
            const ask = parseFloat(prices.ask);

            // Calculate spread percentage
            const spreadPercent = ((ask / bid - 1) * 100).toFixed(2);
            console.log(`Market: Bid=${bid}, Ask=${ask}, Spread=${spreadPercent}%`);

            // Use bid-based pricing with 2-20% markup (10 orders at 2% increments)
            // This ensures competitive pricing even with wide spreads
            const order = (amount / 10).toFixed(3);
            console.log(`Placing 10 sell orders of ${order} FLUX each, priced 2-20% above highest bid`);

            for (let i = 1; i <= 10; i++) {
                const price = (bid * (1 + 0.02 * i)).toFixed(3); // 2%, 4%, 6%... 20% above bid
                await place_order(price, order, 'sell', 'FLUX');
                await sleep(2500);
            }
            console.log("FLUX management completed successfully");
        } else {
            console.log("Not enough FLUX to manage");
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'manageFlux'
    }).catch(err => {
        console.error(`manageFlux failed after all retries: ${err.message}`);
        console.log('Skipping FLUX management for this iteration');
    });
}




//run getRewards() once per 15 minutes
async function run() {
    console.log('='.repeat(60));
    console.log('lb-rewards script started at ' + new Date().toISOString());
    console.log('='.repeat(60));

    // Initial MongoDB connection
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
            // Ensure we have a valid node
            console.log('\n[1/5] Finding fastest node...');
            await findNode();

            console.log('\n[2/5] Managing FLUX...');
            await manageFlux();

            console.log('\n[3/5] Processing SWAP.HIVE...');
            await withdrawSwapHive();

            console.log('\n[4/5] Distributing rewards...');
            await getRewards();

            console.log('\n[5/5] Distributing revenue...');
            await distributeRevenue();

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log('\n' + '='.repeat(60));
            console.log(`✓ Iteration #${iterationCount} completed successfully in ${duration}s`);
            console.log('Sleeping for 15 minutes...');
            console.log('='.repeat(60));
            await sleep(900000);

        } catch (err) {
            console.error('\n' + '!'.repeat(60));
            console.error(`ERROR in iteration #${iterationCount}:`);
            console.error(err.stack);
            console.error('!'.repeat(60));
            console.log('Waiting 2 minutes before retry due to error...');
            await sleep(120000);
        }
    }
}

run();




