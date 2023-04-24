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


var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, connectTimeoutMS: 5000, serverSelectionTimeoutMS: 5000 });


const timeout = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

//sleep function
async function sleep(ms) {
    console.log('Sleeping for ' + ms + 'ms');
    return new Promise(resolve => setTimeout(resolve, ms));
}

//function to change to a new hive node
async function changeNode() {
    var nodes = ['https://api.hive.blog', 'https://anyx.io', 'https://api.deathwing.me']
    var node = nodes[Math.floor(Math.random() * nodes.length)];
    hive.api.setOptions({ url: node });
    console.log('Changed node to ' + node);
}

async function webhook(title, message, color) {
    
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        hook.send(embed).catch(err => console.log(err.message));    
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

    //from stats collection, find the total players registered today
    collection = db.collection('stats');
    let todaysPlayers = await collection.findOne({ date: new Date().toISOString().slice(0, 10) });
    if (todaysPlayers) {
        todaysPlayers = todaysPlayers.players + 1;
    } else {
        todaysPlayers = 0;
    }
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('New Citizen: ', message, true)
        .addField('Total Citizens: ', totalPlayers.toString(), true)
        .addField('New Citizens Today: ', todaysPlayers.toString(), true)
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

//pay 1 HIVE to refferrer
async function payReferrer(referrer, username) {
    try {
        const xfer = new Object();
        xfer.from = "terracore";
        xfer.to = referrer;
        xfer.amount = "1.000 HIVE";
        xfer.memo = 'Here is your Refferal Bonus for inviting ' + username + ' to TerraCore!';
        await hive.broadcast.transfer(wif, xfer.from, xfer.to, xfer.amount, xfer.memo, function (err, result) {
            if (err) {
                console.log(err);
            } else {
                console.log(result);
            }
        });
        return;
    } catch (error) {
        console.log(error);
    }
}

async function register(username, referrer) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');
        let user = await collection.findOne({ username: username });
        if (user) {
            console.log(username + ' already exists');
            return false;
        }
        await collection.insertOne({username: username , favor: 0, scrap: 1, health: 10, damage: 10, defense: 10, engineering:1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now(), registrationTime: Date.now(), lastBattle: Date.now()});
        console.log('New User ' + username + ' now registered');
        collection = db.collection('stats');
        //increment global player count
        await collection.updateOne({ date: 'global' }, { $inc: { players: 1 } });
        //increment todays date player count
        await collection.updateOne({ date: new Date().toISOString().slice(0, 10) }, { $inc: { players: 1 } }, { upsert: true });


        if (referrer != 'terracore' && referrer != username) {
            webhook2('A New Citizen of Terracore has Registered', username + ' was invited by ' + referrer, 0x00ff00);
            payReferrer(referrer, username);
        }
        else{
            webhook2('A New Citizen of Terracore has Registered', username, 0x00ff00);
        }
        return true;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }
        else {
            console.log(err);
            return false;
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
        return;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }
        else {
            console.log(err);
            return;
        }
    }
}

