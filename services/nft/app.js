const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
var hive = require('@hiveio/hive-js');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
var seedrandom = require('seedrandom');
const chalk = require('chalk');

//connect to Webhook
const hook = new Webhook(process.env.NFT_DISCORD_WEBHOOK);
const hook2 = new Webhook(process.env.NFT_DISCORD_WEBHOOK2);
const hook3 = new Webhook(process.env.NFT_DISCORD_WEBHOOK3);
const hook4 = new Webhook(process.env.NFT_DISCORD_WEBHOOK4);
const dbName = 'terracore';
const wif = process.env.NFT_ACTIVE_KEY;
const wif2 = process.env.ACTIVE_KEY2;
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30000 });
async function establishConnection() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

// Initialize the connection pool
establishConnection();

let db = client.db('terracore');

const nodes = ['https://api.deathwing.me', 'https://api.hive.blog', 'https://anyx.io', 'https://api.openhive.network', 'https://techcoderx.com', 'https://api.c0ff33a.uk','https://hiveapi.actifit.io']

// Add this variable at the top of your file, with other global variables
let lastUsedNode = '';

async function testNodeEndpoints(nodes) {
  let fastestEndpoint = '';
  let fastestResponseTime = Infinity;
  let availableNodes = nodes.filter(node => node !== lastUsedNode);

  if (availableNodes.length === 0) {
    availableNodes = nodes;
  }

  const testPromises = availableNodes.map(endpoint => {
    return new Promise((resolve) => {
      hive.api.setOptions({ url: endpoint });
      const startTime = Date.now();

      hive.api.getState('/', (err, result) => {
        if (err) {
          console.error(`${endpoint} error: ${err.message}`);
          resolve(null);
        } else {
          const responseTime = Date.now() - startTime;
          console.log(`${endpoint}: ${responseTime}ms`);
          resolve({ endpoint, responseTime });
        }
      });
    });
  });

  const results = await Promise.all(testPromises);
  const validResults = results.filter(result => result !== null);

  if (validResults.length > 0) {
    const fastest = validResults.reduce((min, p) => p.responseTime < min.responseTime ? p : min);
    fastestEndpoint = fastest.endpoint;
    fastestResponseTime = fastest.responseTime;

    console.log(`Fastest endpoint: ${fastestEndpoint} (${fastestResponseTime}ms)`);
    
    const json = { "action": "test-tx" };
    const data = JSON.stringify(json);

    try {
      await hive.broadcast.customJsonAsync(wif, ['terracore.market'], [], 'test-tx', data);
      console.log(`${fastestEndpoint} transaction successful`);
      lastUsedNode = fastestEndpoint;
    } catch (err) {
      console.error(`${fastestEndpoint} transaction error: ${err.message}`);
    }
  } else {
    console.error('No valid endpoints found');
  }

  return fastestEndpoint;
}

async function changeNode() {
  const newNode = await testNodeEndpoints(nodes);
  if (newNode) {
    hive.api.setOptions({ url: newNode });
    console.log(`Switched to node: ${newNode}`);
  } else {
    console.error('Failed to change node');
  }
}

