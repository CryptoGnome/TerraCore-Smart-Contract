var hive = require('@hiveio/hive-js');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
require('dotenv').config();

//connect to Webhook
const hook = new Webhook(process.env.DISCORD_WEBHOOK);

const url = process.env.MONGO_URL;
const dbName = 'terracore';
const SYMBOL = 'SCRAP';
const wif = process.env.ACTIVE_KEY;

var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });



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
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username: username });
    if (user) {
        console.log(username + ' already exists');
        return false;
    }
    let result = await collection.insertOne({username: username , favor: 0, scrap: 1, health: 10, damage: 10, defense: 10, engineering:1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now()});
    console.log('New User ' + username + ' now registered');
    webhook('New User', username + ' has registered', '#5EEEDA');

    //increment global player count
    await collection.updateOne({ date: 'global' }, { $inc: { players: 1 } });
    //increment todays date player count
    await collection.updateOne({ date: new Date().toISOString().slice(0, 10) }, { $inc: { players: 1 } }, { upsert: true });
    return true;

}

//store hash in mongo collection that stores all regsitration hashes
async function storeRegistration(hash, username) {
    let db = client.db(dbName);
    let collection = db.collection('registrations');
    let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
    console.log('Hash ' + hash + ' stored');
}

async function storeHash(hash, username) {
    let db = client.db(dbName);
    let collection = db.collection('hashes');
    let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
    console.log('Hash ' + hash + ' stored');
}

//function to make sure scrap is set to 0
async function resetScrap(username, claims) {
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
    if (Date.now() - user.lastclaim < 15000) {
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
                    memo: 'terracore_claim_xfer'
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
                    memo: 'terracore_claim_mint'
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

    //call resetScrap function until it returns true
    while (await resetScrap(username, (user.claims - 1)) == false) {
        console.log('Resetting scrap for ' + username);
    }

}

//battle function
async function battle(username, _target) {
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

    //check if user has more damage than target defense and attacks > 0
    if (user.damage > target.defense && user.attacks > 0) {
        //check the amount of scrap users has staked
        var staked = await scrapStaked(username);
        //allow user to take target scrap up to the amount of damage left after target defense and add it to user damage
        let scrapToSteal = user.damage - target.defense;
        if (scrapToSteal > target.scrap) {
            //check if current scrap of user + scrap to steal is more than staked scrap
            scrapToSteal = target.scrap;
            if (user.scrap + scrapToSteal > staked) {
                scrapToSteal = (staked + 1) - user.scrap;
                //make sure scrap to steal is not moe than target scrap
                if (scrapToSteal > target.scrap) {
                    scrapToSteal = target.scrap;
                }

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

            if (result[1].to == 'terracore' && memo.event == 'terracore_register' && result[1].amount == mintPrice) {
                var registered = register(result[1].from);
                if (registered) {
                    storeRegistration(memo.hash, result[1].from);
                }
            }
        
        }

        if (result[0] == 'custom_json' && result[1].id == 'terracore_claim') {
            console.log(result);
            //claim function
            claim(result[1].required_auths[0]);
        }
        else if (result[0] == 'custom_json' && result[1].id == 'terracore_battle') {
            console.log(result);
            //convert result[1].json[0] to object
            var data = JSON.parse(result[1].json);
            //get target from data
            var target = data.target;
            //battle function
            var b = battle(result[1].required_auths[0], target);
        }       
    });
}




//track last event and reset claims every 15 seconds
listen();
lastevent = Date.now();

//check supply every 15 minutes
setInterval(function() {
    scrapData();
}, 900000);

//kill process if no events have been received in 30 seconds
setInterval(function() {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 15000) {
        console.log('No events received in 15 seconds, shutting down so pm2 can restart');
        process.exit();
    }
}, 1000);
