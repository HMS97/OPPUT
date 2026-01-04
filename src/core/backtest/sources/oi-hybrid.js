/**
 * OI-WASP Hybrid Strategy (Regime-Adaptive)
 *
 * Automatically switches between mean-reversion and trend-following
 * based on market regime detected via ADX:
 *
 * - ADX < 20: Strong mean-reversion (range-bound market)
 * - ADX 20-30: Weak mean-reversion with tighter filters
 * - ADX > 30: Trend-following (breakout trades)
 *
 * This solves the problem where mean-reversion fails in trending markets
 * and trend-following fails in choppy markets.
 */

import {
  calculateSMA,
  calculateRSI,
  calculateADX,
  calculateBollingerPercentB,
  calculateATRArray,
  calculateEMA
} from '../../patterns/indicators.js'
import { getDataPipeline } from '../../data/pipeline.js'

/**
 * Market regime types
 */
const REGIME = {
  RANGE_STRONG: 'RANGE_STRONG',   // ADX < 20 - strong mean reversion
  RANGE_WEAK: 'RANGE_WEAK',       // ADX 20-25 - cautious mean reversion
  TRANSITION: 'TRANSITION',        // ADX 25-30 - avoid trading
  TREND: 'TREND',                  // ADX > 30 - trend following
}

