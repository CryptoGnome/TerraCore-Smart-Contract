var hive = require('@hiveio/hive-js');
const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const fetch = require('node-fetch');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
require('dotenv').config();
var seedrandom = require('seedrandom');

//connect to Webhook using retry on limit
const hook = new Webhook(process.env.DISCORD_WEBHOOK);
//seciondary webhook for registrations
const hook2 = new Webhook(process.env.DISCORD_WEBHOOK_2);
//hook for quest completions
const hook3 = new Webhook(process.env.DISCORD_WEBHOOK_3);


const dbName = 'terracore';
const SYMBOL = 'SCRAP';
const wif = process.env.ACTIVE_KEY;


var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000 });
const db = client.db(dbName);

const nodes = ['https://hive-api.arcange.eu', 'https://api.deathwing.me', 'https://api.hive.blog', 'https://anyx.io', 'https://hived.emre.sh', 'https://api.openhive.network', 'https://api.hive.blue', 'https://anyx.io', 'https://techcoderx.com'];



async function testNodeEndpoints(nodes) {
    let fastestEndpoint = '';
    let fastestResponseTime = Infinity;

    // Check if there is a last node set in the node db
    let collection = db.collection('nodes');
    
    // Check what the last node was
    let lastNode = await collection.findOne({ name: 'lastNode' });

    // Remove last node from nodes array, if it exists
    if (lastNode) {
        nodes = nodes.filter(endpoint => endpoint !== lastNode.endpoint);
    }

    // Test each endpoint for response time
    for (const endpoint of nodes) {
        lastevent = Date.now();
        lastCheck = Date.now(); 
        hive.api.setOptions({ url: endpoint });
        const startTime = Date.now();

        try {
            await new Promise((resolve, reject) => {
            hive.api.getState('/', (err, result) => {
                if (err) {
                console.error(`${endpoint} error: ${err.message}`);
                reject(err);
                } else {
                const responseTime = Date.now() - startTime;
                console.log(`${endpoint}: ${responseTime}ms`);
                
                if (responseTime < fastestResponseTime) {
                    fastestResponseTime = responseTime;
                    fastestEndpoint = endpoint;
                }

                resolve(result);
                }
            });
        });
        } catch (error) {
            // Handle errors if necessary
        }
    }

    // Log the fastest endpoint
    console.log(`Fastest endpoint: ${fastestEndpoint} (${fastestResponseTime}ms)`);
    hive.api.setOptions({ url: fastestEndpoint });

    // Set the fastest node as active in the database
    if (fastestEndpoint) {
    await collection.updateOne(
        { name: 'lastNode' },
        { $set: { endpoint: fastestEndpoint } },
        { upsert: true }
    );
    }

    return;
}

