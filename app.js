var hive = require('@hiveio/hive-js');
const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const fetch = require('node-fetch');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
require('dotenv').config();

//connect to Webhook using retry on limit
const hook = new Webhook(process.env.DISCORD_WEBHOOK);
//seciondary webhook for registrations
const hook2 = new Webhook(process.env.DISCORD_WEBHOOK_2);

const dbName = 'terracore';
const SYMBOL = 'SCRAP';
const wif = process.env.ACTIVE_KEY;
var QUE_SET = false;

var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000 });



async function webhook(title, message, color) {
    
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        hook.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }
    
}
async function webhook2(title, message, color) {

    //find total players in database
    let db = client.db(dbName);
    let collection = db.collection('players');
    let totalPlayers = await collection.countDocuments();
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('New Citizen: ', message, true)
        .addField('Total Citizens: ', totalPlayers.toString(), true)
        .setColor(color)
        .setTimestamp();
    try {
        hook2.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }
    
}

async function engineBalance(username) {
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
            "symbol":SYMBOL    
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

async function scrapStaked(username) {
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
            "symbol":SYMBOL    
          }
        },
        "id": 1,
      })
    });
    const data = await response.json()
    if (data.result.length > 0) {
        return parseFloat(data.result[0].stake);
    } else {
        return 0;
    }
}

async function register(username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');
        let user = await collection.findOne({ username: username });
        if (user) {
            console.log(username + ' already exists');
            return false;
        }
        await collection.insertOne({username: username , favor: 0, scrap: 1, health: 10, damage: 10, defense: 10, engineering:1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now(), registrationTime: Date.now()});
        console.log('New User ' + username + ' now registered');
        webhook2('A New Citizen of Terracore has Registered', username, 0x00ff00);
        
        collection = db.collection('stats');
        //increment global player count
        await collection.updateOne({ date: 'global' }, { $inc: { players: 1 } });
        //increment todays date player count
        await collection.updateOne({ date: new Date().toISOString().slice(0, 10) }, { $inc: { players: 1 } }, { upsert: true });
        return true;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }

}

