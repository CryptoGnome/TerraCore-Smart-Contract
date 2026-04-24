# TerraCore Smart Contract

Blockchain game backend running on Hive and Hive Engine. Handles battles, quests, claims, NFTs, and leaderboard rewards in a single unified process.

Play the game at [terracoregame.com](https://www.terracoregame.com/).

## Setup

```bash
git clone https://github.com/CryptoGnome/TerraCore-Smart-Contract.git
cd TerraCore-Smart-Contract
npm install
cp .env.example .env   # fill in keys
```

## Start

```bash
pm2 start ecosystem.config.js
pm2 logs tc-terracore
```

## Update

```bash
git pull && npm install && pm2 restart tc-terracore && pm2 logs tc-terracore
```
