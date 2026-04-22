# Monorepo Consolidation Plan

Merge all three TerraCore repos into this repo to simplify deployment (one `git pull`, one `npm install`) and eliminate duplicated infrastructure code (~400 lines shared across repos).

**Repos to merge:**
- `~/Desktop/TerraCore Smart Contract` (this repo) — https://github.com/CryptoGnome/TerraCore-Smart-Contract
- `~/Desktop/Terracore Hive-Engine` — https://github.com/CryptoGnome/Terracore-Hive-Engine
- `~/Desktop/Terracore NFT` — https://github.com/CryptoGnome/Terracore-NFT

---

## Target Structure

```
TerraCore Smart Contract/
├── package.json              ← single root install, merged deps
├── ecosystem.config.js       ← PM2 for all 4 processes
├── .env                      ← prefixed webhook variable names
├── shared/
│   ├── retry.js              ← retryWithBackoff + sleep
│   ├── he-node.js            ← beacon-based HE node selection
│   └── hive-node.js          ← Hive L1 endpoint selection
└── services/
    ├── smart-contract/app.js
    ├── lb-rewards/app.js
    ├── hive-engine/app.js
    └── nft/
        ├── app.js
        ├── db.js
        ├── dev.js
        ├── jslib.js
        ├── data/             ← 225 JSON item templates (seeding only, not runtime)
        └── images/           ← 117 PNGs (338MB — exclude from git via .gitignore)
```

---

## Shared Modules to Extract

**`shared/retry.js`** — Source: `lb-rewards.js` ~lines 174–199
- `retryWithBackoff(fn, options)` and `sleep(ms)` — identical copies exist in both `lb-rewards.js` and `hive-engine/app.js`

**`shared/he-node.js`** — Source: `lb-rewards.js` ~lines 14–162 (the more mature beacon-based version)
- `findNode()`, `updateNodesFromBeacon()`, `fetchWithTimeout()`, `checkNode()`, `validateNode()`, `fallbackNodes[]`

**`shared/hive-node.js`** — Source: `smart-contract/app.js` `testNodeEndpoints()`
- Hive L1 endpoint selection via fetch POST to `condenser_api`

**Do NOT share:**
- `sendTransaction()` — different queue collection in each service (`transactions`, `he-transactions`, `market-transactions`)
- `rollDice()` / `createSeed()` — deterministic RNG with subtly different implementations per service; sharing risks breaking blockchain-verifiable reproducibility
- Discord webhook helpers — different fields per service, not worth abstracting

---

## Root `package.json`

Single root `package.json`, no npm workspaces. Merged dependencies:

```json
{
  "name": "terracore",
  "version": "1.0.0",
  "main": "services/smart-contract/app.js",
  "scripts": { "start": "pm2 start ecosystem.config.js" },
  "dependencies": {
    "@hiveio/hive-js": "^2.0.6",
    "chalk": "^4.1.2",
    "discord-webhook-node": "^1.1.8",
    "dotenv": "^16.3.1",
    "mongodb": "^5.8.1",
    "node-fetch": "^2.6.9",
    "seedrandom": "^3.0.5",
    "sharp": "^0.33.0",
    "sscjs": "^0.0.9"
  }
}
```

**Critical pins:** `chalk@4` and `node-fetch@2` — v5/v3 are ESM-only and break `require()`.

**Note:** Terracore NFT has no `package.json` — audit its `node_modules` for actual installed versions before writing the merged root `package.json`.

---

## Environment Variables

`DISCORD_WEBHOOK` collides across all three repos (each points to a different channel). Rename with service prefixes:

```
# Shared
MONGO_URL=...
POSTING_KEY=...
ACTIVE_KEY=...
ACTIVE_KEY2=...
FUNKY_POSTING=...
FUNKY_ACTIVE=...

# Smart Contract
SC_DISCORD_WEBHOOK=...
SC_DISCORD_WEBHOOK_2=...
SC_DISCORD_WEBHOOK_3=...

# Hive Engine
HE_DISCORD_WEBHOOK=...
HE_MARKET_WEBHOOK=...
HE_BOSS_WEBHOOK=...
HE_FORGE_WEBHOOK=...

# NFT
NFT_DISCORD_WEBHOOK=...
NFT_DISCORD_WEBHOOK2=...
NFT_DISCORD_WEBHOOK3=...
NFT_DISCORD_WEBHOOK4=...
```

