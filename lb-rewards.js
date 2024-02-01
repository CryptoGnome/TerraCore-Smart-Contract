const { MongoClient, MongoTopologyClosedError } = require('mongodb');
var hive = require('@hiveio/hive-js');
require('dotenv').config();
const fetch = require('node-fetch');
const SSC = require('sscjs');


const wif = process.env.ACTIVE_KEY;
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });

var ssc;
const nodes = ["https://engine.deathwing.me", "https://enginerpc.com", "https://ha.herpc.dtools.dev", "https://herpc.tribaldex.com", "https://ctpmain.com", "https://engine.hive.pizza", "https://he.atexoras.com:2083",  "https://api2.hive-engine.com/rpc", "https://api.primersion.com", "https://engine.beeswap.tools", "https://herpc.dtools.dev", "https://api.hive-engine.com/rpc", "https://he.sourov.dev"];
var node;

//HE NODE MANAGEMENT
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
    const promises = nodes.map(node => checkNode(node));
    try {
        const results = await Promise.allSettled(promises);

        // Print all results
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                //console.log(`${result.value.node}: ${result.value.status}, Time: ${result.value.duration}ms`);
            } else {
                //console.log(`Error: ${result.reason}`);
            }
        });

        const successfulResults = results
            .filter(result => result.status === 'fulfilled' && result.value.status === 'Success')
            .map(result => result.value);
        
        if (successfulResults.length === 0) throw new Error('No nodes are available');
        
        // Set the fastest node
        const fastestNode = successfulResults.sort((a, b) => a.duration - b.duration)[0].node;
        node = fastestNode;
        console.log('Fastest node is: ' + node);
        return node;
    } catch (error) {
        console.error('Error finding the fastest node:', error.message);
    }
}


//LB
//sleep function
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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
    try {
        //call api.terracoregame.com/leaderboard
        const response = await fetch('https://api.terracoregame.com/leaderboard');
        const json = await response.json();
        //get reward time from stats collection
        const db = client.db('terracore');
        const collection = db.collection('stats');
        const stats = await collection.findOne({ date: "global" });
        const rewardTime = stats.rewardtime;

        //see if current timestamp is greater than reward time
        if (Date.now() < rewardTime) {
            console.log("Not Time to Distribute Rewards");
            return;
        }

        //loop through json and update players
        for (var i = 0; i < json.length; i++) {

            //check if player has lastRewardTime field
            const collection = db.collection('players');
            const player = await collection.findOne({ username: json[i].username });
            if (player.lastRewardTime) {
                //check if the last reward time is less than the rewardtime
                if (player.lastRewardTime < rewardTime) {
                    await distributeRewards(json[i]);
                    await collection.updateOne({ username: json[i].username }, { $set: { lastRewardTime: rewardTime }, $inc: { version: 1 } });
                    await sleep(500);
                }
                else{
                    console.log("Player " + json[i].username + " already received rewards");
                }
            }
            else {
                await distributeRewards(json[i]);
                await collection.updateOne({ username: json[i].username }, { $set: { lastRewardTime: rewardTime }, $inc: { version: 1 } });
                await sleep(500);
            }
                
        }

        //reset the rewardtime in the stats collection
        var newRewardTime = Date.now() + 86400000;
        
        await db.collection('stats').updateOne({ date: "global" }, { $set: { rewardtime: newRewardTime } });
        console.log("Leaderboard Rewards Fully Distributed");
        return;


    } catch (err) {
        console.log(err.stack);
    }
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
    console.log("Withdrawing SWAP.HIVE");
    var amount = await engineBalance('terracore', 'SWAP.HIVE');
    amount = amount.toFixed(3);
    console.log("Current SWAP.HIVE Balance: " + amount);
    if (amount > 1) {
    
        const json = {
            "contractName": "hivepegged",
            "contractAction": "withdraw",
            "contractPayload": {
                "quantity": amount.toString()
            }
        };

        //convert json to string
        const data = JSON.stringify(json);

        hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function(err, result) {
            console.log(err, result);
        });

        await sleep(120000);
    }
}



//HE
//distribute to developers and to H-E for $FLUX stabilization
async function distributeRevenue() {
    var hive_balance = await checkBalance();
    //convert to float
    var balance = parseFloat(hive_balance);
    console.log("Current Hive Balance: " + balance);
    if (balance > 20) {
        ///send 70% to crypt0gnome
        var gnome = balance * .7;
        var gnome = gnome.toFixed(3);
        //send 30% to asgarth
        var asgarth = balance * .3;
        var asgarth = asgarth.toFixed(3);

        //send to crypt0gnome
        await sendHive('crypt0gnome', gnome, 'terracore_revenue_distribution');
        await sendHive('asgarth', asgarth, 'terracore_revenue_distribution');
    }
    else{
        console.log("Not enough Hive to distribute");
    }
}

async function engineBalance(username, token) {
    //make a list of nodes to try
    const nodes = ["https://engine.rishipanthee.com", "https://herpc.dtools.dev", "https://api.primersion.com"];
    var node;

    //try each node until one works, just try for a response
    for (let i = 0; i < nodes.length; i++) {
        try {
            const response = await fetch(nodes[i], {
                method: "GET",
                headers:{'Content-type' : 'application/json'},
            });
            const data = await response.json()
            node = nodes[i];
            break;
        } catch (error) {
            console.log(error);
        }
    }

                

    const response = await fetch(node + "/contracts", {
      method: "POST",
      headers:{'Content-type' : 'application/json'},
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "find",
        params: {
          contract: "tokens",
          table: "balances",
          query: {
            "account":username,
            "symbol":token    
          }
        },
        "id": 1,
      })
    });
    const data = await response.json()
    if (data.result.length > 0) {
        return parseFloat(data.result[0].balance);
    } else {
        return 0;
    }
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
async function fetch_prices(symbol){
    //send post request to enginerpc.com/contracts
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

    //from data.result[0].metrics get the highest bid and lowest ask
    var bid = data.result[0].highestBid;
    var ask = data.result[0].lowestAsk;
    return {bid: bid, ask: ask};
}

async function manageFlux() {
    //get balance of FLUX
    var flux = await engineBalance('terracore', 'FLUX');
    console.log("Current FLUX Balance: " + flux);

    //if greater than 1 
    if (flux > 5) {
        //burn 80%
        var burn = flux * .8;
        //burn the FLUX
        await transfer('null', burn, 'terracore');
        //place flux in orderbook above highest ask
        var amount = flux * .2;
        var prices = await fetch_prices('FLUX');
        var ask = parseFloat(prices.ask);
        console.log("Current Ask: " + ask);
        //split into 5 orders and ladder the sell orders each order should be 5% higher than the last starting at at 5% higher than the lowest ask
        var order = amount / 10;
        order = order.toFixed(3);
        for (var i = 1; i < 11; i++) {
            var price = ask + (ask * .05 * i);
            price = price.toFixed(3);
            await place_order(price, order, 'sell', 'FLUX');
            await sleep(2500);
        }

    }
    else {
        console.log("Not enough FLUX to manage");
    }

}




//run getRewards() once per 15 minutes
async function run() {
    try {
        while (true) {
            await findNode();
            await manageFlux();
            await withdrawSwapHive();
            await getRewards();
            await distributeRevenue();
            await sleep(900000);
        }
    } catch (err) {
        console.log(err.stack);
    }
}

run();




