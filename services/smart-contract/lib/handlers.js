const ctx = require('../context');
const { register, storeRegistration } = require('./registration');
const { sendTransaction } = require('./queue');

function extractUser(op) {
    const auths = Array.isArray(op.required_auths) ? op.required_auths : [];
    const posting = Array.isArray(op.required_posting_auths) ? op.required_posting_auths : [];
    return auths[0] || posting[0] || null;
}

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
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[SC] claim: ${user}`);
        await sendTransaction(user, 'claim', 'none', blockId, trxId);
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_battle') {
        const data = JSON.parse(operation[1].json);
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[SC] battle: ${user} → ${data.target}`);
        await sendTransaction(user, 'battle', data.target, blockId, trxId, Date.now());
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_quest_progress') {
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[SC] quest-progress: ${user}`);
        await sendTransaction(user, 'progress', 'none', blockId, trxId, Date.now());
    }

    if (operation[0] === 'custom_json' && operation[1].id === 'terracore_quest_complete') {
        const user = extractUser(operation[1]);
        if (!user) return;
        console.log(`[SC] quest-complete: ${user}`);
        await sendTransaction(user, 'complete', 'none', blockId, trxId);
    }
}

module.exports = { handleOperation };
