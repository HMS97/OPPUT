/**
 * Pattern Detector Signal Source Adapter
 * Wraps PatternDetector for use with BacktestEngine
 */

import { PatternDetector } from '../../patterns/detector.js'

export class PatternDetectorSource {
  /**
   * @param {Object} config - Pattern detector configuration
   * @param {number} config.minStrength - Minimum signal strength (0-100)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.lookback - Candles to analyze before current
   */
  constructor(config = {}) {
    this.name = 'Pattern Detector'
    this.minStrength = config.minStrength ?? 30
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.lookback = config.lookback ?? 50
    this.detectorConfig = config.detectorConfig ?? {}
    this.detector = new PatternDetector(this.detectorConfig)
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    // Need enough history for pattern detection
    if (index < this.lookback) {
      return null
    }

    // Get slice of candles up to current index (inclusive)
    const candleSlice = candles.slice(Math.max(0, index - this.lookback), index + 1)

    if (candleSlice.length < 10) {
      return null
    }

    // Run pattern detection
    this.detector.analyze(candleSlice)
    const summary = this.detector.getSignalSummary()

    // Check if signal meets criteria
    if (!summary || summary.signal === 'NONE' || summary.direction === 'NEUTRAL') {
      return null
    }

    if (summary.strength < this.minStrength) {
      return null
    }

    // Check if direction is in allowed types
    const direction = summary.direction // CALL or PUT
    if (!this.signalTypes.includes(direction)) {
      return null
    }

    // Return signal in standard format
    return {
      type: summary.signal, // STRONG_CALL, CALL, PUT, STRONG_PUT
      direction: direction,
      strength: summary.strength,
      source: this.name,
      price: candles[index].close,
      time: candles[index].time,
      patterns: summary.patterns,
      indicators: summary.indicators,
      metadata: {
        putWeight: summary.putWeight,
        callWeight: summary.callWeight,
        patternCount: summary.patterns.length,
        indicatorBonus: summary.indicatorBonus,
      },
    }
  }

  /**
   * Get configuration for display/export
   * @returns {Object}
   */
  getConfig() {
    return {
      source: 'pattern-detector',
      minStrength: this.minStrength,
      signalTypes: this.signalTypes,
      lookback: this.lookback,
    }
  }
}