async function storeClaim(username, qty) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('claims');
        await collection.insertOne({username: username, qty: qty, time: Date.now()});
        return;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }
        else {
            console.log(err);
            return;
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
            client.close();
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
        lastCheck = Date.now();
        let db = client.db(dbName);
        let collection = db.collection('transactions');
        //before starting make sure there are no transactions in the queue from the same username with the same type if so remove all but one, this will help prevents spamming, filter by tim received
        let transactions = await collection.find({})
        .sort({ time: 1 })
        .toArray()

        //loop through transactions and remove any that are the same type and username
        for (let i = 0; i < transactions.length; i++) {
            let transaction = transactions[i];
            for (let j = 0; j < transactions.length; j++) {
                let transaction2 = transactions[j];
                if(transaction.username == transaction2.username && transaction.type == transaction2.type && transaction.target == transaction2.target && transaction._id != transaction2._id) {
                    await collection.deleteOne({ _id: transaction2._id });
                    //also remove the transaction from the array so it is not checked again
                    transactions.splice(j, 1);
                }
            }
        }   

        //check if there are any transactions to send
        if(transactions.length != 0) {
            console.log('-------------------------------------------------------')
            console.log('Sending ' + transactions.length + ' transactions');
            console.log('-------------------------------------------------------')
            for (let i = 0; i < transactions.length; i++) {
                lastCheck = Date.now();
                let transaction = transactions[i];
                console.log('Sending transaction ' + (i+ 1).toString() + ' of ' + transactions.length.toString());
                if(transaction.type == 'claim') {
                    while(true){
                        //const result = await Promise.race([claim(transaction.username), timeout(5000)]);
                        const result = await claim(transaction.username);
                        if(result) {
                            let maxAttempts = 10;
                            let delay = 200;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if(clear.deletedCount == 1){
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.5; // exponential backoff  
                                
                            }
                        }
                        break;
                    }
                }
                else if(transaction.type == 'battle') {
                    while(true){
                        //const result = await Promise.race([battle(transaction.username, transaction.target), timeout(5000)]);
                        var result2 = await battle(transaction.username, transaction.target);
                        if(result2) {
                            let maxAttempts = 10;
                            let delay = 200;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if(clear.deletedCount == 1){
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.5; // exponential backoff
                            }
                        }
                        break;
                    }
                }
                
            }
            console.log('Completed Sending Transactions');
            return true;
        }
        else {
            return true;
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
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
    try{
        //check if there are any transactions in the queue, if no return in 3 seconds kill the process
        let done = await sendTransactions();
        if(done) {
            setTimeout(checkTransactions, 1000);
        }
    }
    catch (err) {
        client.close();
        process.exit(1);
    }
}

//broadcast claim
async function broadcastClaim(username, data, user, qty) {
    try {
        const result = await hive.broadcast.customJsonAsync(wif, ['terracore'], [], 'ssc-mainnet-hive', data);
        if (result.id) {
            return true;
        }
        else {
            console.log("No result id");
            webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
            return false;
        }
    } catch (err) {
        //send error webhook
        webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
        return false;
    }
}

//claim favorcheckDodge
async function claim(username) {
    try{
        let db = client.db(dbName);
        let collection = db.collection('players');
        //make sure user exists and has claims left
        let user = await collection.findOne({ username : username });

        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }
        if (user.claims == 0) {
            console.log('User ' + username + ' has no claims left');
            return true;
        }
        if ((Date.now() - user.lastPayout) < 30000) {
            return true;
        }

        //transfer scrap to user from terracore
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
            var claim = await broadcastClaim(username, JSON.stringify(data), user, qty);
            if(claim) {
                let maxAttempts = 10;
                let delay = 200;
                for (let i = 0; i < maxAttempts; i++) {
                    //inc version
                    let update = await collection.updateOne({ username: username }, { $set: { scrap: 0, claims: user.claims - 1, lastPayout: Date.now() }, $inc: { version: 1 } });
                    if(update.acknowledged == true && update.modifiedCount == 1) {
                        await storeClaim(username, qty);
                        webhook("Scrap Claimed", username + " claimed " + qty + " SCRAP", '#6130ff');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // exponential backoff  
                }
            }
            else {
                await changeNode();
                webhook("Error", "Error claiming scrap for user line:482 " + username + " Please try again", '#ff0000');
                return false;
            }

        }
        catch (err) {
            console.log(err);
            await changeNode();
            webhook("Error", "Error claiming scrap for user line:489 " + username + " Error: " + err, '#ff0000');
            return false;
        }
                            
        
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }
        else {
            console.log(err);
            //switch hive node
            webhook("Error", "Error claiming scrap for user line:502 " + username + " Error: " + err, '#ff0000');
            return false;
        }
    }

}

