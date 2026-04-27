# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ecosystem Awareness

This module is one of three interconnected parts of TerraCore. Changes here are the highest-impact because this is the **sole writer** to MongoDB and the source of all on-chain actions.

| Module | Location | Impact on this module |
|--------|----------|-----------------------|
| **API** | `../TerraCore API/` | Reads every MongoDB field this module writes — renaming, removing, or restructuring a field breaks API responses immediately |
| **Frontend** | `../Terracore FE/` | Reflects game mechanics in its UI — changes to battle math, reward amounts, quest logic, or new operation types need corresponding frontend updates |

**Before renaming or removing a MongoDB field:** grep `../TerraCore API/app.js` for the field name.
**Before changing token amounts, cooldowns, or game mechanics:** check `../Terracore FE/src/` for hardcoded values or logic that mirrors those rules.
**Before shipping any cost, burn rate, reward amount, or mechanic change:** bump the API version in `../TerraCore API/package.json` (format `YYYY.MM.patch`), update `released` in the `/version` handler in `../TerraCore API/app.js`, and update the `API version:` line in `../Terracore FE/public/llms.txt`. Bots rely on this signal to know when to re-read pricing and operation docs.
**Before adding a new custom JSON operation type:** the frontend will need a new signing flow and the API may need a new endpoint to expose its state.
**Before changing a collection name or schema shape:** both the API and any frontend polling that collection will break.

The root `../CLAUDE.md` has the full system architecture overview.

---

## Project Overview

TerraCore is a blockchain-based game backend built on the **Hive blockchain** with **Hive Engine** smart contracts. Players register, battle, and complete quests to earn SCRAP tokens. This is a production Node.js monorepo running as a **single unified process**.

## Running the Application

```bash
# Install dependencies
npm install

# Start the unified process
pm2 start ecosystem.config.js

# Pull latest and restart
git pull && npm install && pm2 restart tc-terracore && pm2 logs tc-terracore
```

No test suite is configured.

## Environment Variables (`.env`)

| Variable | Purpose |
|----------|---------|
| `MONGO_URL` | MongoDB Atlas connection string |
| `ACTIVE_KEY` | Hive active key for `terracore` account (transfers, token ops) |
| `ACTIVE_KEY2` | Hive active key for FLUX issuance account |
| `NFT_ACTIVE_KEY` | Hive active key for `terracore.market` account |
| `FUNKY_ACTIVE` | Hive active key for FUNKY-related operations |
| `SC_DISCORD_WEBHOOK` | Smart contract — general notifications |
| `SC_DISCORD_WEBHOOK_2` | Smart contract — registration notifications |
| `SC_DISCORD_WEBHOOK_3` | Smart contract — quest completion notifications |
| `HE_DISCORD_WEBHOOK` | Hive Engine — general notifications |
| `HE_MARKET_WEBHOOK` | Hive Engine — marketplace notifications |
| `HE_BOSS_WEBHOOK` | Hive Engine — boss fight notifications |
| `HE_FORGE_WEBHOOK` | Hive Engine — forge notifications |
| `NFT_DISCORD_WEBHOOK` | NFT — general notifications |
| `NFT_DISCORD_WEBHOOK2` | NFT — secondary notifications |
| `NFT_DISCORD_WEBHOOK3` | NFT — item mint notifications |
| `NFT_DISCORD_WEBHOOK4` | NFT — additional notifications |

## Architecture

This is a **monorepo running as a single PM2 process** (`tc-terracore`). One Hive L1 stream, one Hive Engine stream, and the lb-rewards timer share a single MongoDB connection and Node.js event loop.

### Entry Point: `services/app.js`
- Connects MongoDB once; populates all per-service context objects
- Starts one `hive.api.streamBlock()` → routes each operation to both SC and NFT handlers
- Starts one `ssc.stream()` → routes to HE handlers
- Runs lb-rewards cycle as a non-blocking background loop (every 15 min)
- Unified heartbeat: exits if L1 or HE stream silent > 30s (PM2 restarts)

### Service Modules

| Service | Entry | Handles |
|---------|-------|---------|
| `services/smart-contract/` | `lib/handlers.js` | Registration, battles, quests, claims (Hive L1) |
| `services/nft/` | `lib/handlers.js` | Marketplace, crates, equip, salvage, consumables (Hive L1) |
| `services/hive-engine/` | `lib/handlers.js` | Upgrades, boss fights, crate buys, forges, quests (HE stream) |
| `services/lb-rewards/` | `cycle.js` | SCRAP distribution, FLUX management, revenue (15-min timer) |

Each service has its own `context.js` (db, client, wif, webhooks). The unified `services/app.js` populates all of them from the single shared connection — the lib modules themselves need no changes when run standalone vs unified.

### Shared Modules (`shared/`)

