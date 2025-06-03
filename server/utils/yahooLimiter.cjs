// server/utils/yahooLimiter.js
const Bottleneck = require('bottleneck');

// This Bottleneck config allows ~100 calls/minute (≈ 1.0 calls/sec).
// You can tweak the reservoir/minTime as needed.
const yahooLimiter = new Bottleneck({
  reservoir:              60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60 * 1000,
  minTime:                300
});

module.exports = yahooLimiter;