//battle function
async function battle(username, _target) {
    try{

        if(username == _target) {
            console.log('Error : Battle User: ' + username + ' tried to battle themselves');
            return true;
        }

        var db = client.db(dbName);
        var collection = db.collection('players');
        //load target user
        var user = await collection.findOne({ username : username });
        //check if user exists
        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }
        //load target 
        var target = await collection.findOne({ username : _target });
        //check if target exists
        if (!target) {
            console.log('Target ' + target + ' does not exist');
            return true;
        }

        //check if targer.registrationTime exists
        if (target.registrationTime) {
            //check if target registrationTime is less than 24 hours ago
            if (Date.now() - target.registrationTime < 86400000) {
                //send webhook stating target is has new user protection inc version
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
                webhook("New User Protection", "User " + username + " tried to attack " + _target + " but they have new user protection", '#ff6eaf')
                return true;
            }
        }

        //check if targer.lastBattle does not exist
        if (!target.lastBattle) {
            //set to now - 60 seconds
            target.lastBattle = Date.now() - 60000;
            //inv version
            await collection.updateOne({ username: _target }, { $set: { lastBattle: target.lastBattle }, $inc: { version: 1 } });
        }

        //make sure target is not getting attacked withing 60 seconds of last payout
        if (Date.now() - target.lastBattle < 60000) {
            await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
            //webhook("Unable to attack target", "User " + username + " tried to attack " + _target + " but they are not back at the base yet...", '#ff6eaf')
            return true;
        }


        //check if user has more damage than target defense and attacks > 0 and has defense > 10
        if (user.stats.damage > target.stats.defense && user.attacks > 0) {
            //check the amount of scrap users has staked
            var staked = await scrapStaked(username);
            var roll = await rollAttack(user);
            var scrapToSteal = target.scrap * (roll / 100);

            //give target a chance to ddodge based on toughness
            if (checkDodge(target)) {
                //send webhook stating target dodged attack
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, timestamp: Date.now()});
                webhook("Attack Dodged", "User " + username + " tried to attack " + _target + " but they dodged the attack", '#ff6eaf')
            }

            //check if scrap to steal is more than target scrap if so set scrap to steal to target scrap
            if (scrapToSteal > target.scrap) {
                scrapToSteal = target.scrap;
            }

            //check if current scrap of user + scrap to steal is more than staked scrap
            if (user.scrap + scrapToSteal > staked + 1) {
                scrapToSteal = (staked + 1) - user.scrap;
            }

            //make sure scrapToSteal is not NaN
            if (isNaN(scrapToSteal)) {
                //shoot error webhook
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is NaN, please try again", '#6385ff')
                return true;
            }

            //make sure scrapToSteal is not less than 0
            if (scrapToSteal < 0) {
                //shoot error webhook
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is less than 0, please try again", '#6385ff')
                return true;
            }

            
            try{
                let newScrap = user.scrap + scrapToSteal;
                let newTargetScrap = target.scrap - scrapToSteal;
                let newAttacks = user.attacks - 1;
                //modify target scrap & add to user scrap
                let maxAttempts = 10;
                let delay = 200;
                for (let i = 0; i < maxAttempts; i++) {
                    //inc versions
                    const bulkOps = [
                        { updateOne: { filter: { username: _target }, update: { $set: { scrap: newTargetScrap }, $inc: { version: 1 } } } },
                        { updateOne: { filter: { username: username }, update: { $set: { scrap: newScrap, attacks: newAttacks, lastBattle: Date.now() } , $inc: { version: 1 } } } }
                    ];
                    const result = await collection.bulkWrite(bulkOps);
                    //check if update was successful frim above result
                    if (result.nModified == 2 && result.nMatched == 2 && result.ok == 1) {
                        await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: scrapToSteal, timestamp: Date.now()});
                        webhook("New Battle Log", 'User ' + username + ' stole ' + scrapToSteal.toString() + ' scrap from ' + _target + ' with a ' + roll.toFixed(2).toString() + '% roll chance', '#f55a42');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // exponential backoff
                }

                //if we get here then we failed to update the database return 
                return true;

            }
            catch (e) {
                //send webhook with red color
                webhook("New Error", " Error: " + e, '#6385ff');
                return true;
            }

        }
        else{
            //check if user has attacks left
            if (user.attacks > 0) {
                await collection.updateOne({ username: username }, { $inc: { attacks: -1, version: 1 } ,  $set: { lastBattle: Date.now() } });
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, timestamp: Date.now()});
                webhook("New Battle Log", 'User ' + username + ' failed to steal scrap from ' + _target + ' you need more attack power than your opponent!', '#f55a42');
                return true;
            }
            else {
                console.log('User ' + username + ' has no attacks left');
                webhook("New Battle Log", 'User ' + username + ' failed to steal scrap from ' + _target + ' you have no attacks left!', '#f55a42');
                return true;
            }
            
        }
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }
        else {
            console.log(err);
            webhook("New Error", " Line: 681 Error: " + err, '#6385ff');
            return true;
        }
    }
}

function checkDodge(_target) {
    var k = 0.025;
    var toughness = k * _target.hiveEngineStake;

    // Adjust toughness based on stake
    var values = [3, 5, 10, 20, 30, 40, 50, 60, 75];
    for (var i = 0; i < values.length; i++) {
        if (toughness > values[i]) {
            var scrapNeeded = (values[i] / k);
            k = k / 2;
            toughness = values[i] + k * (_target.hiveEngineStake - scrapNeeded);
        }
    }

    //check that _target.stats.dodge exists
    if(_target.stats.dodge != undefined) {
        toughness = toughness + _target.stats.dodge;
    }

    // Check if attack is dodged
    var roll = Math.floor(Math.random() * 100) + 1;
    if (roll < toughness) {
        return true;
    }
    else {
        return false;
    }
}

