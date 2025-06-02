const { runNightlySnapshot } = require('../services/scheduler.cjs');

runNightlySnapshot()
  .then(() => console.log('✅ Nightly scan complete'))
  .catch(err => console.error('❌ Scan failed', err));
