mergeInto(LibraryManager.library, {

	Connect: function (username) {
		var user = UTF8ToString(username);
		hive_keychain.requestHandshake(function() {
			console.log("User: " + user);
			//check if user is logged in
			window.hive_keychain.requestSignBuffer(user, 'login', 'Posting', function(response) {
				console.log("Login received!");
				console.log(response);
				if (response['success'] == true) {
					console.log("Login successful, username: " + response['data']['username']);
					SendMessage("Hive", "SetUser", response['data']['username']);
				}
				else {
					console.log("Login failed!");

					return "";
				}
			});
		});
	},
 

	Register: function (username, refferer, registration_fee) {	
		console.log("Registering user: " + UTF8ToString(username));
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		var memo = {
			"hash": "terracore_register-" + hash,
			"referrer": UTF8ToString(refferer)
		};
		window.hive_keychain.requestTransfer(UTF8ToString(username), "terracore", UTF8ToString(registration_fee), JSON.stringify(memo), "HIVE"), function(response) {
			console.log(response);
			if (response['success'] == true) {
				console.log("Transfer successful, username: " + response['data']['username']);
			}
			else {
				console.log("Transfer failed!");
			}
		};	
	},

	OpenCrate: function (username, crate_type) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		var json = {
			"hash": "terracore_open_crate-" + hash,
			"crate_type": UTF8ToString(crate_type),
			"owner": UTF8ToString(username)
		};
		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_open_crate",
			'Posting',
			data,
			'Terracore Open Crate',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	///custom token transfer
	Event: function (username, amount, memo) {
		const id = "ssc-mainnet-hive";
		
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		var _memo = UTF8ToString(memo) + "-" + hash;

		const json = {
			"contractName": "tokens",
			"contractAction": "transfer",
			"contractPayload": {
				"symbol": "SCRAP",
				"to": "null",
				"quantity": UTF8ToString(amount),
				"memo": _memo
			}
	
		};

		//convert json to string
		const data = JSON.stringify(json);
		console.log(data);
		
		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			id, 
			'Active', 
			data, 
			'Terracore Upgrade', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
	},

	//custom token stake
	Stake: function (username, amount, memo) {
		const id = "ssc-mainnet-hive";
		
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		var _memo = UTF8ToString(memo) + "-" + hash;

		const json = {
			"contractName": "tokens",
			"contractAction": "stake",
			"contractPayload": {
				"symbol": "SCRAP",
				"to": UTF8ToString(username),
				"quantity": UTF8ToString(amount),
				"memo": _memo
			}
	
		};

        //convert json to string
		const data = JSON.stringify(json);
		console.log(data);
		
		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			id, 
			'Active', 
			data, 
			'Terracore Stake $SCRAP', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
    },

	//claim function
	ClaimScrap: function (username, amount, type){
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"amount": UTF8ToString(amount),
			"tx-hash": hash
		};

		//convert json to string
		const data = JSON.stringify(json);
		console.log(data);
		
		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			UTF8ToString(type), 
			'Active', 
			data, 
			'Terracore Claim', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
	},

	Battle: function (username, target){
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"target": UTF8ToString(target),
			"tx-hash": hash
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			'terracore_battle', 
			'Active', 
			data, 
			'Terracore Battle', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
	},

	//custom json function for equip nft
	Equip: function (username, item_number) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_equip-" + hash,
			"item_number": UTF8ToString(item_number)
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_equip",
			'Posting',
			data,
			'Terracore Equip',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	//custom json function for unequip nft
	Unequip: function (username, item_number) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_unequip-" + hash,
			"item_number": UTF8ToString(item_number)
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_unequip",
			'Posting',
			data,
			'Terracore Unequip',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	//custom json function for salvage nft     //{"hash": "terracore_salvage-abb8q0eg1mfems16zh26y","item_number": 1}
	Salvage: function (username, item_number) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_salvage-" + hash,
			"item_number": UTF8ToString(item_number)
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_salvage",
			'Active',
			data,
			'Terracore Salvage',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	 //{"hash": "terracore_boss_fight-abb8q0eg1mfems16zh26y","planet": "oceania"}
	BossFight: function (username, amount, planet) {
		const id = "ssc-mainnet-hive";
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		var _memo = {
			hash: "terracore_boss_fight-" + hash,
			planet : UTF8ToString(planet)
		};

		const json = {
			"contractName": "tokens",
			"contractAction": "transfer",
			"contractPayload": {
				"symbol": "FLUX",
				"to": "null",
				"quantity": UTF8ToString(amount),
				"memo": _memo
			}
	
		};

		//convert json to string
		const data = JSON.stringify(json);
		console.log(data);
		
		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			id, 
			'Active', 
			data, 
			'Terracore Boss Fight', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
	},

	StartQuest: function (username, amount) {
		const id = "ssc-mainnet-hive";
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
		var _memo = {
			hash: "terracore_quest_start-" + hash,
		};

		const json = {
			"contractName": "tokens",
			"contractAction": "transfer",
			"contractPayload": {
				"symbol": "FLUX",
				"to": "null",
				"quantity": UTF8ToString(amount),
				"memo": _memo
			}
	
		};

		//convert json to string
		const data = JSON.stringify(json);
		console.log(data);
		
		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username), 
			id, 
			'Active', 
			data, 
			'Terracore Quest Start', 
			function(response) 
			{
			console.log(response);
			if (response['success'] == true) {
				console.log("Transaction successful!");
			}
			else {
				console.log("Transaction failed!");
			}
		});
	},

	ProgressQuest: function (username) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_quest_progress-" + hash,
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_quest_progress",
			'Posting',
			data,
			'Terracore Quest Progress',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	CompleteQuest: function (username) {
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_quest_complete-" + hash,
		};

		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_quest_complete",
			'Posting',
			data,
			'Terracore Quest Complete',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			}
		);
	},

	//terracore_combine
	Combine: function (type){
		//create random unique 64 bit hash with letters and numbers
		var hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const json = {
			"action": "terracore_combine-" + hash,
			"type": UTF8ToString(type)
		};
		
		//convert json to string
		const data = JSON.stringify(json);

		//request sign tx
		window.hive_keychain.requestCustomJson(
			UTF8ToString(username),
			"terracore_combine",
			'Active',
			data,
			'Terracore Combine',
			function(response)
			{
				console.log(response);
				if (response['success'] == true) {
					console.log("Transaction successful!");
				}
				else {
					console.log("Transaction failed!");
				}
			});
	},


});
