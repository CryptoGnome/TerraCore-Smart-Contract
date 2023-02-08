var hive = require('@hiveio/hive-js');
const mongodb = require('mongodb');
const fetch = require('node-fetch');
require('dotenv').config();

//connect to mongodb
const MongoClient = mongodb.MongoClient;
const url = process.env.MONGO_URL;
const dbName = 'terracore';
const SYMBOL = 'SCRAP';

const wif = process.env.ACTIVE_KEY;


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


async function register(username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username: username });
    if (user) {
        console.log(username + ' already exists');
        return false;
    }
    let result = await collection.insertOne({username: username , favor: 0, scrap: 0, health: 10, damage: 1, defense: 1, engineering:1, cooldown: Date.now(), minerate: 0.0001, attacks: 3, lastregen: Date.now(), claims: 3, lastclaim: Date.now()});
    console.log('New User ' + username + ' now registered');
    return true;

}

//store hash in mongo collection that stores all regsitration hashes
async function storeHash(hash, username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('registrations');
    let result = await collection.insertOne({hash: hash, username: username, time: Date.now()});
    console.log('Hash ' + hash + ' stored');
}

//engineering upgrade
async function engineering(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username : username });

    //check if user exists
    if (!user) {
        return;
    }

    let cost = Math.pow(user.engineering, 2);

    //new minerate is old minerate + 10% of old minerate
    var newrate = user.minerate + (user.minerate * 0.1);

    if (quantity == cost){
        await collection.updateOne({username: username}, {$inc: {engineering: 1}});
        await collection.updateOne({username: username }, {$set: {minerate: newrate}});
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

    let cost = Math.pow(user.damage, 2);

    if (quantity == cost){
        let result = await collection.updateOne({username: username}, {$inc: {damage: 1}});
    }
}

//defense upgrade
async function defense(username, quantity) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    let user = await collection.findOne({ username : username });

    //check if user exists
    if (!user) {
        return;
    }
    let cost = Math.pow(user.defense, 2);

    if (quantity == cost){
        let result = await collection.updateOne({username : username}, {$inc: {defense: 1}});
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


}


//claim reset function
async function resetClaims(username) {
    let client = await MongoClient.connect(url, { useNewUrlParser: true });
    let db = client.db(dbName);
    let collection = db.collection('players');
    await collection.updateOne({ username: username }, { $inc: { claims: -1 }, $set: { cooldown: Date.now(), scrap: 0 } });
    console.log('claims reset for ' + username);
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
    //make sure last claim was longer than 30 seconds ago
    if (Date.now() - user.lastclaim < 30000) {
        console.log('User ' + username + ' has to wait 30 seconds between claims');
        return;
    }

    await resetClaims(username);

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
        });

    }

}



hive.api.streamOperations(function(err, result) {

    //listen for register event
    if (result[0] == 'transfer' && result[1].to == 'terracore') {
        console.log(result[1]);
        //split memo at - and save first part as event second as hash
        var memo = {
            event: result[1].memo.split('-')[0],
            hash: result[1].memo.split('-')[1]
        }

        if (result[1].to == 'terracore' && memo.event == 'register' && result[1].amount == '0.001 HIVE') {
            var registered = register(result[1].from);
            if (registered) {
                storeHash(memo.hash, result[1].from);
            }
        }
    
    }

    if (result[0] == 'custom_json' && result[1].id == 'claim') {
        console.log(result);
        //claim function
        claim(result[1].required_auths[0]);
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
