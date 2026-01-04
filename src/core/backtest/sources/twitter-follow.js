/**
 * Twitter Follow Signal Source for Backtesting
 *
 * Uses stored tweets from the Follow Trade page to generate backtest signals.
 * The Follow Trade page collects tweets in localStorage, which this source reads.
 *
 * To use:
 * 1. Run the Follow Trade page to collect tweets over time
 * 2. Come here to backtest the collected signals
 */

import { parseTweet, validateForExecution, isClosingTrade } from '../../trading/tweet-parser.js'

export class TwitterFollowSource {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.username - Twitter username to backtest (default: StockOptions888)
   * @param {number} config.minConfidence - Minimum confidence to include signal (default: 0.7)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength (maps from confidence)
   * @param {boolean} config.includeClosing - Include closing signals (default: false)
   */
  constructor(config = {}) {
    this.name = 'Twitter Follow'
    this.username = config.username ?? 'StockOptions888'
    this.minConfidence = config.minConfidence ?? 0.7
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 50
    this.includeClosing = config.includeClosing ?? false

    // Load stored tweets
    this.tweets = this.loadStoredTweets()
    this.parsedSignals = this.parseStoredTweets()
  }

  /**
   * Load tweets from localStorage (stored by Follow Trade page)
   * Reads from the signal history which includes ALL detected signals
   */
  loadStoredTweets() {
    const tweets = []

    try {
      // Primary source: Signal history (all detected signals)
      const signalHistory = localStorage.getItem('followTrade_signalHistory')
      if (signalHistory) {
        const signals = JSON.parse(signalHistory)
        // Convert signal history records to tweet format
        for (const sig of signals) {
          if (sig.username === this.username || !this.username) {
            tweets.push({
              id: sig.id,
              text: sig.text,
              created_at: sig.timestamp,
              createdAt: sig.timestamp,
              // Include pre-parsed data
              _parsed: sig.parsed
            })
          }
        }
      }

      // Fallback: Also check executed trades state
      const stateData = localStorage.getItem('followTrade_state')
      if (stateData) {
        const state = JSON.parse(stateData)
        const trades = state.executedTrades || []
        for (const t of trades) {
          if (t.tweet && !tweets.find(tw => tw.id === t.tweet.id)) {
            tweets.push(t.tweet)
          }
        }
      }
    } catch (e) {
      console.warn('[TwitterFollowSource] Failed to load stored tweets:', e)
    }

    // Sort by timestamp (newest first)
    tweets.sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))

    console.log(`[TwitterFollowSource] Loaded ${tweets.length} tweets from history`)
    return tweets
  }

  /**
   * Load tweets from a provided array (for testing or manual data)
   */
  loadTweetsFromArray(tweets) {
    this.tweets = tweets
    this.parsedSignals = this.parseStoredTweets()
  }

  /**
   * Parse stored tweets into signals
   * Uses pre-parsed data from signal history when available
   */
  parseStoredTweets() {
    const signals = []

    for (const tweet of this.tweets) {
      // Use pre-parsed data if available (from signal history)
      const parsed = tweet._parsed || parseTweet(tweet.text)
      if (!parsed) continue

      // Filter by confidence
      if (parsed.confidence < this.minConfidence) continue

      // Filter by signal type
      if (!this.signalTypes.includes(parsed.direction)) continue

      // Filter closing trades
      if (!this.includeClosing && isClosingTrade(tweet.text)) continue

      signals.push({
        tweet,
        parsed,
        timestamp: new Date(tweet.createdAt || tweet.created_at),
        strength: Math.round(parsed.confidence * 100)
      })
    }

    // Sort by timestamp (oldest first for backtesting)
    signals.sort((a, b) => a.timestamp - b.timestamp)

    console.log(`[TwitterFollowSource] Parsed ${signals.length} signals from ${this.tweets.length} tweets`)
    return signals
  }

  /**
   * Set candles for the backtest
   * Required by BacktestEngine interface
   */
  set candles(value) {
    this._candles = value
    // Build index mapping when candles are set
    this._buildSignalIndex()
  }

  get candles() {
    return this._candles || []
  }

  /**
   * Get the date range of parsed signals
   * Useful for auto-adjusting backtest date range
   */
  getSignalDateRange() {
    if (this.parsedSignals.length === 0) return null

    const timestamps = this.parsedSignals
      .map(s => {
        const ts = s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp)
        return ts.getTime()
      })
      .filter(t => !isNaN(t))

    if (timestamps.length === 0) return null

    const minTime = Math.min(...timestamps)
    const maxTime = Math.max(...timestamps)

    // Add 1 day buffer on each side
    const buffer = 24 * 60 * 60 * 1000
    return {
      start: new Date(minTime - buffer),
      end: new Date(maxTime + buffer)
    }
  }

  /**
   * Build an index of signals by candle index for fast lookup
   */
  _buildSignalIndex() {
    this._signalByIndex = new Map()

    if (!this._candles || this._candles.length === 0) {
      console.log('[TwitterFollowSource] No candles to index against')
      return
    }

    if (this.parsedSignals.length === 0) {
      console.log('[TwitterFollowSource] No parsed signals to index')
      return
    }

    const candleTimes = this._candles.map(c => {
      // Handle both timestamp formats (ms or seconds)
      const t = c.time
      return t > 1e12 ? t : t * 1000
    })
    const candleStart = new Date(candleTimes[0])
    const candleEnd = new Date(candleTimes[candleTimes.length - 1])

    // Get signal date range for comparison
    const sigRange = this.getSignalDateRange()

    console.log(`[TwitterFollowSource] Candle range: ${candleStart.toISOString()} to ${candleEnd.toISOString()}`)
    if (sigRange) {
      console.log(`[TwitterFollowSource] Signal range: ${sigRange.start.toISOString()} to ${sigRange.end.toISOString()}`)

      // Check for overlap
      if (sigRange.end < candleStart || sigRange.start > candleEnd) {
        console.warn(`[TwitterFollowSource] WARNING: Signal date range does not overlap with candle data!`)
        console.warn(`[TwitterFollowSource] Adjust your backtest date range to: ${sigRange.start.toLocaleDateString()} - ${sigRange.end.toLocaleDateString()}`)
      }
    }
    console.log(`[TwitterFollowSource] Processing ${this.parsedSignals.length} signals...`)

    let matchedCount = 0
    let outOfRangeCount = 0
    let lowStrengthCount = 0

    for (const sig of this.parsedSignals) {
      // Ensure timestamp is a Date object and in milliseconds
      let sigTime = sig.timestamp instanceof Date
        ? sig.timestamp.getTime()
        : new Date(sig.timestamp).getTime()

      // Skip invalid timestamps
      if (isNaN(sigTime)) {
        console.warn('[TwitterFollowSource] Invalid timestamp:', sig.timestamp)
        continue
      }

      // Find the candle index closest to this tweet
      let closestIdx = -1
      let closestDiff = Infinity

      for (let i = 0; i < candleTimes.length; i++) {
        const diff = Math.abs(candleTimes[i] - sigTime)
        if (diff < closestDiff) {
          closestDiff = diff
          closestIdx = i
        }
      }

      // Allow matching within 48 hours (tweets may be on weekends/after hours)
      // Also match forward in time (tweet comes before next candle opens)
      const maxMatchWindow = 48 * 60 * 60 * 1000 // 48 hours

      if (closestIdx >= 0 && closestDiff < maxMatchWindow) {
        // Check minimum strength (use very low threshold for Twitter)
        const effectiveMinStrength = Math.min(this.minStrength, 20)
        if (sig.strength >= effectiveMinStrength) {
          // Only store one signal per candle (first one wins)
          if (!this._signalByIndex.has(closestIdx)) {
            this._signalByIndex.set(closestIdx, {
              direction: sig.parsed.direction,
              strength: sig.strength,
              patterns: [`@${this.username}`, sig.parsed.format || 'tweet-signal'],
              reason: `Tweet: "${sig.tweet.text.substring(0, 50)}..."`,
              tweetId: sig.tweet.id,
              strike: sig.parsed.strike,
              expiry: sig.parsed.expiry,
              price: sig.parsed.price,
              timestamp: new Date(sigTime)
            })
            matchedCount++
          }
        } else {
          lowStrengthCount++
        }
      } else {
        outOfRangeCount++
        // Debug: show first few out-of-range signals
        if (outOfRangeCount <= 3) {
          console.log(`[TwitterFollowSource] Out of range: ${new Date(sigTime).toISOString()} (closest candle: ${closestDiff / (1000 * 60 * 60)}h away)`)
        }
      }
    }

    console.log(`[TwitterFollowSource] Indexed ${this._signalByIndex.size} signals:`)
    console.log(`  - Matched: ${matchedCount}`)
    console.log(`  - Out of date range: ${outOfRangeCount}`)
    console.log(`  - Low strength filtered: ${lowStrengthCount}`)

    // If no matches but we have signals, provide guidance
    if (matchedCount === 0 && this.parsedSignals.length > 0 && sigRange) {
      console.error(`[TwitterFollowSource] No signals matched! Your candles don't cover the tweet dates.`)
      console.error(`[TwitterFollowSource] SOLUTION: Set date range to ${sigRange.start.toLocaleDateString()} - ${sigRange.end.toLocaleDateString()}`)
    }
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * Required by BacktestEngine interface
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    // Check if there's a signal at this index
    const signal = this._signalByIndex?.get(index)
    if (!signal) {
      return null
    }

    const candle = candles[index]

    // Return signal in standard format
    return {
      type: signal.direction,
      direction: signal.direction,
      strength: signal.strength,
      source: this.name,
      price: candle.close,
      time: candle.time,
      patterns: signal.patterns,
      indicators: {},
      metadata: {
        tweetId: signal.tweetId,
        strike: signal.strike,
        expiry: signal.expiry,
        tweetPrice: signal.price
      }
    }
  }

  /**
   * Get configuration for display/export
   * Required by BacktestEngine interface
   * @returns {Object}
   */
  getConfig() {
    return {
      source: 'twitter-follow',
      username: this.username,
      minConfidence: this.minConfidence,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      totalTweets: this.tweets.length,
      parsedSignals: this.parsedSignals.length
    }
  }

  /**
   * Generate signals for backtesting (legacy method)
   * Maps tweet timestamps to candle indices
   */
  generateSignals() {
    if (!this._candles || this._candles.length === 0) {
      console.warn('[TwitterFollowSource] No candles available')
      return []
    }

    if (this.parsedSignals.length === 0) {
      console.warn('[TwitterFollowSource] No parsed signals. Run Follow Trade page first to collect tweets.')
      return []
    }

    // Use the indexed signals
    const signals = []
    for (const [index, sig] of this._signalByIndex) {
      signals.push({
        index,
        direction: sig.direction,
        strength: sig.strength,
        patterns: sig.patterns,
        reason: sig.reason,
        tweetId: sig.tweetId,
        strike: sig.strike,
        expiry: sig.expiry,
        price: sig.price
      })
    }

    // Sort by index
    signals.sort((a, b) => a.index - b.index)

    console.log(`[TwitterFollowSource] Generated ${signals.length} signals from ${this.parsedSignals.length} parsed tweets`)
    return signals
  }

  /**
   * Get summary stats about available data
   */
  getDataSummary() {
    return {
      username: this.username,
      totalTweets: this.tweets.length,
      parsedSignals: this.parsedSignals.length,
      callSignals: this.parsedSignals.filter(s => s.parsed.direction === 'CALL').length,
      putSignals: this.parsedSignals.filter(s => s.parsed.direction === 'PUT').length,
      dateRange: this.parsedSignals.length > 0 ? {
        start: this.parsedSignals[0].timestamp,
        end: this.parsedSignals[this.parsedSignals.length - 1].timestamp
      } : null
    }
  }

  /**
   * Import tweets from JSON (for loading historical data)
   */
  importFromJSON(jsonData) {
    try {
      const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData
      if (Array.isArray(data)) {
        this.loadTweetsFromArray(data)
        return { success: true, count: data.length }
      }
      return { success: false, error: 'Data must be an array of tweets' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  /**
   * Export collected tweets to JSON
   */
  exportToJSON() {
    return JSON.stringify(this.tweets, null, 2)
  }
}

/**
 * Simulated Twitter Follow Source
 * For backtesting when no real tweets are available
 * Simulates signals based on price patterns that a Twitter trader might spot
 */
export class SimulatedTwitterFollowSource {
  constructor(config = {}) {
    this.name = 'Twitter Follow (Simulated)'
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 50
    this.signalFrequency = config.signalFrequency ?? 0.02 // ~2% of bars
    this.winRate = config.winRate ?? 0.6 // Assumed 60% win rate
    this._signalCache = new Map()
  }

  set candles(value) {
    this._candles = value
    this._signalCache.clear()
    this._precomputeSignals()
  }

  get candles() {
    return this._candles || []
  }

  /**
   * Precompute all signals for fast lookup
   */
  _precomputeSignals() {
    if (!this._candles || this._candles.length < 20) {
      return
    }

    const candles = this._candles

    // Use seeded random for reproducibility
    let seed = 12345
    const seededRandom = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 20; i < candles.length - 1; i++) {
      // Random signal based on frequency
      if (seededRandom() > this.signalFrequency) continue

      const candle = candles[i]
      const prevCandles = candles.slice(i - 20, i)

      // Calculate simple mean reversion
      const avgClose = prevCandles.reduce((sum, c) => sum + c.close, 0) / prevCandles.length
      const deviation = (candle.close - avgClose) / avgClose

      // Determine direction based on deviation
      let direction = null
      if (deviation < -0.005 && this.signalTypes.includes('CALL')) {
        direction = 'CALL' // Price below average, expect bounce
      } else if (deviation > 0.005 && this.signalTypes.includes('PUT')) {
        direction = 'PUT' // Price above average, expect pullback
      }

      if (direction) {
        const strength = Math.min(100, Math.round(50 + Math.abs(deviation) * 2000))
        if (strength >= this.minStrength) {
          this._signalCache.set(i, {
            direction,
            strength,
            deviation
          })
        }
      }
    }

    console.log(`[SimulatedTwitterFollowSource] Precomputed ${this._signalCache.size} simulated signals`)
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * Required by BacktestEngine interface
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    const cached = this._signalCache.get(index)
    if (!cached) {
      return null
    }

    const candle = candles[index]

    return {
      type: cached.direction,
      direction: cached.direction,
      strength: cached.strength,
      source: this.name,
      price: candle.close,
      time: candle.time,
      patterns: ['@SimTrader', 'mean-reversion'],
      indicators: {},
      metadata: {
        deviation: cached.deviation,
        simulated: true
      }
    }
  }

  /**
   * Get configuration for display/export
   * Required by BacktestEngine interface
   * @returns {Object}
   */
  getConfig() {
    return {
      source: 'twitter-sim',
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      signalFrequency: this.signalFrequency
    }
  }

  /**
   * Generate simulated signals based on price action (legacy method)
   * Simulates a trader who spots reversals near support/resistance
   */
  generateSignals() {
    const signals = []
    for (const [index, sig] of this._signalCache) {
      signals.push({
        index,
        direction: sig.direction,
        strength: sig.strength,
        patterns: ['@SimTrader', 'mean-reversion'],
        reason: `Simulated: ${sig.direction} signal, ${(sig.deviation * 100).toFixed(2)}% deviation`
      })
    }

    signals.sort((a, b) => a.index - b.index)
    console.log(`[SimulatedTwitterFollowSource] Generated ${signals.length} simulated signals`)
    return signals
  }
}
