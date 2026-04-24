const ctx = require('../context');
const { register, storeRegistration } = require('./registration');
const { sendTransaction } = require('./queue');

async function handleOperation(operation, blockId, trxId) {
    ctx.lastevent = Date.now();
    ctx.lastCheck = Date.now();

    if (operation[0] === 'transfer' && operation[1].to === 'terracore') {
        try {
            var memo = JSON.parse(operation[1].memo);
            if (memo.hash.includes('terracore_register')) {
                var hash = memo.hash.split('-')[1];
                var referrer = memo.referrer;
                console.log(`[SC] register: ${operation[1].from}` + (referrer ? ` (ref: ${referrer})` : ''));
                var registered = await register(operation[1].from, referrer, operation[1].amount);
                if (registered) {
                    await storeRegistration(hash, operation[1].from);
                }
            }
        } catch (err) {
            // memo is not valid JSON — ignore
            console.warn('[SC] non-JSON memo skipped from', operation[1].from, ':', err.message);
        }
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_claim') {
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        console.log(`[SC] claim: ${user}`);
        await sendTransaction(user, 'claim', 'none');
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_battle') {
        var data = JSON.parse(operation[1].json);
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        console.log(`[SC] battle: ${user} → ${data.target}`);
        await sendTransaction(user, 'battle', data.target, blockId, trxId, Date.now());
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_quest_progress') {
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        console.log(`[SC] quest-progress: ${user}`);
        await sendTransaction(user, 'progress', 'none', blockId, trxId, Date.now());
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_quest_complete') {
        var user = operation[1].required_auths[0] == undefined
            ? operation[1].required_posting_auths[0]
            : operation[1].required_auths[0];
        console.log(`[SC] quest-complete: ${user}`);
        await sendTransaction(user, 'complete', 'none');
    }
}

module.exports = { handleOperation };
