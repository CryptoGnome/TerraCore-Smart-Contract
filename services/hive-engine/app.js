const SSC = require('sscjs');
const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const fetch = require('node-fetch');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const { api } = require('@hiveio/hive-js');;
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

//connect to Webhook
const hook = new Webhook(process.env.HE_DISCORD_WEBHOOK);
const market_hook = new Webhook(process.env.HE_MARKET_WEBHOOK);
const boss_hook = new Webhook(process.env.HE_BOSS_WEBHOOK);
const forge_hook = new Webhook(process.env.HE_FORGE_WEBHOOK);
const wif = process.env.ACTIVE_KEY;
const dbName = 'terracore';
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30000 });
const db = client.db(dbName);

const { findNode, updateNodesFromBeacon, validateNode, fallbackNodes } = require('../../shared/he-node');
var node;

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
        return obj.reduce((arr, item, i) => {
            arr[i] = deepClone(item);
            return arr;
        }, []);
    }

    if (obj instanceof Object) {
        return Object.keys(obj).reduce((newObj, key) => {
            newObj[key] = deepClone(obj[key]);
            return newObj;
        }, {});
    }

    throw new Error(`Unable to copy object: ${obj}`);
}

function deepEqual(a, b) {
    // Convert NaN to 0 for comparison purposes
    a = Number.isNaN(a) ? 0 : a;
    b = Number.isNaN(b) ? 0 : b;

    if (a === b) return true;

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (let key of keysA) {
        if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
            return false;
        }
    }

    return true;
}

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

async function marketWebhook(title, message, color) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        market_hook.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }   
}
async function bossWebhook(title, message, rarity, planet) {
    //check if stats are null
    var embed;
    var id;
    
    //color select based on rarity
    switch (rarity) {
        case 'common':
            color = '#bbc0c7';
            id = 'common_crate';
            break;
        case 'uncommon':
            color = '#538a62';
            id = 'uncommon_crate';
            break;
        case 'rare':
            color = '#2a2cbd';
            id = 'rare_crate';
            break;
        case 'epic':
            color = '#7c04cc';
            id = 'epic_crate';
            break;
        case 'legendary':
            color = '#d98b16';
            id = 'legendary_crate';
            break;
    }

    //set image
    embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Planet: ', planet, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
        .setTimestamp();
    
    try {
        await boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }

}

async function bossWebhook2(title, message, rarity, planet, type) {
    //check if stats are null
    var embed;
    var id;
    
    //color select based on rarity
    switch (rarity) {
        case 'common':
            color = '#bbc0c7';
            id = 'common_crate';
            break;
        case 'uncommon':
            color = '#538a62';
            id = 'uncommon_crate';
            break;
        case 'rare':
            color = '#2a2cbd';
            id = 'rare_crate';
            break;
        case 'epic':
            color = '#7c04cc';
            id = 'epic_crate';
            break;
        case 'legendary':
            color = '#d98b16';
            id = 'legendary_crate';
            break;
    }

    //set image
    embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Planet: ', planet, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${type}.png`)
        .setTimestamp();
    
    try {
        await boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }

}

async function forgeWebhook(title, message) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor('#00ff00')
        .setTimestamp();
    try {
        forge_hook.send(embed).then(() => console.log('Sent webhook successfully!'))
        .catch(err => console.log(err.message));
    }
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }   
}

