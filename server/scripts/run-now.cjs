
const { runPreMarketScan } = require('../services/scheduler.cjs');

runPreMarketScan()
  .then(() => console.log('✅ Manual scan complete'))
  .catch(err => console.error('❌ Scan failed', err));
