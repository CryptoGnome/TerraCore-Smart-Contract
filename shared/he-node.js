const fetch = require('node-fetch');

const fallbackNodes = [
    "https://engine.deathwing.me",
    "https://he.splex.gg",
    "https://enginerpc.com",
    "https://ha.herpc.dtools.dev",
    "https://herpc.tribaldex.com",
    "https://ctpmain.com",
    "https://engine.hive.pizza",
    "https://he.atexoras.com:2083",
    "https://api2.hive-engine.com/rpc",
    "https://api.primersion.com",
    "https://engine.beeswap.tools",
    "https://herpc.dtools.dev",
    "https://api.hive-engine.com/rpc",
    "https://he.sourov.dev"
];

var nodes = [...fallbackNodes];
var node;
var lastNodeUpdate = 0;
var isUpdatingNodes = false;

async function updateNodesFromBeacon() {
    if (isUpdatingNodes) return;
    if (Date.now() - lastNodeUpdate < 1800000) return; // 30 minutes

    isUpdatingNodes = true;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('https://beacon.peakd.com/api/he/nodes', {
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
            console.log(`✓ Updated to ${healthyNodes.length} healthy nodes from beacon`);
            lastNodeUpdate = Date.now();
        }
    } catch (error) {
        console.log('Beacon unavailable, using current node list');
    } finally {
        isUpdatingNodes = false;
    }
}

function fetchWithTimeout(url, timeout = 3500) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        )
    ]);
}

function checkNode(node) {
    return new Promise((resolve) => {
        const start = Date.now();
        fetchWithTimeout(node)
            .then(response => {
                const duration = Date.now() - start;
                if (response.ok) {
                    resolve({ node, duration, status: 'Success' });
                } else {
                    resolve({ node, duration, status: 'Failed: Response not OK' });
                }
            })
            .catch(error => resolve({ node, duration: Date.now() - start, status: 'Failed: ' + error.message }));
    });
}

async function findNode() {
    updateNodesFromBeacon().catch(() => {});

    const nodesToTest = nodes.slice(0, 5);
    const promises = nodesToTest.map(node => checkNode(node));

    try {
        const results = await Promise.allSettled(promises);

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                console.log(`${result.value.node}: ${result.value.status}, Time: ${result.value.duration}ms`);
            } else {
                console.log(`Error: ${result.reason}`);
            }
        });

        const successfulResults = results
            .filter(result => result.status === 'fulfilled' && result.value.status === 'Success')
            .map(result => result.value);

        if (successfulResults.length === 0) {
            console.log('First 5 nodes failed, trying next batch...');
            const nextBatch = nodes.slice(5, 10);
            if (nextBatch.length > 0) {
                const retryResults = await Promise.allSettled(nextBatch.map(n => checkNode(n)));
                const retrySuccess = retryResults
                    .filter(r => r.status === 'fulfilled' && r.value.status === 'Success')
                    .map(r => r.value);

                if (retrySuccess.length > 0) {
                    const fastestRetry = retrySuccess.sort((a, b) => a.duration - b.duration)[0];
                    node = fastestRetry.node;
                    console.log('Fastest node (retry): ' + node + ' (' + fastestRetry.duration + 'ms)');
                    return node;
                }
            }

            console.error('WARNING: All nodes failed, using first fallback node as last resort');
            node = fallbackNodes[0];
            return node;
        }

        const fastestNode = successfulResults.sort((a, b) => a.duration - b.duration)[0];
        node = fastestNode.node;
        console.log('Fastest node is: ' + node + ' (' + fastestNode.duration + 'ms)');
        return node;
    } catch (error) {
        console.error('Error finding the fastest node:', error.message);
        node = fallbackNodes[0];
        console.log('Using fallback node:', node);
        return node;
    }
}

function validateNode(nodeUrl, functionName = 'unknown') {
    if (!nodeUrl || typeof nodeUrl !== 'string') {
        throw new Error(`[${functionName}] Invalid node: ${nodeUrl}`);
    }
    if (!nodeUrl.startsWith('https://') && !nodeUrl.startsWith('http://')) {
        throw new Error(`[${functionName}] Node must be a valid URL: ${nodeUrl}`);
    }
    return true;
}

module.exports = { fallbackNodes, findNode, updateNodesFromBeacon, validateNode, fetchWithTimeout };
