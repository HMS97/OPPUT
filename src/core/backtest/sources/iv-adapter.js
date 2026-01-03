/**
 * IV-Based Signal Source Adapter
 * Uses historical implied volatility data for backtesting
 *
 * Data sources (via DataPipeline):
 * - Local SQLite cache (primary)
 * - Schwab API (for live/today data)
 * - DoltHub (fallback for historical)
 *
 * Strategies:
 * 1. IV Percentile - Buy when IV is low (cheap options)
 * 2. IV Skew - Put/Call IV ratio indicates directional bias
 * 3. IV vs HV - Compare implied vs historical volatility
 */

import { DataPipeline, getDataPipeline } from '../../data/pipeline.js'

export class IVSignalSource {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.strategy - 'percentile', 'skew', or 'ivhv'
   * @param {number} config.lookbackDays - Days for percentile calculation (default 20)
   * @param {number} config.lowPercentile - IV percentile for CALL signal (default 20)
   * @param {number} config.highPercentile - IV percentile for PUT signal (default 80)
   * @param {number} config.skewThreshold - Skew threshold for signals (default 0.05)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength
   */
  constructor(config = {}) {
    this.name = 'IV Signal'
    this.strategy = config.strategy ?? 'percentile'
    this.lookbackDays = config.lookbackDays ?? 20
    this.lowPercentile = config.lowPercentile ?? 20
    this.highPercentile = config.highPercentile ?? 80
    this.skewThreshold = config.skewThreshold ?? 0.05
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 30
    this.cooldownBars = config.cooldownBars ?? 1 // Daily data, so 1 bar = 1 day

    // Data pipeline (cache-first with Schwab/DoltHub fallback)
    this.pipeline = config.pipeline || getDataPipeline({ useDoltHubFallback: true })

    // Data cache
    this.ivData = []
    this.skewData = []
    this.dataLoaded = false
    this.lastSignalIndex = -1
  }

