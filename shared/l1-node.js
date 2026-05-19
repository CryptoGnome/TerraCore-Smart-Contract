const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.l1-node-state.json');

const fallbackNodes = [
    'https://api.deathwing.me',
    'https://api.hive.blog',
    'https://api.openhive.network',
    'https://anyx.io',
    'https://api.c0ff33a.uk',
    'https://hiveapi.actifit.io',
    'https://rpc.mahdiyari.info',
    'https://api.syncad.com',
    'https://hapi.ecency.com',
    'https://hive.atexoras.com:2096'
];

var nodes = [...fallbackNodes];
var node;
var lastNodeUpdate = 0;
var isUpdatingNodes = false;

// Error tracking (mirrors hive-interface pattern)
const nodeErrors = new Map();
const nodeConsecutiveErrors = new Map();
const nodeDisabledUntil = new Map();
const nodeLast429 = new Map();
const ERROR_WINDOW_MS = 10 * 60 * 1000;  // 10-min sliding window
const ERROR_THRESHOLD = 10;               // errors before disabling
const CONSECUTIVE_ERROR_THRESHOLD = 3;    // consecutive errors → disable immediately
const DISABLE_DURATION_MS = 60 * 60 * 1000; // disabled for 1 hour
const RECENT_429_WINDOW_MS = 60 * 60 * 1000; // soft penalty window after 429

// Load persisted disable state on module init so PM2 restarts don't wipe
// the in-memory disable map and immediately re-pick a rate-limited node.
(function loadDisabledState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return;
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();
        for (const [nodeUrl, disabledUntil] of Object.entries(data.disabledUntil || {})) {
            if (typeof disabledUntil === 'number' && disabledUntil > now) {
                nodeDisabledUntil.set(nodeUrl, disabledUntil);
            }
        }
        for (const [nodeUrl, ts] of Object.entries(data.last429 || {})) {
            if (typeof ts === 'number' && now - ts < RECENT_429_WINDOW_MS) {
                nodeLast429.set(nodeUrl, ts);
            }
        }
        if (nodeDisabledUntil.size > 0) {
            console.log(`L1: Restored ${nodeDisabledUntil.size} disabled node(s) from ${STATE_FILE}`);
        }
        if (nodeLast429.size > 0) {
            console.log(`L1: Restored ${nodeLast429.size} recent-429 node(s) from ${STATE_FILE}`);
        }
    } catch (err) {
        console.log(`L1: Failed to load disable state: ${err.message}`);
    }
})();

function persistDisabledState() {
    try {
        const data = {
            disabledUntil: Object.fromEntries(nodeDisabledUntil),
            last429: Object.fromEntries(nodeLast429),
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(data));
    } catch (err) {
        console.log(`L1: Failed to persist disable state: ${err.message}`);
    }
}

function hasRecent429(nodeUrl) {
    const ts = nodeLast429.get(nodeUrl);
    if (!ts) return false;
    if (Date.now() - ts > RECENT_429_WINDOW_MS) {
        nodeLast429.delete(nodeUrl);
        return false;
    }
    return true;
}

function track429(nodeUrl) {
    if (!nodeUrl) return;
    nodeLast429.set(nodeUrl, Date.now());
    persistDisabledState();
}

function isNodeDisabled(nodeUrl) {
    const disabledUntil = nodeDisabledUntil.get(nodeUrl);
    if (!disabledUntil) return false;
    if (Date.now() > disabledUntil) {
        nodeDisabledUntil.delete(nodeUrl);
        persistDisabledState();
        return false;
    }
    return true;
}

function disableNode(nodeUrl, durationMs = DISABLE_DURATION_MS) {
    if (!nodeUrl) return;
    nodeDisabledUntil.set(nodeUrl, Date.now() + durationMs);
    console.log(`L1: Disabling node immediately: ${nodeUrl}`);
    const activeNodes = nodes.filter(n => !isNodeDisabled(n));
    if (activeNodes.length === 0) {
        console.log('L1: All nodes disabled — re-enabling all');
        nodeDisabledUntil.clear();
    }
    persistDisabledState();
}

