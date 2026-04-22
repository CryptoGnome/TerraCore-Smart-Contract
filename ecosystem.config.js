module.exports = {
  apps: [
    {
      name: 'tc-terracore',
      script: './services/app.js',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s'
    }
  ]
};

// Rollback: stop tc-terracore, then start this config
// module.exports = {
//   apps: [
//     { name: 'tc-smart-contract', script: './services/smart-contract/app.js', autorestart: true, max_restarts: 50, min_uptime: '5s' },
//     { name: 'tc-hive-engine',    script: './services/hive-engine/app.js',    autorestart: true, max_restarts: 50, min_uptime: '5s' },
//     { name: 'tc-nft',            script: './services/nft/app.js',            autorestart: true, max_restarts: 50, min_uptime: '5s' },
//     { name: 'tc-lb-rewards',     script: './services/lb-rewards/app.js',     autorestart: true, max_restarts: 10, min_uptime: '30s' }
//   ]
// };
