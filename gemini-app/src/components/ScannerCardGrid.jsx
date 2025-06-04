import React, { useEffect, useState } from 'react';
const base = import.meta.env.VITE_API_BASE_URL;

// ——— Reusable badge for numeric scores ———
const Badge = ({ score, label = 'Score' }) => {
  const color =
    score >= 5
      ? 'bg-green-500'
      : score >= 3
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <span className={`text-white text-xs px-2 py-1 rounded-full ${color}`}>
      {label}: {score != null ? score.toFixed(2) : '—'}
    </span>
  );
};

const StatusBadge = ({ isTopPick, score, earlyCandidate }) => {
  if (isTopPick) {
    return (
      <span className="text-xs px-2 py-1 bg-purple-600 text-white rounded-full">
        🌟 Top Pick
      </span>
    );
  } else if (score >= 4) {
    return (
      <span className="text-xs px-2 py-1 bg-red-500 text-white rounded-full">
        🔥 Squeeze Candidate
      </span>
    );
  } else if (earlyCandidate) {
    return (
      <span className="text-xs px-2 py-1 bg-blue-500 text-white rounded-full">
        📡 Early Setup
      </span>
    );
  }
  return null;
};

const ScannerCardGrid = () => {
  const [candidates, setCandidates] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [sortField, setSortField] = useState('totalScore');
  const [filterMode, setFilterMode] = useState('all');
  const [totalScanned, setTotalScanned] = useState(0);
  const [selectedScan, setSelectedScan] = useState('latest');

  // — fetch only the latest candidates —
  const fetchResults = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/scanner/candidates`);
      const data = await res.json();

      const parsed = data.map((item) => ({
        ...item,
        preMarketChange: item.preMarketChange ?? null,
        preMarketVolSpike: item.preMarketVolSpike ?? null,
        combinedReasons: Array.isArray(item.combinedReasons)
          ? item.combinedReasons
          : item.combinedReasons
          ? item.combinedReasons.split(', ').filter((r) => r)
          : [],
        metrics: item.metrics || {},
        action: item.action || '',
        actionRationale: item.actionRationale || '',
        isDayTradeCandidate: Boolean(item.isDayTradeCandidate),
        dayTradeBuyPrice: item.dayTradeBuyPrice,
        dayTradeSellPrice: item.dayTradeSellPrice,
        longBuyPrice: item.longBuyPrice,
        longSellPrice: item.longSellPrice,
        callPick: item.callPick ?? null,
        putPick: item.putPick ?? null,
        callAction: item.callAction || '',
        callRationale: item.callRationale || '',
        putAction: item.putAction || '',
        putRationale: item.putRationale || '',
        callExitPlan: item.callExitPlan || '',
        putExitPlan: item.putExitPlan || '',
      }));

      setCandidates(parsed);
    } catch (err) {
      console.error('Error fetching candidates:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${base}/api/scanner/history`);
      const data = await res.json();
      setHistory([...data].reverse());
      if (data.length) {
        setTotalScanned(data[0].candidateCount);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const runScan = async () => {
    setScanning(true);
    setLoading(true);

    // 1) Kick off the background scan
    await fetch(`${base}/api/scanner/analyze`).catch((err) => {
      console.error('Failed to start scan:', err);
      setScanning(false);
      setLoading(false);
    });

    // 2) Immediately get whatever timestamp is currently at the top
    let lastTimestamp = null;
    try {
      const initRes = await fetch(`${base}/api/scanner/candidates`);
      const initData = await initRes.json();
      lastTimestamp = initData[0]?.timestamp || null;
    } catch (err) {
      console.error('Failed to fetch initial timestamp:', err);
    }

    const startTime = Date.now();
    const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const POLL_INTERVAL = 10 * 1000; // 10 seconds

    // 3) Poll until we see a new timestamp or timeout
    while (Date.now() - startTime < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      try {
        const res = await fetch(`${base}/api/scanner/candidates`);
        const data = await res.json();

        const newTimestamp = data[0]?.timestamp || null;
        if (newTimestamp && newTimestamp !== lastTimestamp) {
          // we have fresh results
          const parsed = data.map((item) => ({
            ...item,
            preMarketChange: item.preMarketChange ?? null,
            preMarketVolSpike: item.preMarketVolSpike ?? null,
            combinedReasons: Array.isArray(item.combinedReasons)
              ? item.combinedReasons
              : item.combinedReasons
              ? item.combinedReasons.split(', ').filter((r) => r)
              : [],
            metrics: item.metrics || {},
            action: item.action || '',
            actionRationale: item.actionRationale || '',
            isDayTradeCandidate: Boolean(item.isDayTradeCandidate),
            dayTradeBuyPrice: item.dayTradeBuyPrice,
            dayTradeSellPrice: item.dayTradeSellPrice,
            longBuyPrice: item.longBuyPrice,
            longSellPrice: item.longSellPrice,
            callPick: item.callPick ?? null,
            putPick: item.putPick ?? null,
            callAction: item.callAction || '',
            callRationale: item.callRationale || '',
            putAction: item.putAction || '',
            putRationale: item.putRationale || '',
            callExitPlan: item.callExitPlan || '',
            putExitPlan: item.putExitPlan || '',
          }));

          setCandidates(parsed);
          setLoading(false);
          setScanning(false);
          return;
        }
      } catch (err) {
        console.error('Polling failed:', err);
      }
    }

    // If we reach here, we’ve timed out
    console.warn('Scan timed out without fresh results.');
    setScanning(false);
    setLoading(false);
  };

  const handleSelectHistory = async (ts) => {
    setSelectedScan(ts);
    if (ts === 'latest') {
      await fetchResults();
      fetchHistory();
    } else {
      const entry = history.find((h) => h.timestamp === ts);
      if (entry) setTotalScanned(entry.candidateCount);
    }
  };

  useEffect(() => {
    fetchResults();
    fetchHistory();
    const id = setInterval(fetchResults, 12 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // — apply filtering & sorting —
  const filtered = candidates
    .filter((c) => c.totalScore >= minScore)
    .filter((c) => {
      if (filterMode === 'squeeze') return c.score >= 4;
      if (filterMode === 'early') return c.earlyCandidate && c.score < 4;
      return true;
    })
    .sort((a, b) => b[sortField] - a[sortField]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap gap-4 justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          📈 Short Squeeze Scanner
        </h2>
        <button
          onClick={runScan}
          className={`px-4 py-2 rounded text-white ${
            scanning ? 'bg-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'
          }`}
          disabled={scanning}
        >
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {/* Summary */}
      <div className="bg-gray-100 p-3 rounded-lg text-sm mb-4 text-gray-700 shadow-sm border">
        Scanned <strong>{totalScanned}</strong> stocks, showing{' '}
        <strong>{filtered.length}</strong> results
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Min Score */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Min Total Score
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm mt-1">≥ {minScore.toFixed(1)}</div>
        </div>
        {/* Sort By */}
        <div>
          <label className="block text-sm font-semibold mb-1">Sort By</label>
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="totalScore">Total Score</option>
            <option value="score">Squeeze Score</option>
            <option value="setupScore">Setup Score</option>
            <option value="shortFloat">Short Float %</option>
            <option value="rsi">RSI</option>
          </select>
        </div>
        {/* Filter Type */}
        <div>
          <label className="block text-sm font-semibold mb-1">Filter Type</label>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="all">All</option>
            <option value="squeeze">🔥 Squeeze Only</option>
            <option value="early">📡 Early Setups Only</option>
          </select>
        </div>
        {/* Scan History */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Scan History
          </label>
          <select
            value={selectedScan}
            onChange={(e) => handleSelectHistory(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="latest">Latest</option>
            {history.map((h) => (
              <option key={h.timestamp} value={h.timestamp}>
                {new Date(h.timestamp).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Candidate Cards */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filtered.map((c, i) => (
            <div
              key={i}
              className="
                flex flex-col justify-between p-6 bg-white border border-gray-200 shadow
                rounded-2xl
                max-h-[32rem]      /* card max-height */
                overflow-auto      /* scroll if content overflows */
              "
            >
              {/* Top: symbol + badges */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {c.symbol}
                  </h3>
                  <Badge score={c.totalScore} label="Total" />
                </div>
                <StatusBadge
                  isTopPick={c.isTopPick}
                  score={c.score}
                  earlyCandidate={c.earlyCandidate}
                />
              </div>

              {/* Middle: recommendation + metrics */}
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-800 mb-3">
                  📋 Recommendation:{' '}
                  <span className="font-bold">{c.recommendation}</span>
                </p>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>
                    <strong>Squeeze Score:</strong> {c.score}
                  </li>
                  <li>
                    <strong>Setup Score:</strong> {c.setupScore}
                  </li>
                  <li>
                    <strong>RSI:</strong>{' '}
                    {c.rsi != null ? c.rsi.toFixed(2) : '—'}
                  </li>
                  <li>
                    <strong>Short Float:</strong>{' '}
                    {c.shortFloat != null
                      ? `${c.shortFloat.toFixed(2)}%`
                      : '—'}
                  </li>
                  <li>
                    <strong>Volume Spike:</strong>{' '}
                    {c.volumeSpike ? '✔️' : '❌'}
                  </li>
                  <li>
                    <strong>Pre-Mkt %:</strong>{' '}
                    {c.preMarketChange != null
                      ? `${c.preMarketChange.toFixed(1)}%`
                      : '—'}
                  </li>
                  <li>
                    <strong>Pre-Mkt Vol Spike:</strong>{' '}
                    {c.preMarketVolSpike != null
                      ? c.preMarketVolSpike.toFixed(2)
                      : '—'}
                  </li>
                  <li>
                    <strong>Support:</strong>{' '}
                    {c.support != null ? `$${c.support.toFixed(2)}` : '—'}
                  </li>
                  <li>
                    <strong>Resistance:</strong>{' '}
                    {c.resistance != null
                      ? `$${c.resistance.toFixed(2)}`
                      : '—'}
                  </li>
                  <li>
                    <strong>Float %:</strong>{' '}
                    {c.floatPercent != null ? c.floatPercent.toFixed(2) : '—'}
                  </li>

                  {c.combinedReasons.length > 0 && (
                    <li>
                      <strong>All Reasons:</strong>{' '}
                      {c.combinedReasons.join(', ')}
                    </li>
                  )}

                  {c.metrics && (
                    <>
                      <li>
                        <strong>Vol Score:</strong>{' '}
                        {c.metrics.volScore != null
                          ? c.metrics.volScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>Spike Score:</strong>{' '}
                        {c.metrics.spikeScore != null
                          ? c.metrics.spikeScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>RSI Score:</strong>{' '}
                        {c.metrics.rsiScore != null
                          ? c.metrics.rsiScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>Mom Score:</strong>{' '}
                        {c.metrics.momScore != null
                          ? c.metrics.momScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>Float Score:</strong>{' '}
                        {c.metrics.floatScore != null
                          ? c.metrics.floatScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>Short Score:</strong>{' '}
                        {c.metrics.shortScore != null
                          ? c.metrics.shortScore.toFixed(2)
                          : '—'}
                      </li>
                      <li>
                        <strong>Breakout:</strong>{' '}
                        {c.metrics.breakout ? '✅' : '❌'}
                      </li>
                      <li>
                        <strong>Bounce:</strong>{' '}
                        {c.metrics.bounce ? '✅' : '❌'}
                      </li>
                      <li>
                        <strong>Price As Of:</strong>{' '}
                        {c.timestamp
                          ? new Date(c.timestamp).toLocaleString()
                          : '—'}
                      </li>
                      <li>
                        <strong>Current Price:</strong>{' '}
                        {c.price != null ? `$${c.price.toFixed(2)}` : '—'}
                      </li>
                      <li>
                        <strong>Buy Price:</strong>{' '}
                        {c.buyPrice != null
                          ? `$${c.buyPrice.toFixed(2)}`
                          : '—'}
                      </li>
                      <li>
                        <strong>Sell Price:</strong>{' '}
                        {c.sellPrice != null
                          ? `$${c.sellPrice.toFixed(2)}`
                          : '—'}
                      </li>
                      <li>
                        <strong>Strategy:</strong>{' '}
                        {c.isDayTradeCandidate ? 'Day-Trade' : 'Long-Hold'}
                      </li>

                      {c.isDayTradeCandidate && (
                        <>
                          <li>
                            <strong>Day Entry:</strong>{' '}
                            {c.dayTradeBuyPrice != null
                              ? `$${c.dayTradeBuyPrice.toFixed(2)}`
                              : '—'}
                          </li>
                          <li>
                            <strong>Day Exit:</strong>{' '}
                            {c.dayTradeSellPrice != null
                              ? `$${c.dayTradeSellPrice.toFixed(2)}`
                              : '—'}
                          </li>
                        </>
                      )}

                      {!c.isDayTradeCandidate && (
                        <>
                          <li>
                            <strong>Long Entry:</strong>{' '}
                            {c.longBuyPrice != null
                              ? `$${c.longBuyPrice.toFixed(2)}`
                              : '—'}
                          </li>
                          <li>
                            <strong>Long Target:</strong>{' '}
                            {c.longSellPrice != null
                              ? `$${c.longSellPrice.toFixed(2)}`
                              : '—'}
                          </li>
                        </>
                      )}

                      <li>
                        <strong>GPT Action:</strong> {c.action || '—'}
                      </li>
                      <li>
                        <strong>GPT Rationale:</strong>{' '}
                        {c.actionRationale || '—'}
                      </li>
                    </>
                  )}
                </ul>
              </div>

              {/* Bottom: GPT summary */}
              <div className="text-gray-600 text-xs italic mt-6">
                <h4 className="font-medium">GPT analysis</h4>
                <p>{c.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}

{/* ———————————————— Options Suggestions Section ———————————————— */}
{!loading && filtered.length > 0 && (
  <div className="mt-12">
    <h3 className="text-2xl font-bold text-gray-800 mb-4">
      Options Suggestions
    </h3>

    <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 gap-8">
      {filtered.map((c, idx) => {
        if (!c.callPick && !c.putPick) return null;

        return (
          <div
            key={idx}
            className="p-6 bg-white border border-gray-200 shadow-lg rounded-2xl"
          >
            {/* Symbol Header */}
            <h4 className="text-xl font-semibold text-gray-900 mb-4">
              {c.symbol}
            </h4>

            <div className="flex flex-col lg:flex-row lg:space-x-6">
              {/* —————————————— CALL SIDE —————————————— */}
              {c.callPick && (
                <div className="flex-1 mb-6 lg:mb-0">
                  <h5 className="text-lg font-medium text-blue-600 mb-2">
                    Call Option
                  </h5>
                  <ul className="space-y-2 text-base text-gray-700">
                    <li>
                      <strong>Contract:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.contractSymbol}
                      </span>
                    </li>
                    <li>
                      <strong>Strike / Expiry:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.strike != null
                          ? `$${c.callPick.strike.toFixed(2)} / ${c.callPick.expiry}`
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Bid:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.bid != null ? c.callPick.bid : '—'}
                      </span>{' '}
                      &nbsp; <strong>Ask:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.ask != null ? c.callPick.ask : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Implied Vol:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.impliedVolatility != null
                          ? c.callPick.impliedVolatility.toFixed(2)
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Open Interest:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.openInterest != null
                          ? c.callPick.openInterest
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Rationale:</strong>
                      <div className="mt-1 bg-gray-50 p-2 rounded text-sm leading-snug whitespace-pre-wrap">
                        {c.callPick.rationale || '—'}
                      </div>
                    </li>
                    <li>
                      <strong>Entry Price:</strong>{' '}
                      <span className="text-gray-900">
                        {c.callPick.entryPrice != null
                          ? c.callPick.entryPrice
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Exit Plan:</strong>
                      <div className="mt-1 bg-gray-50 p-2 rounded text-sm leading-snug whitespace-pre-wrap">
                        {c.callPick.exitPlan || '—'}
                      </div>
                    </li>
                  </ul>
                </div>
              )}

              {/* —————————————— PUT SIDE —————————————— */}
              {c.putPick && (
                <div className="flex-1">
                  <h5 className="text-lg font-medium text-red-600 mb-2">
                    Put Option
                  </h5>
                  <ul className="space-y-2 text-base text-gray-700">
                    <li>
                      <strong>Contract:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.contractSymbol}
                      </span>
                    </li>
                    <li>
                      <strong>Strike / Expiry:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.strike != null
                          ? `$${c.putPick.strike.toFixed(2)} / ${c.putPick.expiry}`
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Bid:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.bid != null ? c.putPick.bid : '—'}
                      </span>{' '}
                      &nbsp; <strong>Ask:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.ask != null ? c.putPick.ask : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Implied Vol:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.impliedVolatility != null
                          ? c.putPick.impliedVolatility.toFixed(2)
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Open Interest:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.openInterest != null
                          ? c.putPick.openInterest
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Rationale:</strong>
                      <div className="mt-1 bg-gray-50 p-2 rounded text-sm leading-snug whitespace-pre-wrap">
                        {c.putPick.rationale || '—'}
                      </div>
                    </li>
                    <li>
                      <strong>Entry Price:</strong>{' '}
                      <span className="text-gray-900">
                        {c.putPick.entryPrice != null
                          ? c.putPick.entryPrice
                          : '—'}
                      </span>
                    </li>
                    <li>
                      <strong>Exit Plan:</strong>
                      <div className="mt-1 bg-gray-50 p-2 rounded text-sm leading-snug whitespace-pre-wrap">
                        {c.putPick.exitPlan || '—'}
                      </div>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}



    </div>
  );
};

export default ScannerCardGrid;
