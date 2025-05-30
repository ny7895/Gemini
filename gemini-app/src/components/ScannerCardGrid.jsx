import React, { useEffect, useState } from 'react';

// ——— Reusable badge for numeric scores ———
const Badge = ({ score, label = 'Score' }) => {
  const color = score >= 5 ? 'bg-green-500' : score >= 3 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <span className={`text-white text-xs px-2 py-1 rounded-full ${color}`}>
      {label}: {score != null ? score.toFixed(2) : '—'}
    </span>
  );
};

const StatusBadge = ({ isTopPick, score, earlyCandidate }) => {
  if (isTopPick) {
    return (
      <span className="text-xs px-2 py-1 bg-purple-600 text-white rounded-full">🌟 Top Pick</span>
    );
  } else if (score >= 4) {
    return (
      <span className="text-xs px-2 py-1 bg-red-500 text-white rounded-full">
        🔥 Squeeze Candidate
      </span>
    );
  } else if (earlyCandidate) {
    return (
      <span className="text-xs px-2 py-1 bg-blue-500 text-white rounded-full">📡 Early Setup</span>
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
    const res = await fetch('/api/scanner/candidates');
    const data = await res.json();

    const parsed = data.map((item) => ({
      ...item,

      // bring in the new pre-market fields (use `item`, not `r`)
      preMarketChange: item.preMarketChange ?? null,
      preMarketVolSpike: item.preMarketVolSpike ?? null,
      combinedReasons: Array.isArray(item.combinedReasons)
        ? item.combinedReasons
        : item.combinedReasons
          ? item.combinedReasons.split(', ').filter((r) => r)
          : [],

      metrics: item.metrics || {},

      // GPT analysis fields
      action: item.action || '',
      actionRationale: item.actionRationale || '',
      isDayTradeCandidate: Boolean(item.isDayTradeCandidate),
      dayTradeBuyPrice: item.dayTradeBuyPrice,
      dayTradeSellPrice: item.dayTradeSellPrice,
      longBuyPrice: item.longBuyPrice,
      longSellPrice: item.longSellPrice,
    }));

    setCandidates(parsed);
    setLoading(false);
  };

  const fetchHistory = async () => {
    const res = await fetch('/api/scanner/history');
    const data = await res.json();
    setHistory([...data].reverse());
    if (data.length) {
      setTotalScanned(data[0].candidateCount);
    }
  };

  const runScan = async () => {
    setScanning(true);
    await fetch('/api/scanner/analyze');
    await fetchResults();
    setScanning(false);
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
        <h2 className="text-2xl font-bold text-gray-800">📈 Short Squeeze Scanner</h2>
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
        Scanned <strong>{totalScanned}</strong> stocks, showing <strong>{filtered.length}</strong>{' '}
        results
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Min Score */}
        <div>
          <label className="block text-sm font-semibold mb-1">Min Total Score</label>
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
          <label className="block text-sm font-semibold mb-1">Scan History</label>
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

      {/* Card Grid */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filtered.map((c, i) => (
            <div
              key={i}
              className="flex flex-col justify-between h-full rounded-2xl p-6 bg-white border border-gray-200 shadow"
            >
              {/* Top: symbol + badges */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{c.symbol}</h3>
                  <Badge score={c.totalScore} label="Total" />
                </div>
                <StatusBadge
                  isTopPick={c.isTopPick}
                  score={c.score}
                  earlyCandidate={c.earlyCandidate}
                />
              </div>

              {/* Middle: recommendation + metrics */}
              <div className="flex-grow mt-4">
                <p className="text-sm font-medium text-gray-800 mb-3">
                  📋 Recommendation: <span className="font-bold">{c.recommendation}</span>
                </p>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>
                    <strong>Squeeze Score:</strong> {c.score}
                  </li>
                  <li>
                    <strong>Setup Score:</strong> {c.setupScore}
                  </li>
                  <li>
                    <strong>RSI:</strong> {c.rsi != null ? c.rsi.toFixed(2) : '—'}
                  </li>
                  <li>
                    <strong>Short Float:</strong>{' '}
                    {c.shortFloat != null ? `${c.shortFloat.toFixed(2)}%` : '—'}
                  </li>
                  <li>
                    <strong>Volume Spike:</strong> {c.volumeSpike ? '✔️' : '❌'}
                  </li>
                  <li>
                    <strong>Pre-Mkt %:</strong>{' '}
                    {c.preMarketChange != null ? `${c.preMarketChange.toFixed(1)}%` : '—'}
                  </li>
                  <li>
                    <strong>Pre-Mkt Vol Spike:</strong>{' '}
                    {c.preMarketVolSpike != null ? c.preMarketVolSpike.toFixed(2) : '—'}
                  </li>
                  <li>
                    <strong>Support:</strong> {c.support != null ? `$${c.support.toFixed(2)}` : '—'}
                  </li>
                  <li>
                    <strong>Resistance:</strong>{' '}
                    {c.resistance != null ? `$${c.resistance.toFixed(2)}` : '—'}
                  </li>
                  <li>
                    <strong>Float %:</strong>{' '}
                    {c.floatPercent != null ? c.floatPercent.toFixed(2) : '—'}
                  </li>

                  {c.combinedReasons.length > 0 && (
                    <li>
                      <strong>All Reasons:</strong> {c.combinedReasons.join(', ')}
                    </li>
                  )}

                  {c.metrics && (
                    <>
                      <li>
                        <strong>Vol Score:</strong>{' '}
                        {c.metrics.volScore != null ? c.metrics.volScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>Spike Score:</strong>{' '}
                        {c.metrics.spikeScore != null ? c.metrics.spikeScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>RSI Score:</strong>{' '}
                        {c.metrics.rsiScore != null ? c.metrics.rsiScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>Mom Score:</strong>{' '}
                        {c.metrics.momScore != null ? c.metrics.momScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>Float Score:</strong>{' '}
                        {c.metrics.floatScore != null ? c.metrics.floatScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>Short Score:</strong>{' '}
                        {c.metrics.shortScore != null ? c.metrics.shortScore.toFixed(2) : '—'}
                      </li>
                      <li>
                        <strong>Breakout:</strong> {c.metrics.breakout ? '✅' : '❌'}
                      </li>
                      <li>
                        <strong>Bounce:</strong> {c.metrics.bounce ? '✅' : '❌'}
                      </li>
                      <li>
                        <strong>Price As Of:</strong>{' '}
                        {c.timestamp ? new Date(c.timestamp).toLocaleString() : '—'}
                      </li>
                      <li>
                        <strong>Current Price:</strong>{' '}
                        {c.price != null ? `$${c.price.toFixed(2)}` : '—'}
                      </li>
                      <li>
                        <strong>Buy Price:</strong>{' '}
                        {c.buyPrice != null ? `$${c.buyPrice.toFixed(2)}` : '—'}
                      </li>
                      <li>
                        <strong>Sell Price:</strong>{' '}
                        {c.sellPrice != null ? `$${c.sellPrice.toFixed(2)}` : '—'}
                      </li>
                      <li>
                        <strong>Strategy:</strong>{' '}
                        {c.isDayTradeCandidate ? 'Day-Trade' : 'Long-Hold'}
                      </li>

                      {c.isDayTradeCandidate && (
                        <>
                          <li>
                            <strong>Day Entry:</strong>{' '}
                            {c.dayTradeBuyPrice != null ? `$${c.dayTradeBuyPrice.toFixed(2)}` : '—'}
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
                            {c.longBuyPrice != null ? `$${c.longBuyPrice.toFixed(2)}` : '—'}
                          </li>
                          <li>
                            <strong>Long Target:</strong>{' '}
                            {c.longSellPrice != null ? `$${c.longSellPrice.toFixed(2)}` : '—'}
                          </li>
                        </>
                      )}

                      <li>
                        <strong>GPT Action:</strong> {c.action || '—'}
                      </li>
                      <li>
                        <strong>GPT Rationale:</strong> {c.actionRationale || '—'}
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
    </div>
  );
};

export default ScannerCardGrid;