async function changeNode() {
    await testNodeEndpoints(nodes);
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
    let collection = db.collection('players');
    let totalPlayers = await collection.countDocuments();

    //from stats collection, find the total players registered today
    collection = db.collection('stats');
    let todaysPlayers = await collection.findOne({ date: new Date().toISOString().slice(0, 10) });
    if (todaysPlayers) {
        todaysPlayers = todaysPlayers.players;
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
async function webhook3(title, common, uncommon, rare, epic, legendary) {
    //send embed to discord
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Common Relics: ', common, true)
        .addField('Uncommon Relics: ', uncommon, false)
        .addField('Rare Relics: ', rare, false)
        .addField('Epic Relics: ', epic, false)
        .addField('Legendary Relics: ', legendary, false)
        .setColor('#00ff00')
        .setTimestamp();
    try {
        hook3.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }

}  
async function webhook4(title, msg) {
    //send embed to discord red color
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', msg, true)
        .setColor('#ff0000')
        .setTimestamp();
    try {
        hook3.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }

}  



//switch this to look at DB
async function scrapStaked(username) {
    try{
        let collection = db.collection('players');

        //find the player
        let player = await collection.findOne({ username: username });
        if (player) {
            return player.hiveEngineStake
        } else {
            return 0;
        }
    } catch (error) {   
        console.log(error);
    }

}

//pay refferrer
async function payReferrer(referrer, username, amount) {
    try {
        console.log('Paying ' + referrer + ' for referring ' + username + ' ' + amount + ' HIVE');
        const xfer = new Object();
        xfer.from = "terracore";
        xfer.to = referrer;
        xfer.amount = amount;
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

async function register(username, referrer, amount) {
    try{
        //cehck if amount == registration_fee in price_feed db
        let registration_fee_query = await db.collection('price_feed').findOne({date: "global"});
        let registration_fee = registration_fee_query.registration_fee;
        let referrer_fee = registration_fee_query.referral_fee;    
        
        //remove HIVE from registration_fee string with 3 decimal places
        registration_fee = parseFloat(registration_fee.split(' ')[0]).toFixed(3);
        amount = parseFloat(amount.split(' ')[0]).toFixed(3);

        console.log('Amount: ' + amount + ' Registration Fee: ' + registration_fee);
        if (amount < registration_fee) {
            console.log('Amount does not match registration fee');
            //await refund(username, amount);
            return false;
        }
        

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


        if (referrer != 'terracore' && referrer != username && referrer !== undefined) {
            webhook2('A New Citizen of Terracore has Registered', username + ' was invited by ' + referrer, 0x00ff00);
            payReferrer(referrer, username, referrer_fee);
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
async function sendTransaction(username, type, target, blockId, trxId, hash) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('transactions');
        let result = await collection.insertOne({username: username, type: type, target: target, blockId: blockId, trxId: trxId, hash: hash, time: Date.now()});
        console.log('Transaction ' + result.insertedId + ' added to queue');
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

//create a function that can be called to send all transactions in the queue
async function sendTransactions() {
    try{
        lastCheck = Date.now();
        let collection = db.collection('transactions');
        let transactions = await collection.find({})
        .sort({ time: 1 })
        .toArray()

        //check if there are any transactions to send
        if(transactions.length != 0) {
            console.log('-------------------------------------------------------')
            console.log('Sending ' + transactions.length + ' transactions');
            console.log('-------------------------------------------------------')
            for (let i = 0; i < transactions.length; i++) {
                lastCheck = Date.now();
                let transaction = transactions[i];
                console.log('Sending ' + transaction.type + ' transaction ' + (i+ 1).toString() + ' of ' + transactions.length.toString());
                if(transaction.type == 'claim') {
                    while(true){
                        //const result = await Promise.race([claim(transaction.username), timeout(5000)]);
                        const result = await claim(transaction.username);
                        if(result) {
                            let maxAttempts = 3;
                            let delay = 3000;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if(clear.deletedCount == 1){
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.2; // exponential backoff  
                                
                            }
                        }
                        break;
                    }
                }
                else if(transaction.type == 'battle') {
                    while(true){
                        var result2 = await battle(transaction.username, transaction.target, transaction.blockId, transaction.trxId, transaction.hash);
                        //const result2 = await Promise.race([battle(transaction.username, transaction.target, transaction.blockId, transaction.trxId, transaction.hash), timeout(3000)]);
                        if(result2) {
                            let maxAttempts = 3;
                            let delay = 3000;
                            for (let i = 0; i < maxAttempts; i++) {
                                let clear = await collection.deleteOne({ _id: transaction._id });
                                if(clear.deletedCount == 1){
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, delay));
                                delay *= 1.2; // exponential backoff
                            }
                        }
                        break;
                    }
                }
                else if(transaction.type == 'progress') {
                    await progressQuest(transaction.username, transaction.blockId, transaction.trxId);
                    await collection.deleteOne({ _id: transaction._id });
                }
                else if(transaction.type == 'complete') {
                    await completeQuest(transaction.username);
                    await collection.deleteOne({ _id: transaction._id });
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
            setTimeout(checkTransactions, 200);
        }
    }
    catch (err) {
        client.close();
        process.exit(1);
    }
}

async function performUpdate(collection, username, user) {
    while (true) {
        const updateResult = await collection.findOneAndUpdate(
            { username, claims: { $gt: 0 }, lastPayout: { $lt: Date.now() - 30000 } },
            {
                $set: { scrap: 0, claims: user.claims - 1, lastPayout: Date.now() },
                $inc: { version: 1 }
            },
            { returnOriginal: false }
        );

        if (updateResult.value) {
            return true; // Successful update
        }

    }
}

//claim favorcheckDodge
async function claim(username) {
    try {
        const collection = db.collection('players');
        const user = await collection.findOne({ username });

        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }

        if (user.claims === 0) {
            console.log('User ' + username + ' has no claims left');
            return true;
        }

        //check if user.lastPayout exists if not add it to the user object
        if (!user.lastPayout) {
            await collection.updateOne({ username }, { $set: { lastPayout: Date.now() - 60000 } });
        }
            

        if ((Date.now() - user.lastPayout) < 30000) {
            return true;
        }
        

        const qty = user.scrap.toFixed(8);
        const data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol: 'SCRAP',
                to: username,
                quantity: qty.toString(),
                memo: 'terracore_claim_mint'
            }
        };


        const claimSuccess = await hive.broadcast.customJsonAsync(wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));

        if (!claimSuccess) {
            await collection.insertOne({username: username, qty: 'failed', time: Date.now()});
            return true;
        }

        await performUpdate(collection, username, user);

        await storeClaim(username, qty);
        webhook("Scrap Claimed", `${username} claimed ${qty} SCRAP`, '#6130ff');
        return true;
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            client.close();
            process.exit(1);
        }

        
        //webhook("Error", `Error claiming scrap for user ${username}. Error: ${err}`, '#ff0000');
        return false;
    }
}

//battle function
async function battle(username, _target, blockId, trxId, hash) {
    try{

        if(username == _target) {
            console.log('Error : Battle User: ' + username + ' tried to battle themselves');
            return true;
        }
        var collection = db.collection('players');
        var result = await collection.find({
            $or: [
                { username: username },
                { username: _target }
            ]
        }).toArray();
        
        var user = result.find(entry => entry.username === username);
        var target = result.find(entry => entry.username === _target);
        
        if (!user) {
            console.log('User ' + username + ' does not exist');
            return true;
        }
        
        if (!target) {
            console.log('Target ' + target + ' does not exist');
            return true;
        }

        //check if target.registrationTime exists
        if (target.registrationTime) {
            //check if target registrationTime is less than 24 hours ago
            if (Date.now() - target.registrationTime < 86400000) {
                //send webhook stating target is has new user protection inc version
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, dodged:false, timestamp: Date.now()});
                webhook("New User Protection", "User " + username + " tried to attack " + _target + " but they have new user protection", '#ff6eaf')
                return true;
            }
        }

        //check if target.consumable.protection > 0
        if (target.consumables.protection > 0) {
            //take the first timestamp of the protection array and check if it is less than 24 hours ago
            if (Date.now() - target.consumables.protection[0] < 86400000) {
                //send webhook stating target is has protection inc version
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, dodged:false, timestamp: Date.now()});
                webhook("Protection Potion Active!", "User " + username + " tried to attack " + _target + " but they have protection", '#ff6eaf')
                return true;
                
            }
         
        }

        //check if target.lastBattle does not exist
        if (!target.lastBattle) {
            //set to now - 60 seconds
            target.lastBattle = Date.now() - 60000;
            //inv version
            await collection.updateOne({ username: _target }, { $set: { lastBattle: target.lastBattle }, $inc: { version: 1 } });
        }
        

        //make sure target is not getting attacked withing 60 seconds of last payout
        if (Date.now() - target.lastBattle < 60000) {
            await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
            await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, dodged:false, timestamp: Date.now()});
            //webhook("Unable to attack target", "User " + username + " tried to attack " + _target + " but they are not back at the base yet...", '#ff6eaf')
            return true;
        }



        //check if user has more damage than target defense and attacks > 0 and has defense > 10 or if consumables.focus > 0
        if (user.stats.damage > target.stats.defense && user.attacks > 0 || user.consumables.focus > 0 && user.attacks > 0) {
            //check the amount of scrap users has staked
            var staked = await scrapStaked(username);
            var seed = await createSeed(blockId, trxId, hash);
            var roll = await rollAttack(user, seed);
            var scrapToSteal = target.scrap * (roll / 100);

            //give target a chance to ddodge based on toughness
            if (checkDodge(target) && user.consumables.focus == 0) {
                //send webhook stating target dodged attack
                await collection.updateOne({ username: username }, { $inc: { attacks: -1 , version: 1 } });
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, seed: seed, roll: roll, dodged:true, timestamp: Date.now()});
                webhook("Attack Dodged", "User " + username + " tried to attack " + _target + " but they dodged the attack", '#ff6eaf')
                return true;
            }

            //check if user has focus if so remove it as it is used for this attack 
            if (user.consumables.focus > 0) {
                await collection.updateOne({ username: username }, { $inc: { 'consumables.focus': -1 , version: 1 } });
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
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, dodged:false, timestamp: Date.now()});
                return true;
            }

            //make sure scrapToSteal is not less than 0
            if (scrapToSteal <= 0) {
                //shoot error webhook
                webhook("New Error", "User " + username + " tried to attack " + _target + " but scrapToSteal is less than or = 0, please try again", '#6385ff')
                await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: 0, dodged:false, timestamp: Date.now()});
                return true;
            }

            
            try{
                let newScrap = user.scrap + scrapToSteal;
                let newTargetScrap = target.scrap - scrapToSteal;
                let newAttacks = user.attacks - 1;
                //modify target scrap & add to user scrap
                let maxAttempts = 3;
                let delay = 700;
                for (let i = 0; i < maxAttempts; i++) {
                    //inc versions
                    const bulkOps = [
                        { updateOne: { filter: { username: _target }, update: { $set: { scrap: newTargetScrap }, $inc: { version: 1 } } } },
                        { updateOne: { filter: { username: username }, update: { $set: { scrap: newScrap, attacks: newAttacks, lastBattle: Date.now() } , $inc: { version: 1 } } } }
                    ];
                    const result = await collection.bulkWrite(bulkOps);
                    //check if update was successful frim above result
                    if (result.modifiedCount == 2) {
                        await db.collection('battle_logs').insertOne({username: username, attacked: _target, scrap: scrapToSteal, seed: seed, roll: roll, timestamp: Date.now()});
                        webhook("New Battle Log", 'User ' + username + ' stole ' + scrapToSteal.toString() + ' scrap from ' + _target + ' with a ' + roll.toFixed(2).toString() + '% roll chance', '#f55a42');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.2; // exponential backoff
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
            webhook("New Error", " Line: 681 Error: " + err, '#6385ff');
            return true;
        }
    }
}

