const cron  = require('node-cron')
const axios = require('axios')
const { db } = require('../utils/db.cjs')
const { buildFilterList } = require('./priceSnapshots.cjs');

require('dotenv').config()

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL
const SCAN_URL      = 'http://localhost:3000/api/scanner/analyze'

async function runPreMarketScan() {
  try {
    const resp    = await axios.get(SCAN_URL)
    const results = resp.data

    const blocks = []

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Pre-Market Scan Results (${new Date().toLocaleString()} MDT)*`
      }
    })

    for (const c of results) {
      blocks.push({ type: 'divider' })

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${c.symbol}* — _${c.recommendation}_`
        }
      })

      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Price As Of:*\n${new Date(c.timestamp).toLocaleString()}` },
          { type: 'mrkdwn', text: `*Current Price:*\n$${c.price?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*Buy Price:*\n$${c.buyPrice?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*Sell Price:*\n$${c.sellPrice?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*Pre-Mkt %:*\n${c.preMarketChange?.toFixed(1) ?? '—'}%` },
          { type: 'mrkdwn', text: `*RSI:*\n${c.rsi?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*Support:*\n$${c.support?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*Resistance:*\n$${c.resistance?.toFixed(2) ?? '—'}` },
          { type: 'mrkdwn', text: `*GPT Action:*\n${c.action || '—'}` },
          { type: 'mrkdwn', text: `*GPT Rationale:*\n${c.actionRationale || '—'}` }
        ]
      })
    }

    await axios.post(SLACK_WEBHOOK, { blocks })
    console.log('✅ Sent full scan details to Slack')
  } catch (err) {
    console.error('❌ Scheduled scan failed:', err.message)
    console.error(err.stack)
    if (err.response) {
      console.error('→ response.status:', err.response.status)
      console.error('→ response.data:', err.response.data)
    }
    if (SLACK_WEBHOOK) {
      await axios.post(SLACK_WEBHOOK, {
        text: `:warning: Pre-market scan error: ${err.message}`
      })
    }
    throw err
  }
}

cron.schedule('10 2 * * 1-5', runPreMarketScan, {
  timezone: 'America/Denver'
})

// ——— Nightly snapshot + scan summary ———
async function runNightlySnapshot() {
    try {
      // 0) rebuild priceSnapshots table and filterTickers.json
      await buildFilterList();
  
      // 1) count total vs filtered
      const snaps    = db.prepare('SELECT symbol, lastClose FROM priceSnapshots').all();
      const total    = snaps.length;
      const filtered = snaps.filter(r => r.lastClose < 0.01).length;
      const remain   = total - filtered;
  
      // 2) run the actual scan
      const resp    = await axios.get(SCAN_URL);
      const results = resp.data;
  
      // 3) build Slack blocks summary
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
  
      // 4) one line per candidate
      for (const c of results) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• *${c.symbol}* – ${c.recommendation} (Score: ${c.totalScore.toFixed(2)})`
          }
        });
      }
  
      // 5) post to Slack
      await axios.post(SLACK_WEBHOOK, { blocks });
      console.log('✅ Nightly snapshot scan complete');
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
})

module.exports = {
  runPreMarketScan,
  runNightlySnapshot
}
