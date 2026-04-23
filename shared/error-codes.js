const SEVERITY = {
    FATAL: 'FATAL',
    ERROR: 'ERROR',
    WARN:  'WARN',
};

const CODES = {
    // System / Infrastructure
    SYS_MONGO_CLOSED:         { description: 'MongoDB topology closed unexpectedly',       severity: SEVERITY.FATAL },
    SYS_MONGO_RECONNECT_FAIL: { description: 'MongoDB reconnection attempt failed',        severity: SEVERITY.FATAL },
    SYS_L1_STREAM_STALE:      { description: 'Hive L1 block stream has gone silent',       severity: SEVERITY.FATAL },
    SYS_HE_STREAM_STALE:      { description: 'Hive Engine stream has gone silent',         severity: SEVERITY.FATAL },
    SYS_STARTUP_FAIL:         { description: 'Fatal error during process startup',         severity: SEVERITY.FATAL },
    SYS_HE_NODE_ALL_FAILED:   { description: 'All Hive Engine nodes failed connectivity',  severity: SEVERITY.ERROR },
    SYS_BEACON_UPDATE_FAIL:   { description: 'HE beacon node list update failed',          severity: SEVERITY.WARN  },

    // Smart Contract service
    SC_BATTLE_SCRAP_NAN:       { description: 'scrapToSteal computed as NaN in battle()',  severity: SEVERITY.ERROR },
    SC_BATTLE_SCRAP_ZERO:      { description: 'scrapToSteal <= 0 after caps applied',      severity: SEVERITY.ERROR },
    SC_BATTLE_BULK_WRITE_FAIL: { description: 'bulkWrite did not modify 2 documents',      severity: SEVERITY.ERROR },
    SC_BATTLE_UNEXPECTED:      { description: 'Unexpected error in battle()',               severity: SEVERITY.ERROR },
    SC_CLAIM_BROADCAST_FAIL:   { description: 'customJson broadcast returned falsy',        severity: SEVERITY.ERROR },
    SC_CLAIM_UNEXPECTED:       { description: 'Unexpected error in claim()',                severity: SEVERITY.ERROR },
    SC_QUEST_SELECT_FAIL:      { description: 'selectQuest() threw an unexpected error',   severity: SEVERITY.ERROR },
    SC_QUEST_PROGRESS_FAIL:    { description: 'progressQuest() threw an unexpected error', severity: SEVERITY.ERROR },
    SC_QUEST_COMPLETE_FAIL:    { description: 'completeQuest() threw an unexpected error', severity: SEVERITY.ERROR },
    SC_QUEUE_TX_FAIL:          { description: 'sendTransactions() loop threw unexpectedly', severity: SEVERITY.ERROR },
    SC_REGISTER_FAIL:          { description: 'register() threw an unexpected error',      severity: SEVERITY.ERROR },

    // Hive Engine service
    HE_HANDLER_FLUX_PARSE:     { description: 'Error parsing FLUX burn memo/payload',      severity: SEVERITY.WARN  },
    HE_QUEUE_TX_FAIL:          { description: 'HE sendTransactions() threw unexpectedly',  severity: SEVERITY.ERROR },
    HE_BOSS_FIGHT_FAIL:        { description: 'bossFight() threw an unexpected error',     severity: SEVERITY.ERROR },
    HE_UPGRADE_FAIL:           { description: 'Stat upgrade threw an unexpected error',    severity: SEVERITY.ERROR },
    HE_FORGE_FAIL:             { description: 'Item forge threw an unexpected error',      severity: SEVERITY.ERROR },
    HE_QUEST_FAIL:             { description: 'HE quest processing failed',                severity: SEVERITY.ERROR },

    // NFT service
    NFT_QUEUE_TX_FAIL:         { description: 'NFT sendTransactions() threw unexpectedly', severity: SEVERITY.ERROR },
    NFT_CRATE_OPEN_FAIL:       { description: 'open_crate() threw an unexpected error',    severity: SEVERITY.ERROR },
    NFT_MARKETPLACE_FAIL:      { description: 'Marketplace operation failed',              severity: SEVERITY.ERROR },

    // Leaderboard Rewards
    LB_CYCLE_FAIL:             { description: 'runCycle() threw after all retries',        severity: SEVERITY.ERROR },
    LB_REWARD_DIST_FAIL:       { description: 'getRewards() failed for a player',          severity: SEVERITY.WARN  },
    LB_REVENUE_DIST_FAIL:      { description: 'distributeRevenue() failed after retries',  severity: SEVERITY.ERROR },
    LB_SWAP_HIVE_FAIL:         { description: 'withdrawSwapHive() failed after retries',   severity: SEVERITY.ERROR },
};

module.exports = { SEVERITY, CODES };
