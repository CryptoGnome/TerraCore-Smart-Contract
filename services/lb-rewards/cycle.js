const fetch = require('node-fetch');
const ctx = require('./context');
const { findNode, validateNode, fetchWithTimeout } = require('../../shared/he-node');
const { sleep, retryWithBackoff } = require('../../shared/retry');
const { logError } = require('../../shared/error-logger');
var seedrandom = require('seedrandom');

var node;

const TIER_BASE_COST  = { 1: 10,  2: 50,  3: 235,  4: 985,  5: 4010 };
const TIER_DURATION   = { 1: 1,   2: 4,   3: 12,   4: 24,   5: 48   };
const TIER_BASE_ROLLS = { 1: 2,   2: 3,   3: 4,    4: 6,    5: 10   };
const QUEST_TARGET_PRICE_DEFAULT = 0.0003;       // target SCRAP price in HIVE
const QUEST_FLUX_TARGET_DEFAULT  = 3.0;           // target FLUX price in HIVE (~$0.185 at current HIVE)
const ORACLE_INTERVAL_MS = 4 * 60 * 60 * 1000;   // 4 hours
const ORACLE_MAX_CYCLE_CHANGE = 0.50;
const ORACLE_MAX_MULTIPLIER = 50.0;               // raised from 20 to allow flux-adjusted range
const QUEST_TYPES = ['combat', 'salvage', 'stealth', 'fortune', 'defense'];

// Weighted tier draw for random slots (Tier 1:10%, 2:20%, 3:30%, 4:25%, 5:15%)
const WEIGHTED_TIER_POOL = [1,1,2,2,2,2,3,3,3,3,3,3,4,4,4,4,4,5,5,5];

async function ensureMongoConnection() {
    try {
        await ctx.client.db('admin').command({ ping: 1 });
        return true;
    } catch (err) {
        console.error('MongoDB connection lost, attempting reconnect...');
        try {
            await ctx.client.connect();
            console.log('MongoDB reconnected successfully');
            return true;
        } catch (reconnectErr) {
            console.error('MongoDB reconnect failed:', reconnectErr.message);
            throw new Error('MongoDB connection unavailable');
        }
    }
}

async function distributeRewards(user) {
    if (!Number.isFinite(user.calculatedReward) || user.calculatedReward <= 0) {
        console.warn(`[LB] skipping invalid reward for ${user.username}: ${user.calculatedReward}`);
        return;
    }
    var reward = user.calculatedReward.toFixed(8);
    console.log('Distributing ' + reward + ' to ' + user.username);
    try {
        var data = {
            contractName: 'tokens',
            contractAction: 'transfer',
            contractPayload: { symbol: 'SCRAP', to: user.username, quantity: reward, memo: 'terracore_reward' },
        };
        await ctx.hive.broadcast.customJsonAsync(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(data));
    } catch (err) {
        console.log(err);
    }
}

