
const {
  analyzeSqueezeCandidate,
  analyzeEarlySetup, scoreTicker
} = require('../services/aiScoring.cjs');
const { analyzeWithGPT }     = require('../services/gptAnalysis.cjs');
const { getTopMovers }       = require('../services/moversService.cjs');
const { getFinnhubIndicators } = require('../services/finnhubService.cjs');
const subscriptionManager    = require('../services/subscriptionManager.cjs');
const { saveResults }        = require('../utils/db.cjs');
const log                    = require('../utils/logger.cjs');

// p-limit for concurrency control
let pLimit;
(async () => {
  const mod = await import('p-limit');
  pLimit = mod.default;
})();

/**
 * Classifies the signal based on score, early setup, RSI, and momentum.
 */
function classifySignal({ score, earlyCandidate, rsi, momentum }) {
  if (score >= 4) return '🔥 Squeeze Potential';
  if (earlyCandidate) return '📡 Early Watch';
  if (rsi < 40 && momentum > 0.03) return '✅ Buy Signal';
  if (rsi > 70 || momentum < 0) return '❌ Avoid';
  return '⚠️ Neutral';
}

/**
 * Generates a quick suggestion string based on technical metrics.
 */
function generateSuggestion({ rsi, momentum, volumeSpike, support, resistance, price }) {
  const suggestions = [];
  if (rsi < 40 && momentum > 0.03 && volumeSpike) suggestions.push('⚠️ Watch for entry near support.');
  else if (rsi > 70) suggestions.push('🚫 Overbought – avoid entry.');
  if (support && resistance && price) {
    const upside = ((resistance - price) / price) * 100;
    if (upside > 10) suggestions.push('✅ Target: 10%+ upside.');
  }
  if (momentum > 0.05) suggestions.push('📈 Strong momentum – swing potential.');
  else if (momentum < -0.03) suggestions.push('📉 Weak momentum – stay cautious.');
  return suggestions.join(' ') || '🤔 No strong signal detected.';
}

/**
 * Takes raw market metrics and runs technical scoring, static suggestions,
 * GPT analysis, and classification to produce a full result object.
 */