  /**
   * Load IV data for the backtest period
   * Must be called before running backtest
   * @param {string} symbol - Stock symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async loadData(symbol, startDate, endDate) {
    console.log(`[IV Signal] Loading data for ${symbol}...`)

    // Add lookback buffer to start date
    const bufferStart = new Date(startDate)
    bufferStart.setDate(bufferStart.getDate() - this.lookbackDays - 10)

    // Load IV history via pipeline (cache → Schwab → DoltHub fallback)
    this.ivData = await this.pipeline.fetchIVHistory(symbol, bufferStart, endDate)

    // Load skew data if using skew strategy
    if (this.strategy === 'skew') {
      this.skewData = await this.pipeline.fetchIVSkewHistory(symbol, bufferStart, endDate)
    }

    this.dataLoaded = true
    console.log(`[IV Signal] Loaded ${this.ivData.length} IV records, ${this.skewData.length} skew records`)
  }

  /**
   * Find IV data for a specific date
   * @param {number} timestamp - Candle timestamp
   * @returns {Object|null} - IV data for that date
   */
  findIVForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]

    return this.ivData.find(iv => {
      const ivDate = iv.date.toISOString().split('T')[0]
      return ivDate === targetDate
    })
  }

  /**
   * Find skew data for a specific date
   * @param {number} timestamp - Candle timestamp
   * @returns {Object|null} - Skew data for that date
   */
  findSkewForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]

    return this.skewData.find(s => {
      const skewDate = s.date.toISOString().split('T')[0]
      return skewDate === targetDate
    })
  }

  /**
   * Calculate IV percentile over lookback period
   * @param {number} currentIndex - Current index in ivData
   * @returns {number} - Percentile (0-100)
   */
  calculatePercentile(currentIndex) {
    if (currentIndex < this.lookbackDays) return 50

    const currentIV = this.ivData[currentIndex].ivCurrent
    const lookbackIVs = this.ivData
      .slice(currentIndex - this.lookbackDays, currentIndex)
      .map(d => d.ivCurrent)
      .filter(iv => iv > 0)

    if (lookbackIVs.length === 0) return 50

    const belowCount = lookbackIVs.filter(iv => iv < currentIV).length
    return (belowCount / lookbackIVs.length) * 100
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   * @param {Array} candles - All candles
   * @param {number} index - Current candle index
   * @returns {Object|null} - Signal object or null
   */
  analyze(candles, index) {
    if (!this.dataLoaded) {
      console.warn('[IV Signal] Data not loaded. Call loadData() first.')
      return null
    }

    // Check cooldown
    if (index - this.lastSignalIndex < this.cooldownBars) {
      return null
    }

    const candle = candles[index]

    // Find corresponding IV data
    const ivDataIndex = this.ivData.findIndex(iv => {
      const ivDate = iv.date.toISOString().split('T')[0]
      const candleDate = new Date(candle.time).toISOString().split('T')[0]
      return ivDate === candleDate
    })

    if (ivDataIndex < 0 || ivDataIndex < this.lookbackDays) {
      return null
    }

    let signal = null

    switch (this.strategy) {
      case 'percentile':
        signal = this.analyzePercentile(candle, ivDataIndex)
        break
      case 'skew':
        signal = this.analyzeSkew(candle)
        break
      case 'ivhv':
        signal = this.analyzeIVHV(candle, ivDataIndex)
        break
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
   * Generate signal based on IV percentile
   */
  analyzePercentile(candle, ivDataIndex) {
    const percentile = this.calculatePercentile(ivDataIndex)
    const ivData = this.ivData[ivDataIndex]

    // Low IV = cheap options = bullish opportunity (CALL)
    if (percentile <= this.lowPercentile && this.signalTypes.includes('CALL')) {
      const strength = Math.round(80 - percentile * 0.6) // Lower percentile = stronger signal
      return this.createSignal('CALL', candle, {
        percentile,
        ivCurrent: ivData.ivCurrent,
        strategy: 'IV Percentile (Low)',
      }, strength)
    }

    // High IV = expensive options = bearish fear (PUT)
    if (percentile >= this.highPercentile && this.signalTypes.includes('PUT')) {
      const strength = Math.round(20 + (percentile - 80) * 3) // Higher percentile = stronger
      return this.createSignal('PUT', candle, {
        percentile,
        ivCurrent: ivData.ivCurrent,
        strategy: 'IV Percentile (High)',
      }, strength)
    }

    return null
  }

  /**
   * Generate signal based on IV skew
   */
  analyzeSkew(candle) {
    const skewData = this.findSkewForDate(candle.time)
    if (!skewData) return null

    const { skew, skewRatio, otmPutIV, otmCallIV } = skewData

    // High put IV skew = fear = contrarian CALL
    if (skew >= this.skewThreshold && this.signalTypes.includes('CALL')) {
      const strength = Math.round(50 + (skew - this.skewThreshold) * 500)
      return this.createSignal('CALL', candle, {
        skew: skew.toFixed(4),
        skewRatio: skewRatio.toFixed(2),
        putIV: otmPutIV.toFixed(4),
        callIV: otmCallIV.toFixed(4),
        strategy: 'IV Skew (High Put Premium)',
      }, Math.min(100, strength))
    }

    // Low put IV skew = complacency = contrarian PUT
    if (skew <= -this.skewThreshold && this.signalTypes.includes('PUT')) {
      const strength = Math.round(50 + Math.abs(skew + this.skewThreshold) * 500)
      return this.createSignal('PUT', candle, {
        skew: skew.toFixed(4),
        skewRatio: skewRatio.toFixed(2),
        putIV: otmPutIV.toFixed(4),
        callIV: otmCallIV.toFixed(4),
        strategy: 'IV Skew (Low Put Premium)',
      }, Math.min(100, strength))
    }

    return null
  }

  /**
   * Generate signal based on IV vs HV comparison
   */
  analyzeIVHV(candle, ivDataIndex) {
    const ivData = this.ivData[ivDataIndex]
    const { ivCurrent, hvCurrent } = ivData

    if (!ivCurrent || !hvCurrent || hvCurrent === 0) return null

    const ivhvRatio = ivCurrent / hvCurrent

    // IV much lower than HV = options cheap = CALL
    if (ivhvRatio < 0.8 && this.signalTypes.includes('CALL')) {
      const strength = Math.round(50 + (0.8 - ivhvRatio) * 250)
      return this.createSignal('CALL', candle, {
        ivCurrent: ivCurrent.toFixed(4),
        hvCurrent: hvCurrent.toFixed(4),
        ivhvRatio: ivhvRatio.toFixed(2),
        strategy: 'IV < HV (Cheap Options)',
      }, Math.min(100, strength))
    }

    // IV much higher than HV = options expensive = PUT (vol crush expected)
    if (ivhvRatio > 1.3 && this.signalTypes.includes('PUT')) {
      const strength = Math.round(50 + (ivhvRatio - 1.3) * 100)
      return this.createSignal('PUT', candle, {
        ivCurrent: ivCurrent.toFixed(4),
        hvCurrent: hvCurrent.toFixed(4),
        ivhvRatio: ivhvRatio.toFixed(2),
        strategy: 'IV > HV (Expensive Options)',
      }, Math.min(100, strength))
    }

    return null
  }

  /**
   * Create signal object
   */
  createSignal(direction, candle, metadata, strength) {
    return {
      type: direction,
      direction,
      strength: Math.max(0, Math.min(100, strength)),
      source: this.name,
      price: candle.close,
      time: candle.time,
      metadata: {
        ...metadata,
        dataSource: 'DataPipeline (Cache/Schwab/DoltHub)',
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
   */
  getConfig() {
    return {
      source: 'iv-signal',
      strategy: this.strategy,
      lookbackDays: this.lookbackDays,
      lowPercentile: this.lowPercentile,
      highPercentile: this.highPercentile,
      skewThreshold: this.skewThreshold,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      dataSource: 'DataPipeline (Cache → Schwab → DoltHub)',
    }
  }
}
