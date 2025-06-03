// server/services/testOptions.cjs

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { suggestCall, suggestPut } = require('../services/optionsService.cjs');
const { getContractsInRange } = require('../services/optionsService.cjs');


// Create a write stream for logging
const logFilePath = path.join(__dirname, 'optionsTest.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });

// Override console.log and console.error
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  const message = args.map(String).join(' ') + '\n';
  logStream.write(message);
  originalLog(...args);
};

console.error = (...args) => {
  const message = args.map(String).join(' ') + '\n';
  logStream.write(message);
  originalError(...args);
};

async function testSymbol(symbol) {
  const result = { symbol };
  try {
    const call = await suggestCall(symbol, false, null);
    result.call = call;
    console.log(`[testOptions] ${symbol} call result:`, call);
  } catch (err) {
    result.callError = err.message;
    console.error(`[testOptions] ${symbol} callError:`, err.message);
  }

  try {
    const put = await suggestPut(symbol, false, null);
    result.put = put;
    console.log(`[testOptions] ${symbol} put result:`, put);
  } catch (err) {
    result.putError = err.message;
    console.error(`[testOptions] ${symbol} putError:`, err.message);
  }

  return result;
}
getContractsInRange('AAPL').then(console.log);

;(async () => {
  const tickers = ['AAPL', 'TSLA', 'MSFT', 'GOOG'];
  const output = [];

  for (const sym of tickers) {
    console.log(`\n=== Testing options for ${sym} ===`);
    const res = await testSymbol(sym);
    output.push(res);
  }

  // Write JSON results
  const outPath = path.join(__dirname, 'optionsResults.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\n✅ JSON results written to ${outPath}`);
  } catch (fsErr) {
    console.error(`❌ Failed to write JSON results file: ${fsErr.message}`);
  }

  // Now that we're completely done, close the log stream
  logStream.end();

  // If you want one final console message after end(): use originalLog
  originalLog(`✅ All console output saved to ${logFilePath}`);
})();
