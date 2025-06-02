
const axios = require('axios')
require('dotenv').config()

const POLYGON_API_KEY = process.env.POLYGON_API_KEY
const BASE_URL       = 'https://api.polygon.io/v3/snapshot/options'

async function fetchOptionChain(symbol) {
  const url  = `${BASE_URL}/${symbol}`
  try {
    const resp = await axios.get(url, {
      params: { apiKey: POLYGON_API_KEY, limit: 250 }
    })
    return resp.data.results || []
  } catch (err) {
    console.error(`❌ Polygon chain fetch failed for ${symbol}:`, err.message)
    return []
  }
}

function pickExpiration(expirations, isDayTrade) {
  expirations.sort()
  if (isDayTrade) {
    // pick nearest weekly expiry on Friday
    return expirations.find(d => new Date(d).getUTCDay() === 5) || expirations[0]
  } else {
    // pick expiry ~30 days out
    const target = Date.now() + 30 * 24 * 60 * 60 * 1000
    return expirations.reduce((p, c) =>
      Math.abs(new Date(c) - target) < Math.abs(new Date(p) - target) ? c : p
    )
  }
}

function pickByDelta(options, target = 0.35) {
  return options.reduce((best, opt) => {
    const d1 = Math.abs(opt.greeks.delta - target)
    const d2 = Math.abs(best.greeks.delta - target)
    return d1 < d2 ? opt : best
  })
}

async function suggestCall(symbol, isDayTrade) {
  const chain       = await fetchOptionChain(symbol)
  const expirations = Array.from(new Set(chain.map(o => o.expiration_date)))
  const expiry      = pickExpiration(expirations, isDayTrade)
  const calls       = chain.filter(o =>
    o.expiration_date === expiry &&
    o.contract_type   === 'call' &&
    o.greeks &&
    o.greeks.delta != null
  )
  if (!calls.length) throw new Error(`no calls for ${symbol}`)
  const pick    = pickByDelta(calls, 0.35)
  const premium = pick.last_quote?.askPrice ?? pick.last_trade?.price
  return {
    type:    'call',
    strike:  pick.strike_price,
    expiry:  pick.expiration_date,
    premium: premium,
    delta:   pick.greeks.delta
  }
}

async function suggestPut(symbol, isDayTrade) {
  const chain       = await fetchOptionChain(symbol)
  const expirations = Array.from(new Set(chain.map(o => o.expiration_date)))
  const expiry      = pickExpiration(expirations, isDayTrade)
  const puts        = chain.filter(o =>
    o.expiration_date === expiry &&
    o.contract_type   === 'put' &&
    o.greeks &&
    o.greeks.delta != null
  )
  if (!puts.length) throw new Error(`no puts for ${symbol}`)
  const pick    = pickByDelta(puts, -0.35)
  const premium = pick.last_quote?.askPrice ?? pick.last_trade?.price
  return {
    type:    'put',
    strike:  pick.strike_price,
    expiry:  pick.expiration_date,
    premium: premium,
    delta:   Math.abs(pick.greeks.delta)
  }
}

module.exports = {
  fetchOptionChain,
  suggestCall,
  suggestPut
}
