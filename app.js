var hive = require('@hiveio/hive-js');
const mongodb = require('mongodb');
const fetch = require('node-fetch');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
require('dotenv').config();

//connect to Webhook
const hook = new Webhook(process.env.DISCORD_WEBHOOK);


//connect to mongodb
const MongoClient = mongodb.MongoClient;
const url = process.env.MONGO_URL;
const dbName = 'terracore';
const SYMBOL = 'SCRAP';
const wif = process.env.ACTIVE_KEY;

async function webhook(title, message, color) {
    
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        hook.send(embed);
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
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username: username });
    if (user) {
        console.log(username + ' already exists');
        return false;
    }
    let result = await collection.insertOne({username: username , favor: 0, scrap: 0, health: 10, damage: 10, defense: 10, engineering:1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now()});
    console.log('New User ' + username + ' now registered');
    webhook('New User', username + ' has registered', '#86fc86');
    return true;

}

//store hash in mongo collection that stores all regsitration hashes
async function storeRegistration(hash, username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('registrations');
    let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
    console.log('Hash ' + hash + ' stored');
}

async function storeHash(hash, username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('hashes');
    let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
    console.log('Hash ' + hash + ' stored');
}
//defense upgrade
async function defense(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');

    //create loop to run until update is successful
    let user = await collection.findOne({ username : username });
    if (!user) {
        return;
    }
    while (true) {
        let cost = Math.pow(user.defense/10, 2);
        if (quantity == cost){
            await collection.updateOne({username : username}, {$inc: {defense: 10}});
            webhook('Upgrade', username + ' upgraded defense to ' + (user.defense + 10), '#86fc86');
        }

        //check if update was successful
        let userCheck = await collection.findOne({ username : username });
        if (userCheck.defense == user.defense + 10) {
            break;
        }
     
    }
}
//engineering upgrade
async function engineering(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');

    //create loop to run until update is successful
    let user = await collection.findOne({ username : username });
    if (!user) {
        return;
    }
    while (true) {
        let cost = Math.pow(user.engineering, 2);
        //new minerate is old minerate + 10% of old minerate
        var newrate = user.minerate + (user.minerate * 0.1);

        if (quantity == cost){
            await collection.updateOne({username: username}, {$inc: {engineering: 1}});
            await collection.updateOne({username: username }, {$set: {minerate: newrate}});
            webhook('Engineering Upgrade', username + ' has upgraded their engineering to ' + user.engineering + 1, '#86fc86')
        }

        //check if update was successful
        let userCheck = await collection.findOne({ username : username });
        if (userCheck.engineering == user.engineering + 1 && userCheck.minerate == newrate) {
            break;
        }
    }

}

//health upgrade
async function health(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username : username });

    //check if user exists
    if (!user) {
        return;
    }
    let cost = Math.pow(user.health/10, 2);

    if (quantity == cost){
        let result = await collection.updateOne({username: username}, {$inc: {health: 10}});
        webhook('Health Upgrade', username + ' has upgraded their health to ' + user.health + 10, '#86fc86');
    }
}

//damage upgrade
async function damage(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username : username });

    //check if user exists
    if (!user) {
        return;
    }

    let cost = Math.pow(user.damage/10, 2);

    if (quantity == cost){
        let result = await collection.updateOne({username: username}, {$inc: {damage: 10}});
        webhook('Damage Upgrade', username + ' has upgraded their damage to ' + user.damage + 10, '#86fc86');
    }
}


//contributor upgrade
async function contribute(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({username: username});

    //check if user exists
    if (!user) {
        return;
    }

    let qty = parseFloat(quantity);
    //add quantity to favor
    await collection.updateOne({username: username}, {$inc: {favor: qty}});
    //load stats collection
    let stats = db.collection('stats');
    //todays date
    var date = new Date().toISOString().slice(0, 10);

    //add qty to current favor
    await stats.updateOne({date: date}, {$inc: {currentFavor: qty}});

    //update date glboal in stats collection and increment current favor
    let collection2 = db.collection('stats');
    await collection2.updateOne({date: "global"}, {$inc: {currentFavor: qty}});


    //webhook
    webhook("New Contribution", "User " + username + " contributed " + qty.toString() + " favor", '#c94ce6')


}

