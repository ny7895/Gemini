
const fs           = require('fs');
const path         = require('path');
const Bottleneck   = require('bottleneck');
const fetch        = global.fetch || require('node-fetch');
const yahooFinance = require('yahoo-finance2').default;
const technicals   = require('../utils/technicals.cjs');

const API_KEY = process.env.FINNHUB_API_KEY;
if (!API_KEY) throw new Error('Missing FINNHUB_API_KEY');

const CACHE_FILE = path.resolve(__dirname, '../cache/indicatorCache.json');
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    cache = {};
  }
}

// ─── Throttlers ──────────────────────────────────────────────────────────────
const fhLimiter = new Bottleneck({
  reservoir:               60,
  reservoirRefreshAmount:  60,
  reservoirRefreshInterval: 60 * 1000, // refresh every minute
  minTime:                 1000        // at least 1s between calls
});
const yhLimiter = new Bottleneck({
  reservoir:               300,
  reservoirRefreshAmount:  300,
  reservoirRefreshInterval: 60 * 1000, // refresh every minute
  minTime:                 200         // at least 200ms between calls
});

/**
 * Helper: fetch JSON via node-fetch
 */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * getFinnhubIndicators(symbol)
 *
 * - Quote (free)
 * - Stock fundamentals via /stock/metric (free)
 * - Company news count via /company-news (free)
 * - Historical OHLC from Yahoo-Finance (free)
 *
 * Caches results for 5 minutes.
 */
async function getFinnhubIndicators(symbol) {
  const now = Date.now();

  // 1) Return from cache if fresh
  if (cache[symbol] && now - cache[symbol].ts < 5 * 60 * 1000) {
    return cache[symbol].data;
  }

  // 2) Live quote via Finnhub REST (free)
  let quote;
  try {
    quote = await fhLimiter.schedule(() =>
      fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
      )
    );
  } catch (err) {
    console.warn(`⚠️ Finnhub quote failed for ${symbol}: ${err.message}`);
    return null;
  }
  const price  = quote.c;
  const volume = quote.v;

  // 3) Historical OHLC (30d daily) via Yahoo Finance (free)
  let history = [];
  try {
    const period1 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    history = await yhLimiter.schedule(() =>
      yahooFinance.historical(symbol, {
        period1,
        interval: '1d'
      })
    );
  } catch (err) {
    console.warn(`⚠️ Yahoo history failed for ${symbol}: ${err.message}`);
  }

  const closes = Array.isArray(history)
    ? history.map(d => d.close).filter(v => v != null)
    : [];
  const vols = Array.isArray(history)
    ? history.map(d => d.volume).filter(v => v != null)
    : [];

  // 4) Compute technical indicators (RSI, momentum, volume spike, support/resistance)
  const rsi         = technicals.calculateRSI(closes);
  const momentum    = technicals.calculateMomentum(closes);
  const volumeSpike = technicals.findVolumeSpikes(vols);
  const { support, resistance } = technicals.supportResistance(closes);

  // 5) Fundamentals via /stock/metric (free)
  let revenueGrowth = null;
  let debtToEquity  = null;
  let epsNormalized = null;
  try {
    const fm = await fhLimiter.schedule(() =>
      fetchJSON(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(
          symbol
        )}&metric=all&token=${API_KEY}`
      )
    );
    const m = fm.metric || {};
    revenueGrowth = typeof m.revenueGrowth === 'number' ? m.revenueGrowth : null;
    debtToEquity  = typeof m.debtToEquity === 'number' ? m.debtToEquity : null;
    epsNormalized = typeof m.epsNormalizedAnnual === 'number' ? m.epsNormalizedAnnual : null;
  } catch (err) {
    console.warn(`⚠️ Finnhub fundamentals failed for ${symbol}: ${err.message}`);
  }

  // 6) Company news count (past 24h) via /company-news (free)
  let newsCount = 0;
  try {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const news = await fhLimiter.schedule(() =>
      fetchJSON(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(
          symbol
        )}&from=${from}&to=${to}&token=${API_KEY}`
      )
    );
    if (Array.isArray(news)) {
      newsCount = news.length;
    }
  } catch (err) {
    console.warn(`⚠️ Finnhub company-news failed for ${symbol}: ${err.message}`);
  }

  // 7) Assemble payload
  const payload = {
    symbol,
    price,
    volume,
    rsi,
    momentum,
    volumeSpike,
    support,
    resistance,

    // Fundamental fields
    revenueGrowth,
    debtToEquity,
    epsNormalized,

    // News count
    newsCount
  };

  // 8) Cache result
  cache[symbol] = { ts: now, data: payload };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn(`⚠️ Could not write cache file: ${e.message}`);
  }

  return payload;
}

module.exports = { getFinnhubIndicators };
