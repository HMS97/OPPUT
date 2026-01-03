/**
 * OI-Based Signal Source Adapter (OPTIMIZED)
 * Uses REAL WASP from Unicorn API for mean reversion signals
 *
 * OPTIMIZATION CHANGES (based on mean reversion best practices):
 * 1. RSI filter: RSI < 35 for CALL, RSI > 65 for PUT
 * 2. ADX filter: Only trade when ADX < 25 (range-bound market)
 * 3. Bollinger Band confirmation: %B < 0.2 for CALL, %B > 0.8 for PUT
 * 4. ATR volatility filter: Avoid low volatility dead zones
 * 5. Wider entry deviation: 0.5% base (was 0.2%)
 * 6. Longer cooldown: 3 bars minimum
 *
 * Data source: Unicorn API (EODHD marketplace)
 * - Requires EODHD_API_KEY in .env
 * - In browser: requires server.js proxy running (npm start)
 * - Falls back to SMA proxy if API unavailable
 */

import {
  calculateSMA,
  calculateRSI,
  calculateADX,
  calculateBollingerPercentB,
  calculateATRArray
} from '../../patterns/indicators.js'
import { DataPipeline, getDataPipeline } from '../../data/pipeline.js'

/**
 * Get timeframe scaling factor
 * Base timeframe is 5m = 1.0, scale up for longer timeframes
 */
function getTimeframeScale(timeframe) {
  const scales = {
    5: 1.0,     // Base: 5m
    15: 1.5,    // 15m: 1.5x
    60: 2.5,    // 1H: 2.5x
    240: 10.0,  // 4H/Daily: 10x
  }
  return scales[timeframe] || 1.0
}

