const { sendTransaction } = require('./queue');
const { storeHash, storeRejectedHash, checkHash } = require('./hashes');
const { bossFight, getExpectedFluxCost } = require('./boss');
const { startQuest } = require('./quests');
const { webhook } = require('./webhooks');
const { logError } = require('../../../shared/error-logger');

async function handleTransaction(transaction) {
    if (transaction['contract'] != 'tokens') return;

    // Replay-dedup keys on the Hive Engine transaction id (server-observed, globally unique) —
    // not the client-supplied memo. The memo is still used for ROUTING (action type, item_number,
    // rarity, tier, etc.); only the idempotency key is trxId. This mirrors the L1 smart-contract
    // queue, which already dedups on transaction_id, and removes the silent-FLUX-loss class of bug
    // where a stale client reuses a deterministic memo that collides with a prior on-chain action.
    const trxId = transaction.transactionId;

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

            if      (event == 'terracore_engineering') { console.log(`[HE] engineering: ${from} (${quantity} SCRAP)`); sendTransaction(from, quantity, 'engineering', hashStore, trxId); }
            else if (event == 'terracore_damage')      { console.log(`[HE] damage: ${from} (${quantity} SCRAP)`);      sendTransaction(from, quantity, 'damage',      hashStore, trxId); }
            else if (event == 'terracore_defense')     { console.log(`[HE] defense: ${from} (${quantity} SCRAP)`);     sendTransaction(from, quantity, 'defense',     hashStore, trxId); }
            else if (event == 'terracore_contribute')  { console.log(`[HE] contribute: ${from} (${quantity} SCRAP)`);  sendTransaction(from, quantity, 'contribute',  hashStore, trxId); }
            else if (event == 'tm_buy_crate') {
                console.log(`[HE] buy-crate: ${from} (${quantity} SCRAP)`);
                sendTransaction(from, quantity, 'buy_crate', hashStore, trxId);
            } else if (event == 'terracore_quest_start') {
                const memoParts = hashStore.split('-');
                const questType = memoParts[1];
                const tier = parseInt(memoParts[2], 10);
                const dedupKey = trxId || hashStore;
                if (await checkHash(dedupKey)) {
                    console.warn(`[HE] duplicate quest-start skipped: trxId=${dedupKey} user=${from}`);
                    return;
                }
                await storeHash(hashStore, from, quantity, dedupKey);
                console.log(`[HE] quest-start: ${from} type=${questType} tier=${tier} (${quantity} SCRAP)`);
                startQuest(from, questType, tier, quantity)
                    .then(result => {
                        if (!result) console.warn(`[HE] quest-start failed for ${from}`);
                    })
                    .catch(err => logError('HE_QUEST_START_FAIL', err, { fn: 'startQuest', username: from, service: 'HE' }));
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

                    const { hash, planet } = payload.memo;
                    const quantity = parseFloat(payload.quantity);
                    const expectedFlux = await getExpectedFluxCost(planet);
                    console.log(`[HE] boss-fight: ${from} → ${planet} (${quantity} FLUX)`);

                    if (expectedFlux !== null && expectedFlux == quantity) {
                        const dedupKey = trxId || hash;
                        if (await checkHash(dedupKey)) {
                            console.warn(`[HE] duplicate boss-fight skipped: trxId=${dedupKey} user=${from}`);
                            return;
                        }
                        // Store key before fight to prevent replay
                        await storeHash(hash, from, quantity, dedupKey);
                        bossFight(from, planet, hash)
                            .then(result => {
                                console.log(`[HE] boss-fight result: ${from} → ${planet}:`, result);
                            })
                            .catch(err => logError('HE_BOSS_FIGHT_FAIL', err, { fn: 'bossFight', username: from, service: 'HE' }));
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
                sendTransaction(from, payload.quantity, 'forge', hashStore, trxId);
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
            const stakeLogs = JSON.parse(transaction.logs);
            if (stakeLogs.errors && stakeLogs.errors.length > 0) {
                console.warn(`[HE] stake rejected by HE: ${sender} — ${JSON.stringify(stakeLogs.errors)}`);
                storeRejectedHash(hashStore, sender);
                return;
            }
            console.log(`[HE] stake: ${sender} (${qty} SCRAP)`);
            webhook('New Stake', sender + ' has staked ' + qty + ' SCRAP', '#FFA500');
            storeHash(hashStore, sender, qty, trxId);
        }
    }
}

module.exports = { handleTransaction };
