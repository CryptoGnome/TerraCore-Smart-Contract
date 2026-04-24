const ctx = require('../context');
const { purchaseItem, listItem, cancelItem, transferItem } = require('./marketplace');
const { queOpenCrates, queEquip, queCombine, queUse } = require('./queue');
const { salvageNFT } = require('./items');
const { logError } = require('../../../shared/error-logger');

function extractUser(op) {
    const auths = Array.isArray(op.required_auths) ? op.required_auths : [];
    const posting = Array.isArray(op.required_posting_auths) ? op.required_posting_auths : [];
    return auths[0] || posting[0] || null;
}

async function handleOperation(operation, blockId, trxId, hash) {
    if (operation[0] === 'transfer' && operation[1].to == 'terracore.market') {
        try {
            var memo = JSON.parse(operation[1].memo);
            if (memo.action.includes('tm_purchase') && operation[1].to == 'terracore.market') {
                console.log(`[NFT] purchase: ${operation[1].from} (${operation[1].amount})`);
                await purchaseItem(memo, operation[1].amount, operation[1].from);
            }
        } catch (err) {
            logError('NFT_MEMO_PARSE_FAIL', err, { fn: 'handleOperation', from: operation[1].from, service: 'NFT' });
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'tm_create') {
        const auths = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
        if (auths[0]) {
            var data = JSON.parse(operation[1].json);
            console.log(`[NFT] list-item: ${auths[0]}`);
            await listItem(data, auths[0]);
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'tm_cancel') {
        var data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[NFT] cancel-listing: ${user}`);
        await cancelItem(data, user);
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'tm_transfer') {
        const auths = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
        if (auths[0]) {
            var data = JSON.parse(operation[1].json);
            console.log(`[NFT] transfer-item: ${auths[0]} → ${data.to}`);
            await transferItem(data, auths[0]);
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_open_crate') {
        var data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        var collection = ctx.db.collection('crates');

        if (data.length != undefined) {
            for (let i = 0; i < data.length; i++) {
                var rarity = data[i].crate_type;
                let item = await collection.findOne({ owner: user, crate_type: rarity });
                if (item != null) {
                    console.log(`[NFT] open-crate: ${user} (${rarity})`);
                    queOpenCrates(user, rarity, blockId, trxId, Date.now());
                }
            }
        } else {
            var rarity = data.crate_type;
            let item = await collection.findOne({ owner: user, crate_type: rarity });
            if (item != null) {
                console.log(`[NFT] open-crate: ${user} (${rarity})`);
                queOpenCrates(user, rarity, blockId, trxId, hash);
            }
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_equip') {
        var data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        if (data.length != undefined) {
            console.log(`[NFT] equip: ${user} (${data.length} items)`);
            for (var i = 0; i < data.length; i++) {
                queEquip(user, data[i].item_number, 'equip');
            }
        } else {
            console.log(`[NFT] equip: ${user} item #${data.item_number}`);
            queEquip(user, data.item_number, 'equip');
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_unequip') {
        var data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        if (data.length != undefined) {
            console.log(`[NFT] unequip: ${user} (${data.length} items)`);
            for (var i = 0; i < data.length; i++) {
                queEquip(user, data[i].item_number, 'unequip');
            }
        } else {
            console.log(`[NFT] unequip: ${user} item #${data.item_number}`);
            queEquip(user, data.item_number, 'unequip');
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_salvage') {
        const auths = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
        if (auths[0]) {
            var data = JSON.parse(operation[1].json);
            console.log(`[NFT] salvage: ${auths[0]} item #${data.item_number}`);
            await salvageNFT(auths[0], data.item_number);
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_combine') {
        const auths = Array.isArray(operation[1].required_auths) ? operation[1].required_auths : [];
        if (auths[0]) {
            var data = JSON.parse(operation[1].json);
            console.log(`[NFT] combine: ${auths[0]} (${data.type})`);
            queCombine(auths[0], data.type);
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id == 'terracore_use_consumable') {
        var data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[NFT] use-consumable: ${user} (${data.type})`);
        queUse(user, data.type);
    }
}

module.exports = { handleOperation };
