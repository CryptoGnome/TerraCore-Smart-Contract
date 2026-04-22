# TerraCore Monorepo Implementation Plan

**Goal:** Merge all three repos onto one server → one `git pull`, one `pm2 restart`, lower hosting costs.

**Repos being merged:**
- `~/Desktop/TerraCore Smart Contract` (this repo) — main repo, destination
- `~/Desktop/Terracore Hive-Engine`
- `~/Desktop/Terracore NFT`

**Where work happens:**
- **Phase 0 (all code changes) → done here on this dev machine, then pushed to GitHub**
- **Phases 1–5 (PM2 cutover) → done on the production server after `git pull`**

**Ground rules:**
- Old repos stay untouched on disk until 1 week of stable production
- Cut over one service at a time, lowest risk first
- Never touch PM2 until Phase 0 is 100% validated and pushed

---

## Progress Tracker

### Phase 0 — Setup (zero production impact)

#### 0.1 Pre-flight checks
- [ ] Confirm all 3 current PM2 processes are running and healthy (`pm2 list`)
- [ ] Push Hive-Engine to GitHub (it is 1 commit ahead of origin)
- [ ] Note current PM2 process names/IDs for all running services

#### 0.2 Create directory structure in this repo
- [ ] `mkdir -p services/smart-contract`
- [ ] `mkdir -p services/lb-rewards`
- [ ] `mkdir -p services/hive-engine`
- [ ] `mkdir -p services/nft`
- [ ] `mkdir -p shared`

#### 0.3 Copy Smart Contract files into services/
- [ ] `cp app.js services/smart-contract/app.js`
- [ ] `cp lb-rewards.js services/lb-rewards/app.js`

#### 0.4 Copy Hive-Engine files
- [ ] Copy `~/Desktop/Terracore Hive-Engine/app.js` → `services/hive-engine/app.js`

#### 0.5 Copy NFT files
- [ ] Copy `~/Desktop/Terracore NFT/app.js` → `services/nft/app.js`
- [ ] Copy `~/Desktop/Terracore NFT/db.js` → `services/nft/db.js`
- [ ] Copy `~/Desktop/Terracore NFT/dev.js` → `services/nft/dev.js`
- [ ] Copy `~/Desktop/Terracore NFT/jslib.js` → `services/nft/jslib.js`
- [ ] Copy `~/Desktop/Terracore NFT/data/` → `services/nft/data/` (225 JSON templates)
- [ ] Copy `~/Desktop/Terracore NFT/images/` → `services/nft/images/` (338MB — disk only, gitignored)

#### 0.6 Update .gitignore
- [ ] Add `services/nft/images/` to `.gitignore` (338MB too large for git)
- [ ] Verify `node_modules` is still ignored

#### 0.7 Audit NFT dependencies (no package.json exists — must check manually)
- [ ] Check `chalk` version installed in `~/Desktop/Terracore NFT/node_modules/chalk/package.json`
- [ ] Check `node-fetch` version installed there
- [ ] Check `sharp` version installed there
- [ ] Check `seedrandom` version installed there
- [ ] Confirm all are compatible with pins in step 0.8

#### 0.8 Create root package.json
- [ ] Write root `package.json` with merged, pinned deps (see template below)
- [ ] Run `npm install` from repo root
- [ ] Confirm zero `MODULE_NOT_FOUND` or version conflict errors

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

> **Critical pins:** `chalk@4` and `node-fetch@2` are pinned to major version — v5/v3 are ESM-only and break `require()`.

#### 0.9 Update .env with prefixed webhook names
Current `.env` has `DISCORD_WEBHOOK` pointing to different channels in each repo — this collides. Add prefixed versions:

