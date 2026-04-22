const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });


const dbName = 'terracore';
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });




//create function that will clear the database of all entries
async function clearDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        const db = client.db(dbName);
        const collection = db.collection('item-templates');
        await collection.deleteMany({});
        console.log("Deleted all documents");
    }
    catch (err) {
        console.log(err.stack);
    }
}
//function to delete all images from the images folder
async function clearImages() {
    //find the imges folder in the current directory
    const images_folder = path.join(__dirname, 'images');
    //get all files in the images folder
    const images = fs.readdirSync(images_folder);
    //loop through all images in the images folder
    for (let i = 0; i < images.length; i++) {
        //delete the image
        fs.unlinkSync(path.join(images_folder, images[i]));
    }

}
async function updateDB(){
    const folder_names = ['armor', 'avatar', 'ship', 'special', 'weapon'];
    const db = client.db(dbName);
    const collection = db.collection('item-templates');
    for (let i = 0; i < folder_names.length; i++) {
        //look for data folder in the current directory
        const data_folder = path.join(__dirname, 'data', folder_names[i]);
        //get all files in the data folder
        var files = fs.readdirSync(data_folder);
        console.log(files);
        //remove images from files
        files = files.filter(file => file !== 'images');

        //loop through all json files in the data folder
        for (let j = 0; j < files.length; j++) {
            //take the current file and save it to the mono
            const file = fs.readFileSync(path.join(data_folder, files[j]));
            const data = JSON.parse(file);
            //update "image" in data with file name
            data.image = "https://terracore.herokuapp.com/images/" + files[j].replace('.json', '.png');
            await collection.insertOne(data);
        }

        //go into the images folder
        const images_folder = path.join(__dirname, 'data', folder_names[i], 'images');
        //get all files in the images folder
        const images = fs.readdirSync(images_folder);
        //loop through all images in the images folder
        for (let j = 0; j < images.length; j++) {
            //resize the image and save it to the imgages folder in the current directory
            await sharp(path.join(images_folder, images[j])).resize(256, 256).toFile(path.join(__dirname, 'images', images[j]));
        }
    }
}

//go through ever itme in item-templates and add equiped to false
async function addEquiped(){
    const db = client.db(dbName);
    const collection = db.collection('item-templates');
    const items = await collection.find({}).toArray();
    console.log(items.length);
    for(let i = 0; i < items.length; i++){
        console.log(items[i].name);
        items[i].equiped = false;

    }
    //save backup to file
    fs.writeFileSync(path.join(__dirname, 'data', 'backup.json'), JSON.stringify(items));

    await collection.deleteMany({});
    await collection.insertMany(items);
}

//go through ever itme in item-templates.attributes and remove stash
async function removeStash(){
    const db = client.db(dbName);
    const collection = db.collection('item-templates');
    const items = await collection.find({}).toArray();
    console.log(items.length);
    for(let i = 0; i < items.length; i++){
        console.log(items[i].name);
        delete items[i].attributes.stash;
    }
    //save backup to file
    fs.writeFileSync(path.join(__dirname, 'data', 'backup.json'), JSON.stringify(items));

    await collection.deleteMany({});
    await collection.insertMany(items);
        

}

//function to go through all players and remove the items object and update the database
async function removeItems(){
    const db = client.db(dbName);
    const collection = db.collection('players');
    const players = await collection.find({}).toArray();
    //remove items collection
    const items = db.collection('items');
    await items.deleteMany({});

    //remove crates collection
    const crates = db.collection('crates');
    await crates.deleteMany({});

    //remove marketplace-logs collection
    const logs = db.collection('marketplace-logs');
    await logs.deleteMany({});

    //remove nft-mints
    const nfts = db.collection('nft-mints');
    await nfts.deleteMany({});

    //remove nft-drops
    const drops = db.collection('nft-drops');
    await drops.deleteMany({});



}


//rest items
async function resetItems(){
    const db = client.db(dbName);
    const collection = db.collection('players');
    const players = await collection.find({}).toArray();
    console.log(players.length);
    for(let i = 0; i < players.length; i++){
        console.log(players[i].username);
        //update player delete items
        await collection.updateOne({username: players[i].username}, {$unset: {items: ""}});
    }
}


//got through items collection and rumber the item_number 0-xx and set equiped to false
async function numberItems(){
    const db = client.db(dbName);
    const collection = db.collection('items');
    const items = await collection.find({}).toArray();
    console.log(items.length);
    for(let i = 0; i < items.length; i++){
        console.log(items[i].name);
        items[i].item_number = i;
        items[i].equiped = false;
        await collection.updateOne({_id: items[i]._id}, {$set: {item_number: i, equiped: false}});
    }
}


//resert market object for all items
async function resetMarket(){
    const db = client.db(dbName);
    const collection = db.collection('items');
    const items = await collection.find({}).toArray();
    console.log(items.length);
    for(let i = 0; i < items.length; i++){
        console.log(items[i].name);
        items[i].market = {
            listed: false,
            price: 0,
            seller: null,
            created: 0,
            expires: 0,
            sold: 0
        }

        //update item
        await collection.updateOne({_id: items[i]._id}, {$set: {market: items[i].market}});
    }
}







//main function
async function main() {
    //await removeItems();
    //await resetItems();
    //await numberItems();
    await resetMarket();
    console.log("Completed");
    process.exit(0);
}

main();

            