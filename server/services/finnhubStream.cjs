

const WebSocket = require('ws');

const API_KEY = process.env.FINNHUB_API_KEY;
const MAX_SUBSCRIPTIONS = 50;

const socket = new WebSocket(`wss://ws.finnhub.io?token=${API_KEY}`);
const latestQuotes = new Map();
const subscribed = new Set();

socket.on('open', () => {
  console.log('Finnhub WS connected');
});

socket.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    return console.warn('WS parse error', err);
  }
  if (msg.type === 'trade' && Array.isArray(msg.data)) {
    msg.data.forEach(({ s: symbol, p: price, v: volume }) => {
      latestQuotes.set(symbol, { price, volume });
    });
  }
});

socket.on('error', (err) => {
  console.error('Finnhub WS error', err);
});

socket.on('close', () => {
  console.log('Finnhub WS closed — attempting reconnect in 5s');
  setTimeout(() => {
    module.exports = require('./finnhubStream.cjs');
  }, 5000);
});

function subscribe(symbol) {
  if (subscribed.has(symbol)) return;
  if (subscribed.size >= MAX_SUBSCRIPTIONS) {
    throw new Error(`Cannot subscribe to ${symbol}: max ${MAX_SUBSCRIPTIONS} symbols reached.`);
  }
  socket.send(JSON.stringify({ type: 'subscribe', symbol }));
  subscribed.add(symbol);
}

function unsubscribe(symbol) {
  if (!subscribed.has(symbol)) return;
  socket.send(JSON.stringify({ type: 'unsubscribe', symbol }));
  subscribed.delete(symbol);
  latestQuotes.delete(symbol);
}

function getLatestQuote(symbol) {
  return latestQuotes.get(symbol) || null;
}

module.exports = { subscribe, unsubscribe, getLatestQuote };
