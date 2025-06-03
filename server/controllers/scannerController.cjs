// server/controllers/scannerController.cjs

const {
  analyzeSqueezeCandidate,
  analyzeEarlySetup,
  scoreTicker
} = require('../services/aiScoring.cjs');
const { analyzeWithGPT } = require('../services/gptAnalysis.cjs');
const { getTopMovers } = require('../services/moversService.cjs');
const { getFinnhubIndicators } = require('../services/finnhubService.cjs');
const { getYahooIndicators } = require('../services/yahooIndicators.cjs');
const subscriptionManager = require('../services/subscriptionManager.cjs');
const testTickers = require('../data/testList.json');
const { saveResults, getLatestCandidates } = require('../utils/db.cjs');
const log = require('../utils/logger.cjs');
const { analyzeOptionsWithGPT } = require('../services/optionsAnalysisService.cjs');
const filterTickers = require('../data/filterTickers.json');

// Technical helpers
const {
  calculateEMA,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateDonchian
} = require('../utils/technicals.cjs');

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
 * Takes raw market metrics (Finnhub + Yahoo), computes extended indicators,
 * runs technical scoring, static suggestions, GPT analysis, and classification.
 */
async function analyzeMetrics(data) {
  const {
    symbol,
    // Finnhub-provided:
    price,
    volume,
    rsi: rsiRaw,
    momentum,
    volumeSpike,
    support,
    resistance,
    floatPercent: fhFloat,
    shortPercent: fhShort,
    preMarketChange,
    preMarketVolSpike,
    fundamentals: fhFundamentals,
    avg20Volume,
    daysToCover,

    // Yahoo-provided:
    history,
    fundamentals: yhFundamentals,
    floatPercent: yhFloat,
    shortPercent: yhShort
  } = data;

  // Extract a single numeric RSI (last element if array)
  const rsi = Array.isArray(rsiRaw)
    ? rsiRaw[rsiRaw.length - 1]
    : rsiRaw;

  // Merge float/short and fundamentals from Yahoo if available, else from Finnhub
  const floatPercent = yhFloat != null ? yhFloat : fhFloat;
  const shortPercent = yhShort != null ? yhShort : fhShort;
  const fundamentals = {
    ...fhFundamentals,
    ...yhFundamentals
  };

  // Build parallel arrays from history
  const closes = history.map(bar => bar.close);
  const highs = history.map(bar => bar.high);
  const lows = history.map(bar => bar.low);
  const vols = history.map(bar => bar.volume);

  // 1) Compute extended indicators
  const ema10 = calculateEMA(closes, 10);
  const ema50 = calculateEMA(closes, 50);
  const { macdLine, signalLine } = calculateMACD(closes);
  const atr14 = calculateATR(highs, lows, closes, 14);
  const bollinger = calculateBollingerBands(closes, 20, 2);
  const donchian = calculateDonchian(highs, lows, 20);

  // 2) Combined technical score (includes new indicators)
  const combined = scoreTicker({
    price,
    avg20Volume,
    volume,
    volumeSpike,
    rsi,
    momentum,
    support,
    resistance,
    floatPercent,
    shortPercent,
    daysToCover,

    ema10,
    ema50,
    macdLine,
    signalLine,
    atr14,
    bollinger,
    donchian,

    revenueGrowth: fundamentals.revenueGrowth,
    debtToEquity: fundamentals.debtEquity,
    epsTrailingTwelveMonths: fundamentals.epsTrailingTwelveMonths,

    newsCount: data.newsCount || 0,
    socialSentiment: data.socialSentiment || 0,

    preMarketChange,
    preMarketVolSpike
  });

  // 3) Pre-screen
  const aiResult = analyzeSqueezeCandidate({
    rsi,
    shortFloat: shortPercent,
    volumeSpike,
    momentum
  });
  const setupResult = analyzeEarlySetup({
    rsi,
    shortFloat: shortPercent,
    volumeSpike,
    momentum
  });
  if (aiResult.score < 2 && !setupResult.isEarlyCandidate) return null;

  // 4) Static suggestion & hybrid defaults
  const suggestion = generateSuggestion({ rsi, momentum, volumeSpike, support, resistance, price });
  const limitBuy = support ? +(support * 1.02).toFixed(2) : null;
  const marketBuy = price;
  const defaultSell = limitBuy ? +(limitBuy * 1.15).toFixed(2) : null;
  const MOM_THRESHOLD = 0.05;
  const defaultBuy = momentum > MOM_THRESHOLD ? marketBuy : limitBuy;

  let explanation = suggestion;
  let buyPrice = defaultBuy;
  let sellPrice = defaultSell;
  let action = classifySignal({
    score: aiResult.score,
    earlyCandidate: setupResult.isEarlyCandidate,
    rsi,
    momentum
  });
  let actionRationale = explanation;

  // placeholders for GPT-overrides
  let isDay = false;
  let dayBuy = null;
  let daySell = null;
  let longBuy = null;
  let longSell = null;
  log.info(`• [${symbol}] aiResult.score=${aiResult.score}, isEarly=${setupResult.isEarlyCandidate}`);

  // 5) GPT-driven analysis (if qualified)
  if (aiResult.score >= 2) {
    try {
      // Pass all raw arrays and fundamentals to GPT:
      const gpt = await analyzeWithGPT({
        symbol,
        price,
        rsi,
        shortFloat: shortPercent,
        volumeSpike,
        momentum,
        support,
        resistance,

        // Raw arrays of indicators:
        ema10,
        ema50,
        macdLine,
        signalLine,
        atr14,
        bollinger,
        donchian,

        // Single fundamentals object
        fundamentals,

        // Sentiment
        newsCount: data.newsCount || 0,
        socialSentiment: data.socialSentiment || 0,

        // Pre-market
        preMarketChange,
        preMarketVolSpike
      });

      explanation = gpt.explanation;
      action = gpt.action;
      actionRationale = gpt.actionRationale;

      buyPrice = gpt.buyPrice != null ? gpt.buyPrice : defaultBuy;
      sellPrice = gpt.sellPrice != null ? gpt.sellPrice : defaultSell;

      isDay = Boolean(gpt.isDayTradeCandidate);
      dayBuy = gpt.dayTradeBuyPrice;
      daySell = gpt.dayTradeSellPrice;
      longBuy = gpt.longBuyPrice;
      longSell = gpt.longSellPrice;
    } catch (err) {
      log.warn(`⚠️ GPT failed for ${symbol}: ${err.message}`);
    }
  }

  // 6) Return everything (including raw arrays for GPT)
  return {
    symbol,
    price,
    volume,
    rsi,
    momentum,
    volumeSpike,
    support,
    resistance,
    floatPercent: floatPercent,
    shortFloat: shortPercent,

    preMarketChange,
    preMarketVolSpike,

    // extended indicators on entire history (raw arrays)
    ema10,
    ema50,
    macdLine,
    signalLine,
    atr14,
    bollinger,
    donchian,

    // fundamentals & sentiment (nested object)
    fundamentals,

    // Finnhub-provided fields
    avg20Volume,
    daysToCover,

    score: aiResult.score,
    earlyCandidate: setupResult.isEarlyCandidate,
    setupScore: setupResult.setupScore,

    suggestion,
    summary: explanation,

    action,
    actionRationale,

    buyPrice,
    sellPrice,

    isDayTradeCandidate: isDay,
    dayTradeBuyPrice: dayBuy,
    dayTradeSellPrice: daySell,
    longBuyPrice: longBuy,
    longSellPrice: longSell,

    reasons: aiResult.reasons.join(', '),
    setupReasons: setupResult.setupReasons.join(', '),

    totalScore: combined.totalScore,
    combinedReasons: combined.reasons.join(', '),
    metrics: combined.metrics,

    isTopPick: combined.isTopPick
  };
}

