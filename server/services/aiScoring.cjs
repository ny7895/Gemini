
function analyzeSqueezeCandidate({ rsi, shortFloat, volumeSpike, momentum }) {
  let score = 0;
  let reasons = [];

  if (shortFloat > 20) {
    score += 2;
    reasons.push("High short float");
  }
  if (rsi < 40) {
    score += 1;
    reasons.push("RSI shows potential bounce");
  }
  if (volumeSpike) {
    score += 2;
    reasons.push("Unusual volume");
  }
  if (momentum > 0.03) {
    score += 1;
    reasons.push("Bullish price momentum");
  }

  return {
    isCandidate: score >= 4,
    score,
    reasons,
  };
}

function analyzeEarlySetup({ rsi, shortFloat, volumeSpike, momentum }) {
  let score = 0;
  let reasons = [];

  if (shortFloat > 15) {
    score += 2;
    reasons.push("Moderately high short float");
  }
  if (rsi > 30 && rsi < 45) {
    score += 2;
    reasons.push("RSI in early reversal zone");
  }
  if (!volumeSpike) {
    score += 1;
    reasons.push("No volume spike yet — possible accumulation");
  }
  if (momentum > 0.01 && momentum < 0.03) {
    score += 1;
    reasons.push("Subtle bullish momentum");
  }

  return {
    isEarlyCandidate: score >= 4,
    setupScore: score,
    setupReasons: reasons,
  };
}

// --- helper to normalize a value between 0 and 1 (clamped) ---
function norm(x, min, max) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  return (x - min) / (max - min);
}

function scoreTicker(data) {
  const {
    price,
    avg20Volume,
    volume,
    volumeSpike,
    rsi,
    momentum,
    support,
    resistance,
    floatPercent,
    shortPercent,
    daysToCover,
  } = data;

  // 1) run squeeze & early-setup analyses
  const squeeze = analyzeSqueezeCandidate({
    rsi,
    shortFloat: shortPercent,
    volumeSpike,
    momentum,
  });
  const early = analyzeEarlySetup({
    rsi,
    shortFloat: shortPercent,
    volumeSpike,
    momentum,
  });

  // 2) other metric scores
  const volScore   = norm(volume, avg20Volume * 1.5, avg20Volume * 5);
  const spikeScore = norm(volumeSpike, 1.5, 4);
  const rsiScore   = rsi < 40
                     ? (40 - rsi) / 20      // 30 → 0.5, 40 → 0
                     : (rsi > 75 ? -1 : 0); // penalize RSI > 75
  const momScore   = norm(momentum, 0, 0.1);
  const floatScore = (floatPercent >= 1 && floatPercent <= 10)
                     ? 1
                     : (floatPercent > 10 && floatPercent <= 50)
                       ? 0.5
                       : 0;
  const shortScore = (shortPercent >= 15 && daysToCover >= 5) ? 1 : 0;

  // 3) breakout / bounce signals
  const breakout = price > resistance && volumeSpike > 1.5;
  const bounce   = price > support && volumeSpike > 1;

  // 4) combine everything with weights
  const totalScore =
      2 * spikeScore +
      1 * volScore +
      1.5 * momScore +
      1 * rsiScore +
      1 * floatScore +
      1 * shortScore +
      2 * (breakout || bounce) +
      (squeeze.score || 0) +
      (early.setupScore || 0);

  // 5) collect human-readable reasons
  const reasons = [
    ...squeeze.reasons,
    ...early.setupReasons,
  ];
  if (breakout) reasons.push("Price breakout on volume");
  if (bounce)   reasons.push("Support bounce on volume");

  return {
    totalScore,
    reasons,
    isTopPick: totalScore >= 8,   // adjust threshold as needed
    squeeze,
    early,
    metrics: { volScore, spikeScore, rsiScore, momScore, floatScore, shortScore, breakout, bounce }
  };
}

module.exports = {
  analyzeSqueezeCandidate,
  analyzeEarlySetup,
  scoreTicker,
};