function checkDodge(_target) {
    // Check if attack is dodged
    var roll = Math.floor(Math.random() * 100) + 1;
    if (roll < _target.stats.dodge) {
        return true;
    }
    else {
        return false;
    }
}

function rollAttack(_player, seed) {
    var rng = seedrandom(seed);
    var roll = rng();
    // Generate a random number let steal = Math.floor(Math.random() * (100 - _player.stats.crit + 1)) + _player.stats.crit; //dont floor
    var steal = roll * (100 - _player.stats.crit + 1) + _player.stats.crit;
    if (steal > 100) {
      steal = 100;
    }

    return steal;
}
  
////////////////////////////////////////////////////
////////////
/////////// Quest  Functions
//////////
///////////////////////////////////////////////////
//function to create a seed from blockId & trxId to make verifiable random number using the Hive blockchain
async function createSeed(blockId, trxId, hash) {
    //create seed from blockId & trxId
    var seed = blockId + '@' + trxId + '@'  + hash;
    //return seed
    return seed;
}

async function rollDice(index, seed = null) {

    //if there is a seed value then use it to generate a random number
    if (seed !== null) {
        const rng = seedrandom(seed.toString(), {state: true});
        //roll a number using rng that can be reproduced using the seed
        const result = rng() * (index - 0.01 * index) + 0.01 * index;
        return result;

    }

    const result = Math.random() * (index - 0.01 * index) + 0.01 * index;

    return result;
}
  

