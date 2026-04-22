# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TerraCore is a blockchain-based game backend built on the **Hive blockchain** with **Hive Engine** smart contracts. Players register, battle, and complete quests to earn SCRAP tokens. This is a production Node.js application.

## Running the Application

```bash
# Install dependencies
npm install

# Run real-time event listener (manages game state)
pm2 start app.js

# Run leaderboard rewards distributor (runs on 15-min intervals)
pm2 start lb-rewards.js

# Pull latest and restart process 0
pm2 stop 0 && git pull && pm2 start 0 && pm2 logs
```

No test suite is configured.

## Environment Variables (`.env`)

| Variable | Purpose |
|----------|---------|
| `MONGO_URL` | MongoDB Atlas connection string |
| `POSTING_KEY` | Hive account posting key (for custom JSON broadcasts) |
| `ACTIVE_KEY` | Hive account active key (for token transfers) |
| `DISCORD_WEBHOOK` | General notifications |
| `DISCORD_WEBHOOK_2` | Registration notifications |
| `DISCORD_WEBHOOK_3` | Quest completion notifications |

## Architecture

The system is **two independent processes**:

### `app.js` — Real-time Event Listener
- Streams Hive blockchain blocks and processes custom JSON operations for game events
- Handles: player registration, battles, quest progression, token claims
- Writes game state to MongoDB, queues Hive Engine token transactions
- Has a heartbeat that restarts the stream if no activity in ~60 seconds
- Broadcasts via `hive.broadcast.customJsonAsync()` and `hive.broadcast.transfer()`

### `lb-rewards.js` — Leaderboard Rewards Distributor
- Runs every 15 minutes to distribute SCRAP tokens, manage FLUX token liquidity, and distribute revenue
- Fetches live Hive Engine node list from Beacon API (`https://beacon.peakd.com/api/he/nodes`) every 30 minutes; falls back to hardcoded nodes
- Uses `retryWithBackoff()` throughout for resilience

## Development Principles

This is a production system handling real token transfers and blockchain broadcasts. Mistakes here affect real players and real money. Apply these principles on every change:

**Think before coding.** Before touching any code, state your interpretation of the task out loud and surface any tradeoffs or ambiguities. If a request could mean two different things — especially around token math, battle mechanics, or payout logic — ask rather than assume. Never silently guess and proceed.

**Simplicity first.** Write the minimum code that solves the stated problem. Don't add speculative features, extra abstractions, or "while I'm here" cleanup. The existing patterns (`retryWithBackoff`, `bulkWrite`, the transaction queue) already handle resilience and atomicity — extend them rather than inventing alternatives.

**Surgical changes only.** Edit exactly what was asked. Don't refactor surrounding code, rename variables, or remove dead code unless explicitly requested. The RNG seeding, transaction queue flow, and node rotation logic are production-proven — leave them alone unless the task specifically targets them.

**Define success before writing code.** Since there is no test suite, write down what correct behavior looks like before editing anything. For a bug fix: describe the exact wrong output and the exact expected output. For a new feature: describe the observable end state. Use that as your acceptance criterion and don't stop until it's met.

**Extra caution on money-touching code.** Any function that mints SCRAP, places DEX orders, distributes FLUX, or broadcasts a Hive transfer gets a second read-through before you consider it done. Confirm amounts, recipients, and conditions are exactly right — there is no rollback on a blockchain transaction.

## Key Design Patterns

**Deterministic RNG:** All combat and quest rolls use `seedrandom` seeded with `blockId + txId + context`. Never replace with `Math.random()` — outcomes must be reproducible and verifiable on-chain.

**Transaction Queue:** Game state changes never broadcast directly. They are inserted into the `transactions` MongoDB collection and processed asynchronously by `checkTransactions()` / `sendTransactions()`. This prevents race conditions.

**Node Rotation:** `app.js` tests Hive API endpoints and uses the fastest responder. `lb-rewards.js` batch-tests Hive Engine nodes via Beacon API, with fallback to hardcoded `fallbackNodes`.

**Bulk DB Writes:** Player stat updates use `collection.bulkWrite()` with `updateOne` operations to minimize round-trips.

## MongoDB Collections

| Collection | Purpose |
|-----------|---------|
| `players` | Player stats (scrap, health, damage, defense, engineering, cooldowns) |
| `active-quests` | In-progress quests |
| `quest-template` | Quest definitions |
| `quest-log` | Quest action audit log |
| `battle_logs` | Full combat records including seeds, rolls, and stolen scrap |
| `registrations` | Player registration records |
| `claims` | Token claim tracking |
| `transactions` | Pending Hive/Hive Engine transactions queue |
| `referrers` | Referral relationships and bonuses |
| `price_feed` | Game configuration (registration fee, referral %) |
| `stats` | Daily aggregate player counts |
| `lastUsedEndpoint` | Hive API node selection history |

## Blockchain Integration

- **Hive blockchain:** `@hiveio/hive-js` — streams blocks, reads custom JSON memos, broadcasts transfers
- **Hive Engine (SSC):** `sscjs` — mints SCRAP tokens, places DEX orders for FLUX token management
- Token contract IDs: `SCRAP`, `FLUX`, `SWAP.HIVE`

## Related Repositories

The full TerraCore game spans multiple repos. The other two smart contract components are available locally on the desktop:

| Repo | Local Path | GitHub |
|------|-----------|--------|
| Hive Engine contract | `~/Desktop/Terracore Hive-Engine/` | https://github.com/CryptoGnome/Terracore-Hive-Engine |
| NFT contract | `~/Desktop/Terracore NFT/` | https://github.com/CryptoGnome/Terracore-NFT |
