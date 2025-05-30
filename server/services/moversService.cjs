// services/moversService.cjs

const yahooFinance = require('yahoo-finance2').default;
const Bottleneck   = require('bottleneck');
const rawTickers   = require('../data/tickers.json');
const { DateTime }    = require('luxon')


const ALL_TICKERS = rawTickers.filter(t => !t.includes('^'));

const limiter = new Bottleneck({
  reservoir:              300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                200
});

/**
 * Fetch and filter your “top movers” cheaply via Yahoo Finance.
 *
 * @param {object} options
 * @param {number} options.priceMax
 * @param {number} options.volumeMin
 * @param {number} options.floatMax
 * @param {number} options.changePctMin
 * @param {number|null} options.preMarketMin  – only filter pre-market if non-null
 */
async function getTopMovers(options = {}) {
  const {
    priceMax     = 85,
    volumeMin    = 1_000_000,
    floatMax     = 50_000_000,
    changePctMin = 2.5,
    preMarketMin = 8    // <- default to null (off)
  } = options;

  // detect pre-market clock (4:00–9:30)
  const estNow = DateTime.now().setZone('America/New_York');
  const h = estNow.hour;
  const m = estNow.minute;
  const isPreMarket = (h >= 4 && (h < 9 || (h === 9 && m < 30)));

  const candidates = [];

  for (let i = 0; i < ALL_TICKERS.length; i++) {
    const symbol = ALL_TICKERS[i];
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
          // only apply pre-market threshold if user set it
          ok = preMarketChange != null && preMarketChange >= preMarketMin;
        } else {
          // otherwise in any session use the regular change %
          ok = changePct != null && changePct >= changePctMin;
        }
      }

      if (ok) candidates.push(symbol);
    } catch (err) {
      console.warn(`⚠️ Skipped ${symbol}: ${err.message}`);
    }

    if (i > 0 && i % 100 === 0) {
      console.log(`📊 Checked ${i}/${ALL_TICKERS.length}, found ${candidates.length} so far`);
    }
  }

  return candidates;
}

module.exports = { getTopMovers };
