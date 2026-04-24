const fetch = require('node-fetch');

const fallbackNodes = [
    'https://api.deathwing.me',
    'https://api.hive.blog',
    'https://api.openhive.network',
    'https://techcoderx.com',
    'https://hive-api.arcange.eu',
    'https://anyx.io',
    'https://api.c0ff33a.uk',
    'https://hiveapi.actifit.io',
    'https://rpc.mahdiyari.info',
    'https://api.syncad.com',
    'https://hapi.ecency.com'
];

var nodes = [...fallbackNodes];
var node;
var lastNodeUpdate = 0;
var isUpdatingNodes = false;

// Error tracking (mirrors hive-interface pattern)
const nodeErrors = new Map();
const nodeDisabledUntil = new Map();
const ERROR_WINDOW_MS = 10 * 60 * 1000;  // 10-min sliding window
const ERROR_THRESHOLD = 10;               // errors before disabling
const DISABLE_DURATION_MS = 60 * 60 * 1000; // disabled for 1 hour

function isNodeDisabled(nodeUrl) {
    const disabledUntil = nodeDisabledUntil.get(nodeUrl);
    if (!disabledUntil) return false;
    if (Date.now() > disabledUntil) {
        nodeDisabledUntil.delete(nodeUrl);
        return false;
    }
    return true;
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

    if (entry.count >= ERROR_THRESHOLD) {
        nodeDisabledUntil.set(nodeUrl, now + DISABLE_DURATION_MS);
        console.log(`L1: Disabling node due to errors: ${nodeUrl}`);

        // Panic recovery: if all nodes disabled, re-enable all
        const activeNodes = nodes.filter(n => !isNodeDisabled(n));
        if (activeNodes.length === 0) {
            console.log('L1: All nodes disabled — re-enabling all');
            nodeDisabledUntil.clear();
        }
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
    const candidates = activeNodes.length > 0 ? activeNodes : nodes;

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

module.exports = { fallbackNodes, findNode, updateNodesFromBeacon, trackError, isNodeDisabled, getCurrentNode };
