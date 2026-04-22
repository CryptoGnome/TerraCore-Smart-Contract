const { MongoClient, MongoTopologyClosedError } = require('mongodb');
const fetch = require('node-fetch');
var hive = require('@hiveio/hive-js');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });


const dbName = 'terracore';
const wif = process.env.NFT_ACTIVE_KEY;
const wif2 = process.env.FUNKY_ACTIVE;
var client = new MongoClient(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 7000 });



//min price is 0.050 HIVE
//create a sample listing transaction
async function createListing(item, price, type, amount) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "tm_create-" + hash;
	json.marketplace = "terracore";
	json.item_number = item;
	json.price = price;
	json.amount = amount;
	json.type = type;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, ['funkydev'], [], 'tm_create', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}

//create a cancel listing transaction
async function cancelListing(item, price, type) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "tm_cancel-" + hash;
	json.marketplace = "terracore";
	json.item_number = item;
	json.price = price;
	json.type = type;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, ['funkydev'], [], 'tm_cancel', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}

//create transfer transaction
async function transfer(item, to, type) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "tm_transfer-" + hash;
	json.item_number = item;
	json.receiver = to;
	json.type = type;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif, [], ['terracore.market'], 'tm_transfer', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}


async function buy(item, price, type, buyer, seller) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "tm_purchase-" + hash;
	json.marketplace = "terracore";
	json.item_number = item;
	json.type = type;
	json.buyer = buyer;
	json.seller = seller;
	//convert json to string
	const data = JSON.stringify(json);

	//request transfer
	hive.broadcast.transfer(wif2, buyer, seller, price, data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}


//buy crate
async function buyCrate() {
	const id = "ssc-mainnet-hive";
		
	//create random unique 64 bit hash with letters and numbers
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	var _memo = "tm_buy_crate-" + hash;

	const json = {
		"contractName": "tokens",
		"contractAction": "transfer",
		"contractPayload": {
			"symbol": "SCRAP",
			"to": "null",
			"quantity": "0.1",
			"memo": _memo
		}

	};

	//request transfer
	hive.broadcast.customJson(wif2, ['funkydev'], [], id, JSON.stringify(json), function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}

//equip item
async function equip(item) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "terracore_equip-" + hash;
	json.item_number = item;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, [], ['funkydev'], 'terracore_equip', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}

//unequip item
async function unequip(item) {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "terracore_unequip-" + hash;
	json.item_number = item;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, [], ['funkydev'], 'terracore_unequip', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}


//unequip item
async function progressQuest() {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "terracore_quest_progress-" + hash;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, [], ['funkydev'], 'terracore_quest_progress', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}
async function completeQuest() {
	var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	//send a custom HIVE json transaction }
	var json = new Object();
	json.action = "terracore_quest_complete-" + hash;

	//convert json to string
	const data = JSON.stringify(json);

	//request sign tx
	hive.broadcast.customJson(wif2, [], ['funkydev'], 'terracore_quest_complete', data, function (err, result) {
		if (err) {
			console.log(err);
		} else {
			console.log(result);
		}
	});
}


//main function
async function main() {
	//cancelListing(2, "0.050 HIVE", "items");
	progressQuest();
	//completeQuest();
	//await equip(52);
	//await unequip(51);

	//setTimeout(function () {
	//createListing(0, "10.000 HIVE", "rare_relics", 1);

	//cancelListing(0, "1.000 HIVE", "rare_relics");

	//wait 10 seconds
	//setTimeout(function () {
	//	buy(2, "0.050 HIVE", "items", "funkydev", "terracore.market");
	//}, 20000);
}

main();




	