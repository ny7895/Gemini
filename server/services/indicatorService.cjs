const fs = require('fs');
const path = require('path');
const { getYahooIndicators } = require('./yahooIndicators.cjs');

const CACHE_PATH = path.join(__dirname, '../cache/indicatorCache.json');

// Ensure the cache folder exists
const ensureCacheDir = () => {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
};

const readCache = () => {
  ensureCacheDir();
  if (fs.existsSync(CACHE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    } catch (e) {
      console.error(`⚠️ Cache corrupted: ${e.message}`);
      fs.unlinkSync(CACHE_PATH); // delete bad cache
      return {};
    }
  }
  return {};
};


const writeCache = (cache) => {
  ensureCacheDir();
  const tmpPath = CACHE_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tmpPath, CACHE_PATH);
};


const isFresh = (timestamp) => {
  const ONE_DAY = 1000 * 60 * 60 * 24;
  return Date.now() - new Date(timestamp).getTime() < ONE_DAY;
};

async function getIndicators(symbol) {
  const cache = readCache();
  const entry = cache[symbol];

  if (entry && isFresh(entry.updatedAt)) {
    // console.log(`✅ Cache hit: ${symbol}`);
    return entry;
  }

  try {
    const data = await getYahooIndicators(symbol);

    // ✅ Validate the fetched data BEFORE writing to cache
    if (!data || typeof data !== 'object' || Object.values(data).includes(undefined)) {
      throw new Error(`Invalid data for ${symbol}`);
    }

    cache[symbol] = {
      ...data,
      updatedAt: new Date().toISOString()
    };
    writeCache(cache);
    return cache[symbol];

  } catch (err) {
    console.error(`⚠️ Indicator fetch failed for ${symbol}:`, err.message);
    if (entry) {
      console.warn(`⚠️ Returning stale cache for ${symbol}`);
      return entry;
    }
    throw err;
  }
}


module.exports = { getIndicators };