async function progressQuest(username, blockId, trxId) {
    //check if user has a quest already
    //if so return false else insert quest into active-quests collection
    try{
        //check if user is in active-quests collection
        let collection = db.collection('active-quests');
        let quest = await collection.findOne({ username: username });
        //get username from players collection
        let _username = await db.collection('players').findOne({ username: username });

        if (quest) {
            //check if quest has time if not add time
            if (!quest.time) {
                //create unix timestamp
                console.log('Quest does not have time');
                quest.time = Date.now();
                //update quest with time
                await collection.updateOne({ username: username }, { $set: { time: quest.time } });
            }

            //make sure more 3 sec
            if (quest.time + 3000 < Date.now()) {
                //before progressing quest let's make a roll to see if the quest is successful
                var seed = await createSeed(blockId, trxId, quest.round.toString());
                var roll = await rollDice(1, seed);
                if(roll < quest.success_chance) {
                    console.log('Quest was successful for user ' + username, ' with a roll of ' + roll.toFixed(2).toString() + ' and a success chance of ' + quest.success_chance.toFixed(2).toString());
                    //quest was successful
                    if(_username) {
                        var activeQuest;
                        //user already has a quest lets start from the current round
                        activeQuest = await selectQuest(quest.round + 1, _username);
                        //take the rewards from the quest and add them to values in activeQuest
                        activeQuest.common_relics += quest.common_relics;
                        activeQuest.uncommon_relics += quest.uncommon_relics;
                        activeQuest.rare_relics += quest.rare_relics;
                        activeQuest.epic_relics += quest.epic_relics;
                        activeQuest.legendary_relics += quest.legendary_relics;

                        //replace current quest with new quest
                        collection.replaceOne({ username: username }, activeQuest);

        

                        //log quest progress
                        await db.collection('quest-log').insertOne({username: username, action: 'progress', quest: activeQuest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date()});

                        return true;

                    
                    }
                    else {
                        console.log('User ' + username + ' does not exist');
                        return false;
                    }
                }
                else {
                    //quest failed
                    //remove quest from active-quests collection
                    console.log('Quest failed for user ' + username, ' with a roll of ' + roll.toFixed(2).toString() + ' and a success chance of ' + quest.success_chance.toFixed(2).toString());
                    await db.collection('quest-log').insertOne({username: username, action: 'failed', quest: quest, roll: roll, success_chance: quest.success_chance, seed: seed, time: new Date()});
                    await collection.deleteOne({ username: username });
                    webhook4("Quest Failed", "Quest Failed for " + username + " with a roll of " + roll.toFixed(2).toString() + " and a success chance of " + quest.success_chance.toFixed(2).toString());
                    return false;
                }
            }
            else {
                console.log('Quest for user ' + username + ' has not been 3 seconds since last progress');
                return false;
            }
        }
        else {
            console.log('User ' + username + ' does not have a quest yet please use startQuest');
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
            return false;
        }
    }
}

