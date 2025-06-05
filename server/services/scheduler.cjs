// server/services/scheduler.cjs

const fs    = require('fs');
const path  = require('path');
const cron  = require('node-cron');
const axios = require('axios');
const { db } = require('../utils/db.cjs');
const { buildFilterList } = require('./priceSnapshots.cjs');
require('dotenv').config();

const SLACK_WEBHOOK   = process.env.SLACK_WEBHOOK_URL;
const ANALYZE_URL     = 'http://localhost:3000/api/scanner/analyze';
const CANDIDATES_URL  = 'http://localhost:3000/api/scanner/candidates';

// Path to filterTickers.json so we can delete it before nightly rebuild
const FILTER_FILE = path.resolve(__dirname, '../data/filterTickers.json');

/**
 * Trigger a full-run scan (fire‐and‐forget), then poll /candidates
 * until a new timestamp appears or we hit maxWaitMs.
 *
 * @param {object} options
 * @param {number} options.pollIntervalMs – how often to check (default: 60_000 ms)
 * @param {number} options.maxWaitMs – how long to wait before giving up (default: 30 min)
 * @returns {Promise<Array>} – resolves to the final list of candidate objects
 */
async function triggerScanAndWait({ pollIntervalMs = 60_000, maxWaitMs = 30 * 60_000 } = {}) {
  // 1) Record the existing “latest” timestamp (if any)
  let oldTimestamp = null;
  try {
    const initRes  = await axios.get(CANDIDATES_URL);
    const initData = initRes.data;
    oldTimestamp   = initData[0]?.timestamp || null;
  } catch {
    // no prior data or endpoint unreachable → oldTimestamp stays null
    oldTimestamp = null;
  }

  // 2) Kick off the background scan
  await axios.get(ANALYZE_URL);

  // 3) Poll until we see a new timestamp or exceed maxWaitMs
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const resp = await axios.get(CANDIDATES_URL);
      const data = resp.data;
      const newTimestamp = data[0]?.timestamp || null;

      // If there's a timestamp and it differs from oldTimestamp, the scan is done
      if (newTimestamp && newTimestamp !== oldTimestamp) {
        return data;
      }
    } catch (err) {
      console.warn('Polling /candidates failed:', err.message);
      // continue polling until timeout
    }
  }

  throw new Error(`triggerScanAndWait: timed out after ${maxWaitMs / 1000} seconds`);
}

/**
 * Pre-Market scan: trigger a fresh scan and send results to Slack once ready.
 */
async function runPreMarketScan() {
  try {
    // 1) Trigger scan + poll until completion
    const results = await triggerScanAndWait({
      pollIntervalMs: 60_000,      // check every 60 seconds
      maxWaitMs:      30 * 60_000  // give up after 30 minutes
    });

    // 2) Build Slack blocks
    const blocks = [];
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Pre-Market Scan Results (${new Date().toLocaleString()} MDT)*`
      }
    });

    for (const c of results) {
      blocks.push({ type: 'divider' });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${c.symbol}* — _${c.recommendation || 'n/a'}_`
        }
      });

      const fields = [
        { type: 'mrkdwn', text: `*Price As Of:*\n${new Date(c.timestamp).toLocaleString()}` },
        { type: 'mrkdwn', text: `*Current Price:*\n$${c.price?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*Buy Price:*\n$${c.buyPrice?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*Sell Price:*\n$${c.sellPrice?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*RSI:*\n${c.rsi?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*Support:*\n$${c.support?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*Resistance:*\n$${c.resistance?.toFixed(2) ?? '—'}` },
        { type: 'mrkdwn', text: `*GPT Action:*\n${c.action || '—'}` },
        { type: 'mrkdwn', text: `*GPT Rationale:*\n${c.actionRationale || '—'}` }
      ];

      blocks.push({
        type: 'section',
        fields
      });
    }

    // 3) Post to Slack
    if (SLACK_WEBHOOK) {
      await axios.post(SLACK_WEBHOOK, { blocks });
      console.log('✅ Sent Pre-Market scan details to Slack');
    }
  } catch (err) {
    console.error('❌ Pre-Market scan failed:', err.message);
    if (err.response) {
      console.error('→ response.status:', err.response.status);
      console.error('→ response.data:', err.response.data);
    }
    if (SLACK_WEBHOOK) {
      await axios.post(SLACK_WEBHOOK, {
        text: `:warning: Pre-Market scan error: ${err.message}`
      });
    }
    throw err;
  }
}

cron.schedule('10 2 * * 1-5', runPreMarketScan, {
  timezone: 'America/Denver'
});

/**
 * Nightly snapshot + scan summary: rebuild snapshots, whitelist, then run scan.
 */
async function runNightlySnapshot() {
  try {
    // 0) Delete any existing filterTickers.json so we know it’s rebuilt
    if (fs.existsSync(FILTER_FILE)) {
      fs.unlinkSync(FILTER_FILE);
      console.log(`ℹ️ Deleted old filter list at ${FILTER_FILE}`);
    }

    // 1) Rebuild priceSnapshots table and fresh filter list
    await buildFilterList();

    // 2) Count total vs filtered
    const snaps    = db.prepare('SELECT symbol, lastClose FROM priceSnapshots').all();
    const total    = snaps.length;
    const filtered = snaps.filter(r => r.lastClose < 0.01).length;
    const remain   = total - filtered;

    // 3) Trigger a fresh scan and wait until it completes
    const results = await triggerScanAndWait({
      pollIntervalMs: 60_000,      // check every 60 seconds
      maxWaitMs:      40 * 60_000  // give up after 40 minutes
    });

    // 4) Build Slack summary blocks (limit to 10 candidates)
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Nightly Pre-Market Scan (${new Date().toLocaleString()} MDT)*`
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total tickers:* ${total}` },
          { type: 'mrkdwn', text: `*Filtered < $0.01:* ${filtered}` },
          { type: 'mrkdwn', text: `*To scan:* ${remain}` },
          { type: 'mrkdwn', text: `*Candidates found:* ${results.length}` }
        ]
      },
      { type: 'divider' }
    ];

    for (const c of results.slice(0, 10)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• *${c.symbol}* – ${c.recommendation || 'n/a'}  (Score: ${c.totalScore?.toFixed(2) || '—'})`
        }
      });
    }
    if (results.length > 10) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_…and ${results.length - 10} more candidates…_`
        }
      });
    }

    // 5) Post to Slack
    if (SLACK_WEBHOOK) {
      await axios.post(SLACK_WEBHOOK, { blocks });
      console.log('✅ Nightly snapshot scan complete');
    }
  } catch (err) {
    console.error('❌ Nightly snapshot failed:', err.message);
    if (SLACK_WEBHOOK) {
      await axios.post(SLACK_WEBHOOK, {
        text: `:warning: Nightly scan error: ${err.message}`
      });
    }
    throw err;
  }
}

cron.schedule('30 18 * * 1-5', runNightlySnapshot, {
  timezone: 'America/Denver'
});

module.exports = {
  runPreMarketScan,
  runNightlySnapshot
};
