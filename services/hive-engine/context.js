const ctx = {
    db: null,
    client: null,
    wif: null,
    hook: null,
    market_hook: null,
    boss_hook: null,
    forge_hook: null,
    lastCheck: Date.now(),
    lastevent: Date.now(),
};
module.exports = ctx;