- [ ] Add `SC_DISCORD_WEBHOOK` (was `DISCORD_WEBHOOK` in Smart Contract)
- [ ] Add `SC_DISCORD_WEBHOOK_2` (was `DISCORD_WEBHOOK_2`)
- [ ] Add `SC_DISCORD_WEBHOOK_3` (was `DISCORD_WEBHOOK_3`)
- [ ] Add `HE_DISCORD_WEBHOOK` (was `DISCORD_WEBHOOK` in Hive Engine)
- [ ] Add `HE_MARKET_WEBHOOK` (was `MARKET_WEBHOOK`)
- [ ] Add `HE_BOSS_WEBHOOK` (was `BOSS_WEBHOOK`)
- [ ] Add `HE_FORGE_WEBHOOK` (was `FORGE_WEBHOOK`)
- [ ] Add `NFT_DISCORD_WEBHOOK` (was `DISCORD_WEBHOOK` in NFT)
- [ ] Add `NFT_DISCORD_WEBHOOK2` (was `DISCORD_WEBHOOK2`)
- [ ] Add `NFT_DISCORD_WEBHOOK3` (was `DISCORD_WEBHOOK3`)
- [ ] Add `NFT_DISCORD_WEBHOOK4` (was `DISCORD_WEBHOOK4`)
- [ ] Shared keys stay unchanged: `MONGO_URL`, `POSTING_KEY`, `ACTIVE_KEY`, `ACTIVE_KEY2`, `FUNKY_POSTING`, `FUNKY_ACTIVE`

#### 0.10 Fix dotenv path in all 4 service files
Each file moves two directories deeper — dotenv can't find `.env` without an explicit path.

Change this line in all 4 files:
```javascript
// Before
require('dotenv').config();

// After
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
```

- [ ] `services/smart-contract/app.js`
- [ ] `services/lb-rewards/app.js`
- [ ] `services/hive-engine/app.js`
- [ ] `services/nft/app.js`

#### 0.11 Update webhook variable references in each service file
- [ ] `services/smart-contract/app.js` — replace `DISCORD_WEBHOOK` → `SC_DISCORD_WEBHOOK`, `DISCORD_WEBHOOK_2` → `SC_DISCORD_WEBHOOK_2`, `DISCORD_WEBHOOK_3` → `SC_DISCORD_WEBHOOK_3`
- [ ] `services/hive-engine/app.js` — replace `DISCORD_WEBHOOK` → `HE_DISCORD_WEBHOOK`, `MARKET_WEBHOOK` → `HE_MARKET_WEBHOOK`, `BOSS_WEBHOOK` → `HE_BOSS_WEBHOOK`, `FORGE_WEBHOOK` → `HE_FORGE_WEBHOOK`
- [ ] `services/nft/app.js` — replace `DISCORD_WEBHOOK` → `NFT_DISCORD_WEBHOOK`, `DISCORD_WEBHOOK2` → `NFT_DISCORD_WEBHOOK2`, `DISCORD_WEBHOOK3` → `NFT_DISCORD_WEBHOOK3`, `DISCORD_WEBHOOK4` → `NFT_DISCORD_WEBHOOK4`

#### 0.12 Extract shared modules
- [ ] Create `shared/retry.js` — extract `retryWithBackoff()` and `sleep()` from `lb-rewards.js` (~lines 174–199)
- [ ] Create `shared/he-node.js` — extract `findNode()`, `updateNodesFromBeacon()`, `fetchWithTimeout()`, `checkNode()`, `validateNode()`, `fallbackNodes[]` from `lb-rewards.js` (~lines 14–162)
- [ ] Create `shared/hive-node.js` — extract `testNodeEndpoints()` from `services/smart-contract/app.js`
- [ ] Update `services/lb-rewards/app.js` to `require('../../shared/retry')` and `require('../../shared/he-node')` instead of inline copies
- [ ] Update `services/hive-engine/app.js` to require the same shared modules

> **Do NOT share:** `sendTransaction()` (different queue collection per service), `rollDice()`/`createSeed()` (deterministic RNG — different per service, must not change), Discord webhook helpers (different shape per service).

#### 0.13 Create ecosystem.config.js
- [ ] Write `ecosystem.config.js` at repo root (see template below)

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

#### 0.14 Validate all 4 services load without errors
Run each manually (Ctrl+C once it starts connecting — just checking for startup errors):
- [ ] `node services/smart-contract/app.js` — confirm no crash, Hive stream connects
- [ ] `node services/lb-rewards/app.js` — confirm no crash, MongoDB connects
- [ ] `node services/hive-engine/app.js` — confirm no crash
- [ ] `node services/nft/app.js` — confirm no crash