/**
 * runFullScan()
 *
 * This is the background function that performs the entire multi‐phase scan
 * and then persists results into SQLite via saveResults(...).
 * We skip any ticker where getYahooIndicators returned null or an empty history array.
 */
async function runFullScan() {
  try {
    const useTest = process.env.USE_TEST_LIST === 'false';
    const whitelistToUse = useTest ? testTickers : filterTickers;
    const tickers = await getTopMovers({ whitelist: whitelistToUse });
    log.info(`📈 Phase 1: ${tickers.length} tickers to check`);

    // Phase 2a: collect Finnhub + Yahoo metrics in timed batches
    const BATCH_SIZE = 20;
    const BATCH_INTERVAL = 60 * 1000;
    const allMetrics = [];

    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      log.info(`🔄 Fetching metrics batch ${i / BATCH_SIZE + 1}`);

      const batchResults = await Promise.all(
        batch.map(async (sym) => {
          try {
            // 1) Finnhub data
            const fhData = await getFinnhubIndicators(sym);
            if (!fhData) return null;

            // 2) Yahoo data
            const yhData = await getYahooIndicators(sym);
            if (
              !yhData ||
              !Array.isArray(yhData.history) ||
              yhData.history.length === 0
            ) {
              log.warn(`⚠️ Skipping ${sym}: no valid Yahoo history`);
              return null;
            }

            // 3) merge both into one object
            return {
              symbol: sym,

              // Combine Finnhub + Yahoo floats/shorts:
              floatPercent:
                yhData.floatPercent != null
                  ? yhData.floatPercent
                  : fhData.floatPercent,
              shortPercent:
                yhData.shortPercent != null
                  ? yhData.shortPercent
                  : fhData.shortPercent,

              // Finnhub fields
              price:            fhData.price,
              volume:           fhData.volume,
              rsi:              fhData.rsi,
              momentum:         fhData.momentum,
              volumeSpike:      fhData.volumeSpike,
              support:          fhData.support,
              resistance:       fhData.resistance,
              preMarketChange:  fhData.preMarketChange,
              preMarketVolSpike: fhData.preMarketVolSpike,
              avg20Volume:      fhData.avg20Volume,
              daysToCover:      fhData.daysToCover,

              // Combined fundamentals
              fundamentals: {
                ...fhData.fundamentals,
                ...yhData.fundamentals
              },

              // Yahoo history (needed for technical indicators)
              history: yhData.history
            };
          } catch (err) {
            log.warn(`⚠️ Data fetch failed for ${sym}: ${err.message}`);
            return null;
          }
        })
      );

      allMetrics.push(...batchResults.filter(Boolean));

      if (i + BATCH_SIZE < tickers.length) {
        log.info(`⏳ Pause ${BATCH_INTERVAL / 1000}s before next batch`);
        await new Promise((r) => setTimeout(r, BATCH_INTERVAL));
      }
    }

    // Phase 2b: analyze collected metrics with limited concurrency
    if (!pLimit) {
      const mod = await import('p-limit');
      pLimit = mod.default;
    }
    const limit = pLimit(5);
    const analysis = allMetrics.map((data) => limit(() => analyzeMetrics(data)));
    const results = (await Promise.all(analysis)).filter(Boolean);

    log.info(`🎯 Analysis done – found ${results.length} candidates.`);

    // Phase 3: inject options + GPT
    for (const candidate of results) {
      try {
        console.log(`[runFullScan] Requesting options for "${candidate.symbol}"`);
        const {
          callPick,
          callAction,
          callRationale,
          callExitPlan,
          putPick,
          putAction,
          putRationale,
          putExitPlan
        } = await analyzeOptionsWithGPT({
          symbol:    candidate.symbol,
          metrics:   candidate,
          isDayTrade: candidate.isDayTradeCandidate
        });

        candidate.callPick      = callPick;
        candidate.callAction    = callAction;
        candidate.callRationale = callRationale;
        candidate.callExitPlan  = callExitPlan;
        candidate.putPick       = putPick;
        candidate.putAction     = putAction;
        candidate.putRationale  = putRationale;
        candidate.putExitPlan   = putExitPlan;
      } catch (err) {
        // If no chain, skip; otherwise log and continue
        if (err.response && err.response.status === 404) {
          console.warn(`⚠️ No options chain for ${candidate.symbol}, skipping options analysis.`);
        } else {
          console.error(`⚠️ options analysis failed for ${candidate.symbol}: ${err.message}`);
        }
      }
    }

    // Phase 4: subscribe & save to DB
    results
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, subscriptionManager.limit)
      .forEach((r) => subscriptionManager.ensure(r.symbol));

    // ─── Stringify nested fields & null‐coalesce before inserting into SQLite ─────────────────────
    const sanitized = results.map((cand) => ({
      symbol:            cand.symbol,
      price:             cand.price ?? null,
      volume:            cand.volume ?? null,
    
      // Bind a single numeric RSI (last element), not the full array
      rsi:               Array.isArray(cand.rsi)
                           ? cand.rsi[cand.rsi.length - 1]
                           : (typeof cand.rsi === 'number' ? cand.rsi : null),
    
      momentum:          cand.momentum ?? null,
      volumeSpike:       cand.volumeSpike ? 1 : 0,
      support:           cand.support ?? null,
      resistance:        cand.resistance ?? null,
      floatPercent:      cand.floatPercent ?? null,
      shortFloat:        cand.shortFloat ?? null,
      preMarketChange:   cand.preMarketChange ?? null,
      preMarketVolSpike: cand.preMarketVolSpike ?? null,
    
      // Raw arrays → JSON strings
      ema10:      JSON.stringify(cand.ema10 ?? []),
      ema50:      JSON.stringify(cand.ema50 ?? []),
      macdLine:   JSON.stringify(cand.macdLine ?? []),
      signalLine: JSON.stringify(cand.signalLine ?? []),
      atr14:      JSON.stringify(cand.atr14 ?? []),
      bollinger:  JSON.stringify(cand.bollinger ?? []),
      donchian:   JSON.stringify(cand.donchian ?? []),
    
      // Fundamentals → JSON string
      fundamentals: JSON.stringify(cand.fundamentals ?? {}),
    
      avg20Volume: cand.avg20Volume ?? null,
      daysToCover: cand.daysToCover ?? null,
    
      score:          cand.score ?? null,
      earlyCandidate: cand.earlyCandidate ? 1 : 0,
      setupScore:     cand.setupScore ?? null,
    
      suggestion:      cand.suggestion ?? null,
      summary:         cand.summary ?? null,
    
      action:          cand.action ?? null,
      actionRationale: cand.actionRationale ?? null,
    
      buyPrice:        cand.buyPrice ?? null,
      sellPrice:       cand.sellPrice ?? null,
    
      isDayTradeCandidate: cand.isDayTradeCandidate ? 1 : 0,
      dayTradeBuyPrice:    cand.dayTradeBuyPrice ?? null,
      dayTradeSellPrice:   cand.dayTradeSellPrice ?? null,
      longBuyPrice:        cand.longBuyPrice ?? null,
      longSellPrice:       cand.longSellPrice ?? null,
    
      reasons:      cand.reasons ?? null,
      setupReasons: cand.setupReasons ?? null,
    
      totalScore:      cand.totalScore ?? null,
      combinedReasons: cand.combinedReasons ?? null,
      metrics:         JSON.stringify(cand.metrics ?? {}),
      isTopPick:       cand.isTopPick ? 1 : 0,
    
      // Option picks → JSON strings
      callPick:      JSON.stringify(cand.callPick ?? {}),
      callAction:    cand.callAction ?? null,
      callRationale: cand.callRationale ?? null,
      callExitPlan:  cand.callExitPlan ?? null,
      putPick:       JSON.stringify(cand.putPick ?? {}),
      putAction:     cand.putAction ?? null,
      putRationale:  cand.putRationale ?? null,
      putExitPlan:   cand.putExitPlan ?? null
    }));

    try {
      saveResults(sanitized);
      log.info(`✅ saveResults() completed; inserted ${sanitized.length} rows.`);
      const newRows = getLatestCandidates();
      log.info('[after saveResults] top timestamp is:', newRows[0]?.timestamp);
    } catch (dbErr) {
      log.error(`❌ saveResults() threw an error: ${dbErr.message}`);
    }

    log.info(`📊 Finished scan: ${tickers.length} checked, ${results.length} candidates.`);
  } catch (err) {
    log.error(`❌ runFullScan error: ${err.message}`);
  }
}

/**
 * triggerScan(req, res)
 *
 * Immediately returns { status: 'Scan started' } and runs runFullScan() in background.
 */
function triggerScan(req, res) {
  runFullScan(); // fire‐and‐forget
  res.json({ status: 'Scan started' });
}

module.exports = {
  triggerScan,
  runFullScan,
  analyzeMarket: triggerScan // kept export in case you want to schedule it elsewhere
};