async function storeHash(hash, username, amount) {
    try{
        let collection = db.collection('hashes');
        await collection.insertOne({hash: hash, username: username, amount: parseFloat(amount), time: Date.now()});
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
async function storeRejectedHash(hash, username) {
    try{
        let collection = db.collection('rejectedHashes');
        await collection.insertOne({hash: hash, username: username, time: Date.now()});
        console.log('Rejected Hash ' + hash + ' stored');
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
//engineering upgrade
async function engineering(username, quantity) {
    try{

        let collection = db.collection('players');
        let user = await collection.findOne({ username : username });

        if (!user) {
            return true;
        }
        let cost = Math.pow(user.engineering, 2);
        let newEngineer = user.engineering + 1;


        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost){ 
                let update = await collection.updateOne({username: username}, {$set: {engineering: newEngineer, last_upgrade_time: Date.now()}, $inc: {version: 1, experience: parseFloat(cost)}});
                if(update.acknowledged == true && update.modifiedCount == 1) {
                    webhook('Engineering Upgrade', username + ' upgraded engineering to level ' + newEngineer, 0x00ff00);
                    return true;
                }
            }
            else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5; // exponential backoff  
        }
        //if we get here, we've tried maxAttempts times
        return false;
    }
    catch (err) {
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection closed');
            process.exit(1);
        }
        else {
            webhook('Error', 'Error upgrading engineering for ' + username + ' ' + err, '#ff0000');
        }
    }

}
//defense upgrade
async function defense(username, quantity) {
    try{
        let collection = db.collection('players');
        let user = await collection.findOne({ username : username });

        if (!user) {
            return true;
        }

        let cost = Math.pow(user.defense/10, 2);
        let newDefense = user.defense + 10;

        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost){ 
                let update = await collection.updateOne({username: username}, {$set: {defense: newDefense, last_upgrade_time: Date.now()}, $inc: {version: 1, experience: parseFloat(cost)}});
                if(update.acknowledged == true && update.modifiedCount == 1) {                 
                    webhook('Defense Upgrade', username + ' upgraded defense to ' + newDefense, '#00ff00');
                    return true;
                }
            }
            else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5; // exponential backoff  
        }
        //if we get here, we've tried maxAttempts times
        return false;


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
//damage upgrade
async function damage(username, quantity) {
    try{
        let collection = db.collection('players');
        let user = await collection.findOne({ username : username });

        if (!user) {
            return true;
        }

        let cost = Math.pow(user.damage/10, 2);
        let newDamage = user.damage + 10;

        let maxAttempts = 5;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            if (quantity == cost){ 
                let update = await collection.updateOne({username: username}, {$set: {damage: newDamage, last_upgrade_time: Date.now()}, $inc: {version: 1, experience: parseFloat(quantity)}});
                if(update.acknowledged == true && update.modifiedCount == 1) {
                    webhook('Damage Upgrade', username + ' upgraded damage to ' + newDamage, '#00ff00');
                    return true;
                }
            }
            else {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5; // exponential backoff  
        }
        //if we get here, we've tried maxAttempts times
        return false;
                
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
//contributor upgrade
async function contribute(username, quantity) {
    try{
        let collection = db.collection('players');
        let user = await collection.findOne({username: username});

        //check if user exists
        if (!user) {
            return true;
        }

        //check starting favor
        let qty = parseFloat(quantity);
        let newFavor = user.favor + qty;

        let maxAttempts = 3;
        let delay = 500;
        for (let i = 0; i < maxAttempts; i++) {
            let update = await collection.updateOne({username: username}, {$set: {favor: newFavor}, $inc: {version: 1, experience: qty}});
            if(update.acknowledged == true && update.modifiedCount == 1) {
                webhook('Contributor', username + ' contributed ' + qty + ' favor', '#00ff00');
                //update global favor 
                await globalFavorUpdate(qty);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5; // exponential backoff  
        }
        //if we get here, we've tried maxAttempts times
        return false;

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

//update global favor
async function globalFavorUpdate(qty){
    const stats = db.collection('stats');
    let maxAttempts = 3;
    let delay = 500;

    for (let i = 0; i < maxAttempts; i++) {
        const result = await stats.updateOne({ date: 'global' }, { $inc: { currentFavor: qty } });
        if (result.acknowledged == true && result.modifiedCount == 1) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2.5; // exponential backoff
    }
    return false;

}

////////////////////////////////////////////////////
////////////
/////////// Planet Functions
//////////
///////////////////////////////////////////////////

async function mintCrate(owner, _planet, droproll, luck){
    try{
        //load crate collection
        var collection = db.collection('crates');

        //roll a random number 1 - 1000
        var roll = Math.floor(Math.random() * 1001)
        console.log('Item Roll: ' + roll);
        //add second roll to decide if a create or consumable is minted
        var roll2 = Math.floor(Math.random() * 1001)
        console.log('Crate Roll: ' + roll2);
  
        //get rarity thresholds and values from planetConfig
        const planetConfig = {
            Terracore: {
                rarityThresholds: [950, 985, 995, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [900, 1000],
                dropValues: ['consumable', 'crate']
            },
            Oceana: {
                rarityThresholds: [949, 983, 993, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [750, 1000],
                dropValues: ['consumable', 'crate']
            },
            Celestia: {
                rarityThresholds: [948, 982, 992, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [750, 1000],
                dropValues: ['consumable', 'crate']
            },
            Arborealis: {
                rarityThresholds: [947.5, 981, 991, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [500, 1000],
                dropValues: ['consumable', 'crate']
            },
            Neptolith: {
                rarityThresholds: [947, 980.5, 990.5, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [750, 1000],
                dropValues: ['consumable', 'crate']
            },
            Solisar: {
                rarityThresholds: [930, 975, 993, 1000],
                rarityValues: ['uncommon', 'rare', 'epic', 'legendary'],
                dropThresholds: [750, 1000],
                dropValues: ['consumable', 'crate']
            }
        };

        function getRarityAndDrop(planet, roll, roll2) {
            const config = planetConfig[planet];
            if (!config) {
                throw new Error('Invalid planet');
            }
        
            const rarity = config.rarityValues.find((value, index) => roll <= config.rarityThresholds[index]);
            const drop = config.dropValues.find((value, index) => roll2 <= config.dropThresholds[index]);
        
            return { rarity, drop };
        }
        
        const { rarity, drop } = getRarityAndDrop(_planet, roll, roll2);

        console.log('Drop: ' + drop);

        //check type
        if (drop == 'crate') {           
            let count = await db.collection('crate-count').findOne({supply: 'total'});

            //create crate object
            let crate = new Object();
            crate.name = rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate';
            crate.rarity = rarity;
            crate.owner = owner;
            crate.item_number = count.count + 1;
            crate.image = "https://terracore.herokuapp.com/images/" + rarity + '_crate.png';
            crate.equiped = false;
            //add market object to crate
            let market = new Object();
            market.listed = false;
            market.price = 0;
            market.seller = null;
            market.created = 0;
            market.expires = 0;
            market.sold = 0;

            //add market object to crate
            crate.market = market;


            //add crate to database
            db.collection('crates').insertOne(crate);
            console.log('Minted crate: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
            bossWebhook('Crate Dropped!', crate.name + ' with rarity: ' + crate.rarity + ' has dropped from a boss for ' + crate.owner + '!' + ' Item Number: ' + crate.item_number, crate.rarity, _planet);
            await db.collection('crate-count').updateOne({supply: 'total'}, {$inc: {count: 1}});

            //log boss_log
            //await db.collection('boss-log').insertOne({username: username, planet: _planet, result: true, roll: roll, luck: luck, drop:drop_type, time: Date.now()});
            await db.collection('boss-log').insertOne({username: crate.owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: crate.rarity, drop: "crate", time: Date.now()});

            //log to nft-drops in mongoDB
            await db.collection('nft-drops').insertOne({name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: false, time: new Date()});
            return drop;
        }
        else if (drop == 'consumable') {
            var type;
            if (rarity == 'uncommon') {
                var types = ['attack', 'claim', 'crit', 'damage', 'dodge'];
                //choose random type
                type = types[Math.floor(Math.random() * types.length)];
            }
            else if (rarity == 'rare') {
                var types = ['rage', 'impenetrable', 'overload', 'rogue', 'battle', 'fury']
                //choose random type
                type = types[Math.floor(Math.random() * types.length)];
            }
            else{
                var types = ['protection', 'focus'];
                //choose random type
                type = types[Math.floor(Math.random() * types.length)];
            }


            var collection = db.collection('consumables');
            let player = await collection.findOne({ username : owner , type: type + '_consumable' });
            //boss-log
            await db.collection('boss-log').insertOne({username: owner, planet: _planet, result: true, roll: droproll, luck: luck, rarity: rarity, drop: type + '_consumable', time: Date.now()});

            if (!player) {
                console.log('Player does not have consumable: ' + type + ' creating new entry');
                //insert player into collection with   "market": {
                await collection.insertOne({ username: owner, version: 1, type: type + '_consumable', amount: 1, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
                bossWebhook2('Consumable Dropped!', 'A ' + rarity + ' ' + type + ' consumable has dropped for ' + owner + '!', rarity, _planet, type + '_consumable');
                await db.collection('nft-drops').insertOne({name: type + '_consumable', rarity: rarity, owner: owner, item_number: null, purchased: false, time: new Date()});
                return drop;
            }

            //update player collection adding relics to player9
            console.log('Minted Consumable: ' + type + ' for ' + owner)
            await collection.updateOne({ username: owner, type: type + '_consumable' }, { $inc: { amount: 1 } });
            // webhook
            bossWebhook2('Consumable Dropped!', 'A ' + rarity + ' ' + type + ' consumable has dropped for ' + owner + '!', rarity, _planet, type + '_consumable');
            await db.collection('nft-drops').insertOne({name: type + '_consumable', rarity: rarity, owner: owner, item_number: null, purchased: false, time: new Date()});
            return drop;
        }
        


    }
    catch(err){
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        }
        else{
            console.log(err);
        }
    }
}
//functin to issue relics to user
async function issue(username, type, amount, rarity, planet){
    try{
        //see if user exists
        console.log('Issuing ' + amount + ' ' + type + ' to ' + username);
        var db = client.db(dbName);
        var collection = db.collection('relics');
        let player = await collection.findOne({ username : username , type: type });
        if (!player) {
            //insert player into collection with   "market": {
            await collection.insertOne({ username: username, version: 1, type: type, amount: amount, market: { listed: false, amount: 0, price: 0, seller: null, created: 0, expires: 0, sold: 0 } });
            //add to nft-drops
            await db.collection('nft-drops').insertOne({name: type, rarity: rarity, owner: username, amount: amount, item_number: null, purchased: false, time: new Date()});
            //boss webhook
            bossWebhook2('Relic Dropped!', `${amount} ${type}  have dropped for ${username}!`, rarity, planet, type);
            return true;
        }
        //update player collection adding relics to player9
        await collection.updateOne({ username: username, type: type }, { $inc: { amount: amount } });
        //add to nft-drops
        await db.collection('nft-drops').insertOne({name: type, rarity: rarity, owner: username, amount: amount, item_number: null, purchased: false, time: new Date()});
        //boss webhook
        bossWebhook2('Relic Dropped!', `${amount} ${type} have dropped for ${username}!`, rarity, planet, type);
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
//create a fucntion to roll to see if user gets a crate
async function bossFight(username, _planet) {
    try{
        await db.collection('players').updateOne({ username: username }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1, experience: 100 } });
        let collection = db.collection('players');
        let user = await collection.findOne({ username: username });
        var luck = 0;
        //check if user exists
        if (user == null) {
            console.log('User: ' + username + ' does not exist');
            return false;
        }
        else {
            //get luck
            luck = user.stats.luck;
            //get users level
            var level = user.level;

            //check if users level is greater than the level required to access the planet in the player boss_data
            var found = false;
            var index = 0;
            for (let i = 0; i < user.boss_data.length; i++) {
                if (user.boss_data[i].name == _planet) {
                    //check of the users level is greater than the level required to access the planet
                    if (level >= user.boss_data[i].level) {
                        found = true;
                        index = i;
                    }
                }
            }

            //if the user has access to the 
            if (found == true) {
                //check if the last battle was more than 4 hours ago
                if (Date.now() - user.boss_data[index].lastBattle < 14400000) {
                    console.log('User: ' + username + ' has already battled the boss in the last 4 hours');
                    return false;
                }
                else{
                
                    //roll a random number 0 -100 as a float
                    var roll = Math.random() * 100;

                    //if roll is greater than drop chance then return false
                    if (roll > luck) {
                        console.log("------  BOSS MISSED: Boss Drop Roll: " + roll + " | " + " Drop Max Roll: " + luck + " ------");
                        //set new lastBattle planet om the players boss_data
                        await collection.updateOne({ username: username }, { $set: { ["boss_data." + index + ".lastBattle"]: Date.now() } });
                        //roll random rarity and random amount of relics with a multiplier from luck with the max roll being 5 Relics
                        var rarity = null;
                        var amount = null;
                        var luck_mod = luck / 5;
                        var minThreshold = 0.1;
                        var roll2 = Math.random() * 100;
                        
                        //extar check if planet is terracore halve the luck
                        if(_planet == 'Terracore') {
                            luck_mod = luck_mod / 2;
                        }

                        if (roll2 <= 70) {
                            rarity = 'common';
                            amount = Math.max((Math.random() * 1.25 * luck_mod) + 1, minThreshold); 
                        }
                        else if (roll2 <= 90) {
                            rarity = 'uncommon';
                            amount = Math.max((Math.random() * 1 * luck_mod) + 1, minThreshold); 
                        }
                        else if (roll2 <= 98) {
                            rarity = 'rare';
                            amount = Math.max((Math.random() * 0.75 * luck_mod) + 1, minThreshold);
                        }
                        else if (roll2 <= 99) {
                            rarity = 'epic';
                            amount = Math.max((Math.random() * 0.5 * luck_mod) + 1, minThreshold); 
                        }
                        else {
                            rarity = 'legendary';
                            amount = Math.max(0.1 * luck_mod, minThreshold); 
                        }
                        //issue relics to user
                        await issue(username, rarity + '_relics', amount, rarity, _planet);
                        await db.collection('boss-log').insertOne({username: username, planet: _planet, result: false, roll: roll, luck: luck, drop: rarity + '_relics', amount: amount, time: Date.now()});

                        return false;
                    }
                    else {
                        console.log("------  ITEM FOUND: Boss Drop Roll: " + roll + " | " + " Drop Max Roll: " + luck + " ------");
                        //set new lastBattle planet om the players boss_data
                        await collection.updateOne({ username: username }, { $set: { ["boss_data." + index + ".lastBattle"]: Date.now() } });
                        await mintCrate(username, _planet, roll, luck);
                        return true;
                    }
                }

            }
            else {
                console.log('User: ' + username + ' does not have access to planet: ' + _planet);
                return false;
            }


        }
    }
    catch(err){
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        }
        else{
            console.log(err);
            return false;
        }
    }
}



////////////////////////////////////////////////////
////////////
/////////// QUEST FUNCTIONS
//////////
///////////////////////////////////////////////////
async function rollDice(index) {
    return Math.random() * (index - 0.01 * index) + 0.01 * index;
}
//start quest 
async function startQuest(username) {
    //check if user has a quest already
    //if so return false else insert quest into active-quests collection
    try{
        //check if user is in active-quests collection
        let collection = db.collection('active-quests');
        let user = await collection.findOne({ username: username });
        //get username from players collection
        let _username = await db.collection('players').findOne({ username: username });

        //add 10 Expereince to player
        await db.collection('players').updateOne({ username: username }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1, experience: 50 } });
   
        if(_username) {
            var activeQuest;
            if (!user) {
                //select a quest
                activeQuest = await selectQuest(1, _username);
                //add quest to active-quests collection
                await collection.insertOne(activeQuest);
                //log to quest-log in mongoDB
                await db.collection('quest-log').insertOne({username: username, action: 'start', quest: activeQuest, time: new Date()});
                return true;
            }
            else {
                console.log('User ' + username + ' already has a quest');
                return false;
            }
          
        }
        else {
            console.log('User ' + username + ' does not exist');
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
//create a function the selects quests 
//the functions for start & end will be in the HE contract
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
        var success_chance = 0.85;

        //for every round remove 10% chance of success
        for (let i = 0; i < round; i++) {
            success_chance -= 0.05;
        }

        //loop users stats and find attribute_one and attribute_two

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

            for (let i = 0; i < relic_types; i++) {
                //make  roll for relics
                roll = await rollDice(1);
                // 70% chance to get common relic
                if (roll <= 0.7) {
                    roll = await rollDice(1);
                    common_relics = (roll * 10) * round / 8;
                }
                // 30% chance to get uncommon relic
                else {
                    roll = await rollDice(1);
                    uncommon_relics = (roll * 10) * round / 8;
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
        };
  
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

////////////////////////////////////////////////////
////////////
/////////// NFT FUNCTIONS
//////////
///////////////////////////////////////////////////
async function buy_crate(owner, quantity){
    try{
        //load crate collection
        var collection = db.collection('price_feed');
        var price = await collection.findOne({date: "global"});

        if (quantity == price.price)
        {
            var rarity = 'common';
        }
        else {
            return true;
        }

        collection = db.collection('crates');
        //create crate object
        let crate = new Object();
        crate.name = rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Loot Crate';
        crate.rarity = rarity;
        crate.owner = owner;
        //finc count in supply:total
        let count = await db.collection('crate-count').findOne({supply: 'total'});
        
        crate.item_number = count.count + 1;
        crate.image = "https://terracore.herokuapp.com/images/" + rarity + '_crate.png';
        crate.equiped = false;
        //add market object to crate
        let market = new Object();
        market.listed = false;
        market.price = 0;
        market.seller = null;
        market.created = 0;
        market.expires = 0;
        market.sold = 0;

        //add market object to crate
        crate.market = market;

        //add crate to database
        await collection.insertOne(crate);
        console.log('Create Purchaed: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
        //send webhook to discord green
        marketWebhook('Crate Purchased', crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number, '#00ff00');
        //inc crate count in crate-count db
        await db.collection('crate-count').updateOne({supply: 'total'}, {$inc: {count: 1}});
        //add to nft-drops log
        await db.collection('nft-drops').insertOne({name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: true, time: new Date()});
        //purchasing a crate resets the last_upgrade_time
        await db.collection('players').updateOne({ username: owner }, { $set: { last_upgrade_time: Date.now() }, $inc: { version: 1} });
        return true;
    }
    catch(err){
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        }
        else{
            console.log(err);
            return false;
        }
    }
}

async function applyItemStats(username){
    //get user from players collection
    let result = await db.collection('players').findOne({ username : username });
    //get all items from items collection
    for (const itemName in result.items) {
        const item = result.items[itemName];
        const itemAttributes = item.attributes;
        //check if attrivutes of this item match the attrtibues of the item in the database
        var originalItem = await db.collection('items').findOne({item_number: item.item_number});
   
        //compare the attributes of the item to the attributes of the item in the database
        if (!deepEqual(itemAttributes, originalItem.attributes)) {
            // If the attributes don't match, update the item's attributes to match the database
            result.items[itemName].attributes = deepClone(originalItem.attributes);
        }
        
    }

    //update the user's items in the players collection
    await db.collection('players').updateOne({ username : username }, { $set: { items: result.items } });

    return;
}

//upgrade item from flux
async function upgradeItem(username, item_number, quantity) {
    try{
        let collection = db.collection('items');
        //make sure item number us a number
        item_number = parseInt(item_number);
        //find item
        let item = await collection.findOne({ owner: username, item_number: item_number });
        //check if item exists
        if (item == null) {
            console.log('Item: ' + item_number + ' does not exist or does not belong to user: ' + username);
            return false;
        }
        //double check user owns item
        if (item.owner != username) {
            console.log('Item: ' + item_number + ' does not belong to user: ' + username);
            return false;
        }

        //calculate salvage value
        let value = item.attributes.damage/2 + item.attributes.defense/2 + item.attributes.engineering * 5 + item.attributes.dodge * 5+ item.attributes.crit * 5 + item.attributes.luck * 10;
        console.log('Item: ' + item_number + ' has a salvage value of: ' + value);

        //check if item has a level or NaN
        if (item.level == undefined || isNaN(item.level)) {
            console.log('Item: ' + item_number + ' does not have a level');
            //make level 1
            await collection.updateOne({item_number: item_number }, { $set: {level: 1} });
            item.level = 1;
        }

        //to upgrade an item user must send 5% salvage value * level in flux
        if (quantity < value * 0.0498 * item.level) {
            console.log('User: ' + username + ' did not send the correct amount of flux to upgrade item: ' + item_number);
            return false;
        }

        if (item.salvaged == undefined || item.salvaged == false) {
           //upgrade the item stats by 5% on each attribute the item has, and increase the level by 1 do not increase attributes the item does not have
            await collection.updateOne({item_number: item_number }, { $set: {attributes: {damage: item.attributes.damage * 1.05, defense: item.attributes.defense * 1.05, engineering: item.attributes.engineering * 1.05, dodge: item.attributes.dodge * 1.05, crit: item.attributes.crit * 1.05, luck: item.attributes.luck * 1.05}, level: item.level + 1 } });
            //store to forge log //add entire item json to forge log
            await db.collection('forge-log').insertOne({username: username, item: item, flux: quantity, time: new Date()});
            //update flux burned in stats for todays date date: "2024-01-31"
            await db.collection('stats').updateOne({date: new Date().toISOString().split('T')[0]}, { $inc: {flux_burned_forge: parseFloat(quantity)}});
            //send webhook to discord green
            forgeWebhook('Item Upgraded', 'Item: ' + item_number + ' has been upgraded to level: ' + (item.level + 1) + ' by ' + username + ' using ' + quantity + ' FLUX');

            //apply item stats
            await applyItemStats(username);

            return true;
          
        }
        else {
            console.log('Item: ' + item_number + ' has already been salvaged');
            return false;
        }
    }
    catch(err){
        if(err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        }
        else{
            console.log(err);
        }
    }
}

//////////////////////////////////////////////////////////////////////////////
////QUE AND SEND TRANSACTIONS/////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//create a function where you can send transactions to be queued to be sent
async function sendTransaction(username, quantity, type, hash){
    try{
        let collection = db.collection('he-transactions');
        let result = await collection.insertOne({username: username, quantity: quantity, type: type, hash: hash, time: new Date()});
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
        let collection = db.collection('he-transactions');
        let transactions = await collection.find({}).toArray();
        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            let transaction = transactions[i];
            if(transaction.type == 'engineering') {
                var result = await engineering(transaction.username, transaction.quantity);
                if (result) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id});
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else if (transaction.type == 'contribute') {
                var result2 = await contribute(transaction.username, transaction.quantity);
                if (result2) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id});
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else if (transaction.type == 'defense') {
                var result3 = await defense(transaction.username, transaction.quantity);
                if (result3) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id});
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else if (transaction.type == 'damage') {
                var result4 = await damage(transaction.username, transaction.quantity);
                if (result4) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id});
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else if (transaction.type == 'buy_crate') {
                var result5 = await buy_crate(transaction.username, transaction.quantity);
                if (result5) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id}); 
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else if (transaction.type == 'forge') {
                //get the item number from the hash
                var item_number = transaction.hash.split('-')[1];
                console.log('Item Number: ' + item_number + ' Sent to forge');
                var result6 = await upgradeItem(transaction.username, item_number, transaction.quantity);
                if (result6) {
                    await storeHash(transaction.hash, transaction.username, transaction.quantity);
                    await collection.deleteOne({_id: transaction._id}); 
                }
                else {
                    //delete transaction
                    await collection.deleteOne({_id: transaction._id});
                }
            }
            else{
                console.log('unknown transaction type');
                await collection.deleteOne({_id: transaction._id});
            } 
            
        }
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
        lastCheck = Date.now();
        setTimeout(checkTransactions, 1000);
    }
}



var lastevent = Date.now();
var lastCheck = Date.now();
//aysncfunction to start listening for events
async function listen() {
    checkTransactions();
    const ssc = new SSC(node);
    ssc.stream((err, res) => {
        try{
            if (res['transactions']) {
                lastevent = Date.now();
                //loop through transactions and look for events
                try{
                    for (var i = 0; i < res['transactions'].length; i++) {
                        //check if contract is token
                        if (res['transactions'][i]['contract'] == 'tokens' && res['transactions'][i]['action'] == 'transfer') {
                            //convert payload to json
                            var payload = JSON.parse(res['transactions'][i]['payload']);
                            //check if to is "null" which is burn address
                            if (payload.to == 'null' && payload.symbol == 'SCRAP') {
                                //get memo 
                                var memo = {
                                    event: payload.memo.split('-')[0],
                                    hash: payload.memo.split('-')[1],
                                }
                                var from = res['transactions'][i]['sender'];
                                var quantity = payload.quantity;
                                var hashStore = payload.memo;

                                if (res['transactions'][i].logs.includes('errors')) {
                                    storeRejectedHash(hashStore, from);
                                    return;
                                }

                                //check if memo is engineering
                                if (memo.event == 'terracore_engineering'){
                                    sendTransaction(from, quantity, 'engineering', hashStore);
                                }
                                else if (memo.event == 'terracore_damage'){
                                    sendTransaction(from, quantity, 'damage', hashStore);
                                }
                                else if (memo.event == 'terracore_defense'){
                                    sendTransaction(from, quantity, 'defense', hashStore);
                                }
                                else if (memo.event == 'terracore_contribute'){
                                    sendTransaction(from, quantity, 'contribute', hashStore);
                                }
                                else if (memo.event == 'tm_buy_crate'){
                                    console.log('"Buy Crate" event detected');
                                    sendTransaction(from, quantity, 'buy_crate', hashStore);
                                }
                                else{
                                    console.log('Unknown event');
                                }
                                        
                            }

                            else if (payload.to == 'null' && payload.symbol == 'FLUX') {
                
                                try{
                                    //check if memo is terracore_boss_fight and if so call check planet
                                    if (payload.memo.hash.split('-')[0] == 'terracore_boss_fight') {
                                        // Check if transaction failed
                                        if (res['transactions'][i].logs.includes('errors')) {
                                            storeRejectedHash(hashStore, from);
                                            return;
                                        }
                                    
                                        const planetQtyMapping = {
                                            Terracore: 1,
                                            Oceana: 2,
                                            Celestia: 2,
                                            Arborealis: 2,
                                            Neptolith: 2,
                                            Solisar: 2
                                        };
                  
                                        const { hash, planet} = payload.memo;
                                        const quantity =  parseFloat(payload.quantity);
                                        const sender = res['transactions'][i]['sender'];
                                        const bossFightHash = hash.split('-')[1];
                                        console.log('Boss Fight Event Detected');
                                        console.log('Planet: ' + planet);
                                        console.log('Quantity: ' + quantity);
                                        console.log('Hash: ' + hash);
                                    
                                        if (planetQtyMapping[planet] == quantity) {
                                            console.log('Correct amount of flux sent');
                                            bossFight(sender, planet, bossFightHash)
                                                .then(function(result) {
                                                    console.log('Boss fight result:', result);
                                                    storeHash(hash, sender, quantity);
                                                })
                                                .catch(error => {
                                                    console.error('Error in boss fight:', error);
                                                });
                                        }
                                    }                                    
                                    else if (payload.memo.hash.split('-')[0] == 'terracore_quest_start'){
                                        if (res['transactions'][i].logs.includes('errors')) {
                                            storeRejectedHash(hashStore, from);
                                            return;
                                        }

                                        if(payload.quantity === '2'){
                                            startQuest(res['transactions'][i]['sender']);
                                            console.log('Quest Start Event Detected');
                                        }
                                        else{
                                            console.log('Not Enough Flux was Sent to Start Quest');
                                        }
                                    }
                                }
                                catch(err){
                                    console.log(err);
                                }

                                    


                            }

                            else if (payload.to =='terracore' && payload.symbol == 'FLUX'){
                                //check if memo is terracore_boss_fight and if so call check planet
                                var hashStore = payload.memo;
                                console.log('Forge Event Detected');
                                console.log('Memo: ' + payload.memo);
                                if (payload.memo.split('-')[0] == 'terracore_forge') {
                                    // Check if transaction failed
                                    if (res['transactions'][i].logs.includes('errors')) {
                                        storeRejectedHash(hashStore, from);
                                        return;
                                    }
             
                                    var quantity = payload.quantity;
                                    var sender = res['transactions'][i]['sender'];
                                    //call forge function
                                    sendTransaction(sender, quantity, 'forge', hashStore);         
                                }              
                   
                            }

                        
                        
                        }
                        else if (res['transactions'][i]['contract'] == 'tokens' && res['transactions'][i]['action'] == 'stake') {
                            //convert payload to json
                            var payload = JSON.parse(res['transactions'][i]['payload']);

                            //check if symbol is scrap
                            if (payload.symbol == 'SCRAP') {
                                var sender = res['transactions'][i]['sender'];
                                var qty = payload.quantity;
                                var hashStore = payload.memo;
                                if (res['transactions'][i].logs.includes('errors')) {
                                    storeRejectedHash(hashStore, sender);
                                }
                                webhook('New Stake', sender + ' has staked ' + qty + ' ' + "SCRAP", '#FFA500');
                                storeHash(hashStore, sender, qty);
                            }


                        }
                    }
                }
                catch(err){
                    console.log(err);
                }
            }
            else {
                console.log('No transactions');
            }
        }
        catch(err){
            ///check if it is a type error
            if (err instanceof TypeError) {
                //nothing
            }
            else {
                console.log(err);
            }
        }

    });
}

async function main() {
    node = await findNode();
    listen();
}

//kill process if no events have been received in 30 seconds
setInterval(function() {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 20000) {
        console.log('No events received in 20 seconds, shutting down so pm2 can restart');
        client.close();
        process.exit(1);
    }
}, 1000);

var heartbeat = 0;
setInterval(function() {
    heartbeat++;
    if (heartbeat == 5) {
        heartbeat = 0;
    }
    if (Date.now() - lastCheck > 20000) {
        console.log('Error : No events received in 20 seconds, shutting down so PM2 can restart & try to reconnect to Resolve...');
        client.close();
        process.exit();
    }
}, 1000);

// Refresh nodes from beacon every 30 minutes (non-blocking)
setInterval(function() {
    updateNodesFromBeacon().catch(err => {
        console.log('Background node update failed:', err.message);
    });
}, 1800000); // 30 minutes

main();

