const { DateTime }    = require('luxon')
const yahooFinance    = require('yahoo-finance2').default;
const Bottleneck      = require('bottleneck');
const rawTickers      = require('../data/tickers.json');

const ALL_TICKERS = rawTickers.filter(t => !t.includes('^'));

const limiter = new Bottleneck({
  reservoir:              300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                200
});

/**
 * Fetch and filter “top movers” cheaply via Yahoo Finance.
 *
 * @param {object} options
 * @param {string[]} options.whitelist  – if provided, only scan these symbols
 * @param {number}   options.priceMax
 * @param {number}   options.volumeMin
 * @param {number}   options.floatMax
 * @param {number}   options.changePctMin
 * @param {number|null} options.preMarketMin  – only filter pre-market if non-null
 *
 * @returns {Promise<string[]>}
 */
async function getTopMovers(options = {}) {
  const {
    whitelist,
    priceMax     = 85,
    volumeMin    = 1_000_000,
    floatMax     = 50_000_000,
    changePctMin = 2.5,
    preMarketMin = 8
  } = options;

  // decide which universe to scan
  const universe = Array.isArray(whitelist) ? whitelist : ALL_TICKERS;
  console.log(`✳️  moversService scanning ${universe.length} symbols from ${whitelist ? 'whitelist' : 'ALL_TICKERS'}`);

  // detect pre-market clock (4:00–9:30 EST)
  const estNow = DateTime.now().setZone('America/New_York');
  const h = estNow.hour;
  const m = estNow.minute;
  const isPreMarket = (h >= 4 && (h < 9 || (h === 9 && m < 30)));

  const candidates = [];

  for (let i = 0; i < universe.length; i++) {
    const symbol = universe[i];
    try {
      const quote = await limiter.schedule(() =>
        yahooFinance.quote(symbol, { modules: ['price'] })
      );

      const price           = quote[ isPreMarket ? 'preMarketPrice' : 'regularMarketPrice' ];
      const volume          = quote[ isPreMarket ? 'preMarketVolume' : 'regularMarketVolume' ];
      const floatShares     = quote.sharesOutstanding;
      const changePct       = quote.regularMarketChangePercent;
      const preMarketChange = quote.preMarketChangePercent;

      // baseline liquidity & price & float filter
      let ok =
           price       != null && price       <= priceMax
        && volume      != null && volume      >= volumeMin
        && floatShares != null && floatShares <= floatMax;

      if (ok) {
        if (isPreMarket && preMarketMin != null) {
          ok = preMarketChange != null && preMarketChange >= preMarketMin;
        } else {
          ok = changePct != null && changePct >= changePctMin;
        }
      }

      if (ok) candidates.push(symbol);
    } catch (err) {
      console.warn(`⚠️  Skipped ${symbol}: ${err.message}`);
    }

    if (i > 0 && i % 100 === 0) {
      console.log(`📊  Checked ${i}/${universe.length}, found ${candidates.length} so far`);
    }
  }

  return candidates;
}

module.exports = { getTopMovers };
