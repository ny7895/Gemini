
const fs           = require('fs');
const path         = require('path');
const yahooFinance = require('yahoo-finance2').default;
const { savePriceSnapshots } = require('../utils/db.cjs');
require('dotenv').config();

const RAW_TICKERS     = require('../data/tickers.json');
const OUT_FILE        = path.resolve(__dirname, '../data/filterTickers.json');

// Rate‐limit parameters
const BATCH_SIZE       = 60;
const BATCH_INTERVAL   = 60 * 1000;  // 60 seconds

async function buildFilterList() {
  const snapshots = [];
  const filtered  = [];

  for (let i = 0; i < RAW_TICKERS.length; i += BATCH_SIZE) {
    const batch = RAW_TICKERS.slice(i, i + BATCH_SIZE);

    for (const symbol of batch) {
      if (symbol.includes('^')) continue;

      try {
        const q     = await yahooFinance.quote(symbol, { modules: ['price'] });
        const close = q.regularMarketPrice;

        snapshots.push({
          symbol,
          lastClose: close != null ? close : 0
        });

        if (close != null && close >= 0.01 && close <= 150) {
          filtered.push(symbol);
        }
      } catch (err) {
        console.warn(`⚠️ ${symbol} snapshot failed: ${err.message}`);
      }
    }

    // if there’s another batch to do, wait before continuing
    if (i + BATCH_SIZE < RAW_TICKERS.length) {
      console.log(`⏱️ Batch ${i / BATCH_SIZE + 1} done, waiting ${BATCH_INTERVAL/1000}s...`);
      await new Promise(r => setTimeout(r, BATCH_INTERVAL));
    }
  }

  // 1) save into priceSnapshots
  savePriceSnapshots(snapshots);

  // 2) write out filtered tickers for the scanner whitelist
  fs.writeFileSync(OUT_FILE, JSON.stringify(filtered, null, 2));

  console.log(`✅ Snapshot complete: processed ${snapshots.length} symbols, wrote ${filtered.length} to ${OUT_FILE}`);
}

if (require.main === module) {
  buildFilterList().catch(err => {
    console.error('❌ snapshot job failed:', err);
    process.exit(1);
  });
}

module.exports = { buildFilterList };