**dotenv path fix required in all 4 service app.js files:**
```javascript
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
```

---

## PM2 Config (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [
    { name: 'tc-smart-contract', script: './services/smart-contract/app.js', autorestart: true, max_restarts: 50, min_uptime: '5s' },
    { name: 'tc-hive-engine',    script: './services/hive-engine/app.js',    autorestart: true, max_restarts: 50, min_uptime: '5s' },
    { name: 'tc-nft',            script: './services/nft/app.js',            autorestart: true, max_restarts: 50, min_uptime: '5s' },
    { name: 'tc-lb-rewards',     script: './services/lb-rewards/app.js',     autorestart: true, max_restarts: 10, min_uptime: '30s' }
  ]
};
```

---

## Migration Order (Production-Safe)

### Phase 0 — Restructure (zero production impact)
1. Create `services/smart-contract/`, `services/lb-rewards/`, `services/hive-engine/`, `services/nft/`, `shared/` directories
2. Copy `app.js` → `services/smart-contract/app.js`, `lb-rewards.js` → `services/lb-rewards/app.js`
3. Copy `~/Desktop/Terracore Hive-Engine/app.js` → `services/hive-engine/app.js`
4. Copy `~/Desktop/Terracore NFT/{app,db,dev,jslib}.js` → `services/nft/`; copy `data/` directory
5. Add `services/nft/images/` to `.gitignore`; copy the 338MB `images/` directory to disk only
6. Write root `package.json`; run `npm install`; verify no `MODULE_NOT_FOUND`
7. Update `.env` with prefixed webhook variable names
8. Fix `dotenv` path in all 4 service files; update webhook variable references throughout
9. Write `ecosystem.config.js`
10. Extract `shared/` modules; update `lb-rewards/app.js` and `hive-engine/app.js` to require them

### Phase 1 — lb-rewards (lowest blast radius — 15-min cycle, no real-time player impact)
1. `node services/lb-rewards/app.js` — run manually, verify one full cycle
2. `pm2 stop tc-lb-rewards && pm2 start ecosystem.config.js --only tc-lb-rewards`
3. Monitor 2 cycles (~30 min); confirm SCRAP distribution in Discord

### Phase 2 — Hive Engine
1. `pm2 stop tc-hive-engine && pm2 start ecosystem.config.js --only tc-hive-engine`
2. Watch upgrade/boss fight Discord events for 30 min

### Phase 3 — NFT (2,100+ lines, 8 queue types — all collections isolated)
1. Note: `db.js` uses `__dirname`-relative paths for `data/` — automatically correct after copy
2. `pm2 stop tc-nft && pm2 start ecosystem.config.js --only tc-nft`
3. Watch marketplace and crate opens for 1 hour

### Phase 4 — Smart Contract (last — real-time player impact, highest blast radius)
1. `pm2 stop tc-smart-contract && pm2 start ecosystem.config.js --only tc-smart-contract`
2. Watch battles, quests, and claims in Discord for 1 hour

---

## Key Risks

| Risk | Mitigation |
|------|-----------|
| `chalk@5` / `node-fetch@3` break `require()` | Pin exact major versions in root package.json |
| NFT has no `package.json` — unknown installed versions | Audit NFT `node_modules` for actual versions before writing root package.json |
| dotenv can't find `.env` from subdirectory | Explicit `path.join(__dirname, '../../.env')` in all service app.js files |
| 338MB NFT images blow up git repo | Add `services/nft/images/` to `.gitignore` before first commit |
| Old repos needed if monorepo breaks | Keep all three desktop repos intact for at least one week post-cutover |
| `db.js` `__dirname` paths break after move | Already uses `__dirname`-relative paths — self-corrects automatically |
| Hive Engine is 1 commit ahead of origin | Push Hive Engine before starting (separate concern, not blocking) |

---

## Static Assets (NFT)

The 225 JSON templates in `data/` and 117 PNG images in `images/` (338MB total) are **only used by `db.js`** for initial database seeding. Production `app.js` reads from the `item-templates` MongoDB collection; images are served from a CDN. These files are inert at runtime — keep `data/` in the repo, exclude `images/` via `.gitignore`.
