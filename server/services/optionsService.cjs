// server/services/optionsService.cjs

const yahooFinance = require('yahoo-finance2').default;
const yahooLimiter = require('../utils/yahooLimiter.cjs');

/**
 * pickATMContract(optionsList, underlyingPrice)
 *
 * From a list of option contracts (each has .strike), pick the one
 * whose strike is closest to the underlyingPrice. Returns that contract
 * object, or null if the list is empty.
 */
function pickATMContract(optionsList, underlyingPrice) {
  if (!Array.isArray(optionsList) || optionsList.length === 0) {
    return null;
  }

  let best = optionsList[0];
  let bestDiff = Math.abs(best.strike - underlyingPrice);

  for (const opt of optionsList) {
    if (typeof opt.strike !== 'number') continue;
    const diff = Math.abs(opt.strike - underlyingPrice);
    if (diff < bestDiff) {
      best = opt;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * pickTwoMonthsOut(expirationDates)
 *
 * Given an array of Date objects (sorted ascending), return the first Date
 * that is on or after “now + 60 days.” If none exist, return the last date.
 */
function pickTwoMonthsOut(expirationDates) {
  const now = Date.now();
  const targetMs = now + 60 * 24 * 60 * 60 * 1000; // 60 days
  for (const d of expirationDates) {
    if (d.getTime() >= targetMs) {
      return d;
    }
  }
  return expirationDates[expirationDates.length - 1];
}

/**
 * suggestCall(symbol, isDayTrade, priceOverride)
 *
 * 1) Fetch all expirationDates via yahooFinance.options(symbol).
 * 2) Build “searchDates” starting from the date ≈ two months out (if none, fallback to full list).
 * 3) Loop over searchDates in ascending order:
 *     a) Convert dateObj → rawTs (seconds).
 *     b) Fetch chainForDate = yahooFinance.options(symbol, { date: rawTs }).
 *     c) If chainForDate.options[0].calls is nonempty, break/return that ATM call.
 * 4) Throw if we never find any calls within that range.
 * 5) Pick ATM call via pickATMContract(calls, underlyingPrice).
 */
async function suggestCall(symbol, isDayTrade, priceOverride = null) {
  // 1) Fetch all expirations
  let chainRoot;
  try {
    chainRoot = await yahooLimiter.schedule(() =>
      yahooFinance.options(symbol)
    );
  } catch (err) {
    throw new Error(`Failed to fetch expirations for ${symbol}: ${err.message}`);
  }

  const expirations = chainRoot.expirationDates || [];
  console.log(
    `[optionsService] ${symbol} raw expirationDates (first 5):`,
    expirations.slice(0, 5),
    `(total=${expirations.length})`
  );
  if (expirations.length === 0) {
    throw new Error(`No option expirations returned for ${symbol}`);
  }

  // 2) Pick two months out and build searchDates
  const twoMonthDate = pickTwoMonthsOut(expirations);
  let searchDates = expirations.filter(d => d.getTime() <= twoMonthDate.getTime());
  if (searchDates.length === 0) {
    searchDates = expirations.slice(); // fallback to full list
  }
  console.log(
    `[optionsService] ${symbol} will search expirations from nearest up through:`,
    twoMonthDate.toISOString().slice(0, 10)
  );

  // 3) Loop over searchDates until we find a non-empty calls array
  let chosenRawTs = null;
  let chosenDateObj = null;
  let chainForDate = null;

  for (const dateObj of searchDates) {
    const rawTs = Math.floor(dateObj.getTime() / 1000);

    // b) Fetch the chain for that date
    try {
      chainForDate = await yahooLimiter.schedule(() =>
        yahooFinance.options(symbol, { date: rawTs })
      );
    } catch (err) {
      console.warn(
        `[optionsService] ${symbol} failed to fetch chain for expiry ${dateObj
          .toISOString()
          .slice(0, 10)} (rawTs=${rawTs}): ${err.message}`
      );
      continue;
    }

    const optionObj = Array.isArray(chainForDate.options) ? chainForDate.options[0] : null;
    const calls = optionObj && Array.isArray(optionObj.calls) ? optionObj.calls : [];
    console.log(
      `[optionsService] ${symbol} chainForDate on ${dateObj
        .toISOString()
        .slice(0, 10)} → calls.length=${calls.length}`
    );

    if (calls.length > 0) {
      chosenRawTs = rawTs;
      chosenDateObj = dateObj;
      break;
    }
    // Otherwise keep looping
  }

  if (!chosenRawTs) {
    const allDates = searchDates.map(d => d.toISOString().slice(0, 10)).join(', ');
    throw new Error(
      `No call contracts found for any expirations from nearest through two months: [${allDates}]`
    );
  }

  console.log(
    `[optionsService] ${symbol} using expiration date:`,
    chosenDateObj.toISOString().slice(0, 10),
    `(rawTs=${chosenRawTs})`
  );

  // Now we have chainForDate for chosenRawTs
  const optionObj = chainForDate.options[0];
  const calls = Array.isArray(optionObj.calls) ? optionObj.calls : [];
  const puts = Array.isArray(optionObj.puts) ? optionObj.puts : [];
  console.log(
    `[optionsService] ${symbol} chainForDate summary: calls.length=${
      calls.length
    }, puts.length=${puts.length}`
  );
  console.log(
    `[optionsService] ${symbol} sample call strikes:`,
    calls.slice(0, 5).map(c => c.strike)
  );

  // 4) Underlying price
  let underlyingPrice = priceOverride;
  if (underlyingPrice == null) {
    let quote;
    try {
      quote = await yahooLimiter.schedule(() =>
        yahooFinance.quote(symbol, { modules: ['price'] })
      );
    } catch (err) {
      throw new Error(`Failed to fetch quote for ${symbol}: ${err.message}`);
    }
    underlyingPrice = quote?.regularMarketPrice;
    console.log(`[optionsService] ${symbol} underlyingPrice:`, underlyingPrice);
    if (underlyingPrice == null) {
      throw new Error(`Could not fetch underlying price for ${symbol}`);
    }
  }

  // 5) Pick ATM call from calls[]
  const bestCall = pickATMContract(calls, underlyingPrice);
  if (!bestCall) {
    throw new Error(`No suitable call strike found for ${symbol}`);
  }
  console.log(
    `[optionsService] ${symbol} pickATMContract returned call:`,
    bestCall.contractSymbol
  );

  return {
    type: 'call',
    contractSymbol: bestCall.contractSymbol,
    strike: bestCall.strike,
    expiry: chosenDateObj.toISOString().slice(0, 10),
  };
}

/**
 * suggestPut(symbol, isDayTrade, priceOverride)
 *
 * Same approach as suggestCall, but for puts.
 */
async function suggestPut(symbol, isDayTrade, priceOverride = null) {
  // 1) Fetch all expirations
  let chainRoot;
  try {
    chainRoot = await yahooLimiter.schedule(() =>
      yahooFinance.options(symbol)
    );
  } catch (err) {
    throw new Error(`Failed to fetch expirations for ${symbol}: ${err.message}`);
  }

  const expirations = chainRoot.expirationDates || [];
  console.log(
    `[optionsService] ${symbol} raw expirationDates (first 5):`,
    expirations.slice(0, 5),
    `(total=${expirations.length})`
  );
  if (expirations.length === 0) {
    throw new Error(`No option expirations returned for ${symbol}`);
  }

  // 2) Pick two months out and build searchDates
  const twoMonthDate = pickTwoMonthsOut(expirations);
  let searchDates = expirations.filter(d => d.getTime() <= twoMonthDate.getTime());
  if (searchDates.length === 0) {
    searchDates = expirations.slice(); // fallback
  }
  console.log(
    `[optionsService] ${symbol} will search expirations from nearest up through:`,
    twoMonthDate.toISOString().slice(0, 10)
  );

  let chosenRawTs = null;
  let chosenDateObj = null;
  let chainForDate = null;

  for (const dateObj of searchDates) {
    const rawTs = Math.floor(dateObj.getTime() / 1000);

    try {
      chainForDate = await yahooLimiter.schedule(() =>
        yahooFinance.options(symbol, { date: rawTs })
      );
    } catch (err) {
      console.warn(
        `[optionsService] ${symbol} failed to fetch chain for expiry ${dateObj
          .toISOString()
          .slice(0, 10)} (rawTs=${rawTs}): ${err.message}`
      );
      continue;
    }

    const optionObj = Array.isArray(chainForDate.options) ? chainForDate.options[0] : null;
    const puts = optionObj && Array.isArray(optionObj.puts) ? optionObj.puts : [];
    console.log(
      `[optionsService] ${symbol} chainForDate on ${dateObj
        .toISOString()
        .slice(0, 10)} → puts.length=${puts.length}`
    );

    if (puts.length > 0) {
      chosenRawTs = rawTs;
      chosenDateObj = dateObj;
      break;
    }
  }

  if (!chosenRawTs) {
    const allDates = searchDates.map(d => d.toISOString().slice(0, 10)).join(', ');
    throw new Error(
      `No put contracts found for any expirations from nearest through two months: [${allDates}]`
    );
  }

  console.log(
    `[optionsService] ${symbol} using expiration date:`,
    chosenDateObj.toISOString().slice(0, 10),
    `(rawTs=${chosenRawTs})`
  );

  const optionObj = chainForDate.options[0];
  const calls = Array.isArray(optionObj.calls) ? optionObj.calls : [];
  const puts = Array.isArray(optionObj.puts) ? optionObj.puts : [];
  console.log(
    `[optionsService] ${symbol} chainForDate summary: calls.length=${
      calls.length
    }, puts.length=${puts.length}`
  );
  console.log(
    `[optionsService] ${symbol} sample put strikes:`,
    puts.slice(0, 5).map(p => p.strike)
  );

  let underlyingPrice = priceOverride;
  if (underlyingPrice == null) {
    let quote;
    try {
      quote = await yahooLimiter.schedule(() =>
        yahooFinance.quote(symbol, { modules: ['price'] })
      );
    } catch (err) {
      throw new Error(`Failed to fetch quote for ${symbol}: ${err.message}`);
    }
    underlyingPrice = quote?.regularMarketPrice;
    console.log(`[optionsService] ${symbol} underlyingPrice:`, underlyingPrice);
    if (underlyingPrice == null) {
      throw new Error(`Could not fetch underlying price for ${symbol}`);
    }
  }

  const bestPut = pickATMContract(puts, underlyingPrice);
  if (!bestPut) {
    throw new Error(`No suitable put strike found for ${symbol}`);
  }
  console.log(
    `[optionsService] ${symbol} pickATMContract returned put:`,
    bestPut.contractSymbol
  );

  return {
    type: 'put',
    contractSymbol: bestPut.contractSymbol,
    strike: bestPut.strike,
    expiry: chosenDateObj.toISOString().slice(0, 10),
  };
}

/**
 * getContractsInRange(symbol)
 *
 * Returns _all_ option chains (calls + puts) for every expiration
 * from the nearest date up through two months out. If the array of
 * expirationDates is empty, throws an error. Otherwise returns:
 *
 * [
 *   {
 *     expiry: '2025-06-05',
 *     calls: [ … ],
 *     puts: [ … ]
 *   },
 *   {
 *     expiry: '2025-06-12',
 *     calls: [ … ],
 *     puts: [ … ]
 *   },
 *   … up through the two-month cutoff …
 * ]
 */
async function getContractsInRange(symbol) {
  // 1) Fetch all expirations
  let chainRoot;
  try {
    chainRoot = await yahooLimiter.schedule(() =>
      yahooFinance.options(symbol)
    );
  } catch (err) {
    throw new Error(`Failed to fetch expirations for ${symbol}: ${err.message}`);
  }

  const expirations = chainRoot.expirationDates || [];
  console.log(
    `[optionsService] ${symbol} raw expirationDates (first 5):`,
    expirations.slice(0, 5),
    `(total=${expirations.length})`
  );
  if (expirations.length === 0) {
    throw new Error(`No option expirations returned for ${symbol}`);
  }

  // 2) Determine two-month cutoff
  const twoMonthDate = pickTwoMonthsOut(expirations);

  // 3) Build list of dates from nearest up through two months
  const datesInRange = expirations.filter(d =>
    // include any expiration ≤ twoMonthDate
    d.getTime() <= twoMonthDate.getTime()
  );
  console.log(
    `[optionsService] ${symbol} will fetch contracts for expirations from ${datesInRange[0]
      .toISOString()
      .slice(0, 10)} up through ${twoMonthDate.toISOString().slice(0, 10)}`
  );

  const results = [];

  // 4) For each date in that range, fetch its chain and collect calls+puts
  for (const dateObj of datesInRange) {
    const rawTs = Math.floor(dateObj.getTime() / 1000);
    let chainForDate;
    try {
      chainForDate = await yahooLimiter.schedule(() =>
        yahooFinance.options(symbol, { date: rawTs })
      );
    } catch (err) {
      console.warn(
        `[optionsService] ${symbol} failed to fetch chain for expiry ${dateObj
          .toISOString()
          .slice(0, 10)} (rawTs=${rawTs}): ${err.message}`
      );
      continue;
    }

    const optionObj = Array.isArray(chainForDate.options) ? chainForDate.options[0] : null;
    if (!optionObj) {
      console.warn(
        `[optionsService] ${symbol} no option object for expiry ${dateObj
          .toISOString()
          .slice(0, 10)}`
      );
      continue;
    }

    const calls = Array.isArray(optionObj.calls) ? optionObj.calls : [];
    const puts = Array.isArray(optionObj.puts) ? optionObj.puts : [];

    console.log(
      `[optionsService] ${symbol} ${dateObj.toISOString().slice(0, 10)}: calls.length=${
        calls.length
      }, puts.length=${puts.length}`
    );

    results.push({
      expiry: dateObj.toISOString().slice(0, 10),
      calls,
      puts
    });
  }

  return results;
}

module.exports = {
  suggestCall,
  suggestPut,
  getContractsInRange
};
