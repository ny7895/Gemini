const express = require('express');
const router  = express.Router();

const { analyzeMarket }        = require('../controllers/scannerController.cjs');
const { db }                   = require('../utils/db.cjs');
const { getLatestCandidates, getScanHistory } = require('../utils/db.cjs');

// Helper to map a DB row into API shape
function mapRow(r) {
  return {
    symbol:              r.symbol,
    price:               r.price,
    volume:              r.volume,
    rsi:                 r.rsi,
    momentum:            r.momentum,
    volumeSpike:         Boolean(r.volumeSpike),
    support:             r.support,
    resistance:          r.resistance,
    floatPercent:        r.floatPercent,
    shortFloat:          r.shortFloat,
    preMarketChange:     r.preMarketChange,
    preMarketVolSpike:   r.preMarketVolSpike,

    score:               r.score,
    setupScore:          r.setupScore,
    earlyCandidate:      Boolean(r.earlyCandidate),

    action:              r.action,
    actionRationale:     r.actionRationale,
    isDayTradeCandidate: Boolean(r.isDayTradeCandidate),
    dayTradeBuyPrice:    r.dayTradeBuyPrice,
    dayTradeSellPrice:   r.dayTradeSellPrice,
    longBuyPrice:        r.longBuyPrice,
    longSellPrice:       r.longSellPrice,

    totalScore:          r.totalScore,
    isTopPick:           Boolean(r.isTopPick),
    combinedReasons:     Array.isArray(r.combinedReasons)
                            ? r.combinedReasons
                            : (r.combinedReasons
                              ? r.combinedReasons.split(', ')
                              : []),
    metrics:             r.metrics ? JSON.parse(r.metrics) : {},

    recommendation:      r.recommendation,
    suggestion:          r.suggestion,
    summary:             r.summary,
    buyPrice:            r.buyPrice,
    sellPrice:           r.sellPrice,

    reasons:             JSON.parse(r.reasons || '[]'),
    setupReasons:        JSON.parse(r.setupReasons || '[]'),
    callPick:            r.callPick ? JSON.parse(r.callPick) : null,

    callAction:          r.callAction,
    callRationale:       r.callRationale,
    callExitPlan:        r.callExitPlan,
    putPick:             r.putPick ? JSON.parse(r.putPick) : null,

    putAction:           r.putAction,
    putRationale:        r.putRationale,
    putExitPlan:         r.putExitPlan,

    timestamp:           r.timestamp
  };
}

// Return latest squeeze candidates
router.get('/candidates', (req, res) => {
  try {
    const rows    = getLatestCandidates();
    const results = rows.map(mapRow);
    res.json(results);
  } catch (err) {
    console.error('❌ Failed to fetch candidates:', err);
    res.status(500).send('Failed to fetch candidates');
  }
});

// Return historical scans, with full result objects
router.get('/history', (req, res) => {
  try {
    const history = getScanHistory();
    const detailed = history.map(entry => {
      const rows = db
        .prepare(
          `SELECT * 
             FROM squeezeCandidates 
            WHERE timestamp = ? 
         ORDER BY id DESC`
        )
        .all(entry.timestamp);

      return {
        timestamp:      entry.timestamp,
        candidateCount: entry.candidateCount,
        results:        rows.map(mapRow)
      };
    });

    res.json(detailed);
  } catch (err) {
    console.error('❌ Failed to fetch history:', err);
    res.status(500).send('Failed to fetch history');
  }
});

// Run full market analysis
router.get('/analyze', analyzeMarket);

// Health check endpoint
router.get('/ping', (req, res) => {
  res.send('Scanner API is alive 🧠');
});

module.exports = router;
