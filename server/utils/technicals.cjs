// utils/technicals.cjs

/**
 * Calculate the N-period RSI series for an array of closing prices.
 * Returns an array of length prices.length, with null for indices < period.
 */
function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < period + 1) return [];

  const rsiArr = Array(prices.length).fill(null);
  // 1) First period gains/losses (simple avg)
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // First RSI value at index = period
  if (avgLoss === 0) {
    rsiArr[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsiArr[period] = parseFloat((100 - 100 / (1 + rs)).toFixed(2));
  }

  // 2) Wilder smoothing for the rest of the series
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsiArr[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsiArr[i] = parseFloat((100 - 100 / (1 + rs)).toFixed(2));
    }
  }

  return rsiArr;
}

/**
 * Simple momentum = (most recent change) / previous close.
 */
function calculateMomentum(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  const change = prices[prices.length - 1] - prices[prices.length - 2];
  return parseFloat((change / prices[prices.length - 2]).toFixed(4));
}

/**
 * Identify if the latest volume is > factor × the average of prior bars.
 */
function findVolumeSpikes(volumes, factor = 1.5) {
  if (!Array.isArray(volumes) || volumes.length < 2) return false;
  const latest = volumes[volumes.length - 1];
  const avg = volumes.slice(0, -1).reduce((sum, v) => sum + v, 0) / (volumes.length - 1);
  return latest > factor * avg;
}

/**
 * Basic support & resistance: min & max of the close series.
 */
function supportResistance(closes) {
  if (!Array.isArray(closes) || closes.length === 0) {
    return { support: null, resistance: null };
  }
  const support = Math.min(...closes);
  const resistance = Math.max(...closes);
  return { support, resistance };
}

/**
 * Rolling support & resistance over a sliding window.
 * Returns an array of { support, resistance }, with null until enough data.
 */
function rollingSR(prices, lookback = 20) {
  if (!Array.isArray(prices) || prices.length < lookback) return [];

  const out = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < lookback - 1) {
      out.push({ support: null, resistance: null });
    } else {
      const slice = prices.slice(i - lookback + 1, i + 1);
      out.push({
        support: Math.min(...slice),
        resistance: Math.max(...slice),
      });
    }
  }
  return out;
}

/**
 * Calculate a Simple Moving Average (SMA) for the last `period` elements in `arr`.
 * Returns an array matching arr.length, with null until enough data.
 */
function calculateSMA(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return [];

  const smaArr = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) {
      smaArr.push(null);
    } else {
      const slice = arr.slice(i - period + 1, i + 1);
      const sum = slice.reduce((acc, v) => acc + v, 0);
      smaArr.push(sum / period);
    }
  }
  return smaArr;
}

/**
 * Calculate an Exponential Moving Average (EMA) series.
 * Returns an array the same length as `arr`, with nulls for indices < period-1.
 */
function calculateEMA(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return [];

  const k = 2 / (period + 1);
  const emaArray = [];
  let sum = 0;
  // first period values → null until period-1
  for (let i = 0; i < period - 1; i++) {
    sum += arr[i];
    emaArray.push(null);
  }
  sum += arr[period - 1];
  let prevEma = sum / period;
  emaArray.push(prevEma);

  // subsequent EMAs
  for (let i = period; i < arr.length; i++) {
    const price = arr[i];
    const currEma = price * k + prevEma * (1 - k);
    emaArray.push(currEma);
    prevEma = currEma;
  }
  return emaArray;
}

/**
 * Calculate MACD line and signal line arrays.
 * MACD Line = EMA12 - EMA26
 * Signal Line = EMA9 of MACD Line
 * Returns { macdLine: [], signalLine: [] } with nulls until values become available.
 */
function calculateMACD(prices) {
  if (!Array.isArray(prices) || prices.length < 26) {
    return { macdLine: [], signalLine: [] };
  }
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = prices.map((_, idx) => {
    const e12 = ema12[idx];
    const e26 = ema26[idx];
    if (e12 == null || e26 == null) return null;
    return e12 - e26;
  });
  // For signal line, apply EMA9 to the valid portion of macdLine
  const validMacd = macdLine.filter((v) => v != null);
  const signalRaw = calculateEMA(validMacd, 9);
  // Pad signalRaw to match macdLine length
  const paddedSignal = Array(macdLine.length - signalRaw.length).fill(null).concat(signalRaw);
  return { macdLine, signalLine: paddedSignal };
}

