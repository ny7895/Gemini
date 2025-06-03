const yahooFinance = require('yahoo-finance2').default; // v2
const yahooLimiter = require('../utils/yahooLimiter.cjs');
const technicals    = require('../utils/technicals.cjs');

async function getYahooIndicators(symbol, lookbackDays = 20) {
  try {
    // ─── 1) QUOTE DATA (v2 structure) ───────────────────────────────────────
    let quote;
    try {
      quote = await yahooLimiter.schedule(() =>
        yahooFinance.quote(symbol, {
          fields: [
            'regularMarketPrice',
            'regularMarketVolume',
            'preMarketPrice',
            'preMarketChange',
            'marketState',
            'regularMarketPreviousClose'
          ]
        })
      );
    } catch (err) {
      console.warn(`[yahooIndicators] ${symbol} · quote() failed:`, err.message);
      return null;
    }

    if (!quote || !quote.regularMarketPrice) {
      console.warn(`[yahooIndicators] ${symbol} · Invalid quote data`);
      return null;
    }

    const marketState   = quote.marketState || 'REGULAR';
    const isPreMarket   = marketState.includes('PRE');
    const currentPrice  = isPreMarket
      ? (quote.preMarketPrice || quote.regularMarketPrice)
      : quote.regularMarketPrice;
    const currentVolume = quote.regularMarketVolume;

    // ─── 2) FUNDAMENTALS & SHORT % (v2 quoteSummary) ─────────────────────────
    let fundamentals  = {};
    let shortPercent  = 0;
    let floatShares   = null;
    let sharesOut     = null;

    try {
      const summary = await yahooLimiter.schedule(() =>
        yahooFinance.quoteSummary(symbol, {
          modules: ['financialData', 'defaultKeyStatistics']
        })
      );

      const fin = summary.financialData ?? {};
      const stat = summary.defaultKeyStatistics ?? {};

      fundamentals = {
        peRatio:          fin.trailingPE                       ?? null,
        revenueGrowth:    fin.revenueGrowth?.raw               ?? null,
        debtEquity:       fin.debtToEquity                      ?? null,
        eps:              fin.epsTrailingTwelveMonths          ?? null,
        floatShares:      stat.floatShares                      ?? null,
        sharesOutstanding: stat.sharesOutstanding                ?? null
      };

      shortPercent = stat.shortPercentFloat ?? 0;
      floatShares  = stat.floatShares       ?? null;
      sharesOut    = stat.sharesOutstanding ?? null;
    } catch (err) {
      console.warn(`[yahooIndicators] ${symbol} · quoteSummary failed:`, err.message);
      fundamentals = {};
      shortPercent = 0;
      floatShares  = null;
      sharesOut    = null;
    }

    // ─── 3) HISTORICAL DATA (v2 historical module) ───────────────────────────
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    let history      = [];
    let usedInterval = 'none';

    const getHistoricalData = async (interval) => {
      try {
        const result = await yahooLimiter.schedule(() =>
          yahooFinance.historical(symbol, {
            period1: startDate,
            period2: endDate,
            interval,
            events: 'history',
            includeAdjustedClose: false
          })
        );
        if (!Array.isArray(result) || result.length === 0) {
          return null;
        }
        // Map to uniform shape (we ignore adjClose if present)
        return result.map(row => ({
          date:   new Date(row.date),
          open:   row.open   ?? null,
          high:   row.high   ?? null,
          low:    row.low    ?? null,
          close:  row.close  ?? null,
          volume: row.volume ?? null
        })).filter(d => d.close !== null);
      } catch (err) {
        console.warn(`[yahooIndicators] ${symbol} · historical(${interval}) failed:`, err.message);
        return null;
      }
    };

    for (const interval of ['1d', '1wk', '1mo']) {
      const data = await getHistoricalData(interval);
      if (data && data.length > 0) {
        history      = data;
        usedInterval = interval;
        break;
      }
    }

    if (!history.length) {
      console.warn(`[yahooIndicators] ${symbol} · No valid historical data`);
      return null;
    }

    // ─── 4) TECHNICAL INDICATORS ──────────────────────────────────────────────
    const technicalsData = {};
    {
      const closes  = history.map(d => d.close).filter(Number);
      const volumes = history.map(d => d.volume).filter(Number);

      technicalsData.rsi         =
        closes.length >= 14
          ? technicals.calculateRSI(closes, 14)
          : null;
      technicalsData.momentum    =
        closes.length >= 2
          ? technicals.calculateMomentum(closes)
          : null;
      technicalsData.volumeSpike =
        volumes.length > 5
          ? technicals.findVolumeSpikes(volumes, 1.5)
          : null;

      const regularSessions = history
        .filter(d => new Date(d.date).getHours() === 16)
        .slice(-5);

      technicalsData.support    = regularSessions.length
        ? Math.min(...regularSessions.map(d => d.low))
        : null;
      technicalsData.resistance = regularSessions.length
        ? Math.max(...regularSessions.map(d => d.high))
        : null;
    }

    // ─── 5) PRE-MARKET CALCULATION ────────────────────────────────────────────
    const preMarketData =
      isPreMarket && typeof quote.preMarketPrice === 'number'
        ? {
            price: quote.preMarketPrice,
            changePercent:
              typeof quote.preMarketChange === 'number'
                ? quote.preMarketChange
                : quote.regularMarketPreviousClose
                  ? ((quote.preMarketPrice - quote.regularMarketPreviousClose) /
                     quote.regularMarketPreviousClose) * 100
                  : null
          }
        : null;

    // ─── 6) FINAL RESULT ─────────────────────────────────────────────────────
    return {
      symbol,
      price:      currentPrice,
      volume:     currentVolume,

      fundamentals: {
        peRatio:          fundamentals.peRatio          ?? null,
        revenueGrowth:    fundamentals.revenueGrowth    ?? null,
        debtEquity:       fundamentals.debtEquity       ?? null,
        eps:              fundamentals.eps              ?? null,
        floatShares:      floatShares,
        sharesOutstanding: sharesOut,
        shortPercent:     shortPercent
      },

      history,
      technicals: technicalsData,
      preMarket:  preMarketData,

      meta: {
        intervalUsed: usedInterval,
        dataPoints:   history.length,
        marketState,
        lastUpdated:  new Date()
      }
    };
  } catch (err) {
    console.error(`[yahooIndicators] ${symbol} · Critical error:`, err);
    return null;
  }
}

module.exports = { getYahooIndicators };
