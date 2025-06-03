// server/utils/db.cjs

const Database = require('better-sqlite3')
const path     = require('path')

const dbPath = path.join(__dirname, '../cache/data.sqlite')
const db     = new Database(dbPath)

// Create tables for price snapshots, candidates, and scan history
db.exec(`
  CREATE TABLE IF NOT EXISTS priceSnapshots (
    symbol    TEXT    PRIMARY KEY,
    lastClose REAL    NOT NULL,
    ts        TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS squeezeCandidates (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol                TEXT    NOT NULL,
    price                 REAL,
    volume                REAL,
    rsi                   REAL,
    momentum              REAL,
    volumeSpike           INTEGER,
    support               REAL,
    resistance            REAL,
    floatPercent          REAL,
    shortFloat            REAL,
    score                 INTEGER,
    setupScore            INTEGER,
    earlyCandidate        INTEGER,

    totalScore            REAL,
    isTopPick             INTEGER,
    combinedReasons       TEXT,
    metrics               TEXT,

    recommendation        TEXT,
    suggestion            TEXT,
    summary               TEXT,
    buyPrice              REAL,
    sellPrice             REAL,

    action                TEXT,
    actionRationale       TEXT,
    isDayTradeCandidate   INTEGER,
    dayTradeBuyPrice      REAL,
    dayTradeSellPrice     REAL,
    longBuyPrice          REAL,
    longSellPrice         REAL,

    preMarketChange       REAL,
    preMarketVolSpike     REAL,

    reasons               TEXT,
    setupReasons          TEXT,

    callPick              TEXT,
    putPick               TEXT,
    callAction            TEXT,
    callRationale         TEXT,
    putAction             TEXT,
    putRationale          TEXT,
    callExitPlan          TEXT,
    putExitPlan           TEXT,

    timestamp             TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      TEXT,
    candidateCount INTEGER
  );
`)

/**
 * Upsert a single price snapshot
 */
const upsertSnapshotStmt = db.prepare(`
  INSERT INTO priceSnapshots (symbol, lastClose, ts)
  VALUES (@symbol, @lastClose, @ts)
  ON CONFLICT(symbol) DO UPDATE SET
    lastClose = excluded.lastClose,
    ts        = excluded.ts
`)

/**
 * Save an array of snapshots into priceSnapshots.
 * @param {Array<{symbol:string,lastClose:number}>} snapshots
 */
function savePriceSnapshots(snapshots) {
  const now = new Date().toISOString()
  const transaction = db.transaction((items) => {
    for (const { symbol, lastClose } of items) {
      upsertSnapshotStmt.run({ symbol, lastClose, ts: now })
    }
  })
  transaction(snapshots)
}

/**
 * Retrieve all current price snapshots.
 * @returns {Array<{symbol:string,lastClose:number,ts:string}>}
 */
function getPriceSnapshots() {
  return db.prepare(`SELECT symbol, lastClose, ts FROM priceSnapshots`).all()
}

/**
 * Save an array of results into squeezeCandidates and record history.
 *
 * We now expect that fields like `metrics`, `reasons`, `setupReasons`,
 * `callPick`, and `putPick` are already JSON‐stringified (or plain strings).
 * We no longer wrap them in JSON.stringify here.
 */
function saveResults(results) {
  const insertCandidate = db.prepare(`
    INSERT INTO squeezeCandidates (
      symbol, price, volume, rsi, momentum, volumeSpike,
      support, resistance, floatPercent, shortFloat,
      score, setupScore, earlyCandidate,

      totalScore, isTopPick, combinedReasons, metrics,

      recommendation, suggestion, summary,
      buyPrice, sellPrice,

      action, actionRationale, isDayTradeCandidate,
      dayTradeBuyPrice, dayTradeSellPrice, longBuyPrice, longSellPrice,

      preMarketChange, preMarketVolSpike,

      reasons, setupReasons,

      callPick, putPick,
      callAction, callRationale, putAction, putRationale,
      callExitPlan, putExitPlan,

      timestamp
    ) VALUES (
      @symbol, @price, @volume, @rsi, @momentum, @volumeSpike,
      @support, @resistance, @floatPercent, @shortFloat,
      @score, @setupScore, @earlyCandidate,

      @totalScore, @isTopPick, @combinedReasons, @metrics,

      @recommendation, @suggestion, @summary,
      @buyPrice, @sellPrice,

      @action, @actionRationale, @isDayTradeCandidate,
      @dayTradeBuyPrice, @dayTradeSellPrice, @longBuyPrice, @longSellPrice,

      @preMarketChange, @preMarketVolSpike,

      @reasons, @setupReasons,

      @callPick, @putPick,
      @callAction, @callRationale, @putAction, @putRationale,
      @callExitPlan, @putExitPlan,

      @timestamp
    )
  `)

  const insertHistory = db.prepare(`
    INSERT INTO history (timestamp, candidateCount) VALUES (?, ?)
  `)

  const now = new Date().toISOString()
  const transaction = db.transaction((items) => {
    for (const item of items) {
      console.log('→ Inserting candidate:', item);
      insertCandidate.run({
        symbol:               item.symbol,
        price:                item.price,
        volume:               item.volume,
        rsi:                  item.rsi,
        momentum:             item.momentum,
        volumeSpike:          item.volumeSpike ? 1 : 0,
        support:              item.support,
        resistance:           item.resistance,
        floatPercent:         item.floatPercent,
        shortFloat:           item.shortFloat,
        score:                item.score,
        setupScore:           item.setupScore,
        earlyCandidate:       item.earlyCandidate ? 1 : 0,

        totalScore:           item.totalScore,
        isTopPick:            item.isTopPick ? 1 : 0,
        combinedReasons:      item.combinedReasons,
        metrics:              item.metrics,         // already a JSON string

        recommendation:       item.recommendation || null,
        suggestion:           item.suggestion,
        summary:              item.summary,
        buyPrice:             item.buyPrice,
        sellPrice:            item.sellPrice,

        action:               item.action,
        actionRationale:      item.actionRationale,
        isDayTradeCandidate:  item.isDayTradeCandidate ? 1 : 0,
        dayTradeBuyPrice:     item.dayTradeBuyPrice,
        dayTradeSellPrice:    item.dayTradeSellPrice,
        longBuyPrice:         item.longBuyPrice,
        longSellPrice:        item.longSellPrice,

        preMarketChange:      item.preMarketChange,
        preMarketVolSpike:    item.preMarketVolSpike,

        reasons:              item.reasons,       // already a plain or JSON‐string
        setupReasons:         item.setupReasons,  // same

        callPick:             item.callPick,      // already JSON string
        putPick:              item.putPick,       // already JSON string
        callAction:           item.callAction,
        callRationale:        item.callRationale,
        putAction:            item.putAction,
        putRationale:         item.putRationale,
        callExitPlan:         item.callExitPlan,
        putExitPlan:          item.putExitPlan,

        timestamp:            now
      })
    }
    insertHistory.run(now, items.length)
  })

  transaction(results)
}

/**
 * Retrieve the most recent candidate entries (default 20)
 */
function getLatestCandidates(limit = 20) {
  return db.prepare(
    `SELECT * FROM squeezeCandidates ORDER BY id DESC LIMIT ?`
  ).all(limit)
}

/**
 * Retrieve the scan history (default 10 entries)
 */
function getScanHistory(limit = 10) {
  return db.prepare(
    `SELECT * FROM history ORDER BY id DESC LIMIT ?`
  ).all(limit)
}

module.exports = {
  db,
  savePriceSnapshots,
  getPriceSnapshots,
  saveResults,
  getLatestCandidates,
  getScanHistory
}