async function fetchScrapBalance() {
    return await retryWithBackoff(async () => {
        if (!node) node = await findNode();
        validateNode(node, 'fetchScrapBalance');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch(node + '/contracts', {
                method: 'POST',
                headers: { 'Content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'find', params: { contract: 'tokens', table: 'balances', query: { account: 'terracore', symbol: 'SCRAP' } }, id: 1 }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        const data = await response.json();
        if (!data.result) throw new Error('Invalid response from Hive Engine');
        return data.result.length > 0 ? parseFloat(data.result[0].balance) : 0;
    }, { maxAttempts: 3, initialDelay: 2000, functionName: 'fetchScrapBalance' });
}

async function getRewards() {
    return await retryWithBackoff(async () => {
        await ensureMongoConnection();
        const response = await fetchWithTimeout('https://api.terracoregame.com/leaderboard', 10000);
        const json = await response.json();

        const db = ctx.client.db('terracore');
        const stats = await db.collection('stats').findOne({ date: 'global' });
        if (!stats) throw new Error('No global stats found in database');

        const rewardTime = stats.rewardtime;
        if (Date.now() < rewardTime) {
            console.log('Not Time to Distribute Rewards');
            return;
        }

        let scrapBalance;
        try {
            scrapBalance = await fetchScrapBalance();
        } catch (err) {
            logError('LB_SCRAP_BALANCE_FAIL', err, { fn: 'getRewards', service: 'LB' });
            console.error('Failed to fetch terracore SCRAP balance — skipping reward distribution');
            return;
        }

        await db.collection('stats').updateOne(
            { date: 'global' },
            { $set: { terracoreScrap: scrapBalance } }
        );

        const pool = scrapBalance * 0.0001;
        if (pool <= 0) {
            console.log('terracore SCRAP balance is 0 — skipping reward distribution');
            return;
        }

        const totalApiRewards = json.reduce((sum, u) => sum + (u.reward || 0), 0);
        if (totalApiRewards <= 0) {
            console.log('No reward data from API');
            return;
        }
        for (const user of json) {
            user.calculatedReward = (user.reward / totalApiRewards) * pool;
        }

        console.log(`Processing rewards for ${json.length} players... Pool: ${pool.toFixed(8)} SCRAP`);
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < json.length; i++) {
            try {
                const collection = db.collection('players');
                const player = await collection.findOne({ username: json[i].username });
                if (!player) {
                    console.log(`Player ${json[i].username} not found in database`);
                    continue;
                }
                if (player.lastRewardTime && player.lastRewardTime >= rewardTime) {
                    console.log('Player ' + json[i].username + ' already received rewards');
                    continue;
                }
                await distributeRewards(json[i]);
                await collection.updateOne({ username: json[i].username }, { $set: { lastRewardTime: rewardTime }, $inc: { version: 1 } });
                successCount++;
                await sleep(500);
            } catch (err) {
                errorCount++;
                console.error(`Error processing reward for ${json[i].username}: ${err.message}`);
            }
        }

        const newRewardTime = Date.now() + 86400000;
        await db.collection('stats').updateOne({ date: 'global' }, { $set: { rewardtime: newRewardTime } });
        console.log(`Leaderboard Rewards Distribution Complete: ${successCount} successful, ${errorCount} errors`);
    }, {
        maxAttempts: 2,
        initialDelay: 3000,
        functionName: 'getRewards',
    }).catch(err => {
        logError('LB_CYCLE_FAIL', err, { fn: 'getRewards', service: 'LB' });
    });
}

async function checkBalance() {
    try {
        var balance = await ctx.hive.api.getAccountsAsync(['terracore']);
        var hiveBalance = balance[0].balance.split(' ')[0].replace(/\s/g, '');
        console.log('Current Hive Balance: ' + hiveBalance);
        return hiveBalance;
    } catch (err) {
        console.log(err.stack);
    }
}

async function sendHive(to, amount, memo) {
    console.log('Sending ' + amount + ' HIVE to ' + to);
    ctx.hive.broadcast.transfer(ctx.wif, 'terracore', to, amount + ' HIVE', memo, function (err, result) {
        if (err) console.log(err);
        else console.log(result);
    });
}

async function withdrawSwapHive() {
    return await retryWithBackoff(async () => {
        console.log('Processing SWAP.HIVE');
        const amount = await engineBalance('terracore', 'SWAP.HIVE');
        const parsedAmount = parseFloat(amount.toFixed(3));
        console.log('Current SWAP.HIVE Balance: ' + parsedAmount);

        if (parsedAmount > 1) {
            let halfAmount = (parsedAmount / 2).toFixed(3);
            await swapTokens(parseFloat(halfAmount));
            await sleep(30000);

            halfAmount = (halfAmount - 0.01).toFixed(3);
            const json = {
                contractName: 'hivepegged',
                contractAction: 'withdraw',
                contractPayload: { quantity: halfAmount },
            };

            await new Promise((resolve, reject) => {
                ctx.hive.broadcast.customJson(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(json), function (err, result) {
                    if (err) { console.error('Withdrawal broadcast error:', err); reject(err); }
                    else { console.log('Withdrawal successful:', result); resolve(result); }
                });
            });

            await sleep(120000);
            console.log('SWAP.HIVE processing completed successfully');
        } else {
            console.log('Not enough SWAP.HIVE to process');
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'withdrawSwapHive',
    }).catch(err => {
        logError('LB_SWAP_HIVE_FAIL', err, { fn: 'withdrawSwapHive', service: 'LB' });
    });
}

async function swapTokens(amount) {
    console.log(`Swapping ${amount} SWAP.HIVE for SCRAP`);
    const amountNumber = parseFloat(amount);
    if (isNaN(amountNumber)) throw new Error('Invalid amount: ' + amount);
    const json = {
        contractName: 'marketpools',
        contractAction: 'swapTokens',
        contractPayload: {
            tokenPair: 'SWAP.HIVE:SCRAP', tokenSymbol: 'SWAP.HIVE',
            tokenAmount: amountNumber.toFixed(8), tradeType: 'exactInput',
            maxSlippage: '5.000', beeswap: '3.1.4',
        },
    };
    return new Promise((resolve, reject) => {
        ctx.hive.broadcast.customJson(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(json), function (err, result) {
            if (err) { console.error('Error swapping tokens:', err); reject(err); }
            else { console.log('Swap successful:', result); resolve(result); }
        });
    });
}

async function distributeRevenue() {
    return await retryWithBackoff(async () => {
        await ensureMongoConnection();
        const hive_balance = await checkBalance();
        const balance = parseFloat(hive_balance);

        if (balance > 10) {
            const swapAmount = balance * 0.5;
            try {
                await swap_keychain_hive(swapAmount.toFixed(3), 'HIVE', 'SCRAP', 'terracore');
                await sleep(60000);
            } catch (err) {
                console.error(`Keychain swap failed: ${err.message}`);
                console.log('Continuing with revenue distribution despite swap failure');
                await sleep(5000);
            }

            const hive_balance_after = await checkBalance();
            const balance_after = parseFloat(hive_balance_after);
            const gnome = balance_after * 0.7;
            const asgarth = balance_after * 0.3;

            await sendHive('crypt0gnome', gnome.toFixed(3), 'terracore_revenue_distribution');
            await sleep(3000);
            await sendHive('asgarth', asgarth.toFixed(3), 'terracore_revenue_distribution');
            console.log('Revenue distribution completed successfully');
        } else {
            console.log('Not enough Hive to distribute');
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'distributeRevenue',
    }).catch(err => {
        logError('LB_REVENUE_DIST_FAIL', err, { fn: 'distributeRevenue', service: 'LB' });
    });
}

async function swap_keychain_hive(amount, symbol, symbol2, account) {
    try {
        const fixedAmount = parseFloat(amount).toFixed(3);
        const data = await fetchWithJson(`https://swap.hive-keychain.com/token-swap/estimate/${symbol}/${symbol2}/${fixedAmount}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        console.log(data);
        const data2 = await fetchWithJson('https://swap.hive-keychain.com/token-swap/estimate/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slipperage: 15, steps: data.result, startToken: symbol, endToken: symbol2, amount: fixedAmount, username: account }),
        });
        return new Promise((resolve, reject) => {
            ctx.hive.broadcast.transfer(ctx.wif, account, 'keychain.swap', `${fixedAmount} HIVE`, data2.result.estimateId, function (err, result) {
                if (err) { console.error('Error swapping HIVE:', err); reject(err); }
                else { console.log('HIVE swap successful:', result); resolve(result); }
            });
        });
    } catch (err) {
        console.error('Error in swap_keychain_hive:', err);
        throw err;
    }
}

async function fetchWithJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

async function engineBalance(username, token) {
    return await retryWithBackoff(async () => {
        if (!node) node = await findNode();
        validateNode(node, 'engineBalance');
        console.log(`engineBalance using node: ${node}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch(node + '/contracts', {
                method: 'POST',
                headers: { 'Content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'find', params: { contract: 'tokens', table: 'balances', query: { account: username, symbol: token } }, id: 1 }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        const data = await response.json();
        if (!data.result) throw new Error(`Invalid response format from ${node}`);
        return data.result.length > 0 ? parseFloat(data.result[0].balance) : 0;
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'engineBalance',
    }).catch(err => {
        console.error(`engineBalance failed after all retries: ${err.message}`);
        return 0;
    });
}

async function transfer(to, amount, account) {
    const json = {
        contractName: 'tokens',
        contractAction: 'transfer',
        contractPayload: { symbol: 'FLUX', to: to, quantity: amount.toFixed(8).toString(), memo: 'Burn $FLUX' },
    };
    ctx.hive.broadcast.customJson(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(json), function () {});
}

async function place_order(price, quantity, side, symbol) {
    try {
        console.log('Placing order for ' + quantity + ' at ' + price);
        const op = {
            contractName: 'market',
            contractAction: side,
            contractPayload: { symbol: symbol, quantity: quantity.toString(), price: price.toString() },
        };
        await ctx.hive.broadcast.customJson(ctx.wif, ['terracore'], [], 'ssc-mainnet-hive', JSON.stringify(op));
    } catch (err) {
        console.log(err);
    }
}

async function fetch_prices(symbol) {
    return await retryWithBackoff(async () => {
        if (!node) {
            console.error('node is undefined, finding node...');
            node = await findNode();
        }
        validateNode(node, 'fetch_prices');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch(`${node}/contracts`, {
                method: 'POST',
                body: JSON.stringify({ jsonrpc: '2.0', method: 'find', params: { contract: 'market', table: 'metrics', query: { symbol: symbol }, limit: 1000, offset: 0, indexes: [] }, id: 6969 }),
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        const data = await response.json();
        if (!data.result || data.result.length === 0) throw new Error(`No price data found for ${symbol}`);
        const bid = data.result[0].highestBid;
        const ask = data.result[0].lowestAsk;
        if (!bid || !ask) throw new Error(`Invalid price data for ${symbol}: bid=${bid}, ask=${ask}`);
        return { bid: bid, ask: ask };
    }, {
        maxAttempts: 3,
        initialDelay: 1500,
        functionName: 'fetch_prices',
    });
}

async function manageFlux() {
    return await retryWithBackoff(async () => {
        const flux = await engineBalance('terracore', 'FLUX');
        console.log('Current FLUX Balance: ' + flux);

        if (flux > 5) {
            const burn = flux * 0.25;
            await transfer('null', burn, 'terracore');

            const amount = flux * 0.75;
            const prices = await fetch_prices('FLUX');
            const bid = parseFloat(prices.bid);
            const ask = parseFloat(prices.ask);
            const spreadPercent = ((ask / bid - 1) * 100).toFixed(2);
            console.log(`Market: Bid=${bid}, Ask=${ask}, Spread=${spreadPercent}%`);

            const order = (amount / 10).toFixed(3);
            console.log(`Placing 10 sell orders of ${order} FLUX each, priced 2-20% above highest bid`);
            for (let i = 1; i <= 10; i++) {
                const price = (bid * (1 + 0.02 * i)).toFixed(3);
                await place_order(price, order, 'sell', 'FLUX');
                await sleep(2500);
            }
            console.log('FLUX management completed successfully');
        } else {
            console.log('Not enough FLUX to manage');
        }
    }, {
        maxAttempts: 3,
        initialDelay: 2000,
        functionName: 'manageFlux',
    }).catch(err => {
        console.error(`manageFlux failed after all retries: ${err.message}`);
        console.log('Skipping FLUX management for this iteration');
    });
}

// ─── Quest Oracle ─────────────────────────────────────────────────────────────

async function updateQuestOracle() {
    try {
        const db = ctx.client.db('terracore');
        const priceFeed = await db.collection('price_feed').findOne({ date: 'global' });
        if (!priceFeed) {
            console.log('[QuestOracle] price_feed not found, skipping');
            return;
        }

        const now = Date.now();
        const lastUpdated = priceFeed.quest_oracle_updated_at || 0;
        if (now - lastUpdated < ORACLE_INTERVAL_MS) {
            console.log('[QuestOracle] < 4h since last update, skipping');
            return;
        }

        // Fetch SCRAP and FLUX spot prices (both priced in HIVE on Hive Engine)
        let scrapSpot, fluxSpot;
        try {
            const scrapPrices = await fetch_prices('SCRAP');
            scrapSpot = parseFloat(scrapPrices.bid);
            if (!scrapSpot || scrapSpot <= 0) throw new Error('invalid SCRAP spot price');
        } catch (err) {
            logError('LB_QUEST_ORACLE_SCRAP', err, { fn: 'updateQuestOracle', service: 'LB' });
            console.error('[QuestOracle] Failed to fetch SCRAP price, skipping update');
            return;
        }
        try {
            const fluxPrices = await fetch_prices('FLUX');
            fluxSpot = parseFloat(fluxPrices.bid);
            if (!fluxSpot || fluxSpot <= 0) throw new Error('invalid FLUX spot price');
        } catch (err) {
            // FLUX price failure is non-fatal — fall back to target price (flux factor = 1.0)
            logError('LB_QUEST_ORACLE_FLUX', err, { fn: 'updateQuestOracle', service: 'LB' });
            console.warn('[QuestOracle] Failed to fetch FLUX price, using target as fallback');
            fluxSpot = priceFeed.quest_flux_target || QUEST_FLUX_TARGET_DEFAULT;
        }

        // Maintain rolling 6-element TWAP histories for both tokens
        const scrapHistory = Array.isArray(priceFeed.scrap_price_history) ? [...priceFeed.scrap_price_history] : [];
        scrapHistory.push(scrapSpot);
        if (scrapHistory.length > 6) scrapHistory.shift();

        const fluxHistory = Array.isArray(priceFeed.flux_price_history) ? [...priceFeed.flux_price_history] : [];
        fluxHistory.push(fluxSpot);
        if (fluxHistory.length > 6) fluxHistory.shift();

        const scrapTwap = scrapHistory.reduce((a, b) => a + b, 0) / scrapHistory.length;
        const fluxTwap  = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;

        const targetScrap = priceFeed.quest_target_price || QUEST_TARGET_PRICE_DEFAULT;
        const targetFlux  = priceFeed.quest_flux_target  || QUEST_FLUX_TARGET_DEFAULT;

        // Combined oracle formula:
        //   scrapFactor = targetScrap / scrapTwap  — keeps USD quest cost stable as SCRAP moves
        //   fluxFactor  = max(1, √(fluxTwap/targetFlux))  — ONE-WAY: only raises costs, never lowers
        //
        // Why one-way? When FLUX is cheap, making quests cheaper in SCRAP would push MORE items
        // onto the market into an already depressed FLUX price — procyclical and harmful.
        // The SCRAP oracle already handles accessibility (SCRAP rising → fewer SCRAP needed).
        // The FLUX factor only activates above target to protect FLUX when farming is most profitable.
        const scrapFactor = targetScrap / scrapTwap;
        const fluxFactor  = Math.max(1.0, Math.sqrt(fluxTwap / targetFlux));
        const rawMultiplier = scrapFactor * fluxFactor;
        const newMultiplier = Math.min(Math.max(rawMultiplier, 1.0), ORACLE_MAX_MULTIPLIER);

        // Circuit breaker: >50% swing blocks the multiplier write, TWAP still advances
        const prevMultiplier = priceFeed.quest_cost_multiplier || 1.0;
        const isWarmup = scrapHistory.length < 2 || fluxHistory.length < 2;
        const swing = prevMultiplier > 0 ? Math.abs(newMultiplier - prevMultiplier) / prevMultiplier : 0;
        const breakerTripped = !isWarmup && swing > ORACLE_MAX_CYCLE_CHANGE;

        if (breakerTripped) {
            console.warn(`[QuestOracle] Circuit breaker: prev=${prevMultiplier.toFixed(4)} raw=${newMultiplier.toFixed(4)} swing=${(swing*100).toFixed(1)}% — multiplier held`);
            try {
                const { Webhook } = require('discord-webhook-node');
                if (process.env.SC_DISCORD_WEBHOOK) {
                    const hook = new Webhook(process.env.SC_DISCORD_WEBHOOK);
                    await hook.send(`⚠️ Quest oracle circuit breaker: prev=${prevMultiplier.toFixed(4)} → raw=${newMultiplier.toFixed(4)} (SCRAP=${scrapSpot}, FLUX=${fluxSpot}). Multiplier unchanged.`);
                }
            } catch (webhookErr) {
                console.error('[QuestOracle] Discord alert failed:', webhookErr.message);
            }
        }

        const updateFields = {
            scrap_price_history: scrapHistory,
            flux_price_history:  fluxHistory,
            quest_oracle_updated_at: now,
            quest_target_price: targetScrap,
            quest_flux_target:  targetFlux,
            // scrap_usd is NOT written here — it's the USD price maintained by fetch_cost() in the API.
            // scrapSpot is the HIVE price; overwriting scrap_usd with it would corrupt the USD display.
        };
        if (!breakerTripped) updateFields.quest_cost_multiplier = newMultiplier;

        await db.collection('price_feed').updateOne(
            { date: 'global' },
            { $set: updateFields },
            { upsert: false }
        );

        if (!breakerTripped) {
            console.log(`[QuestOracle] Updated: SCRAP=${scrapSpot.toFixed(8)} FLUX=${fluxSpot.toFixed(4)} scrapFactor=${scrapFactor.toFixed(3)} fluxFactor=${fluxFactor.toFixed(3)} multiplier=${newMultiplier.toFixed(4)} (prev=${prevMultiplier.toFixed(4)})`);
        } else {
            console.log(`[QuestOracle] TWAP updated, multiplier held at ${prevMultiplier.toFixed(4)}: SCRAP=${scrapSpot.toFixed(8)} FLUX=${fluxSpot.toFixed(4)}`);
        }
    } catch (err) {
        logError('LB_QUEST_ORACLE_FAIL', err, { fn: 'updateQuestOracle', service: 'LB' });
    }
}

// ─── Quest Board Generation ───────────────────────────────────────────────────

function weightedTierPick(rng, allowedTiers) {
    const pool = WEIGHTED_TIER_POOL.filter(t => allowedTiers.includes(t));
    if (pool.length === 0) return allowedTiers[Math.floor(rng() * allowedTiers.length)];
    return pool[Math.floor(rng() * pool.length)];
}

function pickTemplate(rng, templates, usedIds) {
    const available = templates.filter(t => !usedIds.has(String(t._id)));
    if (available.length === 0) return null;
    return available[Math.floor(rng() * available.length)];
}

async function generateQuestBoard() {
    try {
        const db = ctx.client.db('terracore');
        const todayDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

        const existing = await db.collection('quest-board').findOne({});
        if (existing && existing.date === todayDate) {
            console.log('[QuestBoard] Board is current for ' + todayDate + ', skipping generation');
            return;
        }

        // Fetch all active templates
        const allTemplates = await db.collection('quest-templates').find({ active: true }).toArray();
        if (allTemplates.length === 0) {
            console.warn('[QuestBoard] No active quest templates found — board not generated');
            return;
        }

        const rng = seedrandom(todayDate);
        const usedIds = new Set();
        const slots = [];

        // Shuffle the 5 quest types
        const types = [...QUEST_TYPES];
        for (let i = types.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [types[i], types[j]] = [types[j], types[i]];
        }

        // Tier assignments: slot 0 = T1/T2, slot 1 = T2/T3, slot 2 = T3+, slots 3-4 = weighted random
        const tierRules = [
            [1, 2],
            [2, 3],
            [3, 4, 5],
            null, // weighted random
            null,
        ];

        for (let i = 0; i < 5; i++) {
            const questType = types[i];
            let tier;
            if (tierRules[i]) {
                tier = tierRules[i][Math.floor(rng() * tierRules[i].length)];
            } else {
                tier = weightedTierPick(rng, [1, 2, 3, 4, 5]);
            }

            // Find templates matching this type + tier (excluding already used)
            const candidates = allTemplates.filter(t => t.quest_type === questType && t.tier === tier && !usedIds.has(String(t._id)));
            // If no templates for this exact type+tier, try other tiers for this type
            let template = candidates.length > 0
                ? candidates[Math.floor(rng() * candidates.length)]
                : pickTemplate(rng, allTemplates.filter(t => t.quest_type === questType), usedIds);

            if (!template) {
                console.warn(`[QuestBoard] No template found for type=${questType} tier=${tier}, skipping slot`);
                continue;
            }

            usedIds.add(String(template._id));
            slots.push({
                template_id: template._id,
                quest_type: template.quest_type,
                tier: template.tier,
                name: template.name,
                flavor: template.flavor || '',
                image_url: template.image_url || '',
                duration_hours: TIER_DURATION[template.tier],
                base_rolls: TIER_BASE_ROLLS[template.tier],
            });
        }

        // Bonus 6th slot: 10% legendary, 90% weighted random
        const legendaryRoll = rng();
        let bonusTemplate = null;
        if (legendaryRoll < 0.10) {
            const legendaries = allTemplates.filter(t => t.legendary === true && !usedIds.has(String(t._id)));
            if (legendaries.length > 0) {
                bonusTemplate = legendaries[Math.floor(rng() * legendaries.length)];
            }
        }
        if (!bonusTemplate) {
            bonusTemplate = pickTemplate(rng, allTemplates, usedIds);
        }
        if (bonusTemplate) {
            usedIds.add(String(bonusTemplate._id));
            slots.push({
                template_id: bonusTemplate._id,
                quest_type: bonusTemplate.quest_type,
                tier: bonusTemplate.tier,
                name: bonusTemplate.name,
                flavor: bonusTemplate.flavor || '',
                image_url: bonusTemplate.image_url || '',
                duration_hours: TIER_DURATION[bonusTemplate.tier],
                base_rolls: TIER_BASE_ROLLS[bonusTemplate.tier],
            });
        }

        await db.collection('quest-board').replaceOne(
            {},
            { date: todayDate, slots, generated_at: Date.now() },
            { upsert: true }
        );

        console.log(`[QuestBoard] Generated board for ${todayDate} with ${slots.length} slots`);
    } catch (err) {
        logError('LB_QUEST_BOARD_FAIL', err, { fn: 'generateQuestBoard', service: 'LB' });
    }
}

// ─── Quest Expiry Cleanup ─────────────────────────────────────────────────────

async function cleanupExpiredQuests() {
    try {
        const db = ctx.client.db('terracore');
        const result = await db.collection('active-quests').deleteMany({ expires_at: { $lt: Date.now() } });
        if (result.deletedCount > 0) {
            console.log(`[QuestCleanup] Deleted ${result.deletedCount} expired quest(s)`);
        }
    } catch (err) {
        logError('LB_QUEST_CLEANUP_FAIL', err, { fn: 'cleanupExpiredQuests', service: 'LB' });
    }
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────

async function runCycle() {
    console.log('\n[1/7] Finding fastest node...');
    node = await findNode();

    console.log('\n[2/7] Managing FLUX...');
    await manageFlux();

    console.log('\n[3/7] Processing SWAP.HIVE...');
    await withdrawSwapHive();

    console.log('\n[4/7] Distributing rewards...');
    await getRewards();

    console.log('\n[5/7] Distributing revenue...');
    await distributeRevenue();

    console.log('\n[6/7] Updating quest oracle...');
    await updateQuestOracle();

    console.log('\n[7/7] Generating quest board + cleanup...');
    await generateQuestBoard();
    await cleanupExpiredQuests();
}

module.exports = { runCycle };