async function rollAttack(_player) {
    var k = 0.025;
    var favor = k * _player.favor;
    var values = [3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75];

    for (var i = 0; i < values.length; i++) {
        if (favor > values[i]) {
            var scrapNeeded = (values[i] / k);
            k = k / 2;
            favor = values[i] + k * (_player.favor - scrapNeeded);
        }
    }

    //check that _player.stats.crit exists
    if(_player.stats.crit != undefined) {
        favor = favor + _player.stats.crit;
    }

    //roll a random number between favor and 100
    var steal = Math.floor(Math.random() * (100 - favor + 1)) + favor;
    //check if steal is greater than 100
    if (steal > 100) {
        steal = 100;
    }
    //return steal
    return steal;
}


//async function to clear transactions from queue
async function clearTransactions() {
    //connect to db
    try{
        let db = client.db(dbName);
        let collection = db.collection('transactions');
        //delete all transactions
        await collection.deleteMany({});
        return;

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
async function clearFirst() {
    //connect to db
    try{
        let db = client.db(dbName);
        let collection = db.collection('transactions');
        //delete the first transaction
        await collection.deleteOne({});

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

var lastevent = Date.now();
var lastCheck = Date.now();
const mintPrice = '20.000 HIVE'
//aysncfunction to start listening for events
async function listen() {
    //await clearTransactions();
    await clearFirst();
    checkTransactions();
    await changeNode();
    hive.api.streamOperations(function(err, result) {
        //timestamp of last event
        lastevent = Date.now(); 
        if (result[0] == 'transfer' && result[1].to == 'terracore') {
            //grab hash from memo
            var memo = JSON.parse(result[1].memo);
            //check if memo is register
            if(memo.hash.includes('terracore_register')){
                //split hash to get hash
                var hash = memo.hash.split('-')[1];
                var referrer = memo.referrer;
                if (result[1].to == 'terracore' && result[1].amount == mintPrice) {
                    var registered = register(result[1].from, referrer);
                    if (registered) {
                        storeRegistration(hash, result[1].from);
                    }
                }
            }
        
        }

        if (result[0] == 'custom_json' && result[1].id == 'terracore_claim') {
            //grab the json from result[1].json
            var data = JSON.parse(result[1].json);
            var user;
            //check if required_auths[0] is []
            if (result[1].required_auths[0] == undefined) {
                user = result[1].required_posting_auths[0];
            }
            else {
                user = result[1].required_auths[0];
            }

            //claim function
            sendTransaction(user, 'claim', 'none');
        }
        else if (result[0] == 'custom_json' && result[1].id == 'terracore_battle') {
            //console.log(result);
            var data = JSON.parse(result[1].json);
            //get target from data
            var target = data.target;
            var user;
            //check if required_auths[0] is []
            if (result[1].required_auths[0] == undefined) {
                user = result[1].required_posting_auths[0];
            }
            else {
                user = result[1].required_auths[0];
            }
            sendTransaction(user, 'battle', target);
        }    
        
    });
}



//track last event and reset claims every 15 seconds
try{
    console.log('-------------------------------------------------------')
    console.log('Starting to Listening for events on HIVE...');
    console.log('-------------------------------------------------------')
    listen();
}
catch(err){
    console.log(err);
}



setInterval(function() {
    //console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 30000) {
        console.log('No events received in 30 seconds, shutting down so pm2 can restart');
        client.close();
        process.exit();
    }
}, 1000);

var heartbeat = 0;
setInterval(function() {
    //console.log('Last Transaction Check: ' + (Date.now() - lastCheck) + ' ms ago');
    heartbeat++;
    if (heartbeat == 5) {
        //log how man seconds since last lastCheck
        console.log('HeartBeat: ' + (Date.now() - lastCheck) + 'ms ago');
        heartbeat = 0;
    }
    if (Date.now() - lastCheck > 20000) {
        console.log('Error : No events received in 20 seconds, shutting down so PM2 can restart & try to reconnect to Resolve...');
        client.close();
        process.exit();
    }
}, 1000);

