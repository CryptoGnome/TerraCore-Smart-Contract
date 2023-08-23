const { MongoClient, MongoTopologyClosedError } = require('mongodb');
var hive = require('@hiveio/hive-js');
require('dotenv').config();


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
    console.log("Distributing " + reward+ " to " + user.username);
    
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

        //see ifcurrent timestamp is greater than reward time
        if (Date.now() < rewardTime) {
            console.log("Not Time to Distribute Rewards");
            return;
        }

        //loop through json and update players
        for (var i = 0; i < json.length; i++) {
            await distributeRewards(json[i]);
            await sleep(500);
        }

        //reset the rewardtime in the stats collection
        const newRewardTime = Date.now() + 86400000;
        collection = db.collection('stats');
        await collection.updateOne({ date: "global" }, { $set: { rewardtime: newRewardTime } });
        console.log("Leaderboard Rewards Fully Distributed");
        return;


    } catch (err) {
        console.log(err.stack);
    }
}



//run getRewards() once per hour
async function run() {
    try {
        while (true) {
            await getRewards();
            await sleep(3600000);
        }
    } catch (err) {
        console.log(err.stack);
    }
}

run();




