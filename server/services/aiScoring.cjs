// server/services/aiScoring.cjs

/**
 * Runs short‐squeeze logic on RSI, short float, volume spike, and momentum.
 */
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

/**
 * Runs early‐setup logic on RSI, short float, volume spike, and momentum.
 */
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
  if (x == null) return 0;
  if (x <= min) return 0;
  if (x >= max) return 1;
  return (x - min) / (max - min);
}

/**
 * Combines all technical, fundamental, sentiment, and pre‐market signals
 * into a single “totalScore.” Returns reasons and sub‐scores.
 */
function scoreTicker(data) {
  const {
    // Existing fields
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

    // New technical arrays/objects:
    ema10,        // array of EMA10 values
    ema50,        // array of EMA50 values
    macdLine,     // array of MACD line values
    signalLine,   // array of MACD signal values
    atr14,        // array of ATR(14) values
    bollinger,    // array of { middle, upper, lower }
    donchian,     // array of { donchianHigh, donchianLow }

    // Fundamental metrics:
    revenueGrowth,
    debtToEquity,
    epsTrailingTwelveMonths,

    // News & sentiment:
    newsCount,
    socialSentiment,

    // Pre-market:
    preMarketChange,
    preMarketVolSpike,
  } = data;

  // 1) Short‐squeeze & early‐setup
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

  // 2) Existing volume/momentum/RSI/float/short scores
  const volScore   = norm(volume, (avg20Volume || 0) * 1.5, (avg20Volume || 1) * 5);
  const spikeScore = volumeSpike ? norm(volume, (avg20Volume || 1) * 1.5, (avg20Volume || 1) * 4) : 0;
  const rsiScore   =
    typeof rsi === "number"
      ? rsi < 40
        ? (40 - rsi) / 20    // 30 → 0.5, 40 → 0
        : rsi > 75
          ? -1
          : 0
      : 0;
  const momScore   = norm(momentum, 0, 0.1);
  const floatScore =
    floatPercent >= 1 && floatPercent <= 10
      ? 1
      : floatPercent > 10 && floatPercent <= 50
        ? 0.5
        : 0;
  const shortScore = shortPercent >= 15 && daysToCover >= 5 ? 1 : 0;

  // 3) Breakout / bounce signals
  const breakout = price > resistance && volumeSpike > 1.5;
  const bounce   = price > support && volumeSpike > 1;

  // 4) EMA Crossover & trend
  let emaScore = 0;
  let emaReason = null;
  const lenEma = Math.min(ema10.length, ema50.length);
  if (lenEma >= 2) {
    const i = lenEma - 1;
    const currEma10 = ema10[i];
    const currEma50 = ema50[i];
    const prevEma10 = ema10[i - 1];
    const prevEma50 = ema50[i - 1];

    if (currEma10 != null && currEma50 != null) {
      if (currEma10 > currEma50) {
        emaScore += 1;
        emaReason = "EMA10 > EMA50 (uptrend)";
      }
      // Check for a “just crossed” condition
      if (
        prevEma10 != null &&
        prevEma50 != null &&
        prevEma10 <= prevEma50 &&
        currEma10 > currEma50
      ) {
        emaScore += 2;
        emaReason = "EMA10 crossed above EMA50";
      }
    }
  }

  // 5) MACD histogram signal
  let macdScore = 0;
  let macdReason = null;
  const lenMacd = Math.min(macdLine.length, signalLine.length);
  if (lenMacd >= 2) {
    const i = lenMacd - 1;
    const currMacd     = macdLine[i];
    const currSignal   = signalLine[i];
    const prevMacd     = macdLine[i - 1];
    const prevSignal   = signalLine[i - 1];
    if (currMacd != null && currSignal != null) {
      const macdHist = currMacd - currSignal;
      if (macdHist > 0) {
        macdScore += 1;
        macdReason = "MACD histogram > 0 (bullish)";
      }
      if (
        prevMacd != null &&
        prevSignal != null &&
        prevMacd - prevSignal <= 0 &&
        macdHist > 0
      ) {
        macdScore += 2;
        macdReason = "MACD just crossed above its signal";
      }
    }
  }

  // 6) ATR volatility signal
  let atrScore = 0;
  let atrReason = null;
  if (Array.isArray(atr14) && atr14.length >= 30) {
    const latestAtr = atr14[atr14.length - 1];
    if (latestAtr != null) {
      // average of the prior 30 ATR values (excluding the last)
      const sliceAtr = atr14.slice(atr14.length - 31, atr14.length - 1);
      const avgAtr30  = sliceAtr.reduce((sum, v) => sum + (v || 0), 0) / sliceAtr.length;
      if (avgAtr30 > 0) {
        // if ATR is moderately low, score positively; if high, negative
        atrScore = norm(latestAtr, avgAtr30 * 0.8, avgAtr30 * 1.2);
        atrReason = "ATR near its 30-day average";
      }
      if (latestAtr > avgAtr30 * 1.5) {
        atrScore += 1;
        atrReason = "ATR spiked > 1.5× 30-day average";
      }
    }
  }

  // 7) Bollinger Bands (20-period) signal
  let bollScore = 0;
  let bollReason = null;
  if (Array.isArray(bollinger) && bollinger.length) {
    const b = bollinger[bollinger.length - 1];
    if (b && b.upper != null && b.lower != null) {
      if (price > b.upper) {
        bollScore += 2;
        bollReason = "Price broke above upper Bollinger Band";
      } else if (price < b.lower) {
        bollScore += 1;
        bollReason = "Price dropped below lower Bollinger Band";
      }
    }
  }

  // 8) Donchian Channel (20-period) signal
  let donchScore = 0;
  let donchReason = null;
  if (Array.isArray(donchian) && donchian.length) {
    const d = donchian[donchian.length - 1];
    if (d && d.donchianHigh != null && d.donchianLow != null) {
      if (price > d.donchianHigh) {
        donchScore += 2;
        donchReason = "Price broke above 20-day Donchian high";
      } else if (price < d.donchianLow) {
        donchScore += 1;
        donchReason = "Price dropped below 20-day Donchian low";
      }
    }
  }

  // 9) Fundamental scoring
  let fundScore = 0;
  let fundReasons = [];
  if (typeof revenueGrowth === "number" && typeof epsTrailingTwelveMonths === "number") {
    if (revenueGrowth >= 10 && epsTrailingTwelveMonths > 0) {
      fundScore += 2;
      fundReasons.push("Strong revenue & EPS growth");
    } else if (revenueGrowth >= 10 || epsTrailingTwelveMonths > 0) {
      fundScore += 1;
      fundReasons.push("Moderate revenue or EPS growth");
    }
  }
  if (typeof debtToEquity === "number") {
    if (debtToEquity < 0.5) {
      fundScore += 2;
      fundReasons.push("Low debt/equity (<0.5)");
    } else if (debtToEquity < 1) {
      fundScore += 1;
      fundReasons.push("Moderate debt/equity (<1)");
    } else if (debtToEquity > 2) {
      fundScore -= 1;
      fundReasons.push("High debt/equity (>2)");
    }
  }

  // 10) News & sentiment scoring
  let newsScore = 0;
  let newsReason = null;
  if (typeof newsCount === "number") {
    if (newsCount >= 10) {
      newsScore = 1;
      newsReason = "High news volume (≥10 articles in 24h)";
    } else {
      newsScore = norm(newsCount, 0, 10);
      if (newsScore > 0) newsReason = "Moderate news coverage";
    }
  }
  let sentimentScore = 0;
  let sentimentReason = null;
  if (typeof socialSentiment === "number") {
    if (socialSentiment > 0) {
      sentimentScore = norm(socialSentiment, 0, 1);
      sentimentReason = "Positive social sentiment";
    }
    if (socialSentiment < -0.3) {
      sentimentScore -= 1;
      sentimentReason = "Negative social sentiment";
    }
  }

  // 11) Pre-market signals
  let preMktScore = 0;
  let preMktReason = null;
  if (typeof preMarketChange === "number") {
    if (preMarketChange >= 5) {
      preMktScore = 1;
      preMktReason = "Pre-market jump ≥ 5%";
    } else {
      preMktScore = norm(preMarketChange, 2, 5);
      if (preMktScore > 0) preMktReason = "Pre-market up > 2%";
    }
  }
  let preMktVolScore = 0;
  let preMktVolReason = null;
  if (typeof preMarketVolSpike === "number") {
    if (preMarketVolSpike >= 5) {
      preMktVolScore = 2;
      preMktVolReason = "Pre-market volume spike ≥ 5× avg";
    } else if (preMarketVolSpike >= 3) {
      preMktVolScore = 1;
      preMktVolReason = "Pre-market volume spike ≥ 3× avg";
    }
  }

  // 12) Combine all sub‐scores with weights
  const totalScore =
    // existing squeeze + early
    (squeeze.score || 0) +
    (early.setupScore || 0) +

    // volume + momentum + RSI + float/short
    2 * spikeScore +
    1 * volScore +
    1.5 * momScore +
    1 * rsiScore +
    1 * floatScore +
    1 * shortScore +

    // breakout / bounce
    2 * (breakout ? 1 : 0) +
    2 * (bounce ? 1 : 0) +

    // EMA crossover / trend
    1 * emaScore +

    // MACD histogram
    1 * macdScore +

    // ATR volatility
    1 * atrScore +

    // Bollinger Band breakout
    2 * bollScore +

    // Donchian breakout
    2 * donchScore +

    // fundamental score
    fundScore +

    // news & sentiment
    newsScore +
    sentimentScore +

    // pre-market
    preMktScore +
    preMktVolScore;

  // 13) Gather human-readable reasons
  const reasons = [
    ...squeeze.reasons,
    ...early.setupReasons,
  ];
  if (volScore > 0)         reasons.push(`Volume score: ${volScore.toFixed(2)}`);
  if (spikeScore > 0)       reasons.push(`Spike score: ${spikeScore.toFixed(2)}`);
  if (rsiScore !== 0)       reasons.push(`RSI score: ${rsiScore.toFixed(2)}`);
  if (momScore > 0)         reasons.push(`Momentum score: ${momScore.toFixed(2)}`);
  if (floatScore > 0)       reasons.push(`Float score: ${floatScore}`);
  if (shortScore > 0)       reasons.push(`Short score: ${shortScore}`);
  if (breakout)             reasons.push("Price breakout on volume");
  if (bounce)               reasons.push("Support bounce on volume");
  if (emaReason)            reasons.push(emaReason);
  if (macdReason)           reasons.push(macdReason);
  if (atrReason)            reasons.push(atrReason);
  if (bollReason)           reasons.push(bollReason);
  if (donchReason)          reasons.push(donchReason);
  if (fundReasons.length)   reasons.push(...fundReasons);
  if (newsReason)           reasons.push(newsReason);
  if (sentimentReason)      reasons.push(sentimentReason);
  if (preMktReason)         reasons.push(preMktReason);
  if (preMktVolReason)      reasons.push(preMktVolReason);

  return {
    totalScore,
    reasons,
    isTopPick: totalScore >= 8, // adjust threshold as needed
    squeeze,
    early,
    metrics: {
      volScore,
      spikeScore,
      rsiScore,
      momScore,
      floatScore,
      shortScore,
      breakout,
      bounce,
      emaScore,
      macdScore,
      atrScore,
      bollScore,
      donchScore,
      fundScore,
      newsScore,
      sentimentScore,
      preMktScore,
      preMktVolScore
    }
  };
}

module.exports = {
  analyzeSqueezeCandidate,
  analyzeEarlySetup,
  scoreTicker,
};
