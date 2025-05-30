const fs         = require('fs');
const path       = require('path');
const Bottleneck = require('bottleneck');
const fetch      = global.fetch || require('node-fetch');
const yahooFinance = require('yahoo-finance2').default;
const technicals = require('../utils/technicals.cjs');
const axios = require('axios');

const API_KEY = process.env.FINNHUB_API_KEY;
if (!API_KEY) throw new Error('Missing FINNHUB_API_KEY');

const CACHE_FILE = path.resolve(__dirname, '../cache/indicatorCache.json');
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); }
  catch { cache = {}; }
}

// ─── Throttlers ─
const fhLimiter = new Bottleneck({
  reservoir:              60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                1000
});
const yhLimiter = new Bottleneck({
  reservoir:              300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                200
});

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Fetches real-time quote and historical data to compute technical indicators.
 * Uses Finnhub for current quote, Yahoo for historical OHLC.
 * Caches results for 5 minutes.
 */
async function getFinnhubIndicators(symbol) {
  const now = Date.now();

  // Return from cache if fresh
  if (cache[symbol] && now - cache[symbol].ts < 5 * 60 * 1000) {
    return cache[symbol].data;
  }

  // 1) Live quote via Finnhub REST
  let quote;
  try {
    quote = await fhLimiter.schedule(() =>
      fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`)
    );
  } catch (err) {
    console.warn(`⚠️ Finnhub quote failed for ${symbol}: ${err.message}`);
    return null;
  }
  const price  = quote.c;
  const volume = quote.v;

  // 2) Historical OHLC (30d daily) via Yahoo Finance
  let history = [];
  try {
    // build a real Date object for “30 days ago”
    const period1 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    history = await yhLimiter.schedule(() =>
      yahooFinance.historical(symbol, {
        period1,           // JS Date 30 days ago
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

  // 3) Compute technical indicators
  const rsi          = technicals.calculateRSI(closes);
  const momentum     = technicals.calculateMomentum(closes);
  const volumeSpike  = technicals.findVolumeSpikes(vols);
  const { support, resistance } = technicals.supportResistance(closes);

  // 4) Assemble payload
  const payload = {
    symbol,
    price,
    volume,
    rsi,
    momentum,
    volumeSpike,
    support,
    resistance,
    floatPercent: null,
    shortPercent: null
  };

  // 5) Cache result
  cache[symbol] = { ts: now, data: payload };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn(`⚠️ Could not write cache file: ${e.message}`);
  }

  return payload;
}

module.exports = { getFinnhubIndicators };