//function to make sure scrap is set to 0
async function resetScrap(username, claims) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    //find user in collection
    let user = await collection.findOne({ username : username });
    //check if user exists
    if (!user) {
        return true;
    }
    else if(user.claims == claims){
        return true;
    }
    else if(user.scrap == 0){
        return true;
    }
    else{
        //set scrap to 0 and update claims
        await collection.updateOne({username: username}, {$set: {scrap: 0, claims: claims, lastclaim: Date.now()}});
        return false;

    }
}

//claim favor
async function claim(username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
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
    //make sure last claim was longer than 120 seconds ago
    if (Date.now() - user.lastclaim < 120000) {
        console.log('User ' + username + ' has to wait 120 seconds between claims');
        return;
    }

    //call resetScrap function until it returns true
    while (await resetScrap(username, (user.claims - 1)) == false) {
        console.log('Resetting scrap for ' + username);
    }
    

    //get engine balance of terracore
    let balance = await engineBalance('terracore');

    if(balance > user.scrap) {
        //transfer scrap to user from terracore
        console.log("Transfering SCRAP from terracore to " + username);

        //make sure qty has no more than 8 decimals
        let qty = user.scrap.toFixed(8);

        //create custom_json to transfer scrap to user
        var op = ['custom_json', {
            required_auths: ['terracore'],
            required_posting_auths: [],
            id: 'ssc-mainnet-hive',
            json: JSON.stringify({
                contractName: 'tokens',
                contractAction: 'transfer',
                contractPayload: {
                    symbol: 'SCRAP',
                    to: username,
                    quantity: qty.toString(),
                    memo: 'claim'
                }
            })
        }];
        //broadcast operation to hive blockchain
        hive.broadcast.customJson(wif, op[1].required_auths, op[1].required_posting_auths, op[1].id, op[1].json, function(err, result) {
            console.log(err, result);
            //if successful, update user scrap to 0
            if (!err) {
                webhook("New Claim", "User " + username + " claimed " + user.scrap.toFixed(8).toString() + " scrap", '#6385ff')
            }
        });
    
    } 
    else {
        //transfer scrap to user from terracore
        console.log("MINTING SCRAP TO USER FOR CLAIM");
        //create custom_json operation that issues scrap to user

        //make sure qty has no more than 8 decimals
        let qty = user.scrap.toFixed(8);

        var op = ['custom_json', {
            required_auths: ['terracore'],
            required_posting_auths: [],
            id: 'ssc-mainnet-hive',
            json: JSON.stringify({
                contractName: 'tokens',
                contractAction: 'issue',
                contractPayload: {
                    symbol: 'SCRAP',
                    to: username,
                    quantity: qty.toString(),
                    memo: 'claim'
                }
            })
        }];

        //broadcast operation to hive blockchain
        hive.broadcast.customJson(wif, op[1].required_auths, op[1].required_posting_auths, op[1].id, op[1].json, function(err, result) {
            console.log(err, result);
            //if success
            if (!err) {
                webhook("New Claim", "User " + username + " claimed " + user.scrap.toFixed(8).toString() + " scrap", '#6385ff')
            }
        });

    }

}

