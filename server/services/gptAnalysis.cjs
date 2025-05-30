
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Ask GPT to use only the provided metrics (including fundamentals and pre-market data)
 * and determine:
 * - A primary action: Buy/Hold/Sell
 * - Whether this is a day-trade candidate
 * - Intraday buy/sell levels if day-trade, including pre-market entry/exit if surge detected
 * - Otherwise, longer-term buy/sell targets
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
    fundamentals,
    preMarketChange,
    preMarketVolSpike
  } = params;

  // 1) System prompt locks it to _only_ your data
  const system = {
    role: "system",
    content: `
You are a market-data analyst. You have _no_ external data access—only use the metrics given below.
Do NOT reference any historical or internet‐sourced knowledge about ${symbol}.
Base all decisions purely on the numbers provided, including pre-market surges.
    `
  };

  // 2) User prompt carries snapshot, including fundamentals and pre-market
  const user = {
    role: "user",
    content: JSON.stringify({
      symbol,
      price,
      rsi,
      shortFloat,
      volumeSpike,
      momentum,
      support,
      resistance,
      fundamentals,
      preMarketChange,
      preMarketVolSpike
    }, null, 2)
  };

  // 3) Ask for JSON output with extended fields
  const functionDef = {
    name: "analyze_stock",
    description: "Suggests entry/exit levels for pre-market surge or day-trade/long-hold based ONLY on provided metrics.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "2-3 sentence rationale for the primary action"
        },
        action: {
          type: "string",
          enum: ["Buy", "Hold", "Sell"],
          description: "Overall recommendation"
        },
        actionRationale: {
          type: "string",
          description: "Brief explanation for the Buy/Hold/Sell recommendation"
        },
        isDayTradeCandidate: {
          type: "boolean",
          description: "True if suitable for a same-day (intraday) trade."
        },
        buyPrice: {
          type: "number",
          description: "Primary entry price (day or long)"
        },
        sellPrice: {
          type: "number",
          description: "Primary exit price (day or long)"
        },
        dayTradeBuyPrice: {
          type: "number",
          description: "Intraday entry target"
        },
        dayTradeSellPrice: {
          type: "number",
          description: "Intraday exit target"
        },
        longBuyPrice: {
          type: "number",
          description: "Long-term entry target"
        },
        longSellPrice: {
          type: "number",
          description: "Long-term exit target"
        },
        preMarketEntryPrice: {
          type: "number",
          description: "Recommended pre-market entry"
        },
        preMarketExitPrice: {
          type: "number",
          description: "Recommended pre-market exit"
        }
      },
      required: [
        "explanation",
        "action",
        "actionRationale",
        "isDayTradeCandidate",
        "buyPrice",
        "sellPrice"
      ]
    }
  };

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini-2025-04-14",
    messages: [system, user],
    functions: [functionDef],
    function_call: { name: "analyze_stock" },
    temperature: 0.2,
    max_tokens: 400
  });

  const args = JSON.parse(response.choices[0].message.function_call.arguments);

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
    preMarketExitPrice:  args.preMarketExitPrice
  };
}

module.exports = { analyzeWithGPT };