//store hash in mongo collection that stores all regsitration hashes
async function storeRegistration(hash, username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('registrations');
        await collection.insertOne({hash: hash, username: username, time: Date.now()});
        console.log('Hash ' + hash + ' stored');
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

async function storeHash(hash, username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('claims');
        let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
        console.log('Claim Hash ' + hash + ' stored');
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

//function to make sure scrap is set to 0
async function resetScrap(username, claims) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');
        //find user in collection
        let user = collection.find({ username : username });
        //check if user exists
        if (!user) {
            return true;
        }
        else if(user.scrap == 0){
            return true;
        }
        else{
            //while loop and check if user has 0 scrap
            while(true){
                var clear = await collection.updateOne({ username: username }, { $set: { scrap: 0, claims: claims, lastPayout: Date.now() } });
                if(clear.modifiedCount == 1){
                    return true;
                }           
            }
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

//set last payout time to now
async function setLastPayout(username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');
        //find user in collection
        let user = collection.find({ username : username });
        //check if user exists
        if (!user) {
            return true;
        }
        else if(user.scrap == 0){
            return true;
        }
        else{
            //loop and ensure last payout is set
            while(true){
                var done = await collection.updateOne({ username: username }, { $set: { lastPayout: Date.now() } });
                if(done.modifiedCount == 1){
                    return true;
                }
            }     
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

//create a function where you can send transactions to be queued to be sent
async function sendTransaction(username, type, target) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let db = client.db(dbName);
        let collection = db.collection('transactions');
        let result = await collection.insertOne({username: username, type: type, target: target, time: Date.now()});
        console.log('Transaction ' + result.insertedId + ' added to queue');
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

//create a function that can be called to send all transactions in the queue
async function sendTransactions() {
    try{
        let db = client.db(dbName);
        let collection = db.collection('transactions');
        let transactions = await collection.find({}).toArray();
        for (let i = 0; i < transactions.length; i++) {
            let transaction = transactions[i];
            if(transaction.type == 'claim') {
                await claim(transaction.username);
            }
            else if(transaction.type == 'battle') {
                await battle(transaction.username, transaction.target);
            }
        }
        await collection.deleteMany({});
        return true;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
            return true;
        }
    }
}

//call send transactions and wait for it to return true then call check transactions
async function checkTransactions() {
    //console.log('Checking transactions');
    let done = await sendTransactions();
    if(done) {
        setTimeout(checkTransactions, 1000);
    }
}

//claim favor
async function claim(username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');

        //make sure user exists and has claims left
        let user = await collection.findOne({ username : username });
        if (!user) {
            console.log('User ' + username + ' does not exist');
            return;
        }
        if (user.claims == 0) {
            console.log('User ' + username + ' has no claims left');
            return;
        }
        //make sure last claim was longer than 15 seconds ago
        if (Date.now() - user.lastPayout < 15000) {
            console.log('User ' + username + ' has to wait 15 seconds between claims');
            return;
        }

        //get engine balance of terracore
        let balance = await engineBalance('terracore');


        if(balance > user.scrap) {
            //transfer scrap to user from terracore
            console.log("Transfering SCRAP from terracore to " + username);
            //make sure qty has no more than 8 decimals
            let qty = user.scrap.toFixed(8);

            //create custom_json to transfer scrap to user
            var data = {
                contractName: 'tokens',
                contractAction: 'transfer',
                contractPayload: {
                    symbol: 'SCRAP',
                    to: username,
                    quantity: qty.toString(),
                    memo: 'terracore_claim_xfer'
                }
            };


            try{
                //reset payout time
                await setLastPayout(username);
                hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data), function (err, result) {
                    if (err) {
                        //send error webhook
                        webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
                    }
                    else {
                        if (!result.id) {
                            console.log("No result id");
                            webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
                            return;
                        }
                        resetScrap(username, user.claims - 1);
                        //storeHash(memo, username);
                        webhook("Scrap Claimed", username + " claimed " + qty + " SCRAP", '#6130ff');
                    }
                });

            }
            catch (err) {
                console.log(err);
                //send error webhook
                webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
            }
        
        } 
        else {
            //transfer scrap to user from terracore
            console.log("MINTING SCRAP TO USER FOR CLAIM");
            //create custom_json operation that issues scrap to user
            //make sure qty has no more than 8 decimals
            let qty = user.scrap.toFixed(8);

            //create custom_json to issue scrap to user
            var data = {
                contractName: 'tokens',
                contractAction: 'issue',
                contractPayload: {
                    symbol: 'SCRAP',
                    to: username,
                    quantity: qty.toString(),
                    memo: 'terracore_claim_mint'
                }
            };

            
            try{
                //reset payout time
                await setLastPayout(username);
                hive.broadcast.customJson(wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data), function (err, result) {
                    if (err) {
                        //send error webhook
                        webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
                    }
                    else {
                        if (!result.id) {
                            console.log("No result id");
                            webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
                            return;
                        }
                        resetScrap(username, user.claims - 1);
                        //storeHash(result.id, username);
                        webhook("Scrap Claimed", username + " claimed " + qty + " SCRAP", '#6130ff');
                    }
                });

            }
            catch (err) {
                console.log(err);
                //send error webhook
                webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
            }
                            
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }


}

//battle function
async function battle(username, _target) {
    try{
        var db = client.db(dbName);
        var collection = db.collection('players');
        
        //load target user
        var user = await collection.findOne({ username : username });
        //check if user exists
        if (!user) {
            console.log('User ' + username + ' does not exist');
            return;
        }
        //load target 
        var target = await collection.findOne({ username : _target });
        //check if target exists
        if (!target) {
            console.log('Target ' + target + ' does not exist');
            return;
        }

        //check if targer.registrationTime exists
        if (target.registrationTime) {
            //check if target registrationTime is less than 24 hours ago
            if (Date.now() - target.registrationTime < 86400000) {
                //send webhook stating target is has new user protection
                webhook("New User Protection", "User " + username + " tried to attack " + _target + " but they have new user protection", '#6385ff')
                return;
            }
        }


        //check if user has more damage than target defense and attacks > 0 and has defense > 10
        if (user.damage > target.defense && user.attacks > 0) {
            //check the amount of scrap users has staked
            var staked = await scrapStaked(username);
            var roll;
            //check who has a higher favor
            if (user.favor > target.favor) {
                //roll a number between 25 and 100 ints
                roll = Math.floor(Math.random() * 75) + 25;
            }
            else if (user.favor < target.favor) {
                //roll a number between 1 and 50
                roll = Math.floor(Math.random() * 50) + 1;
            }
            else if (user.favor == 0) {
                //roll a number between 1 and 25
                roll = Math.floor(Math.random() * 25) + 1;
            }
            else {
                //roll a number between 1 and 100
                roll = Math.floor(Math.random() * 100) + 1;
            }


            //allow user to take target scrap up to the amount of damage left after target defense and add it to user damage
            var scrapToSteal = user.damage - target.defense;

            if (scrapToSteal > target.scrap) {
                //check if current scrap of user + scrap to steal is more than staked scrap
                scrapToSteal = target.scrap;
                scrapToSteal = scrapToSteal * (roll / 100);
                if (user.scrap + scrapToSteal > staked) {
                    scrapToSteal = (staked + 1) - user.scrap;
                    //make sure scrap to steal is not moe than target scrap
                    if (scrapToSteal > target.scrap) {
                        scrapToSteal = target.scrap;
                    }
                }
                else {
                    scrapToSteal = target.scrap;
                    scrapToSteal = scrapToSteal * (roll / 100);
                }
            }
            else {
                //check if current scrap of user + scrap to steal is more than staked scrap
                if (user.scrap + scrapToSteal > staked) {
                    scrapToSteal = (staked + 1) - user.scrap;
                    scrapToSteal = scrapToSteal * (roll / 100);
                    //make sure scrap to steal is not moe than target scrap
                    if (scrapToSteal > target.scrap) {
                        scrapToSteal = target.scrap;
                    }
                }
                else {
                    scrapToSteal = scrapToSteal;
                    scrapToSteal = scrapToSteal * (roll / 100);
                }
            }


            //make sure scrapToSteal is not NaN
            if (isNaN(scrapToSteal)) {
                //shoot error webhook
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is NaN, please try again", '#6385ff')
                return;
            }

            //make sure scrapToSteal is not less than 0
            if (scrapToSteal < 0) {
                //shoot error webhook
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is less than 0, please try again", '#6385ff')
                return;
            }

            //add scrap to user  & subtract attacks from user
            console.log('User ' + username + ' stole ' + scrapToSteal + ' scrap from ' + _target);

            //adjust scrap & set attacks to new value
            collection.updateOne({ username: username }, { $inc: { scrap: scrapToSteal } });
            //remove one from user attacks
            collection.updateOne({ username: username }, { $inc: { attacks: -1 } })
            
            //remove scrap from target
            collection.updateOne({ username: _target }, { $inc: { scrap: -scrapToSteal } });

            //send webhook with red color
            webhook("New Battle Log", 'User ' + username + ' stole ' + scrapToSteal.toString() + ' scrap from ' + _target, '#f55a42');
            //store battle in db
            collection = db.collection('battle_logs');
            await collection.insertOne({username: username, attacked: _target, scrap: scrapToSteal, timestamp: Date.now()});
            return;


        }
        else{

            //remove one from user attacks
            console.log('User ' + username + ' failed to steal scrap from ' + _target);
            //check if user has attacks left
            if (user.attacks > 0) {
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 } });
                //send webhook with red color
                webhook("New Battle Log", 'User ' + username + ' failed to steal scrap from ' + _target + ' you need more attack power than your opponent!', '#f55a42');
                return;
            }
            else {
                console.log('User ' + username + ' has no attacks left');
                //send webhook with red color
                webhook("New Battle Log", 'User ' + username + ' failed to steal scrap from ' + _target + ' you have no attacks left!', '#f55a42');
                return;
            }
            
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            console.log(err);
        }
    }
}

