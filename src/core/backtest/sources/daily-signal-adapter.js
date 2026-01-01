/**
 * Daily Signal Analyzer Adapter
 * Wraps DailySignalAnalyzer for use with BacktestEngine
 */

import { DailySignalAnalyzer, SIGNAL_TYPES } from '../../options/dailySignal.js'

export class DailySignalSource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.minScore - Minimum confluence score (0-100)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.lookback - Candles to analyze
   */
  constructor(config = {}) {
    this.name = 'Daily Signal'
    this.minScore = config.minScore ?? 60
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.lookback = config.lookback ?? 50
    this.analyzerConfig = config.analyzerConfig ?? {}
    this.analyzer = new DailySignalAnalyzer(this.analyzerConfig)

    // Track position state for the analyzer
    this.currentPosition = 'NONE'
    this.lastSignalIndex = -1
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    // Need enough history
    if (index < this.lookback) {
      return null
    }

    // Get slice of candles up to current index
    const candleSlice = candles.slice(Math.max(0, index - this.lookback), index + 1)

    if (candleSlice.length < 30) {
      return null
    }

    // Run daily signal analysis
    const result = this.analyzer.analyze(candleSlice, this.currentPosition)

    // Check if we have an actionable signal
    if (!result || result.type === SIGNAL_TYPES.HOLD) {
      return null
    }

    if (result.score < this.minScore) {
      return null
    }

    // Map signal type to direction
    let direction = null
    let type = result.type

    if (result.type === SIGNAL_TYPES.OPEN_CALL) {
      direction = 'CALL'
      type = result.score >= 80 ? 'STRONG_CALL' : 'CALL'
      this.currentPosition = 'LONG'
    } else if (result.type === SIGNAL_TYPES.OPEN_PUT) {
      direction = 'PUT'
      type = result.score >= 80 ? 'STRONG_PUT' : 'PUT'
      this.currentPosition = 'SHORT'
    } else if (result.type === SIGNAL_TYPES.CLOSE_CALL) {
      // Close signals - we skip these for backtesting entry
      // Exit is handled by exit strategy
      this.currentPosition = 'NONE'
      return null
    } else if (result.type === SIGNAL_TYPES.CLOSE_PUT) {
      this.currentPosition = 'NONE'
      return null
    }

    // Check if direction is in allowed types
    if (!this.signalTypes.includes(direction)) {
      return null
    }

    // Prevent duplicate signals at same index
    if (index === this.lastSignalIndex) {
      return null
    }
    this.lastSignalIndex = index

    return {
      type,
      direction,
      strength: result.score,
      source: this.name,
      price: candles[index].close,
      time: candles[index].time,
      reason: result.reason,
      session: result.session,
      metadata: {
        confluence: result.confluence,
        action: result.action,
        originalType: result.type,
      },
    }
  }

  /**
   * Reset state (call between backtests)
   */
  reset() {
    this.currentPosition = 'NONE'
    this.lastSignalIndex = -1
    this.analyzer = new DailySignalAnalyzer(this.analyzerConfig)
  }

  /**
   * Get configuration
   * @returns {Object}
   */
  getConfig() {
    return {
      source: 'daily-signal',
      minScore: this.minScore,
      signalTypes: this.signalTypes,
      lookback: this.lookback,
    }
  }
}
