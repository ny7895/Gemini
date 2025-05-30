
/**
 * Calculate the 14-period RSI for an array of closing prices.
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

/**
 * Simple momentum = (most recent change) / previous close.
 */
function calculateMomentum(prices) {
  if (prices.length < 2) return 0;
  const change = prices[0] - prices[1];
  return parseFloat((change / prices[1]).toFixed(4));
}

/**
 * Identify if the latest volume is >1.5× the average of the prior bars.
 */
function findVolumeSpikes(volumes, factor = 1.5) {
  if (!Array.isArray(volumes) || volumes.length < 2) return false;
  const latest = volumes[volumes.length - 1];
  const avg    = volumes.slice(0, -1).reduce((sum, v) => sum + v, 0) / (volumes.length - 1);
  return latest > factor * avg;
}

/**
 * Basic support & resistance: the min & max of the close series.
 */
function supportResistance(closes) {
  if (!Array.isArray(closes) || closes.length === 0) {
    return { support: null, resistance: null };
  }
  const support   = Math.min(...closes);
  const resistance = Math.max(...closes);
  return { support, resistance };
}

module.exports = {
  calculateRSI,
  calculateMomentum,
  findVolumeSpikes,
  supportResistance
};
