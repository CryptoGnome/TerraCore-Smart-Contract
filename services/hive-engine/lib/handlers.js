const ctx = require('../context');
const { sendTransaction } = require('./queue');
const { storeHash, storeRejectedHash, bossFight, startQuest } = require('./game');
const { webhook } = require('./webhooks');

async function handleTransaction(transaction) {
    if (transaction['contract'] != 'tokens') return;

    if (transaction['action'] == 'transfer') {
        const payload = JSON.parse(transaction['payload']);

        if (payload.to == 'null' && payload.symbol == 'SCRAP') {
            const memo = {
                event: payload.memo.split('-')[0],
                hash: payload.memo.split('-')[1],
            };
            const from = transaction['sender'];
            const quantity = payload.quantity;
            const hashStore = payload.memo;

            if (transaction.logs.includes('errors')) {
                storeRejectedHash(hashStore, from);
                return;
            }

            if (memo.event == 'terracore_engineering') {
                sendTransaction(from, quantity, 'engineering', hashStore);
            } else if (memo.event == 'terracore_damage') {
                sendTransaction(from, quantity, 'damage', hashStore);
            } else if (memo.event == 'terracore_defense') {
                sendTransaction(from, quantity, 'defense', hashStore);
            } else if (memo.event == 'terracore_contribute') {
                sendTransaction(from, quantity, 'contribute', hashStore);
            } else if (memo.event == 'tm_buy_crate') {
                console.log('"Buy Crate" event detected');
                sendTransaction(from, quantity, 'buy_crate', hashStore);
            } else {
                console.log('Unknown event');
            }
        } else if (payload.to == 'null' && payload.symbol == 'FLUX') {
            try {
                if (payload.memo.hash.split('-')[0] == 'terracore_boss_fight') {
                    const from = transaction['sender'];
                    const hashStore = payload.memo;
                    if (transaction.logs.includes('errors')) {
                        storeRejectedHash(hashStore, from);
                        return;
                    }

                    const planetQtyMapping = {
                        Terracore: 1, Oceana: 2, Celestia: 2,
                        Arborealis: 2, Neptolith: 2, Solisar: 2,
                    };

                    const { hash, planet } = payload.memo;
                    const quantity = parseFloat(payload.quantity);
                    const sender = transaction['sender'];
                    const bossFightHash = hash.split('-')[1];
                    console.log('Boss Fight Event Detected');
                    console.log('Planet: ' + planet);
                    console.log('Quantity: ' + quantity);
                    console.log('Hash: ' + hash);

                    if (planetQtyMapping[planet] == quantity) {
                        console.log('Correct amount of flux sent');
                        bossFight(sender, planet, bossFightHash)
                            .then(result => {
                                console.log('Boss fight result:', result);
                                storeHash(hash, sender, quantity);
                            })
                            .catch(error => console.error('Error in boss fight:', error));
                    }
                } else if (payload.memo.hash.split('-')[0] == 'terracore_quest_start') {
                    const from = transaction['sender'];
                    const hashStore = payload.memo;
                    if (transaction.logs.includes('errors')) {
                        storeRejectedHash(hashStore, from);
                        return;
                    }
                    if (payload.quantity === '2') {
                        startQuest(transaction['sender']);
                        console.log('Quest Start Event Detected');
                    } else {
                        console.log('Not Enough Flux was Sent to Start Quest');
                    }
                }
            } catch (err) {
                console.log(err);
            }
        } else if (payload.to == 'terracore' && payload.symbol == 'FLUX') {
            const hashStore = payload.memo;
            console.log('Forge Event Detected');
            console.log('Memo: ' + payload.memo);
            if (payload.memo.split('-')[0] == 'terracore_forge') {
                const from = transaction['sender'];
                if (transaction.logs.includes('errors')) {
                    storeRejectedHash(hashStore, from);
                    return;
                }
                sendTransaction(transaction['sender'], payload.quantity, 'forge', hashStore);
            }
        }
    } else if (transaction['action'] == 'stake') {
        const payload = JSON.parse(transaction['payload']);
        if (payload.symbol == 'SCRAP') {
            const sender = transaction['sender'];
            const qty = payload.quantity;
            const hashStore = payload.memo;
            if (transaction.logs.includes('errors')) {
                storeRejectedHash(hashStore, sender);
            }
            webhook('New Stake', sender + ' has staked ' + qty + ' SCRAP', '#FFA500');
            storeHash(hashStore, sender, qty);
        }
    }
}

module.exports = { handleTransaction };
