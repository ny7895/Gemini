const { subscribe: wsSubscribe, unsubscribe: wsUnsubscribe } = require('./finnhubStream.cjs');

class SubscriptionManager {
  constructor(limit = 50) {
    this.limit = limit;
    this.queue = [];   // symbols in order of use: oldest at front
    this.set   = new Set();
  }

  // Mark a symbol as recently used
  touch(symbol) {
    const idx = this.queue.indexOf(symbol);
    if (idx !== -1) this.queue.splice(idx, 1);
    this.queue.push(symbol);
  }

  /**
   * Ensure the symbol is subscribed via WS.
   * If over limit, evict oldest subscription first.
   */
  ensure(symbol) {
    // Already subscribed: just bump recency
    if (this.set.has(symbol)) {
      this.touch(symbol);
      return;
    }

    // At capacity? remove oldest
    if (this.queue.length >= this.limit) {
      const oldest = this.queue.shift();
      this.set.delete(oldest);
      try {
        wsUnsubscribe(oldest);
      } catch (e) {
        console.warn(`SubscriptionManager: failed to unsubscribe ${oldest}: ${e.message}`);
      }
    }

    // Subscribe new symbol
    try {
      wsSubscribe(symbol);
      this.set.add(symbol);
      this.queue.push(symbol);
    } catch (err) {
      console.warn(`SubscriptionManager: failed to subscribe ${symbol}: ${err.message}`);
    }
  }
}

module.exports = new SubscriptionManager(50);