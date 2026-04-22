const ctx = require('../context');
const { purchaseItem, listItem, cancelItem, transferItem } = require('./marketplace');
const { queOpenCrates, queEquip, queCombine, queUse } = require('./queue');
const { salvageNFT } = require('./items');

async function handleOperation(operation, blockId, trxId, hash) {
    if (operation[0] == 'transfer' && operation[1].to == 'terracore.market') {
        try {
            var memo = JSON.parse(operation[1].memo);
            if (memo.action.includes('tm_purchase') && operation[1].to == 'terracore.market') {
                await purchaseItem(memo, operation[1].amount, operation[1].from);
            }
        } catch (err) {
            // memo is not JSON
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'tm_create') {
        if (operation[1].required_auths[0] != undefined) {
            var data = JSON.parse(operation[1].json);
            await listItem(data, operation[1].required_auths[0]);
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'tm_cancel') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        await cancelItem(data, user);
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'tm_transfer') {
        if (operation[1].required_auths[0] != undefined) {
            var data = JSON.parse(operation[1].json);
            await transferItem(data, operation[1].required_auths[0]);
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_open_crate') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        var collection = ctx.db.collection('crates');

        if (data.length != undefined) {
            for (let i = 0; i < data.length; i++) {
                var rarity = data.crate_type;
                let item = await collection.findOne({ owner: user, crate_type: rarity });
                if (item != null) {
                    queOpenCrates(user, rarity, blockId, trxId, Date.now());
                }
            }
        } else {
            var rarity = data.crate_type;
            let item = await collection.findOne({ owner: user, crate_type: rarity });
            if (item != null) {
                queOpenCrates(user, rarity, blockId, trxId, hash);
            }
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_equip') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        if (data.length != undefined) {
            for (var i = 0; i < data.length; i++) {
                queEquip(user, data[i].item_number, 'equip');
            }
        } else {
            queEquip(user, data.item_number, 'equip');
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_unequip') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        if (data.length != undefined) {
            for (var i = 0; i < data.length; i++) {
                queEquip(user, data[i].item_number, 'unequip');
            }
        } else {
            queEquip(user, data.item_number, 'unequip');
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_salvage') {
        if (operation[1].required_auths[0] != undefined) {
            var data = JSON.parse(operation[1].json);
            salvageNFT(operation[1].required_auths[0], data.item_number);
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_combine') {
        if (operation[1].required_auths[0] != undefined) {
            var data = JSON.parse(operation[1].json);
            queCombine(operation[1].required_auths[0], data.type);
        }
    }

    if (operation[0] == 'custom_json' && operation[1].id == 'terracore_use_consumable') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        queUse(user, data.type);
    }
}

module.exports = { handleOperation };
