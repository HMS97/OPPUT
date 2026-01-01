/**
 * OI-Based Signal Source Adapter
 * Uses synthetic WASP (price SMA) for backtesting since historical OI data
 * is not available from Yahoo Finance
 *
 * Based on mean reversion: when price deviates significantly from fair value,
 * expect reversion
 */

import { calculateSMA } from '../../patterns/indicators.js'

export class OISignalSource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.waspPeriod - SMA period for synthetic WASP (default 20)
   * @param {number} config.entryDeviation - % deviation to trigger entry (default 1.5)
   * @param {number} config.strongDeviation - % deviation for strong signal (default 2.5)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength
   */
  constructor(config = {}) {
    this.name = 'OI-WASP Deviation'
    this.waspPeriod = config.waspPeriod ?? 20
    this.entryDeviation = config.entryDeviation ?? 1.5
    this.strongDeviation = config.strongDeviation ?? 2.5
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 30
    this.cooldownBars = config.cooldownBars ?? 5

    this.lastSignalIndex = -1
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    // Need enough history for WASP calculation
    if (index < this.waspPeriod + 5) {
      return null
    }

    // Check cooldown
    if (index - this.lastSignalIndex < this.cooldownBars) {
      return null
    }

    // Get candle slice for WASP calculation
    const startIdx = Math.max(0, index - this.waspPeriod - 10)
    const candleSlice = candles.slice(startIdx, index + 1)

    // Calculate synthetic WASP using SMA
    const closes = candleSlice.map((c) => c.close)
    const smaValues = calculateSMA(closes, this.waspPeriod)

    if (!smaValues || smaValues.length === 0) {
      return null
    }

    // Current price and synthetic WASP
    const currentPrice = candles[index].close
    const syntheticWASP = smaValues[smaValues.length - 1]

    if (!syntheticWASP || syntheticWASP === 0) {
      return null
    }

    // Calculate deviation from WASP
    const deviation = ((currentPrice - syntheticWASP) / syntheticWASP) * 100

    // Check for mean reversion signals
    // Price above WASP = overpriced = expect PUT (mean reversion down)
    // Price below WASP = underpriced = expect CALL (mean reversion up)

    let signal = null

    if (deviation >= this.strongDeviation) {
      // Strong overpriced - PUT signal
      if (this.signalTypes.includes('PUT')) {
        signal = this.createSignal(
          'PUT',
          true,
          deviation,
          currentPrice,
          syntheticWASP,
          candles[index]
        )
      }
    } else if (deviation >= this.entryDeviation) {
      // Moderate overpriced - PUT signal
      if (this.signalTypes.includes('PUT')) {
        signal = this.createSignal(
          'PUT',
          false,
          deviation,
          currentPrice,
          syntheticWASP,
          candles[index]
        )
      }
    } else if (deviation <= -this.strongDeviation) {
      // Strong underpriced - CALL signal
      if (this.signalTypes.includes('CALL')) {
        signal = this.createSignal(
          'CALL',
          true,
          Math.abs(deviation),
          currentPrice,
          syntheticWASP,
          candles[index]
        )
      }
    } else if (deviation <= -this.entryDeviation) {
      // Moderate underpriced - CALL signal
      if (this.signalTypes.includes('CALL')) {
        signal = this.createSignal(
          'CALL',
          false,
          Math.abs(deviation),
          currentPrice,
          syntheticWASP,
          candles[index]
        )
      }
    }

    // Check minimum strength
    if (signal && signal.strength < this.minStrength) {
      return null
    }

    if (signal) {
      this.lastSignalIndex = index
    }

    return signal
  }

  /**
   * Create signal object
   */
  createSignal(direction, isStrong, deviation, price, wasp, candle) {
    // Calculate strength based on deviation magnitude
    // 1.5% = 50 strength, 2.5% = 75 strength, 3.5%+ = 100 strength
    const normalizedDev = Math.min(deviation, 3.5)
    const strength = Math.round(30 + (normalizedDev - 1.5) * 35)

    const type = isStrong ? `STRONG_${direction}` : direction

    return {
      type,
      direction,
      strength: Math.min(100, Math.max(0, strength)),
      source: this.name,
      price: price,
      time: candle.time,
      metadata: {
        deviation: deviation.toFixed(2),
        syntheticWASP: wasp.toFixed(2),
        isStrong,
        strategy: 'Mean Reversion',
        note: 'Using synthetic WASP (SMA) for historical backtesting',
      },
    }
  }

  /**
   * Reset state
   */
  reset() {
    this.lastSignalIndex = -1
  }

  /**
   * Get configuration
   * @returns {Object}
   */
  getConfig() {
    return {
      source: 'oi-wasp',
      waspPeriod: this.waspPeriod,
      entryDeviation: this.entryDeviation,
      strongDeviation: this.strongDeviation,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      note: 'Uses synthetic WASP (SMA) - real OI data not available historically',
    }
  }
}