async function analyzeMetrics(data) {
  const {
    symbol, price, volume,
    rsi, momentum, volumeSpike,
    support, resistance,
    shortPercent, floatPercent,
    preMarketChange, preMarketVolSpike,
    fundamentals, avg20Volume, daysToCover
  } = data;
  const shortFloat = shortPercent;

  // 1) Combined technical score
  const combined = scoreTicker({ price, avg20Volume, volume, volumeSpike,
    rsi, momentum, support, resistance, floatPercent, shortPercent, daysToCover
  });

  // 2) Pre‐screen
  const aiResult    = analyzeSqueezeCandidate({ rsi, shortFloat, volumeSpike, momentum });
  const setupResult = analyzeEarlySetup   ({ rsi, shortFloat, volumeSpike, momentum });
  if (aiResult.score < 2 && !setupResult.isEarlyCandidate) return null;

  // 3) Static suggestion & hybrid defaults
  const suggestion  = generateSuggestion(data);
  // calculate both a limit and a market entry
  const limitBuy    = support ? +(support * 1.02).toFixed(2) : null;
  const marketBuy   = price;
  const defaultSell = limitBuy ? +(limitBuy * 1.15).toFixed(2) : null;
  // hybrid: if momentum exceeds threshold, use market; otherwise use limit
  const MOM_THRESHOLD = 0.05;
  const defaultBuy     = momentum > MOM_THRESHOLD
                       ? marketBuy
                       : limitBuy;

  let explanation   = suggestion;
  let buyPrice      = defaultBuy;
  let sellPrice     = defaultSell;

  // default action/rationale
  let action           = classifySignal({
    score: aiResult.score,
    earlyCandidate: setupResult.isEarlyCandidate,
    rsi, momentum
  });
  let actionRationale  = explanation;

  // 4) GPT‐driven analysis (if qualified)
  if (aiResult.score >= 2) {
    try {
      const gpt = await analyzeWithGPT({
        symbol, price, rsi, shortFloat,
        volumeSpike, momentum,
        support, resistance,
        fundamentals
      });
      explanation     = gpt.explanation;
      actionRationale = gpt.explanation;
      action          = gpt.action;
      const gptBuy    = gpt.isDayTradeCandidate
                        ? gpt.dayTradeBuyPrice
                        : gpt.longBuyPrice;
      buyPrice        = gptBuy != null ? gptBuy : defaultBuy;
      sellPrice       = gpt.sellPrice != null ? gpt.sellPrice : defaultSell;
    } catch (err) {
      log.warn(`⚠️ GPT failed for ${symbol}: ${err.message}`);
    }
  }

  // 5) Return everything
  return {
    symbol,
    price,
    preMarketChange,
    preMarketVolSpike,
    volume,
    rsi,
    momentum,
    volumeSpike,
    support,
    resistance,
    float: floatPercent,
    shortFloat,

    score: aiResult.score,
    earlyCandidate: setupResult.isEarlyCandidate,
    setupScore: setupResult.setupScore,

    suggestion,
    summary: explanation,

    // wire action & rationale
    action,
    actionRationale,

    buyPrice,
    sellPrice,

    // day- vs long- targets
    isDayTradeCandidate: Boolean(action === 'Buy'),
    dayTradeBuyPrice:    dayBuy,
    dayTradeSellPrice:   daySell,
    longBuyPrice:        longBuy,
    longSellPrice:       longSell,

    reasons: aiResult.reasons.join(', '),
    setupReasons: setupResult.setupReasons.join(', '),

    totalScore:      combined.totalScore,
    combinedReasons: combined.reasons.join(', '),
    metrics:         combined.metrics,
    isTopPick:       combined.isTopPick
  };
}


/**
 * Main controller: orchestrates a two-phase scan
 * 1) Batch-fetch live metrics via getFinnhubIndicators
 * 2) Analyze those metrics via analyzeMetrics
 */
async function analyzeMarket(req, res) {
  try {
    // Phase 1: pre-screen tickers
    const tickers = await getTopMovers();
    log.info(`📈 Phase 1: ${tickers.length} tickers to check`);

    // Phase 2a: collect metrics in timed batches
    const BATCH_SIZE     = 60;
    const BATCH_INTERVAL = 60 * 1000;
    const allMetrics     = [];

    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      log.info(`🔄 Fetching metrics batch ${i / BATCH_SIZE + 1}`);

      const metrics = await Promise.all(batch.map(sym => getFinnhubIndicators(sym)));
      allMetrics.push(...metrics.filter(Boolean));

      if (i + BATCH_SIZE < tickers.length) {
        log.info(`⏳ Pause ${BATCH_INTERVAL/1000}s before next batch`);
        await new Promise(r => setTimeout(r, BATCH_INTERVAL));
      }
    }

    // Phase 2b: analyze collected metrics with limited concurrency
    if (!pLimit) {
      const mod = await import('p-limit');
      pLimit = mod.default;
    }
    const limit = pLimit(5);
    const analysis = allMetrics.map(data => limit(() => analyzeMetrics(data)));
    const results  = (await Promise.all(analysis)).filter(Boolean);

    log.info(`🎯 Analysis done – found ${results.length} candidates.`);

    // Subscribe top candidates, save, and return
    results.sort((a, b) => b.score - a.score);
    results.slice(0, subscriptionManager.limit).forEach(r => subscriptionManager.ensure(r.symbol));
    saveResults(results);

    log.info(`📊 Finished scan: ${tickers.length} checked, ${results.length} candidates.`);
    res.json(results);
  } catch (err) {
    log.error(`❌ analyzeMarket error: ${err.message}`);
    res.status(500).send('Scan failed');
  }
}

module.exports = { analyzeMarket };
