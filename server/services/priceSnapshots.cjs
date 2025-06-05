// server/services/priceSnapshots.cjs

const fs           = require('fs');
const path         = require('path');
const yahooFinance = require('yahoo-finance2').default;
const { savePriceSnapshots } = require('../utils/db.cjs');
require('dotenv').config();

const RAW_TICKERS = require('../data/tickers.json');
const OUT_FILE    = path.resolve(__dirname, '../data/filterTickers.json');
const OUT_DIR     = path.dirname(OUT_FILE);

// Rate-limit parameters:
const BATCH_SIZE     = 60;
const BATCH_INTERVAL = 60 * 1000;  // 60 seconds

async function buildFilterList() {
  const snapshots = [];
  const filtered  = [];

  console.log('⤷ Starting price snapshot job...');
  console.log(`⤷ Will eventually write filterTickers.json to: ${OUT_FILE}`);

  for (let i = 0; i < RAW_TICKERS.length; i += BATCH_SIZE) {
    const batch = RAW_TICKERS.slice(i, i + BATCH_SIZE);

    for (const symbol of batch) {
      // Skip indices/special tickers
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
        console.warn(`⚠️  ${symbol} snapshot failed: ${err.message}`);
      }
    }

    // If there’s another batch left, pause a bit
    if (i + BATCH_SIZE < RAW_TICKERS.length) {
      console.log(`⏱️  Batch ${Math.floor(i / BATCH_SIZE) + 1} done, waiting ${BATCH_INTERVAL / 1000}s...`);
      await new Promise(r => setTimeout(r, BATCH_INTERVAL));
    }
  }

  // 1) Save into priceSnapshots (SQLite)
  savePriceSnapshots(snapshots);

  // 2) Ensure the output directory exists:
  try {
    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      console.log(`ℹ️  Created directory: ${OUT_DIR}`);
    }
  } catch (dirErr) {
    console.error(`❌ Failed to create directory ${OUT_DIR}: ${dirErr.message}`);
    // We proceed anyway; writeFileSync below will fail if dir truly missing
  }

  // 3) Write out filtered tickers for the scanner whitelist
  console.log(`⤷ Writing ${filtered.length} symbols to ${OUT_FILE}...`);
  try {
    fs.writeFileSync(OUT_FILE, JSON.stringify(filtered, null, 2));
    console.log(`✅ Snapshot complete: processed ${snapshots.length} symbols, wrote ${filtered.length} to ${OUT_FILE}`);
  } catch (writeErr) {
    console.error(`❌ Failed to write ${OUT_FILE}: ${writeErr.message}`);
  }
}

if (require.main === module) {
  buildFilterList().catch(err => {
    console.error('❌ snapshot job failed:', err);
    process.exit(1);
  });
}

module.exports = { buildFilterList };
