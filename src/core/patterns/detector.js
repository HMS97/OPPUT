/**
 * Balanced Pattern Recognition Library
 * Detects both PUT (bearish) and CALL (bullish) trading opportunities
 * Enhanced with RSI, Bollinger Bands, EMA, MACD, and Volume analysis
 */

import {
  calculateRSI,
  calculateBollingerBands,
  calculateEMA,
  calculateSMA,
  calculateMACD,
} from './indicators.js'

/**
 * Default configuration for pattern detection
 */
const DEFAULT_CONFIG = {
  rejectionThreshold: 0.003,
  consolidationBars: 3,
  lowerHighTolerance: 0.001,
  higherLowTolerance: 0.001,
  falseBreakoutThreshold: 0.002,
  // RSI settings
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  // Bollinger Bands settings
  bbPeriod: 20,
  bbStdDev: 2,
  // EMA settings
  emaFast: 8,
  emaSlow: 21,
  // MACD settings
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  // Volume settings
  volumeSpikeMult: 1.5,
}

export class PatternDetector {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.patterns = []
    this.putPatterns = []
    this.callPatterns = []
    this.indicators = {}
  }

  /**
   * Analyze candle data and detect both PUT and CALL patterns
   * @param {Array<{open: number, high: number, low: number, close: number, time: number, volume?: number}>} candles
   * @returns {Array} Detected patterns with signals
   */
  analyze(candles) {
    if (!candles || candles.length < 10) return []

    this.patterns = []
    this.putPatterns = []
    this.callPatterns = []
    this.indicators = {}

    // Calculate technical indicators first
    this.calculateIndicators(candles)

    // Run all pattern detectors for both directions
    this.detectLowerHigh(candles) // PUT signal
    this.detectHigherLow(candles) // CALL signal
    this.detectRejectionAtResistance(candles) // PUT signal
    this.detectRejectionAtSupport(candles) // CALL signal
    this.detectFalseBreakoutUp(candles) // PUT signal
    this.detectFalseBreakoutDown(candles) // CALL signal
    this.detectAbsorptionSelling(candles) // PUT signal
    this.detectAbsorptionBuying(candles) // CALL signal
    this.detectDoubleRejectionTop(candles) // PUT signal
    this.detectDoubleRejectionBottom(candles) // CALL signal
    this.detectPriceStallingHigh(candles) // PUT signal
    this.detectPriceStallingLow(candles) // CALL signal

    // Indicator-based patterns
    this.detectRSISignals(candles)
    this.detectBollingerSignals(candles)
    this.detectEMACrossover(candles)
    this.detectMACDSignals(candles)
    this.detectVolumeSpike(candles)

    return this.patterns
  }

  calculateIndicators(candles) {
    const closes = candles.map((c) => c.close)
    const volumes = candles.map((c) => c.volume || 0)

    this.indicators.rsi = calculateRSI(closes, this.config.rsiPeriod)
    this.indicators.bb = calculateBollingerBands(
      closes,
      this.config.bbPeriod,
      this.config.bbStdDev
    )
    this.indicators.emaFast = calculateEMA(closes, this.config.emaFast)
    this.indicators.emaSlow = calculateEMA(closes, this.config.emaSlow)
    this.indicators.macd = calculateMACD(
      closes,
      this.config.macdFast,
      this.config.macdSlow,
      this.config.macdSignal
    )
    this.indicators.avgVolume = calculateSMA(volumes, 20)
  }

  // ==================== PRICE ACTION PATTERNS ====================

  detectLowerHigh(candles) {
    const swingHighs = this.findSwingHighs(candles, 5)

    for (let i = 1; i < swingHighs.length; i++) {
      const prevHigh = swingHighs[i - 1]
      const currHigh = swingHighs[i]

      if (
        currHigh.high <
        prevHigh.high * (1 - this.config.lowerHighTolerance)
      ) {
        const pattern = {
          type: 'LOWER_HIGH',
          name: 'Lower High',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: currHigh.index,
          price: currHigh.high,
          description: 'Price forms lower high - weakening upward momentum',
          stopLoss: prevHigh.high,
          entry: currHigh.close,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectHigherLow(candles) {
    const swingLows = this.findSwingLows(candles, 5)

    for (let i = 1; i < swingLows.length; i++) {
      const prevLow = swingLows[i - 1]
      const currLow = swingLows[i]

      if (currLow.low > prevLow.low * (1 + this.config.higherLowTolerance)) {
        const pattern = {
          type: 'HIGHER_LOW',
          name: 'Higher Low',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: currLow.index,
          price: currLow.low,
          description: 'Price forms higher low - strengthening upward momentum',
          stopLoss: prevLow.low,
          entry: currLow.close,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }
    }
  }

  detectRejectionAtResistance(candles) {
    const resistanceLevels = this.findResistanceLevels(candles)

    for (let i = 5; i < candles.length; i++) {
      const candle = candles[i]
      const upperWick = candle.high - Math.max(candle.open, candle.close)
      const totalRange = candle.high - candle.low

      if (totalRange === 0) continue

      const wickRatio = upperWick / totalRange

      for (const resistance of resistanceLevels) {
        if (
          candle.high >= resistance * 0.998 &&
          candle.high <= resistance * 1.002 &&
          wickRatio > 0.6
        ) {
          const pattern = {
            type: 'REJECTION_AT_RESISTANCE',
            name: 'Rejection at Resistance',
            signal: 'PUT',
            strength: 'HIGH',
            index: i,
            price: candle.high,
            description: 'Price rejected at resistance level',
            stopLoss: candle.high * 1.002,
            entry: candle.close,
          }
          this.patterns.push(pattern)
          this.putPatterns.push(pattern)
        }
      }
    }
  }

  detectRejectionAtSupport(candles) {
    const supportLevels = this.findSupportLevels(candles)

    for (let i = 5; i < candles.length; i++) {
      const candle = candles[i]
      const lowerWick = Math.min(candle.open, candle.close) - candle.low
      const totalRange = candle.high - candle.low

      if (totalRange === 0) continue

      const wickRatio = lowerWick / totalRange

      for (const support of supportLevels) {
        if (
          candle.low <= support * 1.002 &&
          candle.low >= support * 0.998 &&
          wickRatio > 0.6
        ) {
          const pattern = {
            type: 'REJECTION_AT_SUPPORT',
            name: 'Rejection at Support',
            signal: 'CALL',
            strength: 'HIGH',
            index: i,
            price: candle.low,
            description: 'Price rejected at support level - bullish bounce',
            stopLoss: candle.low * 0.998,
            entry: candle.close,
          }
          this.patterns.push(pattern)
          this.callPatterns.push(pattern)
        }
      }
    }
  }

  detectFalseBreakoutUp(candles) {
    const resistanceLevels = this.findResistanceLevels(candles)

    for (let i = 5; i < candles.length - 1; i++) {
      const candle = candles[i]
      const nextCandle = candles[i + 1]

      for (const resistance of resistanceLevels) {
        if (candle.high > resistance * 1.002) {
          if (
            candle.close < resistance ||
            (nextCandle &&
              nextCandle.close < nextCandle.open &&
              nextCandle.close < resistance)
          ) {
            const pattern = {
              type: 'FALSE_BREAKOUT',
              name: 'False Breakout Up',
              signal: 'PUT',
              strength: 'HIGH',
              index: i,
              price: candle.high,
              description: 'Failed upward breakout - price reverses down',
              stopLoss: candle.high * 1.003,
              entry: nextCandle ? nextCandle.open : candle.close,
            }
            this.patterns.push(pattern)
            this.putPatterns.push(pattern)
          }
        }
      }
    }
  }

  detectFalseBreakoutDown(candles) {
    const supportLevels = this.findSupportLevels(candles)

    for (let i = 5; i < candles.length - 1; i++) {
      const candle = candles[i]
      const nextCandle = candles[i + 1]

      for (const support of supportLevels) {
        if (candle.low < support * 0.998) {
          if (
            candle.close > support ||
            (nextCandle &&
              nextCandle.close > nextCandle.open &&
              nextCandle.close > support)
          ) {
            const pattern = {
              type: 'FALSE_BREAKOUT_DOWN',
              name: 'False Breakout Down',
              signal: 'CALL',
              strength: 'HIGH',
              index: i,
              price: candle.low,
              description: 'Failed downward breakout - price reverses up',
              stopLoss: candle.low * 0.997,
              entry: nextCandle ? nextCandle.open : candle.close,
            }
            this.patterns.push(pattern)
            this.callPatterns.push(pattern)
          }
        }
      }
    }
  }

  detectAbsorptionSelling(candles) {
    for (let i = 3; i < candles.length; i++) {
      const recentCandles = candles.slice(i - 3, i + 1)
      let absorptionCount = 0

      for (const candle of recentCandles) {
        const upperWick = candle.high - Math.max(candle.open, candle.close)
        const totalRange = candle.high - candle.low

        if (totalRange > 0 && upperWick / totalRange > 0.5) {
          absorptionCount++
        }
      }

      if (absorptionCount >= 2) {
        const candle = candles[i]
        const pattern = {
          type: 'ABSORPTION',
          name: 'Selling Absorption',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candle.high,
          description: 'Multiple upper wicks show selling pressure',
          stopLoss: Math.max(...recentCandles.map((c) => c.high)) * 1.002,
          entry: candle.close,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectAbsorptionBuying(candles) {
    for (let i = 3; i < candles.length; i++) {
      const recentCandles = candles.slice(i - 3, i + 1)
      let absorptionCount = 0

      for (const candle of recentCandles) {
        const lowerWick = Math.min(candle.open, candle.close) - candle.low
        const totalRange = candle.high - candle.low

        if (totalRange > 0 && lowerWick / totalRange > 0.5) {
          absorptionCount++
        }
      }

      if (absorptionCount >= 2) {
        const candle = candles[i]
        const pattern = {
          type: 'ABSORPTION_BUYING',
          name: 'Buying Absorption',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: i,
          price: candle.low,
          description: 'Multiple lower wicks show buying pressure',
          stopLoss: Math.min(...recentCandles.map((c) => c.low)) * 0.998,
          entry: candle.close,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }
    }
  }

  detectDoubleRejectionTop(candles) {
    const rejections = []

    for (let i = 2; i < candles.length; i++) {
      const candle = candles[i]
      const upperWick = candle.high - Math.max(candle.open, candle.close)
      const totalRange = candle.high - candle.low

      if (totalRange > 0 && upperWick / totalRange > 0.5) {
        rejections.push({ index: i, high: candle.high, close: candle.close })
      }
    }

    for (let i = 1; i < rejections.length; i++) {
      const prev = rejections[i - 1]
      const curr = rejections[i]
      const priceDiff = Math.abs(curr.high - prev.high) / prev.high

      if (priceDiff < 0.005 && curr.index - prev.index < 20) {
        const pattern = {
          type: 'DOUBLE_REJECTION',
          name: 'Double Top Rejection',
          signal: 'PUT',
          strength: 'VERY_HIGH',
          index: curr.index,
          price: curr.high,
          description: 'Price rejected twice at similar level - strong bearish',
          stopLoss: Math.max(prev.high, curr.high) * 1.002,
          entry: curr.close,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectDoubleRejectionBottom(candles) {
    const rejections = []

    for (let i = 2; i < candles.length; i++) {
      const candle = candles[i]
      const lowerWick = Math.min(candle.open, candle.close) - candle.low
      const totalRange = candle.high - candle.low

      if (totalRange > 0 && lowerWick / totalRange > 0.5) {
        rejections.push({ index: i, low: candle.low, close: candle.close })
      }
    }

    for (let i = 1; i < rejections.length; i++) {
      const prev = rejections[i - 1]
      const curr = rejections[i]
      const priceDiff = Math.abs(curr.low - prev.low) / prev.low

      if (priceDiff < 0.005 && curr.index - prev.index < 20) {
        const pattern = {
          type: 'DOUBLE_REJECTION_BOTTOM',
          name: 'Double Bottom Rejection',
          signal: 'CALL',
          strength: 'VERY_HIGH',
          index: curr.index,
          price: curr.low,
          description: 'Price rejected twice at similar low - strong bullish',
          stopLoss: Math.min(prev.low, curr.low) * 0.998,
          entry: curr.close,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }
    }
  }

  detectPriceStallingHigh(candles) {
    for (let i = this.config.consolidationBars; i < candles.length; i++) {
      const recentCandles = candles.slice(i - this.config.consolidationBars, i + 1)
      const highs = recentCandles.map((c) => c.high)
      const lows = recentCandles.map((c) => c.low)

      const highestHigh = Math.max(...highs)
      const lowestLow = Math.min(...lows)
      const avgClose =
        recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length

      const rangePercent = (highestHigh - lowestLow) / avgClose
      const lookback = Math.min(50, candles.length)
      const recentHighest = Math.max(
        ...candles.slice(Math.max(0, i - lookback), i).map((c) => c.high)
      )

      if (rangePercent < 0.01 && highestHigh > recentHighest * 0.995) {
        const pattern = {
          type: 'PRICE_STALLING',
          name: 'Stalling at High',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candles[i].close,
          description: 'Price stalling at highs - may reverse down',
          stopLoss: highestHigh * 1.003,
          entry: lowestLow,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectPriceStallingLow(candles) {
    for (let i = this.config.consolidationBars; i < candles.length; i++) {
      const recentCandles = candles.slice(i - this.config.consolidationBars, i + 1)
      const highs = recentCandles.map((c) => c.high)
      const lows = recentCandles.map((c) => c.low)

      const highestHigh = Math.max(...highs)
      const lowestLow = Math.min(...lows)
      const avgClose =
        recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length

      const rangePercent = (highestHigh - lowestLow) / avgClose
      const lookback = Math.min(50, candles.length)
      const recentLowest = Math.min(
        ...candles.slice(Math.max(0, i - lookback), i).map((c) => c.low)
      )

      if (rangePercent < 0.01 && lowestLow < recentLowest * 1.005) {
        const pattern = {
          type: 'PRICE_STALLING_LOW',
          name: 'Stalling at Low',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: i,
          price: candles[i].close,
          description: 'Price stalling at lows - may reverse up',
          stopLoss: lowestLow * 0.997,
          entry: highestHigh,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }
    }
  }

  // ==================== INDICATOR-BASED PATTERNS ====================

  detectRSISignals(candles) {
    const rsi = this.indicators.rsi
    if (!rsi || rsi.length === 0) return

    const lastIdx = candles.length - 1
    const currentRSI = rsi[lastIdx]
    const prevRSI = rsi[lastIdx - 1]

    if (currentRSI === null) return

    if (currentRSI > this.config.rsiOverbought) {
      const pattern = {
        type: 'RSI_OVERBOUGHT',
        name: 'RSI Overbought',
        signal: 'PUT',
        strength: currentRSI >= 80 ? 'HIGH' : 'MEDIUM',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: `RSI at ${currentRSI.toFixed(1)} - overbought territory`,
        indicatorValue: currentRSI,
      }
      this.patterns.push(pattern)
      this.putPatterns.push(pattern)
    }

    if (currentRSI < this.config.rsiOversold) {
      const pattern = {
        type: 'RSI_OVERSOLD',
        name: 'RSI Oversold',
        signal: 'CALL',
        strength: currentRSI <= 20 ? 'HIGH' : 'MEDIUM',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: `RSI at ${currentRSI.toFixed(1)} - oversold territory`,
        indicatorValue: currentRSI,
      }
      this.patterns.push(pattern)
      this.callPatterns.push(pattern)
    }

    // RSI Divergences
    if (
      prevRSI !== null &&
      currentRSI < prevRSI &&
      candles[lastIdx].high > candles[lastIdx - 1].high
    ) {
      if (currentRSI > 50 && prevRSI > 60) {
        const pattern = {
          type: 'RSI_BEARISH_DIVERGENCE',
          name: 'RSI Bearish Divergence',
          signal: 'PUT',
          strength: 'HIGH',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'Price making higher high but RSI making lower high',
          indicatorValue: currentRSI,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }

    if (
      prevRSI !== null &&
      currentRSI > prevRSI &&
      candles[lastIdx].low < candles[lastIdx - 1].low
    ) {
      if (currentRSI < 50 && prevRSI < 40) {
        const pattern = {
          type: 'RSI_BULLISH_DIVERGENCE',
          name: 'RSI Bullish Divergence',
          signal: 'CALL',
          strength: 'HIGH',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'Price making lower low but RSI making higher low',
          indicatorValue: currentRSI,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }
    }
  }

  detectBollingerSignals(candles) {
    const bb = this.indicators.bb
    if (!bb || !bb.upper) return

    const lastIdx = candles.length - 1
    const candle = candles[lastIdx]
    const upper = bb.upper[lastIdx]
    const lower = bb.lower[lastIdx]
    const middle = bb.middle[lastIdx]

    if (upper === null || lower === null) return

    if (candle.high >= upper) {
      const strength = candle.close < candle.open ? 'HIGH' : 'MEDIUM'
      const pattern = {
        type: 'BB_UPPER_TOUCH',
        name: 'Bollinger Upper Touch',
        signal: 'PUT',
        strength,
        index: lastIdx,
        price: candle.close,
        description: 'Price touching upper Bollinger Band - potential reversal down',
        indicatorValue: { upper, middle, lower },
      }
      this.patterns.push(pattern)
      this.putPatterns.push(pattern)
    }

    if (candle.low <= lower) {
      const strength = candle.close > candle.open ? 'HIGH' : 'MEDIUM'
      const pattern = {
        type: 'BB_LOWER_TOUCH',
        name: 'Bollinger Lower Touch',
        signal: 'CALL',
        strength,
        index: lastIdx,
        price: candle.close,
        description: 'Price touching lower Bollinger Band - potential reversal up',
        indicatorValue: { upper, middle, lower },
      }
      this.patterns.push(pattern)
      this.callPatterns.push(pattern)
    }

    // BB Squeeze
    const bandWidth = (upper - lower) / middle
    if (bandWidth < 0.02) {
      if (candle.close > middle) {
        const pattern = {
          type: 'BB_SQUEEZE_BULLISH',
          name: 'BB Squeeze Bullish',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: lastIdx,
          price: candle.close,
          description: 'Low volatility squeeze - price above middle band',
          indicatorValue: bandWidth,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      } else {
        const pattern = {
          type: 'BB_SQUEEZE_BEARISH',
          name: 'BB Squeeze Bearish',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: lastIdx,
          price: candle.close,
          description: 'Low volatility squeeze - price below middle band',
          indicatorValue: bandWidth,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectEMACrossover(candles) {
    const emaFast = this.indicators.emaFast
    const emaSlow = this.indicators.emaSlow

    if (!emaFast || !emaSlow) return

    const lastIdx = candles.length - 1
    const prevIdx = lastIdx - 1

    const fastNow = emaFast[lastIdx]
    const slowNow = emaSlow[lastIdx]
    const fastPrev = emaFast[prevIdx]
    const slowPrev = emaSlow[prevIdx]

    if (
      fastNow === null ||
      slowNow === null ||
      fastPrev === null ||
      slowPrev === null
    )
      return

    if (fastPrev <= slowPrev && fastNow > slowNow) {
      const pattern = {
        type: 'EMA_BULLISH_CROSS',
        name: 'EMA Bullish Crossover',
        signal: 'CALL',
        strength: 'HIGH',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: `EMA ${this.config.emaFast} crossed above EMA ${this.config.emaSlow}`,
        indicatorValue: { fast: fastNow, slow: slowNow },
      }
      this.patterns.push(pattern)
      this.callPatterns.push(pattern)
    }

    if (fastPrev >= slowPrev && fastNow < slowNow) {
      const pattern = {
        type: 'EMA_BEARISH_CROSS',
        name: 'EMA Bearish Crossover',
        signal: 'PUT',
        strength: 'HIGH',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: `EMA ${this.config.emaFast} crossed below EMA ${this.config.emaSlow}`,
        indicatorValue: { fast: fastNow, slow: slowNow },
      }
      this.patterns.push(pattern)
      this.putPatterns.push(pattern)
    }

    // Overextended from EMA
    const priceDiff = (candles[lastIdx].close - slowNow) / slowNow
    if (priceDiff > 0.02) {
      const pattern = {
        type: 'EMA_OVEREXTENDED_UP',
        name: 'Price Overextended Up',
        signal: 'PUT',
        strength: 'LOW',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: 'Price extended above moving averages - potential pullback',
        indicatorValue: priceDiff * 100,
      }
      this.patterns.push(pattern)
      this.putPatterns.push(pattern)
    } else if (priceDiff < -0.02) {
      const pattern = {
        type: 'EMA_OVEREXTENDED_DOWN',
        name: 'Price Overextended Down',
        signal: 'CALL',
        strength: 'LOW',
        index: lastIdx,
        price: candles[lastIdx].close,
        description: 'Price extended below moving averages - potential bounce',
        indicatorValue: priceDiff * 100,
      }
      this.patterns.push(pattern)
      this.callPatterns.push(pattern)
    }
  }

  detectMACDSignals(candles) {
    const macd = this.indicators.macd
    if (!macd || !macd.macdLine) return

    const lastIdx = candles.length - 1
    const prevIdx = lastIdx - 1

    const macdNow = macd.macdLine[lastIdx]
    const signalNow = macd.signalLine[lastIdx]
    const macdPrev = macd.macdLine[prevIdx]
    const signalPrev = macd.signalLine[prevIdx]
    const histNow = macd.histogram[lastIdx]
    const histPrev = macd.histogram[prevIdx]

    if (macdNow === null || signalNow === null) return

    if (macdPrev !== null && signalPrev !== null) {
      if (macdPrev <= signalPrev && macdNow > signalNow) {
        const pattern = {
          type: 'MACD_BULLISH_CROSS',
          name: 'MACD Bullish Crossover',
          signal: 'CALL',
          strength: macdNow < 0 ? 'HIGH' : 'MEDIUM',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'MACD line crossed above signal line',
          indicatorValue: { macd: macdNow, signal: signalNow },
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }

      if (macdPrev >= signalPrev && macdNow < signalNow) {
        const pattern = {
          type: 'MACD_BEARISH_CROSS',
          name: 'MACD Bearish Crossover',
          signal: 'PUT',
          strength: macdNow > 0 ? 'HIGH' : 'MEDIUM',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'MACD line crossed below signal line',
          indicatorValue: { macd: macdNow, signal: signalNow },
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }

    // Histogram momentum shift
    if (histNow !== null && histPrev !== null) {
      if (histPrev < 0 && histNow > 0) {
        const pattern = {
          type: 'MACD_HIST_BULLISH',
          name: 'MACD Momentum Shift Up',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'MACD histogram turned positive',
          indicatorValue: histNow,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      }

      if (histPrev > 0 && histNow < 0) {
        const pattern = {
          type: 'MACD_HIST_BEARISH',
          name: 'MACD Momentum Shift Down',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: lastIdx,
          price: candles[lastIdx].close,
          description: 'MACD histogram turned negative',
          indicatorValue: histNow,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  detectVolumeSpike(candles) {
    const avgVolume = this.indicators.avgVolume
    if (!avgVolume) return

    const lastIdx = candles.length - 1
    const candle = candles[lastIdx]
    const avg = avgVolume[lastIdx]

    if (avg === null || !candle.volume) return

    const volumeRatio = candle.volume / avg

    if (volumeRatio >= this.config.volumeSpikeMult) {
      const isBullish = candle.close > candle.open

      if (isBullish) {
        const pattern = {
          type: 'VOLUME_SPIKE_BULLISH',
          name: 'High Volume Bullish',
          signal: 'CALL',
          strength: volumeRatio >= 2 ? 'HIGH' : 'MEDIUM',
          index: lastIdx,
          price: candle.close,
          description: `Volume ${volumeRatio.toFixed(1)}x average with bullish candle`,
          indicatorValue: volumeRatio,
        }
        this.patterns.push(pattern)
        this.callPatterns.push(pattern)
      } else {
        const pattern = {
          type: 'VOLUME_SPIKE_BEARISH',
          name: 'High Volume Bearish',
          signal: 'PUT',
          strength: volumeRatio >= 2 ? 'HIGH' : 'MEDIUM',
          index: lastIdx,
          price: candle.close,
          description: `Volume ${volumeRatio.toFixed(1)}x average with bearish candle`,
          indicatorValue: volumeRatio,
        }
        this.patterns.push(pattern)
        this.putPatterns.push(pattern)
      }
    }
  }

  // ==================== HELPER FUNCTIONS ====================

  findSwingHighs(candles, lookback = 5) {
    const swingHighs = []

    for (let i = lookback; i < candles.length - lookback; i++) {
      const candle = candles[i]
      let isSwingHigh = true

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].high >= candle.high) {
          isSwingHigh = false
          break
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          high: candle.high,
          close: candle.close,
          time: candle.time,
        })
      }
    }

    return swingHighs
  }

  findSwingLows(candles, lookback = 5) {
    const swingLows = []

    for (let i = lookback; i < candles.length - lookback; i++) {
      const candle = candles[i]
      let isSwingLow = true

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].low <= candle.low) {
          isSwingLow = false
          break
        }
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          low: candle.low,
          close: candle.close,
          time: candle.time,
        })
      }
    }

    return swingLows
  }

  findResistanceLevels(candles) {
    const levels = []
    const swingHighs = this.findSwingHighs(candles, 3)

    for (const sh of swingHighs) {
      let foundCluster = false

      for (let i = 0; i < levels.length; i++) {
        if (Math.abs(sh.high - levels[i]) / levels[i] < 0.003) {
          levels[i] = (levels[i] + sh.high) / 2
          foundCluster = true
          break
        }
      }

      if (!foundCluster) {
        levels.push(sh.high)
      }
    }

    return levels
  }

  findSupportLevels(candles) {
    const levels = []
    const swingLows = this.findSwingLows(candles, 3)

    for (const sl of swingLows) {
      let foundCluster = false

      for (let i = 0; i < levels.length; i++) {
        if (Math.abs(sl.low - levels[i]) / levels[i] < 0.003) {
          levels[i] = (levels[i] + sl.low) / 2
          foundCluster = true
          break
        }
      }

      if (!foundCluster) {
        levels.push(sl.low)
      }
    }

    return levels
  }

  /**
   * Get signal summary - determines PUT or CALL based on pattern weights
   */
  getSignalSummary() {
    if (this.patterns.length === 0) {
      return {
        signal: 'NONE',
        strength: 0,
        patterns: [],
        direction: 'NEUTRAL',
        indicators: this.getIndicatorSummary(),
      }
    }

    const strengthWeights = {
      VERY_HIGH: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    }

    let putWeight = 0
    let putIndicatorCount = 0
    for (const pattern of this.putPatterns) {
      putWeight += strengthWeights[pattern.strength] || 1
      if (
        pattern.type.startsWith('RSI_') ||
        pattern.type.startsWith('BB_') ||
        pattern.type.startsWith('EMA_') ||
        pattern.type.startsWith('MACD_') ||
        pattern.type.startsWith('VOLUME_')
      ) {
        putIndicatorCount++
      }
    }

    let callWeight = 0
    let callIndicatorCount = 0
    for (const pattern of this.callPatterns) {
      callWeight += strengthWeights[pattern.strength] || 1
      if (
        pattern.type.startsWith('RSI_') ||
        pattern.type.startsWith('BB_') ||
        pattern.type.startsWith('EMA_') ||
        pattern.type.startsWith('MACD_') ||
        pattern.type.startsWith('VOLUME_')
      ) {
        callIndicatorCount++
      }
    }

    const indicatorBonus =
      Math.max(putIndicatorCount, callIndicatorCount) >= 3
        ? 1.25
        : Math.max(putIndicatorCount, callIndicatorCount) >= 2
          ? 1.15
          : 1.0

    const totalWeight = putWeight + callWeight
    const netWeight = putWeight - callWeight

    let signal, direction
    if (Math.abs(netWeight) < 1) {
      signal = 'NEUTRAL'
      direction = 'NEUTRAL'
    } else if (netWeight > 0) {
      signal = putWeight > 6 ? 'STRONG_PUT' : 'PUT'
      direction = 'PUT'
    } else {
      signal = callWeight > 6 ? 'STRONG_CALL' : 'CALL'
      direction = 'CALL'
    }

    const dominantWeight = Math.max(putWeight, callWeight)
    const patternCount =
      direction === 'PUT'
        ? this.putPatterns.length
        : direction === 'CALL'
          ? this.callPatterns.length
          : this.patterns.length

    const dominanceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0
    const baseStrength =
      patternCount > 0 ? (dominantWeight / patternCount) * 25 : 0
    const normalizedStrength = Math.min(
      100,
      baseStrength * dominanceRatio * 2 * indicatorBonus
    )

    const indicatorSummary = this.getIndicatorSummary()

    return {
      signal,
      strength: normalizedStrength,
      patterns: this.patterns,
      direction,
      putWeight,
      callWeight,
      putIndicatorCount,
      callIndicatorCount,
      indicatorBonus,
      indicators: indicatorSummary,
      recommendation: this.getRecommendation(
        normalizedStrength,
        direction,
        indicatorSummary
      ),
    }
  }

  getIndicatorSummary() {
    const summary = {}

    if (this.indicators.rsi && this.indicators.rsi.length > 0) {
      const lastRSI = this.indicators.rsi[this.indicators.rsi.length - 1]
      if (lastRSI !== null) {
        summary.rsi = {
          value: lastRSI,
          status:
            lastRSI > 70 ? 'OVERBOUGHT' : lastRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
        }
      }
    }

    if (this.indicators.bb && this.indicators.bb.upper) {
      const lastIdx = this.indicators.bb.upper.length - 1
      if (this.indicators.bb.upper[lastIdx] !== null) {
        summary.bollingerBands = {
          upper: this.indicators.bb.upper[lastIdx],
          middle: this.indicators.bb.middle[lastIdx],
          lower: this.indicators.bb.lower[lastIdx],
        }
      }
    }

    if (this.indicators.emaFast && this.indicators.emaSlow) {
      const lastIdx = this.indicators.emaFast.length - 1
      const fast = this.indicators.emaFast[lastIdx]
      const slow = this.indicators.emaSlow[lastIdx]
      if (fast !== null && slow !== null) {
        summary.ema = {
          fast,
          slow,
          trend: fast > slow ? 'BULLISH' : fast < slow ? 'BEARISH' : 'NEUTRAL',
        }
      }
    }

    if (this.indicators.macd && this.indicators.macd.macdLine) {
      const lastIdx = this.indicators.macd.macdLine.length - 1
      const macdVal = this.indicators.macd.macdLine[lastIdx]
      const signalVal = this.indicators.macd.signalLine[lastIdx]
      const histVal = this.indicators.macd.histogram[lastIdx]
      if (macdVal !== null) {
        summary.macd = {
          macd: macdVal,
          signal: signalVal,
          histogram: histVal,
          momentum:
            histVal > 0 ? 'BULLISH' : histVal < 0 ? 'BEARISH' : 'NEUTRAL',
        }
      }
    }

    return summary
  }

  getRecommendation(strength, direction, indicators = {}) {
    if (direction === 'NEUTRAL') {
      return 'No clear direction - wait for stronger signal.'
    }

    const dirLabel = direction === 'PUT' ? 'short/PUT' : 'long/CALL'
    let recommendation = ''

    if (strength >= 75) {
      recommendation = `Strong ${dirLabel} signal! Consider entry.`
    } else if (strength >= 50) {
      recommendation = `Clear ${dirLabel} signal - consider position.`
    } else if (strength >= 25) {
      recommendation = `Weak ${dirLabel} signal - wait for confirmation.`
    } else {
      recommendation = 'Signal too weak - continue monitoring.'
    }

    const contexts = []
    if (indicators.rsi) {
      if (direction === 'PUT' && indicators.rsi.status === 'OVERBOUGHT') {
        contexts.push('RSI confirms overbought')
      } else if (direction === 'CALL' && indicators.rsi.status === 'OVERSOLD') {
        contexts.push('RSI confirms oversold')
      }
    }
    if (indicators.ema) {
      if (
        (direction === 'PUT' && indicators.ema.trend === 'BEARISH') ||
        (direction === 'CALL' && indicators.ema.trend === 'BULLISH')
      ) {
        contexts.push('EMA trend aligned')
      }
    }
    if (indicators.macd) {
      if (
        (direction === 'PUT' && indicators.macd.momentum === 'BEARISH') ||
        (direction === 'CALL' && indicators.macd.momentum === 'BULLISH')
      ) {
        contexts.push('MACD momentum confirms')
      }
    }

    if (contexts.length > 0) {
      recommendation += ` (${contexts.join(', ')})`
    }

    return recommendation
  }
}

// Backwards compatibility alias
export const PutPatternDetector = PatternDetector