async function selectQuest(round, user) {
    //go into quest-template collection and select a random quest then add it to users current quest
    try{
        let collection = db.collection('quest-template');
        let quests = await collection.find({}).toArray();

        //select a random quest
        var random_quest = quests[Math.floor(Math.random() * quests.length)];

        //choose a random attribute based on round
        var availableAttributes = ["damage", "defense", "engineering", "dodge", "crit", "luck"];
        var attribute_one = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
        availableAttributes = availableAttributes.filter(item => item !== attribute_one);
        var attribute_two = availableAttributes[Math.floor(Math.random() * availableAttributes.length)];

        //come up with base stats for the quest these should scale based on the round
        var base_stats = {
            "damage": 20 * round,
            "defense": 20 * round,
            "engineering": 2 * round,
            "dodge": round,
            "crit": round,
            "luck": round
        };


        //base success chance
        var success_chance = 0.80;

        //for every round remove 1% chance of success
        for (let i = 1; i < round; i++) {
            success_chance -= 0.01;
        }

        //create multiplier that can be used to scale the stats based on the round
        var multiplier = round * 2;

        //go through each stat and add to success chance
        for(var key in user.stats) {
            if(key == attribute_one || key == attribute_two) {
                //check of stat is greater than base stat
                if(user.stats[key] > base_stats[key]) {
                    //add to success chance
                    success_chance += 0.1;
                }
            }
        }


        
        //if round is greater than 1 roll for rewards, rewards should scale based on round
        if (round > 0) {
            //roll float for rewards between 0 and 1
            var roll = await rollDice(1);

            var common_relics = 0;
            var uncommon_relics = 0;
            var rare_relics = 0;
            var epic_relics = 0;
            var legendary_relics = 0;

            var relic_types = 1;

            if (round > 4) {
                if (roll < 0.5) {
                    relic_types = 2;
                }
                for (let i = 0; i < relic_types; i++) {
                    //make  roll for relics
                    roll = await rollDice(1);
                    //4% chance for epic relic
                    if (roll <= 0.04) {
                        roll = await rollDice(1);
                        epic_relics = (roll * 10) * multiplier/128;
                    }
                    //15% chance for rare relic
                    else if (roll <= 0.19) {
                        roll = await rollDice(1);
                        rare_relics = (roll * 10) * multiplier/128;
                    }
                    //22% chance for uncommon relic
                    else if (roll <= 0.41) {
                        roll = await rollDice(1);
                        uncommon_relics = (roll * 10) * multiplier/128;
                    }
                    else {
                        roll = await rollDice(1);
                        common_relics = (roll * 10) * multiplier/128;
                    }
                
                }
            }
            if (round > 9) {
                if (roll < 0.75) {
                    relic_types = 1
                }
                else if (roll < 0.5) {
                    relic_types = 2;
                }
                for (let i = 0; i < relic_types; i++) {
                   roll = await rollDice(1);
                    //2.5% chance for legendary relic
                    if (roll <= 0.025) {
                        roll = await rollDice(1);
                        legendary_relics = (roll * 10) * multiplier/256;
                    }
                    //7.5% chance for epic relic
                    else if (roll <= 0.1) {
                        roll = await rollDice(1);
                        epic_relics = (roll * 10) * multiplier/256;
                    }
                    //15% chance for rare relic
                    else if (roll <= 0.25) {
                        roll = await rollDice(1);
                        rare_relics = (roll * 10) * multiplier/256;
                    }
                    //25% chance for uncommon relic
                    else if (roll <= 0.525) {
                        roll = await rollDice(1);
                        uncommon_relics = (roll * 10) * multiplier/256;
                    }
                    else {
                        roll = await rollDice(1);
                        common_relics = (roll * 10) * multiplier/128;
                    }
                   
                }

            }
            if (round > 15) {
                relic_types = 1;
                if (roll < 0.95) {
                    relic_types = 1;
                }
                else if (roll < 0.75) {
                    relic_types = 2
                }
                else if (roll < 0.25) {
                    relic_types = 3;
                }

                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    //5% chance for legendary relic
                    if (roll <= 0.05) {
                        roll = await rollDice(1);
                        legendary_relics = (roll * 10) * multiplier/256;
                    }
                    //10% chance for epic relic
                    else if (roll <= 0.15) {
                        roll = await rollDice(1);
                        epic_relics = (roll * 10) * multiplier/256;
                    }
                    //20% chance for rare relic
                    else if (roll <= 0.35) {
                        roll = await rollDice(1);
                        rare_relics = (roll * 10) * multiplier/128;
                    }
                    //30% chance for uncommon relic
                    else if (roll <= 0.65) {
                        roll = await rollDice(1);
                        uncommon_relics = (roll * 10) * multiplier/64;
                    }
                    else {
                        roll = await rollDice(1);
                        common_relics = (roll * 10) * multiplier/64;
                    }
                }
            }
            if (round > 18) {
                relic_types = 1;
                if (roll < 0.80) {
                    relic_types = 2;
                }
                else if (roll < 0.60) {
                    relic_types = 3;
                }
                else if (roll < 0.40) {
                    relic_types = 4;
                }
                else if (roll < 0.20) { 
                    relic_types = 5;
                }

                for (let i = 0; i < relic_types; i++) {
                    roll = await rollDice(1);
                    //5% chance for legendary relic
                    if (roll <= 0.05) {
                        roll = await rollDice(1);
                        legendary_relics = (roll * 10) * multiplier/128;
                    }
                    //10% chance for epic relic
                    else if (roll <= 0.15) {
                        roll = await rollDice(1);
                        epic_relics = (roll * 10) * multiplier/128;
                    }
                    //20% chance for rare relic
                    else if (roll <= 0.35) {
                        roll = await rollDice(1);
                        rare_relics = (roll * 10) * multiplier/64;
                    }
                    //30% chance for uncommon relic
                    else if (roll <= 0.65) {
                        roll = await rollDice(1);
                        uncommon_relics = (roll * 10) * multiplier/64;
                    }
                    else {
                        roll = await rollDice(1);
                        common_relics = (roll * 10) * round/32;
                    }
                }

            }
            else{
                relic_types = 1;
                for (let i = 0; i < relic_types; i++) {
                    //make  roll for relics
                    roll = await rollDice(1);
                    // 5% epic
                    if (roll <= 0.05) {
                        roll = await rollDice(1);
                        epic_relics = (roll * 10) * multiplier/64;
                    }
                    // 15% rare
                    else if (roll <= 0.2) {
                        roll = await rollDice(1);
                        rare_relics = (roll * 10) * multiplier/64;
                    }
                    // 30% uncommon
                    else if (roll <= 0.5) {
                        roll = await rollDice(1);
                        uncommon_relics = (roll * 10) * multiplier/32;
                    }
                    // 50% common
                    else {
                        roll = await rollDice(1);
                        common_relics = (roll * 10) * multiplier/16;
                    }

             
                }
            }



        }
        else {
            var common_relics = 0;
            var uncommon_relics = 0;
            var rare_relics = 0;
            var epic_relics = 0;
            var legendary_relics = 0;
        }

        //log scraps, and shards to console
        console.log('------------------------------------------------------');
        console.log('Round: ' + round.toString() + ' Success Chance: ' + success_chance.toString() + ' for user: ' + user.username);
        console.log('Common Relics: ' + common_relics.toString());
        console.log('Uncommon Relics: ' + uncommon_relics.toString());
        console.log('Rare Relics: ' + rare_relics.toString());
        console.log('Epic Relics: ' + epic_relics.toString());
        console.log('Legendary Relics: ' + legendary_relics.toString());
        //create new quest object
        var quest = {
            "username": user.username,
            "name": random_quest.name,
            "description": random_quest.description,
            "image": random_quest.image,
            "round": round,
            "success_chance": success_chance,
            "attribute_one": attribute_one,
            "attribute_two": attribute_two,
            "attribute_one_value": base_stats[attribute_one],
            "attribute_two_value": base_stats[attribute_two],
            "common_relics": common_relics,
            "uncommon_relics": uncommon_relics,
            "rare_relics": rare_relics,
            "epic_relics": epic_relics,
            "legendary_relics": legendary_relics,
            "time": Date.now()
        }
  
        //return quest
        return quest;

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

async function completeQuest(username) {
    //check if user has a quest already
    //if so return false else insert quest into active-quests collection
    try{
        //check if user is in active-quests collection
        let collection = db.collection('active-quests');
        let user = await collection.findOne({ username: username });
        console.log(user);
        if (user) {
            await db.collection('quest-log').insertOne({username: username, action: 'complete', rewards: user, time: new Date()});
            if (user.common_relics > 0) {
                await issue(username, 'common_relics', user.common_relics);
            }
            if (user.uncommon_relics > 0) {
                await issue(username, 'uncommon_relics', user.uncommon_relics);
            }
            if (user.rare_relics > 0) {
                await issue(username, 'rare_relics', user.rare_relics);
            }
            if (user.epic_relics > 0) {
                await issue(username, 'epic_relics', user.epic_relics);
            }
            if (user.legendary_relics > 0) {
                await issue(username, 'legendary_relics', user.legendary_relics);
            }
 
        }
        else {
            console.log('User ' + username + ' does not have a quest yet please use startQuest');
            return false;
        }

        //remove quest from active-quests collection
        await collection.deleteOne({ username: username });
        
        webhook3('User ' + username + ' has completed their quest at round ' + user.round.toString(), user.common_relics.toString(), user.uncommon_relics.toString(), user.rare_relics.toString(), user.epic_relics.toString(), user.legendary_relics.toString());

        //return true
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

//issue relic tokens to player collection
async function issue(username, type, amount){
    try{
        //see if user exists
        var db = client.db(dbName);
        var collection = db.collection('relics');
        let player = await collection.findOne({ username : username , type: type });
        if (!player) {
            //insert player into collection with   "market": {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
            return true;
        }
        //update player collection adding relics to player9
        await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
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
            return true;
        }
    }
}


//async function to clear transactions from queue
async function clearTransactions() {
    //connect to db
    try{
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



//test();
var lastevent = Date.now();
var lastCheck = Date.now();
//aysncfunction to start listening for events
async function listen() {
    //await clearFirst();
    changeNode();
    checkTransactions();

    hive.api.streamBlock(async function (err, result) {
        try {
            
            if (!result || !result.transactions || !result.block_id) {
                return;
            }
            

            const blockId = result.block_id
    
            for (const transaction of result.transactions) {
                const trxId = transaction.transaction_id
                //loop through operations in transaction
                for (const operation of transaction.operations) {
                    //timestamp of last event
                    lastevent = Date.now();
                    lastCheck = Date.now(); 
                    //console.log(operation);
                    if (operation[0] == 'transfer' && operation[1].to === 'terracore') {
                        //grab hash from memo
                        var memo = JSON.parse(operation[1].memo);
                        //check if memo is register
                        if(memo.hash.includes('terracore_register')){
                            //split hash to get hash
                            var hash = memo.hash.split('-')[1];
                            var referrer = memo.referrer;
                            if (operation[1].to == 'terracore') {
                                var registered = register(operation[1].from, referrer, operation[1].amount);
                                if (registered) {
                                    storeRegistration(hash, operation[1].from);
                                }
                            }
                        }
                    
                    }
                    if (operation[0] == 'custom_json' && operation[1].id === 'terracore_claim') {
                        //grab the json from result[1].json
                        var data = JSON.parse(operation[1].json);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
            
                        //claim function
                        await sendTransaction(user, 'claim', 'none');
                    }
                    if (operation[0] == 'custom_json' && operation[1].id === 'terracore_battle') {
                    
                        var data = JSON.parse(operation[1].json);
                        //get target from data
                        var target = data.target;
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }

                        //get the index of data in transaction.operations 
                        //var hash = transaction.operations.indexOf(operation);
                
                        
                        await sendTransaction(user, 'battle', target, blockId, trxId, Date.now());
                        
                    }  
                    if (operation[0] == 'custom_json' && operation[1].id === 'terracore_quest_progress') {
                        //console.log(result);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
                        sendTransaction(user, 'progress', 'none', blockId, trxId, hash);
                    }
                    if (operation[0] == 'custom_json' && operation[1].id === 'terracore_quest_complete') {
                        //console.log(result);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
                        //completeQuest(user);
                        sendTransaction(user, 'complete', 'none');
                        
                    }
                }


            
            }
        }
        catch(err) {
            console.log(err);
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
    if (Date.now() - lastCheck > 60000) {
        console.log('Error : No events received in 60 seconds, shutting down so PM2 can restart & try to reconnect to Resolve...');
        client.close();
        process.exit();
    }
}, 1000);