async function webhook(title, message, rarity, stats, color, id) {

    //check if stats are null
    var embed;
    if (stats == null) {
        embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Rarity: ', rarity.toString(), false)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${rarity+"_crate"}.png`)
        .setTimestamp();
    }
    else {
        //color select based on rarity
        switch (rarity) {
            case 'common':
                color = '#bbc0c7';
                break;
            case 'uncommon':
                color = '#538a62';
                break;
            case 'rare':
                color = '#2a2cbd';
                break;
            case 'epic':
                color = '#7c04cc';
                break;
            case 'legendary':
                color = '#d98b16';
                break;
        }

        //check if title != 'New Item Minted':
        if (title != 'New Item Minted') {
            //check if message contains 'listed'
            if (title.includes('Listed')) {
                //change color to yellow
                color = '#f7f75c';
            }
            //check if message contains 'Purchased'
            else if (title.includes('Purchased')) {
                //change color to green
                color = '#5cf75c';
            }
            //check if message contains 'Cancelled'
            else if (title.includes('Cancelled')) {
                //change color to orange
                color = '#FF8440';
            }
            //check if message contains 'Transferred'
            else if (title.includes('Transferred')) {
                //change color towhite
                color = '#ffffff';
            }
        }




        //set image
        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .addField('Damage: ', stats.damage.toString(), true)
            .addField('Defense: ', stats.defense.toString(), true)
            .addField('Dodge: ', stats.dodge.toString(), true)
            .addField('Crit: ', stats.crit.toString(), true)
            .addField('Luck: ', stats.luck.toString(), true)
            .addField('Engineering: ', stats.engineering.toString(), true)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
            .setTimestamp();
    }

    try {
        await hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}
async function webhook2(title, message, color) {
    try{
        if (message.includes('Common')) {
            color = '#808080';
        } else if (message.includes('Uncommon')) {
            color = '#abffc1';
        } else if (message.includes('Rare')) {
            color = '#0000FF';
        } else if (message.includes('Epic')) {
            color = '#800080';
        } else if (message.includes('Legendary')) {
            color = '#FFA500';
        } else {
            color = '#808080';
        }
        
        const embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .setColor(color)
            .setTimestamp();
        
        hook2.send(embed).catch(err => console.log(err.message)); 
    }   
        
    catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }

}
async function webhook3(title, message, rarity, stats, color, id) {

    //check if stats are null
    var embed;
    if (stats == null) {
        embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Rarity: ', rarity.toString(), false)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${rarity+"_crate"}.png`)
        .setTimestamp();
    }
    else {
        //color select based on rarity
        switch (rarity) {
            case 'common':
                color = '#bbc0c7';
                break;
            case 'uncommon':
                color = '#538a62';
                break;
            case 'rare':
                color = '#2a2cbd';
                break;
            case 'epic':
                color = '#7c04cc';
                break;
            case 'legendary':
                color = '#d98b16';
                break;
        }

        //check if title != 'New Item Minted':
        if (title != 'New Item Minted') {
            //check if message contains 'listed'
            if (title.includes('Listed')) {
                //change color to yellow
                color = '#f7f75c';
            }
            //check if message contains 'Purchased'
            else if (title.includes('Purchased')) {
                //change color to green
                color = '#5cf75c';
            }
            //check if message contains 'Cancelled'
            else if (title.includes('Cancelled')) {
                //change color to orange
                color = '#FF8440';
            }
            //check if message contains 'Transferred'
            else if (title.includes('Transferred')) {
                //change color towhite
                color = '#ffffff';
            }
        }




        //set image
        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .addField('Damage: ', stats.damage.toString(), true)
            .addField('Defense: ', stats.defense.toString(), true)
            .addField('Dodge: ', stats.dodge.toString(), true)
            .addField('Crit: ', stats.crit.toString(), true)
            .addField('Luck: ', stats.luck.toString(), true)
            .addField('Engineering: ', stats.engineering.toString(), true)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
            .setTimestamp();
    }

    try {
        await hook3.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}
async function webhook4(title, rarity, quantity, price, buyer, seller) {
    //check if stats are null
    var embed;
    //set image removes s from the end of rarity
    var image = rarity.substring(0, rarity.length - 1);

    //check if title contains Purchased if so make color green
    var color;
    if (title.includes('Purchased')) {
        color = '#5cf75c';
    }
    else {
        color = '#ffffff';
    }


    embed = new MessageBuilder()
        .setTitle(title)
        .addField('Rarity: ', rarity, false)
        .addField('Quantity: ', quantity, true)
        .addField('Price: ', price, true)
        .addField('Buyer: ', buyer, true)
        .addField('Seller: ', seller, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${image}.png`)
        .setTimestamp();

    try {
        await hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}
async function questHook(title, message, color, image) {

    
    try {
        const embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .setColor(color)
            .setThumbnail(image)
            .setTimestamp();
        hook4.send(embed).catch(err => console.log(err.message));
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }
}

////////////////////////////////////////////////////
////////////
/////////// Marketplace Functions
//////////
///////////////////////////////////////////////////
//create function to store marketplace transactions in mongodb
async function marketplaceLog(_action, _id, _item_number, _buyer, _seller, _price, marketplace, rarity, qty){
    try{
        let collection = db.collection('marketplace-logs');
        let log = {
            action: _action,
            id: _id,
            item_number: _item_number,
            buyer: _buyer,
            seller: _seller,
            price: _price,
            marketplace: marketplace,
            rarity: rarity,
            qty: qty,
            created: Date.now()
        }
        await collection.insertOne(log);
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

async function listItem(_item, seller){
    try{
        console.log('Listing item ' + _item.item_number + ' type: ' + _item.type + ' for ' + _item.price + ' by ' + seller);

        //check if _item includes 'relic'
        if (_item.type.includes('relics')){
            //check if item exists in collection with username and type gt0
            let relic = await db.collection('relics').findOne({username: seller, type: _item.type, amount: {$gt: 0}});
            if (relic){
                //check how many relics are currently listed in relic
                if (relic.market.listed == true){
                    //how many
                    let amount = relic.market.amount;
                    //update relic.market.amount and make sure it is not greater than relic.amount
                    if (amount + _item.amount > relic.amount){
                        relic.market.amount = relic.amount;
                    }
                    else{
                        relic.market.amount = amount + _item.amount;
                    }
                    //update relic.market.price
                    relic.market.price = _item.price;
                    //update relic.market.created
                    relic.market.created = new Date().getTime();
                    //save relic
                    await db.collection('relics').updateOne({username: seller, type: _item.type}, {$set: relic});
                    webhook4('Relics Listing Updated', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'Update Listing', relic.market.seller);
                    
                }
                else{
                    //create relic.market object
                    relic.market.listed = true;
                    relic.market.amount = _item.amount;
                    relic.market.price = _item.price;
                    relic.market.seller = seller;
                    relic.market.created = new Date().getTime();
                    //save relic
                    await db.collection('relics').updateOne({username: seller, type: _item.type}, {$set: relic});
                    webhook4('New Relic Listing', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'New Listing', relic.market.seller);
                }
                marketplaceLog('create', relic.type, relic.type, null, seller, relic.market.price, null, relic.type, relic.market.amount);
            }
            else{
                console.log('Relic not found');
                return;
            }

        }
        //check if _item includes 'consumables'
        else if (_item.type.includes('consumable')){

            //check if item exists in collection with username and type gt0
            let consumable = await db.collection('consumables').findOne({username: seller, type: _item.type, amount: {$gt: 0}});
            if (consumable){
                //check how many consumables are currently listed in consumable
                if (consumable.market.listed == true){
                    //how many
                    let amount = consumable.market.amount;
                    //update consumable.market.amount and make sure it is not greater than consumable.amount
                    if (amount + _item.amount > consumable.amount){
                        consumable.market.amount = consumable.amount;
                    }
                    else{
                        consumable.market.amount = amount + _item.amount;
                    }
                    //update consumable.market.price
                    consumable.market.price = _item.price;
                    //update consumable.market.created
                    consumable.market.created = new Date().getTime();
                    //save consumable
                    await db.collection('consumables').updateOne({username: seller, type: _item.type}, {$set: consumable});
                    webhook4('Consumables Listing Updated', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'Update Listing', consumable.market.seller);
                }
                else{
                    //create consumable.market object
                    consumable.market.listed = true;
                    consumable.market.amount = _item.amount;
                    consumable.market.price = _item.price;
                    consumable.market.seller = seller;
                    consumable.market.created = new Date().getTime();
                    //save consumable
                    await db.collection('consumables').updateOne({username: seller, type: _item.type}, {$set: consumable});
                    webhook4('New Consumable Listing', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'New Listing', consumable.market.seller);
                }
                marketplaceLog('create', consumable.type, consumable.type, null, seller, consumable.market.price, null, consumable.type, consumable.market.amount);
            }
            else{
                console.log('Consumable not found');
                return;
            }
        }
        else{
            let collection = db.collection(_item.type)
            let item = await collection.findOne({item_number: parseInt(_item.item_number)});
            //check if item.salvaged exists
            if (item.salvaged == true){
                console.log('Item is salvaged');
                return;
            }

            if (item && item.market.listed == false && item.owner == seller && item.equiped == false){
                console.log('Item found');
                //update item with marketplace info from _item
                item.market.listed = true;
                item.market.price = _item.price;
                item.market.seller = seller;
                item.market.created = new Date().getTime();
                //save item
                await collection.updateOne({item_number: parseInt(_item.item_number)}, {$set: item});
                webhook('New Item Listed', `Item # ${item.item_number}  ${item.name} was listed by ${seller} for ${_item.price}`, item.rarity, item.attributes, '#f7f75c', item.id);
                marketplaceLog('create', item.id, item.item_number, null, seller, item.market.price, null, item.rarity, 1);
                return;
            }
            else{
                console.log('Item not found');
                return;
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
        }
    }
   
}