export class OIHybridSource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.timeframe - Candle timeframe in minutes
   * @param {number} config.waspPeriod - SMA period for WASP proxy (default 15)
   * @param {number} config.adxPeriod - ADX calculation period (default 14)
   * @param {number} config.adxRangeThreshold - Below this = range (default 20)
   * @param {number} config.adxTrendThreshold - Above this = trend (default 30)
   * @param {number} config.meanReversionDev - % deviation for mean reversion entry (default 0.2)
   * @param {number} config.trendBreakoutDev - % deviation for trend entry (default 0.3)
   * @param {string[]} config.signalTypes - ['CALL', 'PUT']
   * @param {number} config.minStrength - Minimum signal strength
   * @param {boolean} config.allowTransition - Trade in transition zone (default false)
   */
  constructor(config = {}) {
    this.name = 'OI-WASP Hybrid'
    this.timeframe = config.timeframe ?? 5

    // WASP parameters
    this.waspPeriod = config.waspPeriod ?? 15

    // Regime detection
    this.adxPeriod = config.adxPeriod ?? 14
    this.adxRangeThreshold = config.adxRangeThreshold ?? 20
    this.adxTrendThreshold = config.adxTrendThreshold ?? 30
    this.allowTransition = config.allowTransition ?? false

    // Mean reversion parameters (used when ADX < 25)
    this.meanReversionDev = config.meanReversionDev ?? 0.2
    this.meanReversionStrongDev = config.meanReversionStrongDev ?? 0.5
    this.rsiPeriod = config.rsiPeriod ?? 14
    this.rsiOversold = config.rsiOversold ?? 35
    this.rsiOverbought = config.rsiOverbought ?? 65
    this.bbPeriod = config.bbPeriod ?? 20

    // Trend following parameters (used when ADX > 30)
    this.trendBreakoutDev = config.trendBreakoutDev ?? 0.3
    this.momentumBars = config.momentumBars ?? 3
    this.emaPeriod = config.emaPeriod ?? 21

    // General
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 30
    this.cooldownBars = config.cooldownBars ?? 2

    // Data
    this.pipeline = config.pipeline || getDataPipeline({ useDoltHubFallback: false, useUnicornProxy: true })
    this.waspData = []
    this.dataLoaded = false
    this.lastSignalIndex = -1

    // Stats tracking
    this.stats = {
      rangeSignals: 0,
      trendSignals: 0,
      filteredTransition: 0,
    }

    // Cache
    this.cachedIndicators = null
    this.cachedCandleCount = 0

    console.log(`[OI-Hybrid] Timeframe: ${this.timeframe}m, Range ADX: <${this.adxRangeThreshold}, Trend ADX: >${this.adxTrendThreshold}`)
  }

  async loadData(symbol, startDate, endDate) {
    try {
      console.log(`[OI-Hybrid] Loading WASP data for ${symbol}...`)
      this.waspData = await this.pipeline.fetchOIWASP(symbol, startDate, endDate, 30)
      this.dataLoaded = true
      console.log(`[OI-Hybrid] Loaded ${this.waspData.length} days of WASP data`)
    } catch (error) {
      console.error('[OI-Hybrid] Failed to load data:', error.message)
      this.waspData = []
      this.dataLoaded = true
    }
  }

  findWASPForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]
    return this.waspData.find(w => w.date.toISOString().split('T')[0] === targetDate)
  }

  /**
   * Calculate all indicators once per candle set
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
      atr: calculateATRArray(candles, 14),
      ema21: calculateEMA(closes, this.emaPeriod),
    }

    this.cachedCandleCount = candles.length
    return this.cachedIndicators
  }

  /**
   * Detect market regime based on ADX
   */
  detectRegime(adxValue) {
    if (adxValue === null || adxValue === undefined) {
      return REGIME.RANGE_WEAK // Default to cautious
    }

    if (adxValue < this.adxRangeThreshold) {
      return REGIME.RANGE_STRONG
    } else if (adxValue < 25) {
      return REGIME.RANGE_WEAK
    } else if (adxValue < this.adxTrendThreshold) {
      return REGIME.TRANSITION
    } else {
      return REGIME.TREND
    }
  }

  /**
   * Calculate price momentum for trend following
   */
  calculateMomentum(candles, index) {
    if (index < this.momentumBars) return 0

    let upBars = 0
    let downBars = 0

    for (let i = index - this.momentumBars + 1; i <= index; i++) {
      if (candles[i].close > candles[i].open) upBars++
      else if (candles[i].close < candles[i].open) downBars++
    }

    if (upBars >= this.momentumBars - 1) return 1   // Bullish
    if (downBars >= this.momentumBars - 1) return -1 // Bearish
    return 0
  }

  /**
   * Main analysis function - routes to appropriate strategy based on regime
   */
  analyze(candles, index) {
    const minHistory = Math.max(this.waspPeriod, this.adxPeriod * 2, this.bbPeriod, this.emaPeriod) + 10
    if (index < minHistory) return null

    // Cooldown check
    if (index - this.lastSignalIndex < this.cooldownBars) return null

    const indicators = this.calculateIndicators(candles)
    const adx = indicators.adx[index]
    const regime = this.detectRegime(adx)

    // Skip transition zone unless explicitly allowed
    if (regime === REGIME.TRANSITION && !this.allowTransition) {
      this.stats.filteredTransition++
      return null
    }

    // Calculate WASP (shared between both strategies)
    const candle = candles[index]
    const currentPrice = candle.close
    let wasp = null

    // Try real WASP
    if (this.waspData.length > 0) {
      const realWASP = this.findWASPForDate(candle.time)
      if (realWASP && realWASP.totalWASP > 0) {
        wasp = realWASP.totalWASP
      }
    }

    // Fall back to SMA
    if (!wasp) {
      const startIdx = Math.max(0, index - this.waspPeriod - 10)
      const candleSlice = candles.slice(startIdx, index + 1)
      const closes = candleSlice.map(c => c.close)
      const smaValues = calculateSMA(closes, this.waspPeriod)
      if (smaValues && smaValues.length > 0) {
        wasp = smaValues[smaValues.length - 1]
      }
    }

    if (!wasp || wasp === 0) return null

    const deviation = ((currentPrice - wasp) / wasp) * 100

    // Route to appropriate strategy
    let signal = null

    if (regime === REGIME.RANGE_STRONG || regime === REGIME.RANGE_WEAK) {
      signal = this.analyzeMeanReversion(candles, index, deviation, wasp, regime, indicators)
      if (signal) this.stats.rangeSignals++
    } else if (regime === REGIME.TREND) {
      signal = this.analyzeTrendFollowing(candles, index, deviation, wasp, indicators)
      if (signal) this.stats.trendSignals++
    } else if (regime === REGIME.TRANSITION && this.allowTransition) {
      // In transition, only take very strong mean reversion signals
      signal = this.analyzeMeanReversion(candles, index, deviation, wasp, regime, indicators)
      if (signal && signal.strength < 60) signal = null // Higher threshold
    }

    if (signal) {
      signal.metadata.regime = regime
      signal.metadata.adx = adx?.toFixed(1)
      this.lastSignalIndex = index
    }

    return signal
  }

  /**
   * Mean reversion strategy (for range-bound markets)
   */
  analyzeMeanReversion(candles, index, deviation, wasp, regime, indicators) {
    const candle = candles[index]
    const currentPrice = candle.close
    const rsi = indicators.rsi[index]
    const percentB = indicators.percentB[index]

    // Adjust thresholds based on regime strength
    const devThreshold = regime === REGIME.RANGE_STRONG
      ? this.meanReversionDev
      : this.meanReversionDev * 1.5  // Wider for weak range

    let direction = null
    let isStrong = false

    // Price above WASP + overbought indicators → PUT (fade the move)
    if (deviation >= devThreshold) {
      // Additional filters for mean reversion
      const rsiConfirm = rsi === null || rsi > this.rsiOverbought - 10
      const bbConfirm = percentB === null || percentB > 0.7

      if (rsiConfirm || bbConfirm) {
        direction = 'PUT'
        isStrong = deviation >= this.meanReversionStrongDev
      }
    }
    // Price below WASP + oversold indicators → CALL (fade the move)
    else if (deviation <= -devThreshold) {
      const rsiConfirm = rsi === null || rsi < this.rsiOversold + 10
      const bbConfirm = percentB === null || percentB < 0.3

      if (rsiConfirm || bbConfirm) {
        direction = 'CALL'
        isStrong = Math.abs(deviation) >= this.meanReversionStrongDev
      }
    }

    if (!direction || !this.signalTypes.includes(direction)) return null

    return this.createSignal(direction, isStrong, Math.abs(deviation), currentPrice, wasp, candle, {
      strategy: 'Mean Reversion',
      rsi: rsi?.toFixed(0),
      percentB: percentB?.toFixed(2),
    })
  }

  /**
   * Trend following strategy (for trending markets)
   */
  analyzeTrendFollowing(candles, index, deviation, wasp, indicators) {
    const candle = candles[index]
    const currentPrice = candle.close
    const ema21 = indicators.ema21[index]
    const momentum = this.calculateMomentum(candles, index)

    // Need clear momentum for trend trades
    if (momentum === 0) return null

    let direction = null
    let isStrong = false

    // Breakout above WASP + bullish momentum + above EMA → CALL (ride the trend)
    if (deviation >= this.trendBreakoutDev && momentum > 0) {
      const emaConfirm = ema21 === null || currentPrice > ema21
      if (emaConfirm) {
        direction = 'CALL'
        isStrong = deviation >= this.trendBreakoutDev * 2
      }
    }
    // Breakout below WASP + bearish momentum + below EMA → PUT (ride the trend)
    else if (deviation <= -this.trendBreakoutDev && momentum < 0) {
      const emaConfirm = ema21 === null || currentPrice < ema21
      if (emaConfirm) {
        direction = 'PUT'
        isStrong = Math.abs(deviation) >= this.trendBreakoutDev * 2
      }
    }

    if (!direction || !this.signalTypes.includes(direction)) return null

    return this.createSignal(direction, isStrong, Math.abs(deviation), currentPrice, wasp, candle, {
      strategy: 'Trend Following',
      momentum: momentum > 0 ? 'BULLISH' : 'BEARISH',
      ema21: ema21?.toFixed(2),
    })
  }

  /**
   * Create signal object
   */
  createSignal(direction, isStrong, deviation, price, wasp, candle, extra = {}) {
    const normalizedDev = Math.min(deviation / 1.0, 1.0)
    const strength = Math.round(40 + normalizedDev * 50 + (isStrong ? 10 : 0))

    const type = isStrong ? `STRONG_${direction}` : direction

    return {
      type,
      direction,
      strength: Math.min(100, Math.max(this.minStrength, strength)),
      source: this.name,
      price,
      time: candle.time,
      metadata: {
        deviation: deviation.toFixed(2),
        wasp: wasp.toFixed(2),
        isStrong,
        ...extra,
      },
    }
  }

  reset() {
    this.lastSignalIndex = -1
    this.cachedIndicators = null
    this.cachedCandleCount = 0
    // Keep stats for analysis
  }

  getStats() {
    return {
      ...this.stats,
      total: this.stats.rangeSignals + this.stats.trendSignals,
      rangePercent: this.stats.rangeSignals / (this.stats.rangeSignals + this.stats.trendSignals) * 100 || 0,
      trendPercent: this.stats.trendSignals / (this.stats.rangeSignals + this.stats.trendSignals) * 100 || 0,
    }
  }

  getConfig() {
    return {
      source: 'oi-hybrid',
      timeframe: this.timeframe,
      waspPeriod: this.waspPeriod,
      regimeDetection: {
        adxPeriod: this.adxPeriod,
        rangeThreshold: this.adxRangeThreshold,
        trendThreshold: this.adxTrendThreshold,
        allowTransition: this.allowTransition,
      },
      meanReversion: {
        deviation: this.meanReversionDev,
        strongDeviation: this.meanReversionStrongDev,
        rsiPeriod: this.rsiPeriod,
        rsiOversold: this.rsiOversold,
        rsiOverbought: this.rsiOverbought,
      },
      trendFollowing: {
        breakoutDev: this.trendBreakoutDev,
        momentumBars: this.momentumBars,
        emaPeriod: this.emaPeriod,
      },
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
    }
  }
}
