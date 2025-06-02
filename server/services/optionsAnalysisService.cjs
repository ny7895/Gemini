
const { fetchOptionChain } = require('./optionsService.cjs')
const { analyzeWithGPT }   = require('./gptAnalysis.cjs')

// Helper: pause for ms milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Analyze both call and put suggestions with GPT, including entry and exit plans.
 *
 * @param {Object} params
 * @param {string} params.symbol      - Stock ticker, e.g. 'AAPL'
 * @param {Object} params.metrics     - Underlying metrics ({ price, rsi, momentum, support, resistance, ... })
 * @param {boolean} params.isDayTrade - True if this is a day-trade candidate
 * @returns {Promise<Object>}         - {
 *   callPick, callAction, callRationale, callExitPlan,
 *   putPick, putAction, putRationale, putExitPlan
 * }
 */
async function analyzeOptionsWithGPT({ symbol, metrics, isDayTrade }) {
  // 1) Throttle: wait 12 seconds before fetching to stay under 5 calls/min
  await sleep(12000)

  // 2) Fetch the entire option chain once from Polygon
  let chain = []
  try {
    chain = await fetchOptionChain(symbol)
  } catch (err) {
    console.error(`❌ Polygon chain fetch failed for ${symbol}:`, err.message)
    throw err
  }

  // 3) Pick an expiration date
  const expirations = Array.from(new Set(chain.map(o => o.expiration_date)))
  expirations.sort()
  let expiry
  if (isDayTrade) {
    expiry = expirations.find(d => new Date(d).getUTCDay() === 5) || expirations[0]
  } else {
    const target = Date.now() + 30 * 24 * 60 * 60 * 1000
    expiry = expirations.reduce((p, c) =>
      Math.abs(new Date(c) - target) < Math.abs(new Date(p) - target) ? c : p
    )
  }

  // Helper to pick by delta
  const pickByDelta = (options, target = 0.35) => {
    return options.reduce((best, opt) => {
      const d1 = Math.abs(opt.greeks.delta - target)
      const d2 = Math.abs(best.greeks.delta - target)
      return d1 < d2 ? opt : best
    })
  }

  // 4) Filter calls for that expiry
  const calls = chain.filter(o =>
    o.expiration_date === expiry &&
    o.contract_type   === 'call' &&
    o.greeks &&
    o.greeks.delta != null
  )
  if (!calls.length) {
    throw new Error(`no call contracts for ${symbol} at ${expiry}`)
  }
  const callPickRaw = pickByDelta(calls, 0.35)
  const callPremium = callPickRaw.last_quote?.askPrice ?? callPickRaw.last_trade?.price
  const callPick = {
    type:    'call',
    strike:  callPickRaw.strike_price,
    expiry:  callPickRaw.expiration_date,
    premium: callPremium,
    delta:   callPickRaw.greeks.delta
  }

  // 5) Filter puts for that expiry
  const puts = chain.filter(o =>
    o.expiration_date === expiry &&
    o.contract_type   === 'put' &&
    o.greeks &&
    o.greeks.delta != null
  )
  if (!puts.length) {
    throw new Error(`no put contracts for ${symbol} at ${expiry}`)
  }
  const putPickRaw = pickByDelta(puts, -0.35)
  const putPremium = putPickRaw.last_quote?.askPrice ?? putPickRaw.last_trade?.price
  const putPick = {
    type:    'put',
    strike:  putPickRaw.strike_price,
    expiry:  putPickRaw.expiration_date,
    premium: putPremium,
    delta:   Math.abs(putPickRaw.greeks.delta)
  }

  // 6) Build a GPT prompt for the call, asking entry and exit
  const callPrompt = `
You are an options strategist.
Stock: ${symbol}
Underlying metrics: price=${metrics.price}, RSI=${metrics.rsi}, momentum=${metrics.momentum}, support=${metrics.support}, resistance=${metrics.resistance}.

Call pick: strike=${callPick.strike}, expiry=${callPick.expiry}, premium=${callPick.premium}, delta=${callPick.delta}.

1) Should we BUY this CALL option? If yes, explain why and when to enter. If not, explain why not.
2) When should we EXIT this CALL? Provide clear exit criteria (e.g. profit target, stop-loss, time-based exit).

Respond with JSON:
{
  "action": "...",
  "rationale": "...",
  "exitPlan": "..."
}
`.trim()

  const callAnalysis = await analyzeWithGPT({ prompt: callPrompt })

  // 7) Build a GPT prompt for the put, asking entry and exit
  const putPrompt = `
You are an options strategist.
Stock: ${symbol}
Underlying metrics: price=${metrics.price}, RSI=${metrics.rsi}, momentum=${metrics.momentum}, support=${metrics.support}, resistance=${metrics.resistance}.

Put pick: strike=${putPick.strike}, expiry=${putPick.expiry}, premium=${putPick.premium}, delta=${putPick.delta}.

1) Should we BUY this PUT option? If yes, explain why and when to enter. If not, explain why not.
2) When should we EXIT this PUT? Provide clear exit criteria (e.g. profit target, stop-loss, time-based exit).

Respond with JSON:
{
  "action": "...",
  "rationale": "...",
  "exitPlan": "..."
}
`.trim()

  const putAnalysis = await analyzeWithGPT({ prompt: putPrompt })

  // 8) Return both raw picks and GPT analysis
  return {
    callPick,
    callAction:    callAnalysis.action,
    callRationale: callAnalysis.rationale,
    callExitPlan:  callAnalysis.exitPlan,

    putPick,
    putAction:    putAnalysis.action,
    putRationale: putAnalysis.rationale,
    putExitPlan:  putAnalysis.exitPlan
  }
}

module.exports = { analyzeOptionsWithGPT }