//{"action":"tm_cancel-v40px60ltuw1ubwnwvywb", "marketplace":"terracore", "item_number":"45", "owner":"terracore"}
async function cancelItem(_item, seller){
    try{

        //check if _item includes 'relic'
        if (_item.type.includes('relics')){
            //check if item exists in collection with username amd market.amount gt0
            let relic = await db.collection('relics').findOne({username: seller, type: _item.type, 'market.amount': {$gt: 0}});
    
            if (relic){
                //cancel market listing
                relic.market.listed = false;
                relic.market.amount = 0;
                relic.market.price = 0;
                relic.market.seller = null;
                relic.market.created = 0;
                //save relic
                await db.collection('relics').updateOne({username: seller, type: _item.type}, {$set: relic});
                webhook4('Relics Listing Cancelled', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'Cancel Listing', relic.market.seller);
                marketplaceLog('cancel', relic.type, relic.type, null, seller, relic.market.price, null, relic.type, relic.market.amount);
                return;
            }
            else{
                console.log('Relic not found');
                return;
            }
        }

        //check if _item includes 'consumable'
        if (_item.type.includes('consumable')){
            //check if consumable exists in collection with username amd market.amount gt0 
            let consumable = await db.collection('consumables').findOne({username: seller, type: _item.type, 'market.amount': {$gt: 0}});

            if (consumable){
                //cancel market listing
                consumable.market.listed = false;
                consumable.market.amount = 0;
                consumable.market.price = 0;
                consumable.market.seller = null;
                consumable.market.created = 0;
                //save consumable
                await db.collection('consumables').updateOne({username: seller, type: _item.type}, {$set: consumable});
                webhook4('Consumables Listing Cancelled', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'Cancel Listing', consumable.market.seller);
                marketplaceLog('cancel', consumable.type, consumable.type, null, seller, consumable.market.price, null, consumable.type, consumable.market.amount);
                return;
            }
            else{
                console.log('Consumable not found');
                return;
            }
        }
                
        //find item_number
        let collection = db.collection(_item.type);
        let item = await collection.findOne({item_number: parseInt(_item.item_number)});
        if (item && item.market.listed == true && item.owner == seller && item.equiped == false){
            //update item with marketplace info from _item
            item.market.listed = false;
            item.market.price = 0;
            item.market.seller = null;
            item.market.created = 0;
            //save item
            await collection.updateOne({item_number: parseInt(_item.item_number)}, {$set: item});
            //light red
            webhook('Listing Cancelled', `Item # ${item.item_number}  ${item.name} was cancelled by ${seller}`, item.rarity, item.attributes, '#ff906e', item.id);
            marketplaceLog('cancel', item.id, item.item_number, null, seller, item.market.price, null, item.rarity, 1);
            return;
        }
        else{
            console.log('Item not found');
            return;
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

//memo:{"hash":"tm_purchase-263fkou4o8e9sq39yafyfo","marketplace":"terracore","item_number":"test","buyer":"crypt0gnome","seller":"terracore"}
async function purchaseItem(memo, price, buyer) {
    try {
        let refundNeeded = true;
        let refundReason = 'Unknown error occurred';

        // Function to handle refunds
        const refundBuyer = async (reason) => {
            console.log(`Refunding buyer ${buyer}: ${price} - Reason: ${reason}`);
            await sendTransaction(buyer, price, `Refund: ${reason}`);
        };

        if (memo.type.includes('relics') || memo.type.includes('consumable')) {
            const collectionName = memo.type.includes('relics') ? 'relics' : 'consumables';
            let item = await db.collection(collectionName).findOne({username: memo.seller, type: memo.type, amount: {$gt: 0}});

            if (!item) {
                refundReason = `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} not found`;
                await refundBuyer(refundReason);
                return;
            }

            if (!item.market.listed) {
                refundReason = `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} not listed`;
                await refundBuyer(refundReason);
                return;
            }

            let item_price = parseFloat(item.market.price.split(' ')[0]);
            let amount = parseFloat(price.split(' ')[0]);
            let _total = (item_price * memo.amount).toFixed(3);

            if (amount < _total) {
                refundReason = `Not enough Hive sent to purchase ${collectionName}`;
                await refundBuyer(refundReason);
                return;
            }

            if (memo.amount > item.market.amount) {
                refundReason = 'Amount is greater than listed';
                await refundBuyer(refundReason);
                return;
            }

            // Perform the purchase
            const session = client.startSession();
            try {
                await session.withTransaction(async () => {
                    // Update seller's inventory
                    await db.collection(collectionName).updateOne(
                        {username: memo.seller, type: memo.type},
                        {
                            $inc: {amount: -memo.amount},
                            $set: memo.amount < item.market.amount 
                                ? {'market.amount': item.market.amount - memo.amount}
                                : {
                                    'market.listed': false,
                                    'market.amount': 0,
                                    'market.price': 0,
                                    'market.seller': null,
                                    'market.created': 0
                                }
                        },
                        {session}
                    );

                    // Update buyer's inventory
                    await db.collection(collectionName).updateOne(
                        {username: memo.buyer, type: memo.type},
                        {$inc: {amount: memo.amount}},
                        {upsert: true, session}
                    );

                    // Log the transaction
                    await marketplaceLog('purchase', item.type, item.type, buyer, memo.seller, item_price, memo.marketplace, item.rarity, memo.amount);
                });

                refundNeeded = false;

                // Process payments
                let sellerAmount = amount * 0.95;
                let marketplaceAmount = amount * 0.025;
                let terracoreAmount = amount * 0.025;

                await sendTransaction(memo.seller, sellerAmount.toFixed(3) + ' HIVE', `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} Sale: ${item.type} to ${buyer}`);
                
                if (memo.marketplace != 'terracore') {
                    await sendTransaction('asgarth', marketplaceAmount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                    await sendTransaction('crypt0gnome', terracoreAmount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                } else {
                    var total = marketplaceAmount + terracoreAmount;
                    await sendTransaction('crypt0gnome', total.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                }

                webhook4(`${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} Purchased`, item.type, memo.amount.toString(), item_price.toString(), buyer, memo.seller);

            } catch (error) {
                console.error('Transaction failed:', error);
                refundReason = 'Transaction failed';
                await refundBuyer(refundReason);
            } finally {
                await session.endSession();
            }
        } else {
            // Handle regular items (non-relics, non-consumables)
            let collection = db.collection(memo.type);
            let check = await collection.findOne({item_number: parseInt(memo.item_number)});
            if (check) {
                if (check.market.listed && check.market.price == price && check.market.seller == memo.seller && check.owner == memo.seller && !check.equiped) {
                    const session = client.startSession();
                    try {
                        await session.withTransaction(async () => {
                            await collection.updateOne(
                                {item_number: check.item_number},
                                {$set: {owner: buyer, market: {listed: false, seller: null, price: 0, sold: Date.now()}}},
                                {session}
                            );

                            let amount = parseFloat(price.split(' ')[0]);
                            let seller_amount = amount * 0.95;
                            let marketplace_amount = amount * 0.025;
                            let terracore_amount = amount * 0.025;

                            await sendTransaction(memo.seller, seller_amount.toFixed(3) + ' HIVE', `Marketplace Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            await marketplaceLog('purchase', check.id, check.item_number, buyer, memo.seller, price, memo.marketplace, check.rarity, 1);

                            if (memo.marketplace != 'terracore') {
                                await sendTransaction('asgarth', marketplace_amount.toFixed(3) + ' HIVE', `3rd Party Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                                await sendTransaction('crypt0gnome', terracore_amount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            } else {
                                var total = marketplace_amount + terracore_amount;
                                await sendTransaction('crypt0gnome', total.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            }
                        });

                        refundNeeded = false;
                        webhook('Item Purchased', `Item # ${check.item_number}  ${check.name} was purchased by ${buyer} for ${price}`, check.rarity, check.attributes, '#81fc8d', check.id);
                    } catch (error) {
                        console.error('Transaction failed:', error);
                        refundReason = 'Transaction failed';
                    } finally {
                        await session.endSession();
                    }
                } else {
                    refundReason = 'Item is no longer available for purchase';
                }
            } else {
                refundReason = 'Item not found';
            }
        }

        if (refundNeeded) {
            await refundBuyer(refundReason);
        }

    } catch (err) {
        console.error('Error in purchaseItem:', err);
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            await refundBuyer('Unexpected error occurred');
        }
    }
}

//{"action":"tm_transfer-v40px60ltuw1ubwnwvywb", "marketplace":"terracore", "item_number":"45", "sender":"terracore", "receiver":"terracore"}
async function transferItem(_item, sender){
    try{
        let collection = db.collection(_item.type);
        let item = await collection.findOne({item_number: parseInt(_item.item_number)});
        //make sure sender is the owner then transfer item to receiver
        if (item.owner == sender && item.equiped == false){
            //check if item has lastTransfer set
            if (item.lastTransfer != null){
                //check if lastTransfer is less than 24 hours ago
                if (Date.now() - item.lastTransfer < 86400000){
                    console.log('Item was transferred less than 24 hours ago, cannot transfer');
                    webhook('Item Transfer Failed', `Item # ${item.item_number}  ${item.name} was transferred less than 24 hours ago, cannot transfer`, item.rarity, item.attributes, '#ff0000', item.id);
                    return;
                }
            }
                

            //make sure item is not listed in marketplace
            if (item.market.listed == true){
                console.log('Item is listed in marketplace cannot be transferred');
            }
            else{
                await collection.updateOne({item_number: item.item_number}, {$set: {owner: _item.receiver, lastTransfer: Date.now()}});
                webhook("Item Transferred", `Item ${item.name} was transferred from ${sender} to ${_item.receiver}`, item.rarity, item.attributes, '#c2fffe', item.id);
                marketplaceLog('transfer', item.id, item.item_number, _item.receiver, sender, null, null, item.rarity, 1);
            }
        }
        else{
            return;
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

async function rollDice(index) {
    return Math.random() * (index - 0.10 * index) + 0.10 * index;
}

async function createSeed(blockId, trxId, hash) {
    //create seed from blockId & trxId
    var seed = blockId + '@' + trxId + '@' + hash;
    //return seed
    return seed;
}

async function generateRandomNumber(seed) {
    const rng = seedrandom(seed.toString(), {state: true});
    //roll number 0-100000
    var randomNumber = Math.floor(rng() * 100000);
    return randomNumber;
}
  
//{"hash": "terracore_open_crate-abb8q0eg1mfems16zh26y","crate_type": "common","owner": "crypt0gnome" }
async function open_crate(owner, _rarity, blockId, trxId, hash){
    try{
        let types = ['avatar', 'armor', 'weapon', 'special', 'ship'];
        //available id ranges for each type of item
        let ranges = [[0,43], [1000,1012], [2000,2019], [3000,3014], [4000,4016]];
        let rarity_list = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        let collection = db.collection('item-templates');
        //choose random type
        let type = types[Math.floor(Math.random() * types.length)];
        //based on the rarity of the crate being sent alter the odds of getting a certain rarity
        //roll dice to determine rarity
        //var roll = Math.floor(Math.random() * 100000) + 1;
        var seed = await createSeed(blockId, trxId, hash);
        var roll = await generateRandomNumber(seed);
        const originalRandom = roll;

        //use the roll and the rarirty passed in to determine the rarity of the item
        var rarity = 'common';
        if (_rarity == 'common'){
            if (roll <= 90000) {
                rarity = 'common'; // 90%
            }
            else if(roll <= 99000){
                rarity = 'uncommon'; // 9%
            }
            else if(roll <= 99750){
                rarity = 'rare'; // 0.75%
            }
            else if(roll <= 99950){
                rarity = 'epic'; // 0.2%
            }
            else{
                rarity = 'legendary'; // 0.05%
            }
        }
        else if (_rarity == 'uncommon'){
            if (roll <= 95000){
                rarity = 'uncommon'; // 95%
            }
            else if (roll <= 99000){
                rarity = 'rare'; // 4%
            }
            else if (roll <= 99900){
                rarity = 'epic'; // 0.9%
            }
            else{
                rarity = 'legendary'; // 0.1%
            }
        }
        else if (_rarity == 'rare'){
            if (roll < 95000){
                rarity = 'rare'; // 95%
            }
            else if (roll < 99000){
                rarity = 'epic'; // 4%
            }
            else{
                rarity = 'legendary'; // 1%
            }
        }
        else if (_rarity == 'epic'){
            if (roll < 98000){
                rarity = 'epic'; // 98%
            }
            else{
                rarity = 'legendary'; // 2%
            }
        }
        else if (_rarity == 'legendary'){
            rarity = 'legendary'; // 100%
            
        }

        //chose a range based on the type rolled
        let range = ranges[types.indexOf(type)];
        //choose a random number in the range
        let item_id = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
        //load item from item templates
        let find = await collection.findOne({id: item_id});
        //based on rarity, choose the attributes that will be used base on the amount that can be rolled per rarity using max_roll eah can only be rolled once
        var attributes = ["damage", "defense", "engineering", "dodge", "crit", "luck"];
        
        if(find != null){
            //load item collection
            collection = db.collection('items');
            //create logic here for minting items based on lots of variables
            //each number in the range has its own base properties
            //for example, 0-20 are all weapons but we will roll random numbers to determine the rarity attributes the item will have its own unique id and image in items we will use that to create the item
            let item = new Object();
            item.name = find.name;
            item.id = find.id;
            //make sure its not overprinted by making sure pint is not greater than max_print if it is reroll
            if (item.print > find.max_supply){
                open_crate(owner, rarity, blockId, trxId);
                return;
            }
            item.edition = find.edition;
            item.print = await collection.countDocuments({id: find.id}) + 1;
            item.max_supply = find.max_supply;
            item.description = find.description;
            item.image = find.image;
            item.owner = owner;
            item.type = type;
            item.rarity = rarity;
            item.equiped = false;
            item.burnt = false;

            //add one to index so that common is 1 and legendary is 5
            let rarity_index = 1;

            if(rarity == 'uncommon'){
                rarity_index = 2;
            }
            else if (rarity == 'rare'){
                rarity_index = 3;
            }
            else if (rarity == 'epic'){
                //roll to decide 4 or 5  1-100
                let roll = Math.floor(Math.random() * 100) + 1;
                if (roll <= 50){
                    rarity_index = 4;
                }
                else{
                    rarity_index = 5;
                }
            }
            else if (rarity == 'legendary'){
                rarity_index = 6;
            }
            
            //roll the amount of attributes based on rarity_index
            var attributes_chosen =[];
            let att_count = 0;
            for (var i = 0; i < rarity_index; i++){
                //for the first attribute, make sure it is based on the item type
                if (i == 0){
                    //choose attribute based on type let types = ['avatar', 'armor', 'weapon', 'special', 'ship'];
                    if (type == 'weapon'){
                        attributes_chosen.push('damage');
                        //remove damage from attributes
                        attributes.splice(0, 1);
                    }
                    else if (type == 'armor'){
                        attributes_chosen.push('defense');
                        attributes.splice(1, 1);
                    }
                    else if (type == 'ship'){
                        let roll = Math.floor(Math.random() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    }
                    else if (type == 'special'){
                        let roll = Math.floor(Math.random() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    }
                    else if (type == 'avatar'){
                        let roll = Math.floor(Math.random() * attributes.length);
                        attributes_chosen.push(attributes[roll]);
                        attributes.splice(roll, 1);
                    }
                }
                else{
                    //choose random attribute from attributes
                    var roll = Math.floor(Math.random() * attributes.length);
                    //add attributes[roll] to attributes_chosen
                    attributes_chosen.push(attributes[roll]);
                    //remove attributes[roll] from attributes
                    attributes.splice(roll, 1);
                }  
            }
  
            let attribute_list = new Object();
            //roll the attributes
            for (var i = 0; i < attributes_chosen.length; i++){
                //see if the attribute is damage or defense
                if (attributes_chosen[i] == 'damage'){
                    //make a roll but it cannot be zero
                    let roll = await rollDice(rarity_index);
                    attribute_list.damage = (roll * 10);
                    att_count += 1;
                }
                else if (attributes_chosen[i] == 'defense'){
                    let roll = await rollDice(rarity_index);
                    attribute_list.defense = (roll * 10);
                    att_count += 1;
                }
                else if (attributes_chosen[i] == 'engineering'){
                    let roll = await rollDice(rarity_index);
                    attribute_list.engineering = roll;
                    att_count += 1;
                }
                else if (attributes_chosen[i] == 'dodge'){
                    let roll = await rollDice(rarity_index);
                    attribute_list.dodge = roll;
                    att_count += 1;
                }
                else if (attributes_chosen[i] == 'crit'){
                    let roll = await rollDice(rarity_index);
                    attribute_list.crit = roll;
                    att_count += 1;
                }
                else if (attributes_chosen[i] == 'luck'){
                    let roll = await rollDice(rarity_index);
                    attribute_list.luck = roll;
                    att_count += 1;
                }

            }

            //check what attributes_list has and add the items from attritbutes list to the item as zero if it doesnt have it
            if (attribute_list.damage == null){
                attribute_list.damage = 0;
            }
            if (attribute_list.defense == null){
                attribute_list.defense = 0;
            }
            if (attribute_list.engineering == null){
                attribute_list.engineering = 0;
            }
            if (attribute_list.dodge == null){
                attribute_list.dodge = 0;
            }
            if (attribute_list.crit == null){
                attribute_list.crit = 0;
            }
            if (attribute_list.luck == null){
                attribute_list.luck = 0;
            }


            if (att_count < rarity_index){
                console.log(rarity + ' ||  Attributes: ' + JSON.stringify(attribute_list) + '                    ||  Not enough attributes, rerolling');
                open_crate(owner, rarity, blockId, trxId);
                return;
            }

        
            item.attributes = attribute_list;
            item.market = find.market;


            //log rarirty and attributes > 0 to console
            //console.log(rarity + ' ||  Attributes: ' + JSON.stringify(attribute_list));
            //await new Promise(resolve => setTimeout(resolve, 1000000));
            //console.log('Done waiting');
  
            let check = await db.collection('crates').findOne({owner: owner, rarity: _rarity, 'market.listed': false});
            //cehck if user has crate of that rarity
            if (check != null){
                //log item taht was minted to console
                console.log("Minted item: " + item.name + " with id: " + item.id + " with rarity: " + item.rarity + " with attributes: " + JSON.stringify(item.attributes));
                let count = await db.collection('item-count').findOne({supply: 'total'});
                var new_count = count.count += 1;
                item.item_number = new_count;
                //make sure this item_number is not already taken in the items collection
                let check2 = await db.collection('items').findOne({item_number: new_count});
                if (check2 == null){
                    await db.collection('item-count').updateOne({supply: "total"}, {$set: {count: new_count}});
                    await db.collection('crates').deleteOne({owner: owner, rarity: _rarity, 'market.listed': false});
                    await db.collection('items').insertOne(item);
                    webhook3('New Item Minted', item.name + ' NFT #' +  item.item_number.toString() + ' has been minted by: ' + owner, item.rarity, item.attributes, '#a538ff', item.id);
                    await db.collection('nft-mints').insertOne({item_id: item.id, item_number: item.item_number, rarity: rarity, owner: owner, type: type, attributes: item.attributes, edition: item.edition, seed: seed, roll: originalRandom, timestamp: Date.now()});
                }
                else{
                    console.log('Item number: ' + new_count + ' already taken');
                    return;
                }
            }
            else{
                console.log("No crate found for user: " + owner + " with rarity: " + rarity);
                //make color red
                //webhook('No Crate Found', 'No crate found for user: ' + owner + ' make sure you remove crates from marketplace before trying to open: ', _rarity, null, null, '#ff0000', item.id);
                return;
            }
       
        }
        else{
            console.log('Base item' + item_id + ' not found in item templates');
            return;
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

//fucntion to check if user has item
async function hasItem(username, item_number){
    try{
        var collection = db.collection('items');
        //find item
        let item = await collection.findOne({ owner : username, item_number : item_number });
        if(item){
            return true;
        }
        else{
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

//equip item
async function equipItem(username, item_number) {
    try {
        const collection = db.collection('players');
        const user = await collection.findOne({ username: username });

        if (user) {
            item_number = parseInt(item_number);
            if (await hasItem(username, item_number)) {
                const item = await db.collection('items').findOne({ item_number: item_number });

                if (item.market.listed) {
                    console.log(`User: ${username} item is listed in marketplace, cannot equip!`);
                    return;
                }

                if (user.items[item.type].item_equipped) {
                    console.log(`User: ${username} already has item equipped, unequipping item: ${user.items[item.type].item_number}`);
                    await unequipItem(username, user.items[item.type].item_number);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (item.salvaged) {
                    console.log(`User: ${username} item has already been salvaged, cannot equip!`);
                    return;
                }

                user.items[item.type] = {
                    item_number: item_number,
                    item_id: item.id,
                    item_equipped: true,
                    rarity: item.rarity,
                    attributes: item.attributes
                };

                await db.collection('players').updateOne(
                    { username: username },
                    { $set: { items: user.items }, $inc: { version: 1 } }
                );

                const updateResult = await db.collection('items').updateOne(
                    { item_number: item_number },
                    { $set: { equiped: true }, $inc: { version: 1 } }
                );

                if (updateResult.modifiedCount > 0) {
                    console.log(`User: ${username} equipped item: ${item_number}`);
                } else {
                    console.log(`Failed to update item: ${item_number} as equipped.`);
                }
            } else {
                console.log(`User: ${username} does not have item: ${item_number}`);
            }
        } else {
            console.log(`User: ${username} does not exist`);
        }
    } catch (err) {
        handleMongoError(err);
    }
}

//unequip item
async function unequipItem(username, item_number) {
    try {
        const collection = db.collection('players');
        const user = await collection.findOne({ username: username });

        if (user) {
            item_number = parseInt(item_number);
            const item = await db.collection('items').findOne({ item_number: item_number });

            if (item && user.items[item.type].item_number === item_number) {
                user.items[item.type] = {
                    item_number: null,
                    item_id: null,
                    item_equipped: false,
                    attributes: {
                        damage: 0,
                        defense: 0,
                        engineering: 0,
                        dodge: 0,
                        crit: 0,
                        luck: 0
                    }
                };

                await db.collection('players').updateOne(
                    { username: username },
                    { $set: { items: user.items }, $inc: { version: 1 } }
                );

                await db.collection('items').updateOne(
                    { item_number: item_number },
                    { $set: { equiped: false }, $inc: { version: 1 } }
                );

                console.log(`User: ${username} unequipped item: ${item_number}`);
            } else {
                console.log(`User: ${username} does not have item: ${item_number}`);
            }
        } else {
            console.log(`User: ${username} does not exist`);
        }
    } catch (err) {
        handleMongoError(err);
    }
}


////////////////////////////////////////////////////
////////////
/////////// Planet Functions
//////////
///////////////////////////////////////////////////

async function salvageNFT(username, item_number) {
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
        //check if item is equiped
        if (item.equiped == true) {
            console.log('Item: ' + item_number + ' is equiped and cannot be salvaged');
            return;
        }
        //check if item is listed in market
        if (item.market.listed == true) {
            console.log('Item: ' + item_number + ' is listed in the market and cannot be salvaged');
            return;
        }
        //double check user owns item
        if (item.owner != username) {
            console.log('Item: ' + item_number + ' does not belong to user: ' + username);
            return false;
        }

        //calculate salvage value
        let value = item.attributes.damage/2 + item.attributes.defense/2 + item.attributes.engineering * 5 + item.attributes.dodge * 5+ item.attributes.crit * 5 + item.attributes.luck * 10;
        console.log('Item: ' + item_number + ' has a salvage value of: ' + value);


        //check if item.salvaged is undefined
        if (item.salvaged == undefined || item.salvaged == false) {
            console.log('Item: ' + item_number + ' has not been salvaged yet');
            let mint = await mintFLUX(username, value);
            if (mint) {
                //set item.salvaged to true set set market to listed false eqiped to false
                await collection.updateOne({item_number: item_number }, { $set: {salvaged: true, equiped: false, owner: null, market: { listed: false, price: 0 } } });
                //add log to 'salvage-log' collection
                await db.collection('salvage-log').insertOne({username: username, item_number: item_number, value: value, time: Date.now()});
                //send webhook title, msg, color
                webhook2("Item #" + item_number + " Salvaged" , "User: " + username + " salvaged a " + item.rarity + " " + item.type + " item for " + value + " $FLUX", "#00ff00");
                return true;
            }
            else {
                return false;
            }
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


async function mintFLUX(username, value) {
    try {
        let qty = value.toFixed(8);
        //create custom_json to issue scrap to user
        var data = {
            contractName: 'tokens',
            contractAction: 'issue',
            contractPayload: {
                symbol: 'FLUX',
                to: username,
                quantity: qty.toString(),
                memo: 'terracore_salvage_flux'
            }
        };

        const result = await hive.broadcast.customJsonAsync(wif2, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));
        if (result.id) {
            console.log("Minted " + qty + " FLUX for user: " + username);
            return true;
        }
        else {
            console.log("No result id");
            return false;
        }
    } catch (err) {
        //send error webhook
        //webhook("Error", "Error claiming scrap for user " + username + " Error: " + err, '#ff0000');
        console.log(err);
        return false;
    }
}

////////////////////////////////////////////////////
////////////
/////////// Quest Functions
//////////
///////////////////////////////////////////////////

async function forgeCrate(owner, type) {
    try{
        //make sure username has enough relics to forge crate
        var db = client.db(dbName);
        var collection = db.collection('relics');
        let player = await collection.findOne({ username : owner , type: type });
        if (player == null) {
            console.log('User: ' + owner + ' does not exist');
            return false;
        }

        //remove -relics from type
        var rarity = type.replace('_relics', '');

        //check if player has enough relics
        if (player.amount < 100) {
            console.log('User: ' + owner + ' does not have enough ' + type + ' relics to forge crate');
            return false;
        }



        //load crate collection
        db = client.db(dbName); 
        var collection = db.collection('crates');

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
        collection.insertOne(crate);
        console.log('Minted crate: ' + crate.name + ' with rarity: ' + crate.rarity + ' with owner: ' + crate.owner + ' with item number: ' + crate.item_number);
        await db.collection('crate-count').updateOne({supply: 'total'}, {$inc: {count: 1}});

        //remove relics from player
        await db.collection('relics').updateOne({username: owner, type : type}, {$inc: {amount: -100}});

        //log to nft-drops in mongoDB
        await db.collection('nft-drops').insertOne({name: crate.name, rarity: crate.rarity, owner: crate.owner, item_number: crate.item_number, purchased: false, relic: true, time: new Date()});
        
        //color select based on rarity
        switch (rarity) {
            case 'common':
                color = '#bbc0c7';
                break;
            case 'uncommon':
                color = '#538a62';
                break;
            case 'rare':
                color = '#2a2cbd';
                break;
            case 'epic':
                color = '#7c04cc';
                break;
            case 'legendary':
                color = '#d98b16';
                break;
        }

        questHook("New Crate Forged", owner + " forged a " + crate.rarity + " crate", color, crate.image);
        return crate;

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


////////////////////////////////////////////////////
////////////
/////////// Potion's
//////////
///////////////////////////////////////////////////

//use consumable function
async function useConsumable(username, type) {
    try{
        //make sure username has enough consumables
        var db = client.db(dbName);
        var collection = db.collection('consumables');
        var player = await collection.findOne({ username : username , type: type });
        if (player == null) {
            console.log('User: ' + username + ' does not exist');
            return false;
        }

        //check if player has enough consumables
        if (player.amount < 1) {
            console.log('User: ' + username + ' does not have enough ' + type + ' consumables');
            return false;
        }

        //remove consumable from player
        await db.collection('consumables').updateOne({username: username, type : type}, {$inc: {amount: -1}});
        console.log('Removed 1 ' + type + ' consumable from user: ' + username);

        //check what type of consumable it is
        //['crit', 'damage', 'dodge', 'protection', 'focus', 'rage', 'impenetrable', 'overload', 'rogue', 'anti-matter', 'battle];
        switch (type) {
            case 'attack_consumable':
                //add + 1 to players attack & inc version && upsert
                await db.collection('players').updateOne({username: username}, {$inc: {attacks: 1, version: 1}}, {upsert: true});
                console.log('Added 1 attack to user: ' + username);
                break;
            case 'claim_consumable':
                //add +1 to claim rate & inc version
                await db.collection('players').updateOne({username: username}, {$inc: {claims: 1, version: 1}}, {upsert: true});
                console.log('Added 1 claim to user: ' + username);
                break;
            case 'crit_consumable':
                //add +1 to consumables.crit & inc version
                await db.collection('players').updateOne({ username: username },{ $inc: { 'consumables.crit': 1, version: 1 }, $push: { 'consumables.crit_times': Date.now() }},{ upsert: true });                 
                console.log('Added 1 crit to user: ' + username);
                break;
            case 'dodge_consumable':
                //add +1 to consumables.dodge & inc version
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.dodge': 1, version: 1}, $push: {'consumables.dodge_times': Date.now()}}, {upsert: true});
                console.log('Added 1 dodge to user: ' + username);
                break;
            case 'damage_consumable':
                //add +1 to consumables.damage & inc version
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.damage': 1, version: 1}, $push: {'consumables.damage_times': Date.now()}}, {upsert: true});
                console.log('Added 1 damage to user: ' + username);
                break;
            case 'protection_consumable':
                //add +1 to consumables.protection & inc version & add 86400000 to result.protection_time
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.protection': 1, version: 1}, $push: {'consumables.protection_times': Date.now()}}, {upsert: true});
                console.log('Added 1 protection to user: ' + username);
                break;
            case 'focus_consumable':
                //add +1 to consumables.focus & inc version
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.focus': 1, version: 1}, $push: {'consumables.focus_times': Date.now()}}, {upsert: true});
                console.log('Added 1 focus to user: ' + username);
                break;
            case 'rage_consumable':
                //add +1 to consumables.rage & inc version
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.rage': 1, version: 1}, $push: {'consumables.rage_times': Date.now()}}, {upsert: true});
                console.log('Added 1 rage to user: ' + username);
                break;
            case 'impenetrable_consumable':
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.impenetrable': 1, version: 1}, $push: {'consumables.impenetrable_times': Date.now()}}, {upsert: true});
                console.log('Added 1 impenetrable to user: ' + username);
                break;
            case 'overload_consumable':
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.overload': 1, version: 1}, $push: {'consumables.overload_times': Date.now()}}, {upsert: true});
                console.log('Added 1 overload to user: ' + username);
                break;
            case 'rogue_consumable':
                await db.collection('players').updateOne({username: username}, {$inc: {'consumables.rogue': 1, version: 1}, $push: {'consumables.rogue_times': Date.now()}}, {upsert: true});
                console.log('Added 1 rogue to user: ' + username);
                break;
            case 'battle_consumable':
                //go into player collection and add reset all the boss_data lastBattle cooldown to now minus 4 hours
                await db.collection('players').updateOne({username: username}, {$set: {'boss_data.$[].lastBattle': Date.now() - 14400000}});
                console.log('Reset all boss_data lastBattle cooldowns for user: ' + username);
                break;
            case 'fury_consumable':
                //give 4 attacks to the player
                await db.collection('players').updateOne({username: username}, {$inc: {attacks: 4, version: 1}}, {upsert: true});
                console.log('Added 4 attacks to user: ' + username);
                break;
            default:
                console.log('Invalid consumable type: ' + type);
                return false;



                
        }
        return true;
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



////////////////////////////////////////////////////
////////////
/////////// Que Functions
//////////
///////////////////////////////////////////////////
//create a function where you can send transactions to be queued to be sent
async function sendTransaction(username, amount, type) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('market-transactions');
        await collection.insertOne({username: username, amount: amount, type: type, time: Date.now()});
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
        let collection = db.collection('market-transactions');
        //get all transactions in the queue
        let transactions = await collection.find({}).toArray();
        //console.log('Sending ' + transactions.length + ' Market transactions');

        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            //for each transaction transfer the amount of HIVE to the user
            //create object to send to hive engine
            const xfer = new Object();
            xfer.from = "terracore.market";
            xfer.to = transactions[i].username;
            xfer.amount = transactions[i].amount;
            xfer.memo = transactions[i].type;
            await hive.broadcast.transfer(wif, xfer.from, xfer.to, xfer.amount, xfer.memo, function (err, result) {
                if (err) {
                    console.log(err);
                } else {
                    console.log(result);
                }
            });
            //delete transaction from queue
            await collection.deleteOne({username: transactions[i].username, amount: transactions[i].amount, type: transactions[i].type, time: transactions[i].time});    
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

//function to que open crates transactions
async function queOpenCrates(username, rarity, blockId, trxId, hash) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('crate-transactions');
        await collection.insertOne({username: username, rarity: rarity, blockId: blockId, trxId: trxId, hash: hash, time: Date.now()});
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
//function to send open crates transactions
async function sendOpenCrates() {
    try{

        let collection = db.collection('crate-transactions');
        //get all transactions in the queue sort by time oldest first
        let transactions = await collection.find({})
        .sort({time: 1})
        .toArray();
        //console.log('Sending ' + transactions.length + ' Crate transactions');

        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            //for each transaction call open crates function
            await open_crate(transactions[i].username, transactions[i].rarity, transactions[i].blockId, transactions[i].trxId, transactions[i].hash);
            //delete transaction from queue
            await collection.deleteOne({username: transactions[i].username, rarity: transactions[i].rarity, time: transactions[i].time});
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
    await sendOpenCrates();
    await sendEquip();
    await sendCombine();
    await sendUse();
    if(done) {
        lastCheck = Date.now();
        setTimeout(checkTransactions, 1000);
    }



}
//async function to clear transactions from queue
async function clearTransactions() {
    //connect to db
    try{
        let collection = db.collection('market-transactions');
        //delete all transactions
        await collection.deleteMany({});

        collection = db.collection('crate-transactions');
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

//create que function for equip/unequip
async function queEquip(username, item_number, type) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('equip-transactions');
        await collection.insertOne({username: username, item: item_number, type: type, time: Date.now()});
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
//function to send equip/unequip transactions
async function sendEquip() {
    try{
        let collection = db.collection('equip-transactions');
        //get all transactions in the queue sort by time oldest first
        let transactions = await collection.find({})
        .sort({time: 1})
        .toArray();

        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            if (transactions[i].type == 'equip') {
                //for each transaction call equip function
                await equipItem(transactions[i].username, transactions[i].item);
            }
            else if (transactions[i].type == 'unequip') {
                //for each transaction call unequip function
                await unequipItem(transactions[i].username, transactions[i].item);
            }
            //delete transaction from queue
            await collection.deleteOne({username: transactions[i].username, item: transactions[i].item, type: transactions[i].type, time: transactions[i].time});
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

//create que function for combine
async function queCombine(username, type) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('combine-transactions');
        await collection.insertOne({username: username, type: type, time: Date.now()});
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

//function to send combine transactions
async function sendCombine() {
    try{
        let collection = db.collection('combine-transactions');
        //get all transactions in the queue sort by time oldest first
        let transactions = await collection.find({})
        .sort({time: 1})
        .toArray();

        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            await forgeCrate(transactions[i].username, transactions[i].type);
            //delete transaction from queue
            await collection.deleteOne({username: transactions[i].username, type: transactions[i].type, time: transactions[i].time});
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

//create que for use consumable
async function queUse(username, type) {
    //create a que where new transactions are added and then sent in order 1 by 1
    try{
        let collection = db.collection('use-transactions');
        await collection.insertOne({username: username, type: type, time: Date.now()});
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

//function to send use consumable transactions
async function sendUse() {
    try{
        let collection = db.collection('use-transactions');
        //get all transactions in the queue sort by time oldest first
        let transactions = await collection.find({})
        .sort({time: 1})
        .toArray();

        for (let i = 0; i < transactions.length; i++) {
            lastCheck = Date.now();
            await useConsumable(transactions[i].username, transactions[i].type);
            //delete transaction from queue
            await collection.deleteOne({username: transactions[i].username, type: transactions[i].type, time: transactions[i].time});
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



////////////////////////////////////////////////////
//////////////////////////
var lastevent = Date.now();
var lastCheck = Date.now();



async function listen() {
    await changeNode();
    //await clearTransactions();
    checkTransactions();
    hive.api.streamBlock(async function (err, result) {
        try {
            const blockId = result.block_id

            if (!result || !result.transactions) {
            console.error('Block without transactions !!')
            return
            }
            
            //loop through transactions in result
            var hash = -1;
            for (const transaction of result.transactions) {
                const trxId = transaction.transaction_id
    
                //loop through operations in transaction
                for (const operation of transaction.operations) {
                    hash = hash + 1;
                    lastevent = Date.now(); 
                    if (operation[0] == 'transfer' && operation[1].to == 'terracore.market') {
                        //grab hash from memo
                        //console.log(result);
                        try{
                            var memo = JSON.parse(operation[1].memo);
                            //check if memo is tm_purchase
                            if(memo.action.includes('tm_purchase')){
                                if (operation[1].to == 'terracore.market') {
                                    await purchaseItem(memo, operation[1].amount, operation[1].from);
                                }
                            }
                        }
                        catch(err){
                            //will error if memo is not a json object
                        }
                            
                    
                    }
                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_create') {
                        //grab the json from operation[1].json
                        //console.log(result);
                        var data = JSON.parse(operation[1].json);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            ///ignore needs active key
                        }
                        else {
                            user = operation[1].required_auths[0];
                            await listItem(data, user);
                        }
            
                    
                    }
                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_cancel'){
                        //grab the json from operation[1].json
                        //console.log(result);
                        var data = JSON.parse(operation[1].json);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
                        await cancelItem(data, user);
                        
                    }
                    if (operation[0] == 'custom_json' && operation[1].id == 'tm_transfer'){
                        //grab the json from operation[1].json
                        //console.log(result);
                        var data = JSON.parse(operation[1].json);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            ///ignore needs active key
            
                        }
                        else {
                            user = operation[1].required_auths[0];
                            await transferItem(data, user);
                        }
                        
                    }
            
                    //crate functions
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_open_crate'){
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined){
                            for (let i = 0; i < data.length; i++) {
                                var user;
                                //check if required_auths[0] is []
                                if (operation[1].required_auths[0] == undefined) {
                                    user = operation[1].required_posting_auths[0];
                                }
                                else {
                                    user = operation[1].required_auths[0];
                                }
            
                                ////check that the user owns the item
                                var db = client.db(dbName);
                                var collection = db.collection('crates');
                                //check the rarity of the crate in the json
                                var rarity = data.crate_type;
                                //check if user owns at least one of the crate
                                let item = collection.findOne({owner: user, crate_type: rarity});
                                
                                if (item != null){
                                    queOpenCrates(user, rarity, blockId, trxId, Date.now());
                                }
                                
                            }
                        }
                        else{
                            var user;
                            //check if required_auths[0] is []
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            }
                            else {
                                user = operation[1].required_auths[0];
                            }
            
                            ////check that the user owns the item
                            var db = client.db(dbName);
                            var collection = db.collection('crates');
                            //check the rarity of the crate in the json
                            var rarity = data.crate_type;
                            //check if user owns at least one of the crate
                            let item = collection.findOne({owner: user, crate_type: rarity});

                            //get the index of data 
                            


                            if (item != null){
                                queOpenCrates(user, rarity, blockId, trxId, hash);
                            }
                        }
            
                    }
            
                    //equippable functions
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_equip'){
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined){
                            //check if there is an array of json objects
                            for (var i = 0; i < data.length; i++){
                                var user;
                                if (operation[1].required_auths[0] == undefined){
                                    user = operation[1].required_posting_auths[0];
                                }
                                else {
                                    user = operation[1].required_auths[0];
                                }
                                //call equip function
                                //equipItem(user, data[i].item_number);
                                queEquip(user, data[i].item_number, 'equip');
                            }
                        }
                        else{
                            var user;
                            //check if required_auths[0] is []
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            }
                            else {
                                user = operation[1].required_auths[0];
                            }
                            //call equip function
                            //equipItem(user, data.item_number);
                            queEquip(user, data.item_number, 'equip');
                        }
            
                    }
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_unequip'){
                        var data = JSON.parse(operation[1].json);
                        if (data.length != undefined){
                            //check if there is an array of json objects
                            for (var i = 0; i < data.length; i++){
                                var user;
                                if (operation[1].required_auths[0] == undefined) {
                                    user = operation[1].required_posting_auths[0];
                                }
                                else {
                                    user = operation[1].required_auths[0];
                                }
                                //call unequip function
                                //unequipItem(user, data[i].item_number);
                                queEquip(user, data[i].item_number, 'unequip');
                            }
                        }
                        else{
                            var user;
                            //check if required_auths[0] is []
                            if (operation[1].required_auths[0] == undefined) {
                                user = operation[1].required_posting_auths[0];
                            }
                            else {
                                user = operation[1].required_auths[0];
                            }
                            //call unequip function
                            //unequipItem(user, data.item_number);
                            queEquip(user, data.item_number, 'unequip');
            
                        }
                    }    
                
                    //salvage nft
                    //{"hash": "terracore_salvage-abb8q0eg1mfems16zh26y","item_number": 1}
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_salvage'){
                        var data = JSON.parse(operation[1].json);
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            ///ignore needs active key
                        }
                        else {
                            user = operation[1].required_auths[0];
                            salvageNFT(user, data.item_number);  
                        }
                    }
            
                    //combine 100 relics to make a crate
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_combine') {
                        //grab the json from operation[1].json
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            ///ignore needs active key
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
                        //forgeCrate(user, type);
                        queCombine(user, type);
                    }

                    //use consumable
                    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_use_consumable') {
                        //grab the json from operation[1].json
                        var data = JSON.parse(operation[1].json);
                        var type = data.type;
                        var user;
                        //check if required_auths[0] is []
                        if (operation[1].required_auths[0] == undefined) {
                            user = operation[1].required_posting_auths[0];
                        }
                        else {
                            user = operation[1].required_auths[0];
                        }
                        queUse(user, type);
                        
                    }

                }
            }
        }
        catch(err){
            console.log(err);
        }

    });
}


        



//track last event and reset claims every 15 seconds
try{
    listen();

}
catch(err){
    console.log(err);
}


setInterval(function() {
    console.log('Last event: ' + (Date.now() - lastevent) + ' ms ago');
    if (Date.now() - lastevent > 30000) {
        console.log('No events received in 30 seconds, shutting down so pm2 can restart');
        process.exit();
    }
}, 3000);

var heartbeat = 0;
setInterval(function() {
    //console.log('Last Transaction Check: ' + (Date.now() - lastCheck) + ' ms ago');
    heartbeat++;
    if (heartbeat == 5) {
        //log how man seconds since last lastCheck
        //console.log('HeartBeat: ' + (Date.now() - lastCheck) + 'ms ago');
        heartbeat = 0;
    }
    if (Date.now() - lastCheck > 30000) {
        console.log('Error : No events received in 30 seconds, shutting down so PM2 can restart & try to reconnect to Resolve...');
        client.close();
        process.exit();
    }
}, 1000);

