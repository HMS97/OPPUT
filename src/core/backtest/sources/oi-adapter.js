/**
 * OI-Based Signal Source Adapter
 * Uses REAL WASP from DoltHub options data when available (2019-2024)
 * Falls back to synthetic WASP (SMA) for recent dates without OI data
 *
 * Based on mean reversion: when price deviates significantly from fair value,
 * expect reversion
 */

import { calculateSMA } from '../../patterns/indicators.js'
import { fetchOIWASP } from '../../data/dolthub.js'

export class OISignalSource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.waspPeriod - SMA period for synthetic WASP (default 20)
   * @param {number} config.entryDeviation - % deviation to trigger entry (default 0.5)
   * @param {number} config.strongDeviation - % deviation for strong signal (default 1.0)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength
   * @param {boolean} config.useRealWASP - Use DoltHub real WASP data (default true)
   */
  constructor(config = {}) {
    this.name = 'OI-WASP Deviation'
    this.waspPeriod = config.waspPeriod ?? 20
    this.entryDeviation = config.entryDeviation ?? 0.5
    this.strongDeviation = config.strongDeviation ?? 1.0
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 30
    this.cooldownBars = config.cooldownBars ?? 3
    this.useRealWASP = config.useRealWASP ?? true

    this.lastSignalIndex = -1
    this.waspData = [] // Real WASP data from DoltHub
    this.dataLoaded = false
  }

  /**
   * Load real WASP data from DoltHub
   * @param {string} symbol - Stock symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async loadData(symbol, startDate, endDate) {
    if (!this.useRealWASP) {
      console.log('[OI-WASP] Using synthetic WASP (SMA proxy)')
      this.dataLoaded = true
      return
    }

    try {
      console.log(`[OI-WASP] Loading real WASP data from DoltHub for ${symbol}...`)
      this.waspData = await fetchOIWASP(symbol, startDate, endDate, 30)
      this.dataLoaded = true
      console.log(`[OI-WASP] Loaded ${this.waspData.length} days of real WASP data`)

      if (this.waspData.length === 0) {
        console.log('[OI-WASP] No DoltHub data found, falling back to SMA proxy')
      }
    } catch (error) {
      console.error('[OI-WASP] Failed to load DoltHub data:', error.message)
      console.log('[OI-WASP] Falling back to SMA proxy')
      this.waspData = []
      this.dataLoaded = true
    }
  }

  /**
   * Find real WASP for a specific date
   * @param {number} timestamp - Candle timestamp
   * @returns {Object|null} - WASP data for that date
   */
  findWASPForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]
    return this.waspData.find(w => w.date.toISOString().split('T')[0] === targetDate)
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

    const candle = candles[index]
    const currentPrice = candle.close
    let wasp = null
    let waspSource = 'SMA'

    // Try to get real WASP from DoltHub data
    if (this.waspData.length > 0) {
      const realWASP = this.findWASPForDate(candle.time)
      if (realWASP && realWASP.totalWASP > 0) {
        wasp = realWASP.totalWASP
        waspSource = 'DoltHub OI'
      }
    }

    // Fall back to synthetic WASP (SMA) if no real data
    if (!wasp) {
      const startIdx = Math.max(0, index - this.waspPeriod - 10)
      const candleSlice = candles.slice(startIdx, index + 1)
      const closes = candleSlice.map((c) => c.close)
      const smaValues = calculateSMA(closes, this.waspPeriod)

      if (!smaValues || smaValues.length === 0) {
        return null
      }
      wasp = smaValues[smaValues.length - 1]
    }

    if (!wasp || wasp === 0) {
      return null
    }

    // Calculate deviation from WASP
    const deviation = ((currentPrice - wasp) / wasp) * 100

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
          wasp,
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
          wasp,
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
          wasp,
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
          wasp,
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
    // 0.5% = 40 strength, 1.0% = 70 strength, 1.5%+ = 100 strength
    const normalizedDev = Math.min(deviation, 1.5)
    const strength = Math.round(40 + (normalizedDev - 0.5) * 60)

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