//calculte the total scrap circulating and staked on the network
async function scrapData(){
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
            "symbol":SYMBOL    
          }
        },
        "id": 1,
      })
    });
    const data = await response.json()
    //loop through all balances and add them to create total circulating supply and total staked supply
    var circulating = 0;
    var staked = 0;
    for (let i = 0; i < data.result.length; i++) {
        //convert to float
        circulating += parseFloat(data.result[i].balance);
        staked += parseFloat(data.result[i].stake);
    }
    //return circulating and staked supply
    console.log('Circulating: ' + (circulating + staked) + ' Staked: ' + staked);
    let db = client.db(dbName);
    let collection = db.collection('stats');
    //update global stats
    await collection.updateOne({ date: 'global' }, { $set: { totalScrap: (circulating + staked), totalStaked: staked } });
}


var lastevent = Date.now();
const mintPrice = '20.000 HIVE'
//aysncfunction to start listening for events
async function listen() {
    checkTransactions();
    hive.api.streamOperations(function(err, result) {
        //timestamp of last event
        lastevent = Date.now(); 
        //listen for register event
        if (result[0] == 'transfer' && result[1].to == 'terracore') {
            console.log(result[1]);
            //split memo at - and save first part as event second as hash
            var memo = {
                event: result[1].memo.split('-')[0],
                hash: result[1].memo.split('-')[1]
            }

            if (result[1].to == 'terracore' && memo.event == 'terracore_register' && result[1].amount == mintPrice) {
                var registered = register(result[1].from);
                if (registered) {
                    storeRegistration(memo.hash, result[1].from);
                }
            }
        
        }

        if (result[0] == 'custom_json' && result[1].id == 'terracore_claim') {
            //console.log(result);
            //grab the json from result[1].json
            var data = JSON.parse(result[1].json);
            //claim function
            sendTransaction(result[1].required_auths[0], 'claim', 'none');
        }
        else if (result[0] == 'custom_json' && result[1].id == 'terracore_battle') {
            //console.log(result);
            //convert result[1].json[0] to object
            var data = JSON.parse(result[1].json);
            //get target from data
            var target = data.target;
            //battle function
            sendTransaction(result[1].required_auths[0], 'battle', target);
        }       
    });
}



//track last event and reset claims every 15 seconds
try{
    listen();
}
catch(err){
    process.exit();
}


lastevent = Date.now();
//check supply every 15 minutes
setInterval(function() {
    scrapData();
}, 900000);


setInterval(function() {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 10000) {
        console.log('No events received in 15 seconds, shutting down so pm2 can restart');
        process.exit();
    }
}, 1000);