/**
 * Calculate the 14-period Average True Range (ATR).
 * Requires arrays of high, low, and close prices (all same length).
 * Returns an array of ATR values; null for indices < period.
 */
function calculateATR(highs, lows, closes, period = 14) {
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    highs.length < period + 1 ||
    lows.length < period + 1 ||
    closes.length < period + 1
  ) {
    return [];
  }

  // True Range array
  const tr = [];
  for (let i = 1; i < highs.length; i++) {
    const currHigh = highs[i];
    const currLow = lows[i];
    const prevClose = closes[i - 1];
    const range1 = currHigh - currLow;
    const range2 = Math.abs(currHigh - prevClose);
    const range3 = Math.abs(currLow - prevClose);
    tr.push(Math.max(range1, range2, range3));
  }

  // First ATR = simple average of first 'period' TRs
  const atrArray = Array(period).fill(null);
  const initialAvg = tr.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  atrArray.push(initialAvg);

  // Wilder’s smoothing for ATR
  let prevAtr = initialAvg;
  for (let i = period; i < tr.length; i++) {
    const currAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atrArray.push(currAtr);
    prevAtr = currAtr;
  }
  return atrArray;
}

/**
 * Calculate Bollinger Bands (20-period) for close prices.
 * Returns an array of { middle, upper, lower }, with null entries until enough data.
 */
function calculateBollingerBands(prices, period = 20, stdDevFactor = 2) {
  if (!Array.isArray(prices) || prices.length < period) {
    return [];
  }
  const bands = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      bands.push({ middle: null, upper: null, lower: null });
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = slice.reduce((sum, v) => sum + v, 0) / period;
      const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
      const sd = Math.sqrt(variance);
      bands.push({
        middle: mean,
        upper: mean + stdDevFactor * sd,
        lower: mean - stdDevFactor * sd,
      });
    }
  }
  return bands;
}

/**
 * Calculate Donchian Channel (20-period) highs/lows for a series of highs and lows.
 * Returns an array of { donchianHigh, donchianLow }, with null until enough data.
 */
function calculateDonchian(highs, lows, period = 20) {
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    highs.length < period ||
    lows.length < period
  ) {
    return [];
  }
  const dc = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period - 1) {
      dc.push({ donchianHigh: null, donchianLow: null });
    } else {
      const highSlice = highs.slice(i - period + 1, i + 1);
      const lowSlice = lows.slice(i - period + 1, i + 1);
      dc.push({
        donchianHigh: Math.max(...highSlice),
        donchianLow: Math.min(...lowSlice),
      });
    }
  }
  return dc;
}

/**
 * Calculate a rolling standard deviation for close prices over a given period.
 * Returns an array of length prices.length, with null for indices < period-1.
 */
function calculateStdDev(prices, period = 20) {
  if (!Array.isArray(prices) || prices.length < period) return [];
  const out = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = slice.reduce((sum, v) => sum + v, 0) / period;
      const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
      out.push(Math.sqrt(variance));
    }
  }
  return out;
}

/**
 * Calculate VWAP (Volume-Weighted Average Price) series.
 * Returns an array of length prices.length, with null for any index if volumes[i] is missing.
 */
function calculateVWAP(prices, volumes) {
  if (!Array.isArray(prices) || !Array.isArray(volumes) || prices.length !== volumes.length) {
    return [];
  }
  const vwapArr = [];
  let cumulativePV = 0;
  let cumulativeVol = 0;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const v = volumes[i];
    if (p == null || v == null) {
      vwapArr.push(null);
      continue;
    }
    cumulativePV += p * v;
    cumulativeVol += v;
    vwapArr.push(cumulativeVol > 0 ? cumulativePV / cumulativeVol : null);
  }
  return vwapArr;
}

module.exports = {
  calculateRSI,
  calculateMomentum,
  findVolumeSpikes,
  supportResistance,
  rollingSR,
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateDonchian,
  calculateStdDev,
  calculateVWAP,
};