export class OISignalSource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.timeframe - Candle timeframe in minutes (5, 15, 60, 240)
   * @param {number} config.waspPeriod - SMA period for synthetic WASP (default 20)
   * @param {number} config.entryDeviation - % deviation to trigger entry (default 0.5)
   * @param {number} config.strongDeviation - % deviation for strong signal (default 1.0)
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength
   * @param {boolean} config.useRealWASP - Use DoltHub real WASP data (default true)
   * @param {boolean} config.useFilters - Use RSI/ADX/BB filters (default true)
   */
  constructor(config = {}) {
    this.name = 'OI-WASP Optimized'
    this.timeframe = config.timeframe ?? 5

    // Scale parameters based on timeframe
    const scale = getTimeframeScale(this.timeframe)

    // OPTIMIZED base values (wider deviations for better entries)
    const baseEntryDev = 0.5   // Was 0.2 - now wider for fewer but better signals
    const baseStrongDev = 1.0  // Was 0.5 - strong signal threshold
    const baseWaspPeriod = 20  // Was 15 - slightly longer for smoother WASP
    const baseCooldown = 3     // Was 1 - longer cooldown to avoid overtrading

    // Scale for timeframe
    this.waspPeriod = config.waspPeriod ?? Math.round(baseWaspPeriod / scale)
    this.entryDeviation = config.entryDeviation ?? (baseEntryDev * scale)
    this.strongDeviation = config.strongDeviation ?? (baseStrongDev * scale)
    this.cooldownBars = config.cooldownBars ?? Math.max(3, Math.round(baseCooldown * scale))

    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 10
    this.useRealWASP = config.useRealWASP ?? true

    // NEW: Filter configuration
    this.useFilters = config.useFilters ?? true
    this.rsiPeriod = config.rsiPeriod ?? 14
    this.rsiOversold = config.rsiOversold ?? 35  // CALL when RSI < 35
    this.rsiOverbought = config.rsiOverbought ?? 65  // PUT when RSI > 65
    this.adxPeriod = config.adxPeriod ?? 14
    this.adxThreshold = config.adxThreshold ?? 25  // Only trade when ADX < 25 (range-bound)
    this.bbPeriod = config.bbPeriod ?? 20
    this.bbLowThreshold = config.bbLowThreshold ?? 0.2  // %B < 0.2 for CALL
    this.bbHighThreshold = config.bbHighThreshold ?? 0.8  // %B > 0.8 for PUT
    this.atrPeriod = config.atrPeriod ?? 14
    this.atrMinMultiple = config.atrMinMultiple ?? 0.5  // Min ATR relative to 20-period average

    // NEW: Week-of-month filter (Week 3-4 has highest OI deviation per original strategy)
    this.useWeekFilter = config.useWeekFilter ?? true
    this.allowedWeeks = config.allowedWeeks ?? [3, 4]  // Only trade Week 3 (15-21) and Week 4 (22-28)

    // Data pipeline (Unicorn API only)
    this.pipeline = config.pipeline || getDataPipeline({ useDoltHubFallback: false, useUnicornProxy: true })

    this.lastSignalIndex = -1
    this.waspData = []
    this.dataLoaded = false

    // Cached indicators (calculated once per analyze call)
    this.cachedIndicators = null
    this.cachedCandleCount = 0

    console.log(`[OI-WASP-OPT] Timeframe: ${this.timeframe}m, Scale: ${scale}x, Entry: ${this.entryDeviation.toFixed(2)}%, Strong: ${this.strongDeviation.toFixed(2)}%, Filters: ${this.useFilters}`)
  }

  /**
   * Load real WASP data via pipeline
   */
  async loadData(symbol, startDate, endDate) {
    if (!this.useRealWASP) {
      console.log('[OI-WASP-OPT] Using synthetic WASP (SMA proxy)')
      this.dataLoaded = true
      return
    }

    try {
      console.log(`[OI-WASP-OPT] Loading WASP data for ${symbol}...`)
      this.waspData = await this.pipeline.fetchOIWASP(symbol, startDate, endDate, 30)
      this.dataLoaded = true
      console.log(`[OI-WASP-OPT] Loaded ${this.waspData.length} days of WASP data`)

      if (this.waspData.length === 0) {
        console.log('[OI-WASP-OPT] No cached/API data found, falling back to SMA proxy')
      }
    } catch (error) {
      console.error('[OI-WASP-OPT] Failed to load data:', error.message)
      console.log('[OI-WASP-OPT] Falling back to SMA proxy')
      this.waspData = []
      this.dataLoaded = true
    }
  }

  /**
   * Find real WASP for a specific date
   */
  findWASPForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]
    return this.waspData.find(w => w.date.toISOString().split('T')[0] === targetDate)
  }

  /**
   * Calculate and cache all indicators for efficiency
   */
  calculateIndicators(candles) {
    if (this.cachedIndicators && this.cachedCandleCount === candles.length) {
      return this.cachedIndicators
    }

    const closes = candles.map(c => c.close)

    this.cachedIndicators = {
      rsi: calculateRSI(closes, this.rsiPeriod),
      adx: calculateADX(candles, this.adxPeriod),
      percentB: calculateBollingerPercentB(closes, this.bbPeriod),
      atr: calculateATRArray(candles, this.atrPeriod),
      atrAvg: null  // Will calculate below
    }

    // Calculate 20-period average ATR for volatility filter
    const validAtr = this.cachedIndicators.atr.filter(v => v !== null)
    if (validAtr.length >= 20) {
      const recentAtr = validAtr.slice(-20)
      this.cachedIndicators.atrAvg = recentAtr.reduce((a, b) => a + b, 0) / 20
    }

    this.cachedCandleCount = candles.length
    return this.cachedIndicators
  }

  /**
   * Get week of month (1-5) from timestamp
   */
  getWeekOfMonth(timestamp) {
    const date = new Date(timestamp)
    const dayOfMonth = date.getDate()
    return Math.ceil(dayOfMonth / 7)
  }

  /**
   * Check if filters pass for a given signal direction
   */
  checkFilters(candles, index, direction) {
    if (!this.useFilters) {
      return { pass: true, reason: 'Filters disabled' }
    }

    const candle = candles[index]

    // Check week-of-month filter (Week 3-4 has highest OI deviation)
    if (this.useWeekFilter) {
      const weekOfMonth = this.getWeekOfMonth(candle.time)
      if (!this.allowedWeeks.includes(weekOfMonth)) {
        return { pass: false, reason: `Week ${weekOfMonth} not in allowed weeks [${this.allowedWeeks.join(',')}]` }
      }
    }

    const indicators = this.calculateIndicators(candles)

    const rsi = indicators.rsi[index]
    const adx = indicators.adx[index]
    const percentB = indicators.percentB[index]
    const atr = indicators.atr[index]
    const atrAvg = indicators.atrAvg

    // Check RSI filter
    if (rsi !== null) {
      if (direction === 'CALL' && rsi > this.rsiOversold) {
        return { pass: false, reason: `RSI ${rsi.toFixed(0)} > ${this.rsiOversold} (not oversold)` }
      }
      if (direction === 'PUT' && rsi < this.rsiOverbought) {
        return { pass: false, reason: `RSI ${rsi.toFixed(0)} < ${this.rsiOverbought} (not overbought)` }
      }
    }

    // Check ADX filter (only trade in range-bound markets)
    if (adx !== null && adx > this.adxThreshold) {
      return { pass: false, reason: `ADX ${adx.toFixed(0)} > ${this.adxThreshold} (trending market)` }
    }

    // Check Bollinger %B filter
    if (percentB !== null) {
      if (direction === 'CALL' && percentB > this.bbLowThreshold) {
        return { pass: false, reason: `%B ${percentB.toFixed(2)} > ${this.bbLowThreshold} (not at lower band)` }
      }
      if (direction === 'PUT' && percentB < this.bbHighThreshold) {
        return { pass: false, reason: `%B ${percentB.toFixed(2)} < ${this.bbHighThreshold} (not at upper band)` }
      }
    }

    // Check volatility filter (avoid dead zones)
    if (atr !== null && atrAvg !== null) {
      if (atr < atrAvg * this.atrMinMultiple) {
        return { pass: false, reason: `ATR too low: ${atr.toFixed(2)} < ${(atrAvg * this.atrMinMultiple).toFixed(2)}` }
      }
    }

    return {
      pass: true,
      reason: 'All filters passed',
      details: {
        rsi: rsi?.toFixed(0),
        adx: adx?.toFixed(0),
        percentB: percentB?.toFixed(2),
        atr: atr?.toFixed(2)
      }
    }
  }

  /**
   * Analyze candles at a specific index and return signal if valid
   */
  analyze(candles, index) {
    // Need enough history for all indicators
    const minHistory = Math.max(this.waspPeriod, this.rsiPeriod, this.adxPeriod * 2, this.bbPeriod) + 10
    if (index < minHistory) {
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

    // Try to get real WASP from Unicorn API data
    if (this.waspData.length > 0) {
      const realWASP = this.findWASPForDate(candle.time)
      if (realWASP && realWASP.totalWASP > 0) {
        wasp = realWASP.totalWASP
        waspSource = 'Unicorn OI'
      }
    }

    // Fall back to synthetic WASP (SMA)
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
    let direction = null
    let isStrong = false

    if (deviation >= this.strongDeviation) {
      // Strong overpriced - PUT signal
      direction = 'PUT'
      isStrong = true
    } else if (deviation >= this.entryDeviation) {
      // Moderate overpriced - PUT signal
      direction = 'PUT'
    } else if (deviation <= -this.strongDeviation) {
      // Strong underpriced - CALL signal
      direction = 'CALL'
      isStrong = true
    } else if (deviation <= -this.entryDeviation) {
      // Moderate underpriced - CALL signal
      direction = 'CALL'
    }

    // No signal triggered
    if (!direction) {
      return null
    }

    // Check if signal type is allowed
    if (!this.signalTypes.includes(direction)) {
      return null
    }

    // OPTIMIZATION: Apply filters
    const filterResult = this.checkFilters(candles, index, direction)
    if (!filterResult.pass) {
      // Log filtered signals for debugging
      // console.log(`[OI-WASP-OPT] Signal filtered: ${direction} at ${currentPrice.toFixed(2)}, reason: ${filterResult.reason}`)
      return null
    }

    // Create signal
    const signal = this.createSignal(
      direction,
      isStrong,
      Math.abs(deviation),
      currentPrice,
      wasp,
      candle,
      filterResult.details
    )

    // Check minimum strength
    if (signal.strength < this.minStrength) {
      return null
    }

    this.lastSignalIndex = index
    return signal
  }

  /**
   * Create signal object
   */
  createSignal(direction, isStrong, deviation, price, wasp, candle, filterDetails) {
    // OPTIMIZED: Higher strength threshold for better signals
    // 0.5% = 50 strength, 1.0% = 75 strength, 1.5%+ = 100 strength
    const normalizedDev = Math.min(deviation / 1.5, 1.0)
    const strength = Math.round(50 + normalizedDev * 50)

    const type = isStrong ? `STRONG_${direction}` : direction

    return {
      type,
      direction,
      strength: Math.min(100, Math.max(40, strength)),  // Minimum 40 strength (was 30)
      source: this.name,
      price: price,
      time: candle.time,
      metadata: {
        deviation: deviation.toFixed(2),
        syntheticWASP: wasp.toFixed(2),
        isStrong,
        strategy: 'Mean Reversion (Optimized)',
        filters: filterDetails || {},
        note: 'RSI/ADX/BB/ATR filters applied',
      },
    }
  }

  /**
   * Reset state
   */
  reset() {
    this.lastSignalIndex = -1
    this.cachedIndicators = null
    this.cachedCandleCount = 0
  }

  /**
   * Get configuration
   */
  getConfig() {
    return {
      source: 'oi-wasp-optimized',
      waspPeriod: this.waspPeriod,
      entryDeviation: this.entryDeviation,
      strongDeviation: this.strongDeviation,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      useRealWASP: this.useRealWASP,
      useFilters: this.useFilters,
      useWeekFilter: this.useWeekFilter,
      allowedWeeks: this.allowedWeeks,
      filters: {
        rsi: { period: this.rsiPeriod, oversold: this.rsiOversold, overbought: this.rsiOverbought },
        adx: { period: this.adxPeriod, threshold: this.adxThreshold },
        bb: { period: this.bbPeriod, lowThreshold: this.bbLowThreshold, highThreshold: this.bbHighThreshold },
        atr: { period: this.atrPeriod, minMultiple: this.atrMinMultiple },
        week: { enabled: this.useWeekFilter, allowedWeeks: this.allowedWeeks },
      },
      dataSource: 'Unicorn API (EODHD) → SMA fallback',
    }
  }
}