//battle function
async function battle(username, _target) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    
    //load target user
    let user = await collection.findOne({ username : username });
    //check if user exists
    if (!user) {
        console.log('User ' + username + ' does not exist');
        return false;
    }
    //load target 
    let target = await collection.findOne({ username : _target });
    //check if target exists
    if (!target) {
        console.log('Target ' + target + ' does not exist');
        return false;
    }

    //check uf user has more damage than target defense and attacks > 0
    if (user.damage > target.defense && user.attacks > 0) {
        //check the amount of scrap users has staked
        var staked = await scrapStaked(username);
        //allow user to take target scrap up to the amount of damage left after target defense and add it to user damage
        let scrapToSteal = user.damage - target.defense;
        if (scrapToSteal > target.scrap) {
            //check if current scrap of user + scrap to steal is more than staked scrap
            scrapToSteal = target.scrap;
            if (user.scrap + scrapToSteal > staked) {
                scrapToSteal = staked - user.scrap;
            }
            else {
                scrapToSteal = target.scrap;
            }
        }
        //add scrap to user  & subtract attacks from user
        console.log('User ' + username + ' stole ' + scrapToSteal + ' scrap from ' + _target);
        await collection.updateOne({ username: username }, { $inc: { scrap: scrapToSteal, attacks: -1 } });
        //remove scrap from target
        await collection.updateOne({ username: _target }, { $inc: { scrap: -scrapToSteal } });

        //send webhook with red color
        webhook("New Battle Log", 'User ' + username + ' stole ' + scrapToSteal.toString() + ' scrap from ' + _target, '#f55a42');
        return true;


    }
    else{
        //remove one from user attacks
        console.log('User ' + username + ' failed to steal scrap from ' + _target);
        //check if user has attacks left
        if (user.attacks > 0) {
            await collection.updateOne({ username: username }, { $inc: { attacks: -1 } });
            return true;
        }
        else {
            console.log('User ' + username + ' has no attacks left');
            return false;
        }
        
    }
}

 

var lastevent = Date.now();
const mintPrice = '10.000 HIVE'
//aysncfunction to start listening for events
async function listen() {
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

            if (result[1].to == 'terracore' && memo.event == 'register' && result[1].amount == mintPrice) {
                var registered = register(result[1].from);
                if (registered) {
                    storeRegistration(memo.hash, result[1].from);
                }
            }
        
        }

        if (result[0] == 'custom_json' && result[1].id == 'claim') {
            console.log(result);
            //claim function
            claim(result[1].required_auths[0]);
        }
        else if (result[0] == 'custom_json' && result[1].id == 'battle') {
            console.log(result);
            //convert result[1].json[0] to object
            var data = JSON.parse(result[1].json);
            //get target from data
            var target = data.target;
            //battle function
            var b = battle(result[1].required_auths[0], target);
        }

        if (result[1].id == 'ssc-mainnet-hive'){
            var from = result[1].required_auths[0];
            var data = JSON.parse(result[1].json);

            try{
                var to = data.contractPayload.to;
            } catch (err){}


            if (to == 'terracore'){
                console.log(data);
                var quantity = data.contractPayload.quantity;
                //make sure symbol is scrap
                if (data.contractPayload.symbol != SYMBOL){
                    console.log('Not scrap');
                    return;
                }

                //split memo at - and save first part as event second as hash
                var memo = {
                    event: data.contractPayload.memo.split('-')[0],
                    hash: data.contractPayload.memo.split('-')[1]
                }
                
                //check if memo is engineering
                if (memo.event == 'engineering'){
                    engineering(from, quantity);
                }
                else if (memo.event == 'health'){
                    health(from, quantity);
                }
                else if (memo.event == 'damage'){
                    damage(from, quantity);
                }
                else if (memo.event == 'defense'){
                    defense(from, quantity);
                }
                else if (memo.event == 'contribute'){
                    contribute(from, quantity);
                }
                else{
                    console.log('Unknown event');
                }

            }

                
        }
    });
}



//test
//track last event and reset claims every 15 seconds
listen();
lastevent = Date.now();
//kill process if no events have been received in 30 seconds
setInterval(function() {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 15000) {
        console.log('No events received in 15 seconds, shutting down so pm2 can restart');
        process.exit();
    }
}, 1000);
