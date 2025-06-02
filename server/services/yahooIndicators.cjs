// services/yahooService.cjs

const yahooFinance = require('yahoo-finance2').default;
const technicals   = require('../utils/technicals.cjs');

async function getYahooIndicators(symbol) {
  try {
    // 1) Get the latest quote
    const quote = await yahooFinance.quote(symbol);

    // 2) Decide whether we're in pre-market hours
    const now  = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const isPreMarket = (h >= 4 && (h < 9 || (h === 9 && m < 30)));

    // 3) Pull the price/volume from the appropriate session
    const priceField  = isPreMarket ? 'preMarketPrice'      : 'regularMarketPrice';
    const volumeField = isPreMarket ? 'preMarketVolume'     : 'regularMarketVolume';

    const price        = quote[priceField];
    const volume       = quote[volumeField];
    const floatShares  = quote.sharesOutstanding || 0;
    const shortPercent = (quote.shortPercentFloat || 0) * 100;

    // 4) Fetch fundamentals
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['financialData']
    });
    const fd = summary.financialData || {};
    const fundamentals = {
      peRatio:         fd.trailingPE ?? null,
      revenueGrowth:   fd.revenueGrowth?.raw != null ? fd.revenueGrowth.raw * 100 : null,
      debtEquity:      fd.debtToEquity ?? null,
      epsTrailingTwelveMonths: fd.epsTrailingTwelveMonths ?? null
    };

    // 5) Fetch 30 days of bars (incl. extended hours)
    const period1 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const period2 = new Date();
    const response = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: '1d',
      includePrePost: true,
      events: []
    });

    const chartData = response.chart?.result?.[0];
    if (!chartData || !Array.isArray(chartData.timestamp)) {
      throw new Error(`No valid chart data for ${symbol}`);
    }
    const { timestamp, indicators: { quote: [bars] = [] } } = chartData;
    if (!bars || !Array.isArray(bars.close)) {
      throw new Error(`Malformed indicator data for ${symbol}`);
    }

    // 6) Build history of all bars
    const history = timestamp.map((ts, i) => ({
      date:   new Date(ts * 1000),
      open:   bars.open?.[i]   ?? null,
      high:   bars.high?.[i]   ?? null,
      low:    bars.low?.[i]    ?? null,
      close:  bars.close?.[i]  ?? null,
      volume: bars.volume?.[i] ?? null,
    })).filter(d => d.close != null);

    // 7) Compute technicals on the full history
    const closes      = history.map(d => d.close);
    const rsi         = technicals.calculateRSI(closes, 14);
    const momentum    = technicals.calculateMomentum(closes);
    const volumeSpike = technicals.detectVolumeSpike(history);

    // 8) Pre-market analysis (4:00–9:29)
    const prevCloseBar   = history.find(d => d.date.getHours() === 16);
    const prevClose      = prevCloseBar?.close;
    const preMarketBars  = history.filter(d => d.date.getHours() < 9);
    let preMarketChange  = null, preMarketVolSpike = null;
    if (preMarketBars.length && prevClose) {
      const lastPre      = preMarketBars[preMarketBars.length - 1];
      preMarketChange   = ((lastPre.close - prevClose) / prevClose) * 100;
      const avgPreVol    = preMarketBars.reduce((sum, b) => sum + b.volume, 0) / preMarketBars.length;
      preMarketVolSpike = lastPre.volume / avgPreVol;
    }

    // 9) Support & resistance from the last 5 full-day bars
    const last5 = history.slice(-5);
    const lows  = last5.map(d => d.low).filter(v => v != null);
    const highs = last5.map(d => d.high).filter(v => v != null);
    const support    = lows.length  ? Math.min(...lows)   : null;
    const resistance = highs.length ? Math.max(...highs)  : null;

    return {
      symbol,
      // live session data
      price,
      volume,
      floatPercent:       floatShares,
      shortPercent,
      // technicals
      rsi,
      momentum,
      volumeSpike,
      // price structure
      support,
      resistance,
      fundamentals,
      history,
      // pre-market stats
      preMarketChange,
      preMarketVolSpike
    };
  } catch (err) {
    throw new Error(`getYahooIndicators failed for ${symbol}: ${err.message}`);
  }
}

module.exports = { getYahooIndicators };