function trackError(nodeUrl) {
    if (!nodeUrl) return;
    const now = Date.now();
    const entry = nodeErrors.get(nodeUrl) || { count: 0, windowStart: now };

    if (now - entry.windowStart > ERROR_WINDOW_MS) {
        entry.count = 1;
        entry.windowStart = now;
    } else {
        entry.count++;
    }
    nodeErrors.set(nodeUrl, entry);

    const consecutive = (nodeConsecutiveErrors.get(nodeUrl) || 0) + 1;
    nodeConsecutiveErrors.set(nodeUrl, consecutive);

    const hitWindow = entry.count >= ERROR_THRESHOLD;
    const hitConsecutive = consecutive >= CONSECUTIVE_ERROR_THRESHOLD;

    if (hitWindow || hitConsecutive) {
        nodeDisabledUntil.set(nodeUrl, now + DISABLE_DURATION_MS);
        const reason = hitConsecutive ? `${consecutive} consecutive errors` : `${entry.count} errors in window`;
        console.log(`L1: Disabling node (${reason}): ${nodeUrl}`);

        // Panic recovery: if all nodes disabled, re-enable all
        const activeNodes = nodes.filter(n => !isNodeDisabled(n));
        if (activeNodes.length === 0) {
            console.log('L1: All nodes disabled — re-enabling all');
            nodeDisabledUntil.clear();
        }
        persistDisabledState();
    }
}

// Called by the poller after a successful request — clears the consecutive
// error counter so transient blips don't accumulate across long uptime.
function recordSuccess(nodeUrl) {
    if (!nodeUrl) return;
    if (nodeConsecutiveErrors.has(nodeUrl)) {
        nodeConsecutiveErrors.delete(nodeUrl);
    }
}

function getCurrentNode() {
    return node;
}

async function updateNodesFromBeacon() {
    if (isUpdatingNodes) return;
    if (Date.now() - lastNodeUpdate < 1800000) return;

    isUpdatingNodes = true;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://beacon.peakd.com/api/best', {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error('Beacon unavailable');

        const data = await response.json();
        const healthyNodes = data
            .filter(n => n &&
                        typeof n.score === 'number' &&
                        n.score >= 85 &&
                        n.endpoint &&
                        n.endpoint.startsWith('https://'))
            .sort((a, b) => b.score - a.score)
            .map(n => n.endpoint);

        if (healthyNodes.length > 0) {
            nodes = healthyNodes;
            console.log(`L1: Updated to ${healthyNodes.length} healthy nodes from beacon`);
            lastNodeUpdate = Date.now();
        }
    } catch (error) {
        console.log('L1: Beacon unavailable, using current node list');
    } finally {
        isUpdatingNodes = false;
    }
}

function checkNode(nodeUrl) {
    return new Promise((resolve) => {
        const start = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        fetch(nodeUrl, {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 }),
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        })
        .then(res => res.json().then(() => {
            clearTimeout(timeoutId);
            const duration = Date.now() - start;
            resolve({ node: nodeUrl, duration, status: res.ok ? 'Success' : 'Failed: not OK' });
        }))
        .catch(err => {
            clearTimeout(timeoutId);
            resolve({ node: nodeUrl, duration: Date.now() - start, status: 'Failed: ' + err.message });
        });
    });
}

async function findNode() {
    updateNodesFromBeacon().catch(() => {});

    const activeNodes = nodes.filter(n => !isNodeDisabled(n));
    const baseCandidates = activeNodes.length > 0 ? activeNodes : nodes;
    // Prefer nodes that have NOT 429'd us in the last hour, even if disable
    // expired. Falls back to all active nodes if every option is flagged.
    const cleanCandidates = baseCandidates.filter(n => !hasRecent429(n));
    const candidates = cleanCandidates.length > 0 ? cleanCandidates : baseCandidates;

    const firstBatch = candidates.slice(0, 5);
    const results = await Promise.allSettled(firstBatch.map(checkNode));

    results.forEach(r => {
        if (r.status === 'fulfilled') {
            console.log(`L1 ${r.value.node}: ${r.value.status}, ${r.value.duration}ms`);
        }
    });

    const successes = results
        .filter(r => r.status === 'fulfilled' && r.value.status === 'Success')
        .map(r => r.value);

    if (successes.length === 0) {
        console.log('L1: First batch failed, trying next batch...');
        const nextBatch = candidates.slice(5, 10);
        if (nextBatch.length > 0) {
            const retryResults = await Promise.allSettled(nextBatch.map(checkNode));
            const retrySuccess = retryResults
                .filter(r => r.status === 'fulfilled' && r.value.status === 'Success')
                .map(r => r.value);
            if (retrySuccess.length > 0) {
                const fastest = retrySuccess.sort((a, b) => a.duration - b.duration)[0];
                node = fastest.node;
                console.log('L1 fastest node (retry): ' + node + ' (' + fastest.duration + 'ms)');
                return node;
            }
        }
        console.error('L1: WARNING all nodes failed, using fallback');
        node = fallbackNodes[0];
        return node;
    }

    const fastest = successes.sort((a, b) => a.duration - b.duration)[0];
    node = fastest.node;
    console.log('L1 fastest node: ' + node + ' (' + fastest.duration + 'ms)');
    return node;
}

module.exports = { fallbackNodes, findNode, updateNodesFromBeacon, trackError, recordSuccess, track429, disableNode, isNodeDisabled, getCurrentNode };
