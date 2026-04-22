const ctx = {
    db: null,
    client: null,
    hive: null,
    wif: null,
    hook: null,
    hook2: null,
    hook3: null,
    lastCheck: Date.now(),
    lastevent: Date.now(),
    changeNode: null    // set by app.js after startup
};

module.exports = ctx;
