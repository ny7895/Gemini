// server/services/moversService.cjs

const { DateTime } = require('luxon');
const yahooFinance = require('yahoo-finance2').default;
const Bottleneck   = require('bottleneck');
const rawTickers   = require('../data/tickers.json');

const ALL_TICKERS = rawTickers.filter(t => !t.includes('^'));

// We’ll still use Bottleneck to ensure we don’t burst more than ~300 calls/minute.
const limiter = new Bottleneck({
  reservoir:              300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                200
});

/**
 * Fetch and filter “top movers” cheaply via Yahoo Finance. We run up to
 * 5 concurrent quote() calls at once, each further throttled by Bottleneck.
 *
 * @param {object} options
 * @param {string[]} options.whitelist      – if provided, only scan these symbols
 * @param {number}   options.priceMax       – max stock price
 * @param {number}   options.volumeMin      – min volume
 * @param {number}   options.floatMax       – max float shares outstanding
 * @param {number}   options.changePctMin   – min regular‐hour % change
 * @param {number|null} options.preMarketMin – min pre‐market % change (if in pre‐market)
 *
 * @returns {Promise<string[]>}
 */
async function getTopMovers(options = {}) {
  const {
    whitelist,
    priceMax     = 85,
    volumeMin    = 800_000,
    floatMax     = 50_000_000,
    changePctMin = 2.5,
    preMarketMin = 8
  } = options;

  const universe = Array.isArray(whitelist) ? whitelist : ALL_TICKERS;
  console.log(
    `✳️ moversService scanning ${universe.length} symbols from ${
      whitelist ? 'whitelist' : 'ALL_TICKERS'
    }`
  );

  // Detect pre‐market window (4:00–9:30 AM Eastern)
  const estNow = DateTime.now().setZone('America/New_York');
  const h = estNow.hour;
  const m = estNow.minute;
  const isPreMarket = h >= 4 && (h < 9 || (h === 9 && m < 30));

  const candidates = [];
  let checkedCount = 0;

  // Dynamically import p-limit (ESM) and use it to limit to 5 concurrent calls
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(5);

  const quoteTasks = universe.map((symbol) =>
    limit(async () => {
      try {
        // Bottleneck schedules each call to stay under 300 req/min
        const quote = await limiter.schedule(() =>
          yahooFinance.quote(symbol, { modules: ['price'] })
        );

        const price = isPreMarket
          ? quote.preMarketPrice
          : quote.regularMarketPrice;
        const volume = isPreMarket
          ? quote.preMarketVolume
          : quote.regularMarketVolume;

        // Guard missing fields explicitly
        const floatShares = typeof quote.sharesOutstanding === 'number'
          ? quote.sharesOutstanding
          : null;
        const changePct = typeof quote.regularMarketChangePercent === 'number'
          ? quote.regularMarketChangePercent
          : null;
        const preMarketChange = typeof quote.preMarketChangePercent === 'number'
          ? quote.preMarketChangePercent
          : null;

        // Baseline liquidity / price / float filter
        let ok =
          price != null && price <= priceMax &&
          volume != null && volume >= volumeMin &&
          floatShares != null && floatShares <= floatMax;

        if (ok) {
          if (isPreMarket && preMarketMin != null) {
            ok = preMarketChange != null && preMarketChange >= preMarketMin;
          } else {
            ok = changePct != null && changePct >= changePctMin;
          }
        }

        if (ok) {
          candidates.push(symbol);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped ${symbol}: ${err.message}`);
      } finally {
        checkedCount++;
        if (checkedCount % 100 === 0) {
          console.log(
            `📊 Checked ${checkedCount}/${universe.length}, found ${candidates.length} so far`
          );
        }
      }
    })
  );

  await Promise.all(quoteTasks);
  return candidates;
}

module.exports = { getTopMovers };