| File | Purpose |
|------|---------|
| `shared/rng.js` | `createSeed`, `rollDice`, `adjustedRoll`, `generateRandomNumber` — used by SC, HE, and NFT |
| `shared/he-node.js` | Beacon API node discovery + fallback list for Hive Engine |
| `shared/retry.js` | `retryWithBackoff()` — used by lb-rewards |

## Key Design Patterns

**Deterministic RNG:** All combat and quest rolls use `seedrandom` via `shared/rng.js`, seeded with `blockId + '@' + trxId + '@' + context`. Never replace with `Math.random()` for seeded paths — outcomes must be reproducible and verifiable on-chain. NFT crates keep their own `rollDice` (0.10 lower bound vs 0.01 in shared).

**Transaction Queue:** Game state changes are never broadcast directly. They are inserted into a MongoDB queue collection and processed asynchronously by `checkTransactions()` / `sendTransactions()`. SC uses `transactions`, HE uses `he-transactions`, NFT uses `market-transactions` / `crate-transactions`.

**Node Rotation:** `services/app.js` tests Hive L1 API endpoints at startup and uses the fastest responder. `shared/he-node.js` batch-tests Hive Engine nodes via Beacon API with fallback to hardcoded nodes.

**Bulk DB Writes:** Player stat updates use `collection.bulkWrite()` with `updateOne` operations to minimize round-trips.

**Context Pattern:** Each service's `lib/*.js` reads from its own `../context.js` singleton. The unified entry point populates these before starting streams — so standalone and unified modes share the same module code.

## MongoDB Collections

| Collection | Purpose |
|-----------|---------|
| `players` | Player stats (scrap, damage, defense, engineering, cooldowns) |
| `active-quests` | In-progress quests |
| `quest-template` | Quest definitions |
| `quest-log` | Quest action audit log |
| `battle_logs` | Combat records including seeds, rolls, stolen scrap |
| `registrations` | Player registration records |
| `claims` | Token claim tracking |
| `transactions` | SC pending transaction queue |
| `he-transactions` | HE pending transaction queue |
| `market-transactions` | NFT marketplace transaction queue |
| `crate-transactions` | NFT crate open queue |
| `referrers` | Referral relationships and bonuses |
| `price_feed` | Game configuration (registration fee, referral %) |
| `stats` | Daily aggregate player counts |
| `lastUsedEndpoint` | Hive L1 node selection history |
| `hashes` | Processed HE transaction dedup store |
| `rejectedHashes` | Rejected HE transaction log |
| `relics` | Quest reward relics per player |
| `items` | Minted NFT items |
| `item-templates` | NFT item base definitions |
| `item-count` | Global NFT mint counter |
| `crates` | Unopened crates held by players |
| `nft-mints` | NFT mint audit log |

## Blockchain Integration

- **Hive blockchain:** `@hiveio/hive-js` — streams blocks, reads custom JSON memos, broadcasts transfers
- **Hive Engine (SSC):** `sscjs` — mints SCRAP tokens, places DEX orders for FLUX token management
- Token contract IDs: `SCRAP`, `FLUX`, `SWAP.HIVE`

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically SSHs into the server and runs `git pull && npm install && pm2 restart tc-terracore` when a new release is published on GitHub. Required secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `SERVER_PATH`.

## Development Principles

This is a production system handling real token transfers and blockchain broadcasts. Mistakes here affect real players and real money. Apply these principles on every change:

**Think before coding.** Before touching any code, state your interpretation of the task out loud and surface any tradeoffs or ambiguities. If a request could mean two different things — especially around token math, battle mechanics, or payout logic — ask rather than assume. Never silently guess and proceed.

**Simplicity first.** Write the minimum code that solves the stated problem. Don't add speculative features, extra abstractions, or "while I'm here" cleanup. The existing patterns (`retryWithBackoff`, `bulkWrite`, the transaction queue) already handle resilience and atomicity — extend them rather than inventing alternatives.

**Surgical changes only.** Edit exactly what was asked. Don't refactor surrounding code, rename variables, or remove dead code unless explicitly requested. The RNG seeding, transaction queue flow, and node rotation logic are production-proven — leave them alone unless the task specifically targets them.

**Define success before writing code.** Since there is no test suite, write down what correct behavior looks like before editing anything. For a bug fix: describe the exact wrong output and the exact expected output. For a new feature: describe the observable end state. Use that as your acceptance criterion and don't stop until it's met.

**Extra caution on money-touching code.** Any function that mints SCRAP, places DEX orders, distributes FLUX, or broadcasts a Hive transfer gets a second read-through before you consider it done. Confirm amounts, recipients, and conditions are exactly right — there is no rollback on a blockchain transaction.

**Update the changelog.** Every commit that ships a change must have a corresponding entry in `../CHANGELOG.md` — one bullet describing what changed and why. Add it before or immediately after committing.
