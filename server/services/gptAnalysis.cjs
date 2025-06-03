// server/services/gptAnalysis.cjs

const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Ask GPT to use only the provided metrics (technicals, fundamentals, sentiment, pre-market, etc.)
 * and determine:
 * - A primary action: Buy/Hold/Sell
 * - Whether this is a day-trade candidate (intraday)
 * - Intraday entry/exit levels if day-trade, including pre-market entry/exit
 * - Otherwise, longer-term buy/sell targets
 *
 * Incoming params should include:
 *   - symbol, price, rsi, shortFloat, volumeSpike, momentum, support, resistance
 *   - ema10 (array), ema50 (array), macdLine (array), signalLine (array), atr14 (array),
 *     bollinger (array of {lower, middle, upper}), donchian (array of {low, high})
 *   - fundamentals: { revenueGrowth, debtToEquity, epsTrailingTwelveMonths, … }
 *   - newsCount (number), socialSentiment (number)   (optional; defaults to 0)
 *   - preMarketChange, preMarketVolSpike
 */
async function analyzeWithGPT(params) {
  const {
    symbol,
    price,
    rsi,
    shortFloat,
    volumeSpike,
    momentum,
    support,
    resistance,

    // raw arrays
    ema10,
    ema50,
    macdLine,
    signalLine,
    atr14,
    bollinger,
    donchian,

    // fundamentals as an object
    fundamentals = {},

    // sentiment (optional)
    newsCount = 0,
    socialSentiment = 0,

    // pre-market
    preMarketChange,
    preMarketVolSpike,
  } = params;

  // Safely extract these three numbers from fundamentals if they exist:
  const revenueGrowth =
    typeof fundamentals.revenueGrowth === "number"
      ? fundamentals.revenueGrowth
      : null;
  const debtToEquity =
    typeof fundamentals.debtToEquity === "number"
      ? fundamentals.debtToEquity
      : null;
  const epsTrailingTwelveMonths =
    typeof fundamentals.epsTrailingTwelveMonths === "number"
      ? fundamentals.epsTrailingTwelveMonths
      : null;

  // 1) System prompt
  const system = {
    role: "system",
    content: `
You are a data-driven market analyst. You have _no_ external data access—only use the metrics provided below.
Do NOT reference any historical or internet‐sourced knowledge about ${symbol}.
Base all decisions purely on these numbers, including any pre-market surges.
Be concise and use a structured JSON response as specified.
    `.trim(),
  };

  // 2) Package everything into a user payload (JSON) and let GPT extract from it
  const userPayload = {
    symbol,
    price,
    rsi,
    shortFloat,
    volumeSpike,
    momentum,
    support,
    resistance,

    // Pass full arrays for GPT’s analysis
    ema10,
    ema50,
    macdLine,
    signalLine,
    atr14,
    bollinger,
    donchian,

    // Pass full fundamentals object
    fundamentals: {
      revenueGrowth,
      debtToEquity,
      epsTrailingTwelveMonths,
      ...fundamentals,
    },

    // Sentiment
    newsCount,
    socialSentiment,

    // Pre-market
    preMarketChange,
    preMarketVolSpike,
  };

  const user = {
    role: "user",
    content: JSON.stringify(userPayload, null, 2),
  };

  // 3) Tell GPT to return a consistent JSON object called “analyze_stock”
  const functionDef = {
    name: "analyze_stock",
    description:
      "Suggests entry/exit levels for pre-market surge or day-trade/long-hold based ONLY on provided metrics.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "2-3 sentence rationale for the primary action",
        },
        action: {
          type: "string",
          enum: ["Buy", "Hold", "Sell"],
          description: "Overall recommendation",
        },
        actionRationale: {
          type: "string",
          description: "Brief explanation for the Buy/Hold/Sell recommendation",
        },
        isDayTradeCandidate: {
          type: "boolean",
          description:
            "True if suitable for a same-day (intraday) trade based on aggressive momentum or pre-market data.",
        },
        buyPrice: {
          type: "number",
          description: "Primary entry price (day or long)",
        },
        sellPrice: {
          type: "number",
          description: "Primary exit price (day or long)",
        },
        dayTradeBuyPrice: {
          type: "number",
          description: "Intraday entry target for day-trade",
        },
        dayTradeSellPrice: {
          type: "number",
          description: "Intraday exit target for day-trade",
        },
        longBuyPrice: {
          type: "number",
          description: "Long-term entry target",
        },
        longSellPrice: {
          type: "number",
          description: "Long-term exit target",
        },
        preMarketEntryPrice: {
          type: "number",
          description: "Recommended pre-market entry price",
        },
        preMarketExitPrice: {
          type: "number",
          description: "Recommended pre-market exit price",
        },
      },
      required: [
        "explanation",
        "action",
        "actionRationale",
        "isDayTradeCandidate",
        "buyPrice",
        "sellPrice",
      ],
    },
  };

  // 4) Ask OpenAI
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini-2025-04-14",
    messages: [system, user],
    functions: [functionDef],
    function_call: { name: "analyze_stock" },
    temperature: 0.2,
    max_tokens: 400,
  });

  // 5) Extract the arguments from GPT’s function_call
  const args = JSON.parse(
    response.choices[0].message.function_call.arguments
  );

  return {
    explanation:         args.explanation,
    action:              args.action,
    actionRationale:     args.actionRationale,
    isDayTradeCandidate: args.isDayTradeCandidate,
    buyPrice:            args.buyPrice,
    sellPrice:           args.sellPrice,
    dayTradeBuyPrice:    args.dayTradeBuyPrice,
    dayTradeSellPrice:   args.dayTradeSellPrice,
    longBuyPrice:        args.longBuyPrice,
    longSellPrice:       args.longSellPrice,
    preMarketEntryPrice: args.preMarketEntryPrice,
    preMarketExitPrice:  args.preMarketExitPrice,
  };
}

module.exports = { analyzeWithGPT };
