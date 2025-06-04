// server/services/optionsAnalysisService.cjs

const { suggestCall, suggestPut, getContractsInRange } = require('./optionsService.cjs');
const { OpenAI } = require('openai');
const log = require('../utils/logger.cjs');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJson(text) {
  // Remove ```json and ``` fences if present, then trim whitespace
  const fencePattern = /^```(?:json)?\s*([\s\S]*)\s*```$/i;
  const match = text.trim().match(fencePattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.trim();
}

async function analyzeOptionsWithGPT({ symbol, metrics, isDayTrade }) {
  await sleep(1000);

  let fullChains;
  try {
    fullChains = await getContractsInRange(symbol);
  } catch (err) {
    log.error(`❌ getContractsInRange failed for ${symbol}: ${err.message}`);
    fullChains = null;
  }

  let callPick = null,
      putPick  = null;

  if (!fullChains) {
    try {
      callPick = await suggestCall(symbol, isDayTrade, metrics.price);
    } catch (err) {
      log.error(`❌ suggestCall failed for ${symbol}: ${err.message}`);
      callPick = null;
    }
    try {
      putPick = await suggestPut(symbol, isDayTrade, metrics.price);
    } catch (err) {
      log.error(`❌ suggestPut failed for ${symbol}: ${err.message}`);
      putPick = null;
    }
  } else {
    const nearest = fullChains[0];
    callPick = pickATMFromList(nearest.calls, metrics.price);
    putPick  = pickATMFromList(nearest.puts, metrics.price);
  }

  let callPrompt = null,
      putPrompt  = null;

  if (fullChains) {
    const simplifiedChains = fullChains.map((entry) => ({
      expiry: entry.expiry,
      calls: entry.calls.map((c) => ({
        contractSymbol:    c.contractSymbol,
        strike:            c.strike,
        bid:               c.bid,
        ask:               c.ask,
        impliedVolatility: c.impliedVolatility,
        openInterest:      c.openInterest
      })),
      puts: entry.puts.map((p) => ({
        contractSymbol:    p.contractSymbol,
        strike:            p.strike,
        bid:               p.bid,
        ask:               p.ask,
        impliedVolatility: p.impliedVolatility,
        openInterest:      p.openInterest
      }))
    }));

    callPrompt = `
You are an options strategist. Below is a **complete chain** of call and put contracts 
for ${symbol}, from the nearest expiration up through ~2 months out.

UNDERLYING METRICS:
  • Price:           ${metrics.price}
  • RSI:             ${metrics.rsi}
  • Momentum:        ${metrics.momentum}
  • Support:         ${metrics.support}
  • Resistance:      ${metrics.resistance}
  • Float %:         ${metrics.floatPercent}
  • Short Float %:   ${metrics.shortFloat}
  • Volume Spike:    ${metrics.volumeSpike ? 'Yes' : 'No'}
  • Pre-Market %Chg: ${metrics.preMarketChange}
  • Pre-Market Spike:${metrics.preMarketVolSpike ? 'Yes' : 'No'}

FULL OPTION CHAINS (calls + puts):
\`\`\`json
${JSON.stringify(simplifiedChains, null, 2)}
\`\`\`

Given all of the above data, answer:
1) Which CALL contract should we BUY (if any)?  Provide:
   • contractSymbol
   • strike
   • expiry
   • bid, ask, impliedVolatility, openInterest
   • Your rationale for choosing it, and suggested entry price.
2) How and when should we EXIT that CALL?  Provide clear exit criteria
   (profit target, stop-loss, or time-based exit).

Respond with JSON:
{
  "contractSymbol": "...",
  "strike": ...,
  "expiry": "...",
  "bid": ...,
  "ask": ...,
  "impliedVolatility": ...,
  "openInterest": ...,
  "rationale": "...",
  "entryPrice": "...",
  "exitPlan": "..."
}
    `.trim();

    putPrompt = `
You are an options strategist. Below is a **complete chain** of call and put contracts 
for ${symbol}, from the nearest expiration up through ~2 months out.

UNDERLYING METRICS:
  • Price:           ${metrics.price}
  • RSI:             ${metrics.rsi}
  • Momentum:        ${metrics.momentum}
  • Support:         ${metrics.support}
  • Resistance:      ${metrics.resistance}
  • Float %:         ${metrics.floatPercent}
  • Short Float %:   ${metrics.shortFloat}
  • Volume Spike:    ${metrics.volumeSpike ? 'Yes' : 'No'}
  • Pre-Market %Chg: ${metrics.preMarketChange}
  • Pre-Market Spike:${metrics.preMarketVolSpike ? 'Yes' : 'No'}

FULL OPTION CHAINS (calls + puts):
\`\`\`json
${JSON.stringify(simplifiedChains, null, 2)}
\`\`\`

Given all of the above data, answer:
1) Which PUT contract should we BUY (if any)?  Provide:
   • contractSymbol
   • strike
   • expiry
   • bid, ask, impliedVolatility, openInterest
   • Your rationale for choosing it, and suggested entry price.
2) How and when should we EXIT that PUT?  Provide clear exit criteria
   (profit target, stop-loss, or time-based exit).

Respond with JSON:
{
  "contractSymbol": "...",
  "strike": ...,
  "expiry": "...",
  "bid": ...,
  "ask": ...,
  "impliedVolatility": ...,
  "openInterest": ...,
  "rationale": "...",
  "entryPrice": "...",
  "exitPlan": "..."
}
    `.trim();
  } else {
    if (callPick) {
      callPrompt = `
You are an options strategist.
Stock: ${symbol}

Underlying metrics:
  • Price:           ${metrics.price}
  • RSI:             ${metrics.rsi}
  • Momentum:        ${metrics.momentum}
  • Support:         ${metrics.support}
  • Resistance:      ${metrics.resistance}
  • Float %:         ${metrics.floatPercent}
  • Short Float %:   ${metrics.shortFloat}
  • Volume Spike:    ${metrics.volumeSpike ? 'Yes' : 'No'}
  • Pre-Market %Chg: ${metrics.preMarketChange}
  • Pre-Market Spike:${metrics.preMarketVolSpike ? 'Yes' : 'No'}

Single ATM CALL contract we can buy:
  • contractSymbol: "${callPick.contractSymbol}"
  • strike:         ${callPick.strike}
  • expiry:         "${callPick.expiry}"

Return JSON with EXACTLY these six fields:
{
  "contractSymbol": string | null,
  "strike":        number | null,
  "expiry":        string | null,
  "action":       "Buy"|"Hold"|"Sell",
  "rationale":     string,
  "exitPlan":      string
}

If you do not want to buy this CALL, set contractSymbol, strike, expiry to null,
and still provide "action":"Hold" (or "action":"Sell") with rationale and exitPlan.
      `.trim();
    }

    if (putPick) {
      putPrompt = `
You are an options strategist.
Stock: ${symbol}

Underlying metrics:
  • Price:           ${metrics.price}
  • RSI:             ${metrics.rsi}
  • Momentum:        ${metrics.momentum}
  • Support:         ${metrics.support}
  • Resistance:      ${metrics.resistance}
  • Float %:         ${metrics.floatPercent}
  • Short Float %:   ${metrics.shortFloat}
  • Volume Spike:    ${metrics.volumeSpike ? 'Yes' : 'No'}
  • Pre-Market %Chg: ${metrics.preMarketChange}
  • Pre-Market Spike:${metrics.preMarketVolSpike ? 'Yes' : 'No'}

Single ATM PUT contract we can buy:
  • contractSymbol: "${putPick.contractSymbol}"
  • strike:         ${putPick.strike}
  • expiry:         "${putPick.expiry}"

Return JSON with EXACTLY these six fields:
{
  "contractSymbol": string | null,
  "strike":        number | null,
  "expiry":        string | null,
  "action":       "Buy"|"Hold"|"Sell",
  "rationale":     string,
  "exitPlan":      string
}

If you do not want to buy this PUT, set contractSymbol, strike, expiry to null,
and still provide "action":"Hold" (or "action":"Sell") with rationale and exitPlan.
      `.trim();
    }

    if (!callPick) callPrompt = null;
    if (!putPick)  putPrompt  = null;
  }

  let callAnalysis = {
      contractSymbol:    null,
      strike:            null,
      expiry:            null,
      bid:               null,
      ask:               null,
      impliedVolatility: null,
      openInterest:      null,
      rationale:         'No option data available.',
      entryPrice:        null,
      exitPlan:          'N/A',
    },
    putAnalysis = {
      contractSymbol:    null,
      strike:            null,
      expiry:            null,
      bid:               null,
      ask:               null,
      impliedVolatility: null,
      openInterest:      null,
      rationale:         'No option data available.',
      entryPrice:        null,
      exitPlan:          'N/A',
    };

  if (callPrompt) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini-2025-04-14',
        messages: [{ role: 'user', content: callPrompt }],
        temperature: 0.2,
        max_tokens: 400,
      });
      const raw = response.choices[0].message.content;
      const jsonText = extractJson(raw);
      callAnalysis = JSON.parse(jsonText);
    } catch (err) {
      log.warn(`⚠️ GPT failed on callPrompt for ${symbol}: ${err.message}`);
    }
  }

  if (putPrompt) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini-2025-04-14',
        messages: [{ role: 'user', content: putPrompt }],
        temperature: 0.2,
        max_tokens: 400,
      });
      const raw = response.choices[0].message.content;
      const jsonText = extractJson(raw);
      putAnalysis = JSON.parse(jsonText);
    } catch (err) {
      log.warn(`⚠️ GPT failed on putPrompt for ${symbol}: ${err.message}`);
    }
  }

  return {
    callPick: callAnalysis.contractSymbol
      ? {
          contractSymbol:    callAnalysis.contractSymbol,
          strike:            callAnalysis.strike,
          expiry:            callAnalysis.expiry,
          bid:               callAnalysis.bid,
          ask:               callAnalysis.ask,
          impliedVolatility: callAnalysis.impliedVolatility,
          openInterest:      callAnalysis.openInterest,
          rationale:         callAnalysis.rationale,
          entryPrice:        callAnalysis.entryPrice,
          exitPlan:          callAnalysis.exitPlan,
        }
      : callPick,
    callRationale: callAnalysis.rationale,
    callExitPlan:  callAnalysis.exitPlan,

    putPick: putAnalysis.contractSymbol
      ? {
          contractSymbol:    putAnalysis.contractSymbol,
          strike:            putAnalysis.strike,
          expiry:            putAnalysis.expiry,
          bid:               putAnalysis.bid,
          ask:               putAnalysis.ask,
          impliedVolatility: putAnalysis.impliedVolatility,
          openInterest:      putAnalysis.openInterest,
          rationale:         putAnalysis.rationale,
          entryPrice:        putAnalysis.entryPrice,
          exitPlan:          putAnalysis.exitPlan,
        }
      : putPick,
    putRationale: putAnalysis.rationale,
    putExitPlan:  putAnalysis.exitPlan,
  };
}

module.exports = { analyzeOptionsWithGPT };

function pickATMFromList(list, underlyingPrice) {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best = list[0];
  let bestDiff = Math.abs(best.strike - underlyingPrice);
  for (const opt of list) {
    if (typeof opt.strike !== 'number') continue;
    const diff = Math.abs(opt.strike - underlyingPrice);
    if (diff < bestDiff) {
      best = opt;
      bestDiff = diff;
    }
  }
  return best;
}
