const { sendTransaction } = require('./queue');
const { storeHash, storeRejectedHash } = require('./hashes');
const { bossFight } = require('./boss');
const { startQuest } = require('./quests');
const { webhook } = require('./webhooks');
const { logError } = require('../../../shared/error-logger');

async function handleTransaction(transaction) {
    if (transaction['contract'] != 'tokens') return;

    if (transaction['action'] == 'transfer') {
        const payload = JSON.parse(transaction['payload']);

        // SCRAP burned → stat upgrades or crate buy
        if (payload.to == 'null' && payload.symbol == 'SCRAP') {
            const event    = payload.memo.split('-')[0];
            const from     = transaction['sender'];
            const quantity = payload.quantity;
            const hashStore = payload.memo;

            if (transaction.logs.includes('errors')) {
                storeRejectedHash(hashStore, from);
                return;
            }

            if      (event == 'terracore_engineering') { console.log(`[HE] engineering: ${from} (${quantity} SCRAP)`); sendTransaction(from, quantity, 'engineering', hashStore); }
            else if (event == 'terracore_damage')      { console.log(`[HE] damage: ${from} (${quantity} SCRAP)`);      sendTransaction(from, quantity, 'damage',      hashStore); }
            else if (event == 'terracore_defense')     { console.log(`[HE] defense: ${from} (${quantity} SCRAP)`);     sendTransaction(from, quantity, 'defense',     hashStore); }
            else if (event == 'terracore_contribute')  { console.log(`[HE] contribute: ${from} (${quantity} SCRAP)`);  sendTransaction(from, quantity, 'contribute',  hashStore); }
            else if (event == 'tm_buy_crate') {
                console.log(`[HE] buy-crate: ${from} (${quantity} SCRAP)`);
                sendTransaction(from, quantity, 'buy_crate', hashStore);
            } else {
                console.log('Unknown SCRAP burn event: ' + event);
            }
            return;
        }

        // FLUX burned → boss fight or quest start
        if (payload.to == 'null' && payload.symbol == 'FLUX') {
            try {
                const memoHash = payload.memo.hash ? payload.memo.hash.split('-')[0] : null;

                if (memoHash == 'terracore_boss_fight') {
                    const from = transaction['sender'];
                    if (transaction.logs.includes('errors')) {
                        storeRejectedHash(payload.memo, from);
                        return;
                    }

                    const planetQtyMapping = { Terracore: 1, Oceana: 2, Celestia: 2, Arborealis: 2, Neptolith: 2, Solisar: 2 };
                    const { hash, planet } = payload.memo;
                    const quantity = parseFloat(payload.quantity);
                    console.log(`[HE] boss-fight: ${from} → ${planet} (${quantity} FLUX)`);

                    if (planetQtyMapping[planet] == quantity) {
                        bossFight(from, planet)
                            .then(result => {
                                console.log(`[HE] boss-fight result: ${from} → ${planet}:`, result);
                                storeHash(hash, from, quantity);
                            })
                            .catch(err => logError('HE_BOSS_FIGHT_FAIL', err, { fn: 'bossFight', username: from, service: 'HE' }));
                    }
                } else if (memoHash == 'terracore_quest_start') {
                    const from = transaction['sender'];
                    if (transaction.logs.includes('errors')) {
                        storeRejectedHash(payload.memo, from);
                        return;
                    }
                    if (payload.quantity === '2') {
                        console.log(`[HE] quest-start: ${from}`);
                        startQuest(from);
                    } else {
                        console.log(`[HE] quest-start rejected: ${from} (insufficient FLUX)`);
                    }
                }
            } catch (err) {
                logError('HE_HANDLER_FLUX_PARSE', err, { fn: 'handleTransaction', service: 'HE' });
            }
            return;
        }

        // FLUX sent to terracore → item forge
        if (payload.to == 'terracore' && payload.symbol == 'FLUX') {
            const hashStore = payload.memo;
            if (payload.memo.split('-')[0] == 'terracore_forge') {
                console.log(`[HE] forge: ${transaction['sender']} (${payload.quantity} FLUX)`);
                const from = transaction['sender'];
                if (transaction.logs.includes('errors')) {
                    storeRejectedHash(hashStore, from);
                    return;
                }
                sendTransaction(from, payload.quantity, 'forge', hashStore);
            }
            return;
        }
    }

    // SCRAP staked → log and notify
    if (transaction['action'] == 'stake') {
        const payload = JSON.parse(transaction['payload']);
        if (payload.symbol == 'SCRAP') {
            const sender    = transaction['sender'];
            const qty       = payload.quantity;
            const hashStore = payload.memo;
            if (transaction.logs.includes('errors')) {
                storeRejectedHash(hashStore, sender);
            }
            console.log(`[HE] stake: ${sender} (${qty} SCRAP)`);
            webhook('New Stake', sender + ' has staked ' + qty + ' SCRAP', '#FFA500');
            storeHash(hashStore, sender, qty);
        }
    }
}

module.exports = { handleTransaction };