#### 0.15 Commit Phase 0 to git
- [ ] `git add services/ shared/ ecosystem.config.js package.json`
- [ ] Verify `.env` is NOT staged (it's gitignored)
- [ ] `git commit -m "feat: restructure into monorepo"`
- [ ] `git push`

---

### Phase 1 — Cut over lb-rewards ✦ LOWEST RISK
*All steps below happen on the production server after pulling from GitHub.*
*15-min cycle, no real-time player impact. Best service to test first.*

- [ ] `git pull && npm install`
- [ ] Run manually first: `node services/lb-rewards/app.js` — let it complete one full 15-min cycle
- [ ] Confirm SCRAP distribution fired in Discord
- [ ] Stop old process: `pm2 stop <old-lb-rewards-id>`
- [ ] Start new: `pm2 start ecosystem.config.js --only tc-lb-rewards`
- [ ] Monitor for 2 full cycles (~30 min) — confirm distributions continue normally
- [ ] `pm2 save` to persist new process list

---

### Phase 2 — Cut over Hive Engine
*HE transaction queue (`he-transactions` collection) is isolated — no overlap with other services.*

- [ ] `pm2 stop <old-hive-engine-id>`
- [ ] `pm2 start ecosystem.config.js --only tc-hive-engine`
- [ ] Monitor 30 min — watch for upgrade/boss fight/forge Discord notifications
- [ ] Confirm no errors in `pm2 logs tc-hive-engine`
- [ ] `pm2 save`

---

### Phase 3 — Cut over NFT
*Most complex service (2,100+ lines, 8 transaction queue types). Give it 1 hour of observation.*

- [ ] Verify `services/nft/images/` exists on server disk (338MB was copied, not in git)
- [ ] `pm2 stop <old-nft-id>`
- [ ] `pm2 start ecosystem.config.js --only tc-nft`
- [ ] Monitor 1 hour — watch marketplace listings, crate opens, item transfers in Discord
- [ ] Confirm `pm2 logs tc-nft` is clean
- [ ] `pm2 save`

---

### Phase 4 — Cut over Smart Contract ✦ HIGHEST RISK
*Real-time player impact. Do this during low-traffic hours (late night). Have rollback command ready.*

**Rollback command (if anything goes wrong):**
```bash
pm2 stop tc-smart-contract && pm2 start <old-smart-contract-script>
```

- [ ] Schedule during off-peak hours
- [ ] `pm2 stop <old-smart-contract-id>`
- [ ] `pm2 start ecosystem.config.js --only tc-smart-contract`
- [ ] Monitor 1 hour — watch battles, quest completions, token claims in Discord
- [ ] Confirm `pm2 logs tc-smart-contract` is clean
- [ ] `pm2 save`

---

### Phase 5 — Cleanup (after 1 week stable)
- [ ] Confirm all 4 processes have been running stable for 7+ days
- [ ] Archive or delete old server deployments for Hive-Engine and NFT repos
- [ ] Update GitHub repo description to reflect monorepo
- [ ] Update README.md with new startup commands (`pm2 start ecosystem.config.js`)
- [ ] Optionally: archive the old GitHub repos (don't delete — keep as historical reference)

---

## Key Risks Reference

| Risk | Mitigation |
|------|-----------|
| `chalk@5` / `node-fetch@3` break `require()` | Pinned to `^4` / `^2` in root package.json |
| NFT has no `package.json` — unknown versions | Step 0.7: audit actual installed versions before writing package.json |
| dotenv can't find `.env` from subdirectory | Explicit `path.join(__dirname, '../../.env')` in all service files (step 0.10) |
| 338MB NFT images blow up git repo | `services/nft/images/` in `.gitignore` (step 0.6) |
| Production breaks during cutover | Old repos untouched on disk; rollback = restart old PM2 process |
| `db.js` `__dirname` paths break after move | Already uses `__dirname`-relative paths — self-corrects automatically |
