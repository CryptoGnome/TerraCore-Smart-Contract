const { MongoClient, MongoTopologyClosedError } = require('mongodb');
var hive = require('@hiveio/hive-js');
require('dotenv').config();
const fetch = require('node-fetch');


const wif = process.env.ACTIVE_KEY;
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });


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
//check the hive balance on the @terracore account
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

//distribute to developers and to H-E for $FLUX stabilization
async function distributeRevenue() {
    var hive_balance = await checkBalance();
    //convert to float
    var balance = parseFloat(hive_balance);
    console.log("Current Hive Balance: " + balance);
    if (balance > 25) {
        //send 5% to hive engine to support $FLUX ecosystem
        var swap = balance * .05;
        var swap = swap.toFixed(3);
        await sendHive('hiveswap', swap, 'hive-engine');
        await sleep(30000);
        var hive_balance = await checkBalance();
        var new_balance = parseFloat(hive_balance);
        ///send 70% to crypt0gnome
        var gnome = new_balance * .7;
        var gnome = gnome.toFixed(3);
        //send 30% to asgarth
        var asgarth = new_balance * .3;
        var asgarth = asgarth.toFixed(3);

        //send to crypt0gnome
        await sendHive('crypt0gnome', gnome, 'terracore_revenue_distribution');
        await sendHive('asgarth', asgarth, 'terracore_revenue_distribution');

        await check_he();
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

async function swap(amount) {
    console.log("Swapping " + amount + " SWAP.HIVE for FLUX");
    const json = {
        "contractName": "marketpools",
        "contractAction": "swapTokens",
        "contractPayload": {
            "tokenPair": "SWAP.HIVE:FLUX",
            "tokenSymbol": "SWAP.HIVE",
            "tokenAmount": amount.toFixed(8).toString(),
            "tradeType": "exactInput",
            "maxSlippage": "5.000",
            "beeswap": "3.1.4"
        }
    };

    //convert json to string
    const data = JSON.stringify(json);

    hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function (err, result) {
        console.log(err, result);
    });

}

async function distributeRewards(amount) {
    console.log("Distributing " + amount + " SWAP.HIVE to distribution contract");
    const json = {
        "contractName": "distribution",
        "contractAction": "deposit",
        "contractPayload": {
            "id": 127,
            "symbol": "SWAP.HIVE",
            "quantity": amount.toFixed(8).toString()
        }
    };

    //convert json to string
    const data = JSON.stringify(json);

    hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', data, function (err, result) {
        console.log(err, result);
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
            "memo": "BuyBack & Burn $FLUX"
        }
    };

    //convert json to string
    const data = JSON.stringify(json);

    hive.broadcast.customJson(account.active_key, ['terracore'], [], 'ssc-mainnet-hive', data, function(err, result) {
    });

}

async function check_he(){
    //get SWAP.HIVE balance
    var balance = await engineBalance('terracore', 'SWAP.HIVE');

    //check if balance is greater than 1
    if(balance < 1){
        console.log("Not enough SWAP.HIVE");
        return;
    }

    //add to distribution contract
    await distributeRewards(balance);

}




//run getRewards() once per 15 minutes
async function run() {
    try {
        while (true) {
            await getRewards();
            await distributeRevenue();
            await sleep(900000);
        }
    } catch (err) {
        console.log(err.stack);
    }
}

run();




