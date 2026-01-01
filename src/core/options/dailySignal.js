/**
 * Daily Signal Analyzer
 *
 * Produces only 3-4 actionable signals per day:
 * - OPEN_PUT / OPEN_CALL (morning entry opportunities)
 * - CLOSE_PUT / CLOSE_CALL (exit existing positions)
 *
 * Uses confluence of multiple indicators to reduce noise
 */

import {
  calculateRSI,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateSMA,
} from '../patterns/indicators.js'

/**
 * Signal types for daily trading
 */
export const SIGNAL_TYPES = {
  OPEN_PUT: 'OPEN_PUT',       // Enter bearish position
  OPEN_CALL: 'OPEN_CALL',     // Enter bullish position
  CLOSE_PUT: 'CLOSE_PUT',     // Exit bearish position
  CLOSE_CALL: 'CLOSE_CALL',   // Exit bullish position
  HOLD: 'HOLD',               // No action - wait
}

/**
 * Market session times (ET)
 */
const SESSIONS = {
  PRE_MARKET: { start: 4, end: 9.5 },
  MORNING: { start: 9.5, end: 11.5 },      // 9:30 AM - 11:30 AM
  MIDDAY: { start: 11.5, end: 14 },        // 11:30 AM - 2:00 PM
  AFTERNOON: { start: 14, end: 16 },       // 2:00 PM - 4:00 PM
}

/**
 * Configuration for daily signal generation
 */
const CONFIG = {
  // Minimum confluence score to generate signal (out of 100)
  minConfluence: 60,

  // Indicator weights for confluence
  weights: {
    rsi: 25,
    macd: 25,
    ema: 20,
    bollingerBands: 15,
    priceAction: 15,
  },

  // RSI thresholds (tighter than default for daily signals)
  rsiOverbought: 65,
  rsiOversold: 35,
  rsiExtreme: 75,  // Very strong signal
  rsiExtremeOversold: 25,

  // Minimum indicators agreeing
  minIndicatorsAgreeing: 3,

  // Signal cooldown in hours (prevent duplicate signals)
  cooldownHours: 4,
}

/**
 * Daily Signal Analyzer
 * Analyzes market data and produces limited, high-quality signals
 */
export class DailySignalAnalyzer {
  constructor(config = {}) {
    this.config = { ...CONFIG, ...config }
    this.lastSignal = null
    this.lastSignalTime = null
    this.indicators = {}
  }

  /**
   * Analyze candle data and produce daily signal
   * @param {Array} candles - OHLCV candle data
   * @param {string} currentPosition - Current position: 'LONG', 'SHORT', or 'NONE'
   * @returns {Object} Daily signal with action and confidence
   */
  analyze(candles, currentPosition = 'NONE') {
    if (!candles || candles.length < 30) {
      return this.createSignal(SIGNAL_TYPES.HOLD, 0, 'Insufficient data')
    }

    // Calculate all indicators
    this.calculateIndicators(candles)

    // Get individual indicator signals
    const rsiSignal = this.analyzeRSI(candles)
    const macdSignal = this.analyzeMACD(candles)
    const emaSignal = this.analyzeEMA(candles)
    const bbSignal = this.analyzeBollingerBands(candles)
    const priceActionSignal = this.analyzePriceAction(candles)

    // Calculate confluence
    const signals = [rsiSignal, macdSignal, emaSignal, bbSignal, priceActionSignal]
    const confluence = this.calculateConfluence(signals)

    // Determine action based on confluence and current position
    const action = this.determineAction(confluence, currentPosition)

    // Check cooldown
    if (this.isInCooldown(action)) {
      return this.createSignal(
        SIGNAL_TYPES.HOLD,
        confluence.score,
        'Signal in cooldown period',
        confluence
      )
    }

    // Update last signal if actionable
    if (action.type !== SIGNAL_TYPES.HOLD) {
      this.lastSignal = action.type
      this.lastSignalTime = Date.now()
    }

    return this.createSignal(
      action.type,
      confluence.score,
      action.reason,
      confluence
    )
  }

  calculateIndicators(candles) {
    const closes = candles.map(c => c.close)
    const volumes = candles.map(c => c.volume || 0)

    this.indicators = {
      rsi: calculateRSI(closes, 14),
      macd: calculateMACD(closes, 12, 26, 9),
      emaFast: calculateEMA(closes, 8),
      emaSlow: calculateEMA(closes, 21),
      ema50: calculateEMA(closes, 50),
      bb: calculateBollingerBands(closes, 20, 2),
      avgVolume: calculateSMA(volumes, 20),
    }
  }

  /**
   * RSI Analysis
   * Returns: 'BULLISH', 'BEARISH', or 'NEUTRAL' with strength
   */
  analyzeRSI(candles) {
    const rsi = this.indicators.rsi
    if (!rsi || rsi.length === 0) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'RSI' }
    }

    const current = rsi[rsi.length - 1]
    const prev = rsi[rsi.length - 2]

    if (current === null) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'RSI' }
    }

    // Extreme oversold with uptick = strong bullish
    if (current < this.config.rsiExtremeOversold && current > prev) {
      return { direction: 'BULLISH', strength: 100, indicator: 'RSI', value: current }
    }

    // Extreme overbought with downtick = strong bearish
    if (current > this.config.rsiExtreme && current < prev) {
      return { direction: 'BEARISH', strength: 100, indicator: 'RSI', value: current }
    }

    // Oversold = bullish
    if (current < this.config.rsiOversold) {
      const strength = Math.min(100, (this.config.rsiOversold - current) * 4)
      return { direction: 'BULLISH', strength, indicator: 'RSI', value: current }
    }

    // Overbought = bearish
    if (current > this.config.rsiOverbought) {
      const strength = Math.min(100, (current - this.config.rsiOverbought) * 4)
      return { direction: 'BEARISH', strength, indicator: 'RSI', value: current }
    }

    // RSI divergence detection
    if (prev !== null) {
      const lastCandle = candles[candles.length - 1]
      const prevCandle = candles[candles.length - 2]

      // Bullish divergence: price lower low, RSI higher low
      if (lastCandle.low < prevCandle.low && current > prev && current < 50) {
        return { direction: 'BULLISH', strength: 70, indicator: 'RSI', value: current, reason: 'divergence' }
      }

      // Bearish divergence: price higher high, RSI lower high
      if (lastCandle.high > prevCandle.high && current < prev && current > 50) {
        return { direction: 'BEARISH', strength: 70, indicator: 'RSI', value: current, reason: 'divergence' }
      }
    }

    return { direction: 'NEUTRAL', strength: 0, indicator: 'RSI', value: current }
  }

  /**
   * MACD Analysis
   */
  analyzeMACD(candles) {
    const macd = this.indicators.macd
    if (!macd || !macd.macdLine) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'MACD' }
    }

    const lastIdx = macd.macdLine.length - 1
    const prevIdx = lastIdx - 1

    const macdNow = macd.macdLine[lastIdx]
    const signalNow = macd.signalLine[lastIdx]
    const histNow = macd.histogram[lastIdx]
    const macdPrev = macd.macdLine[prevIdx]
    const signalPrev = macd.signalLine[prevIdx]
    const histPrev = macd.histogram[prevIdx]

    if (macdNow === null || signalNow === null) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'MACD' }
    }

    // Bullish crossover (MACD crosses above signal)
    if (macdPrev <= signalPrev && macdNow > signalNow) {
      // Stronger if crossing from below zero
      const strength = macdNow < 0 ? 100 : 70
      return { direction: 'BULLISH', strength, indicator: 'MACD', reason: 'bullish_cross' }
    }

    // Bearish crossover (MACD crosses below signal)
    if (macdPrev >= signalPrev && macdNow < signalNow) {
      // Stronger if crossing from above zero
      const strength = macdNow > 0 ? 100 : 70
      return { direction: 'BEARISH', strength, indicator: 'MACD', reason: 'bearish_cross' }
    }

    // Histogram momentum
    if (histNow !== null && histPrev !== null) {
      // Histogram turning positive
      if (histPrev < 0 && histNow > 0) {
        return { direction: 'BULLISH', strength: 60, indicator: 'MACD', reason: 'histogram_turn' }
      }
      // Histogram turning negative
      if (histPrev > 0 && histNow < 0) {
        return { direction: 'BEARISH', strength: 60, indicator: 'MACD', reason: 'histogram_turn' }
      }

      // Strong existing trend
      if (histNow > 0 && histNow > histPrev) {
        return { direction: 'BULLISH', strength: 40, indicator: 'MACD', reason: 'bullish_momentum' }
      }
      if (histNow < 0 && histNow < histPrev) {
        return { direction: 'BEARISH', strength: 40, indicator: 'MACD', reason: 'bearish_momentum' }
      }
    }

    return { direction: 'NEUTRAL', strength: 0, indicator: 'MACD' }
  }

  /**
   * EMA Analysis
   */
  analyzeEMA(candles) {
    const emaFast = this.indicators.emaFast
    const emaSlow = this.indicators.emaSlow
    const ema50 = this.indicators.ema50

    if (!emaFast || !emaSlow) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'EMA' }
    }

    const lastIdx = emaFast.length - 1
    const prevIdx = lastIdx - 1

    const fastNow = emaFast[lastIdx]
    const slowNow = emaSlow[lastIdx]
    const fastPrev = emaFast[prevIdx]
    const slowPrev = emaSlow[prevIdx]
    const price = candles[candles.length - 1].close

    if (fastNow === null || slowNow === null) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'EMA' }
    }

    // Golden cross (fast crosses above slow)
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { direction: 'BULLISH', strength: 90, indicator: 'EMA', reason: 'golden_cross' }
    }

    // Death cross (fast crosses below slow)
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { direction: 'BEARISH', strength: 90, indicator: 'EMA', reason: 'death_cross' }
    }

    // Price position relative to EMAs
    const aboveBothEMAs = price > fastNow && price > slowNow
    const belowBothEMAs = price < fastNow && price < slowNow
    const emaTrend = fastNow > slowNow ? 'BULLISH' : 'BEARISH'

    // Strong bullish: price above both EMAs and fast > slow
    if (aboveBothEMAs && emaTrend === 'BULLISH') {
      return { direction: 'BULLISH', strength: 50, indicator: 'EMA', reason: 'bullish_structure' }
    }

    // Strong bearish: price below both EMAs and fast < slow
    if (belowBothEMAs && emaTrend === 'BEARISH') {
      return { direction: 'BEARISH', strength: 50, indicator: 'EMA', reason: 'bearish_structure' }
    }

    // Mean reversion potential
    if (ema50 && ema50[lastIdx]) {
      const deviation = (price - ema50[lastIdx]) / ema50[lastIdx]

      // Overextended above EMA50 = bearish reversion
      if (deviation > 0.03) {
        return { direction: 'BEARISH', strength: 40, indicator: 'EMA', reason: 'overextended_up' }
      }

      // Overextended below EMA50 = bullish reversion
      if (deviation < -0.03) {
        return { direction: 'BULLISH', strength: 40, indicator: 'EMA', reason: 'overextended_down' }
      }
    }

    return { direction: 'NEUTRAL', strength: 0, indicator: 'EMA' }
  }

  /**
   * Bollinger Bands Analysis
   */
  analyzeBollingerBands(candles) {
    const bb = this.indicators.bb
    if (!bb || !bb.upper) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'BB' }
    }

    const lastIdx = bb.upper.length - 1
    const upper = bb.upper[lastIdx]
    const lower = bb.lower[lastIdx]
    const middle = bb.middle[lastIdx]
    const candle = candles[candles.length - 1]
    const prevCandle = candles[candles.length - 2]

    if (upper === null || lower === null) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'BB' }
    }

    // Touch upper band with rejection (bearish)
    if (candle.high >= upper && candle.close < candle.open) {
      return { direction: 'BEARISH', strength: 80, indicator: 'BB', reason: 'upper_rejection' }
    }

    // Touch lower band with bounce (bullish)
    if (candle.low <= lower && candle.close > candle.open) {
      return { direction: 'BULLISH', strength: 80, indicator: 'BB', reason: 'lower_bounce' }
    }

    // Price crossing middle band
    if (prevCandle.close < middle && candle.close > middle) {
      return { direction: 'BULLISH', strength: 50, indicator: 'BB', reason: 'cross_middle_up' }
    }
    if (prevCandle.close > middle && candle.close < middle) {
      return { direction: 'BEARISH', strength: 50, indicator: 'BB', reason: 'cross_middle_down' }
    }

    // Band squeeze (low volatility, expect breakout)
    const bandwidth = (upper - lower) / middle
    if (bandwidth < 0.02) {
      // Squeeze detected - direction based on price position
      if (candle.close > middle) {
        return { direction: 'BULLISH', strength: 30, indicator: 'BB', reason: 'squeeze_above' }
      } else {
        return { direction: 'BEARISH', strength: 30, indicator: 'BB', reason: 'squeeze_below' }
      }
    }

    return { direction: 'NEUTRAL', strength: 0, indicator: 'BB' }
  }

  /**
   * Price Action Analysis (candlestick patterns)
   */
  analyzePriceAction(candles) {
    if (candles.length < 5) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'PA' }
    }

    const last = candles[candles.length - 1]
    const prev = candles[candles.length - 2]
    const prev2 = candles[candles.length - 3]

    const bodySize = Math.abs(last.close - last.open)
    const totalRange = last.high - last.low
    const upperWick = last.high - Math.max(last.open, last.close)
    const lowerWick = Math.min(last.open, last.close) - last.low

    if (totalRange === 0) {
      return { direction: 'NEUTRAL', strength: 0, indicator: 'PA' }
    }

    // Bullish engulfing
    if (prev.close < prev.open && // Previous bearish
        last.close > last.open && // Current bullish
        last.open < prev.close &&
        last.close > prev.open) {
      return { direction: 'BULLISH', strength: 85, indicator: 'PA', reason: 'bullish_engulfing' }
    }

    // Bearish engulfing
    if (prev.close > prev.open && // Previous bullish
        last.close < last.open && // Current bearish
        last.open > prev.close &&
        last.close < prev.open) {
      return { direction: 'BEARISH', strength: 85, indicator: 'PA', reason: 'bearish_engulfing' }
    }

    // Hammer (bullish reversal)
    if (lowerWick > bodySize * 2 &&
        upperWick < bodySize * 0.5 &&
        this.isDowntrend(candles)) {
      return { direction: 'BULLISH', strength: 75, indicator: 'PA', reason: 'hammer' }
    }

    // Shooting star (bearish reversal)
    if (upperWick > bodySize * 2 &&
        lowerWick < bodySize * 0.5 &&
        this.isUptrend(candles)) {
      return { direction: 'BEARISH', strength: 75, indicator: 'PA', reason: 'shooting_star' }
    }

    // Morning star (3-candle bullish reversal)
    if (prev2.close < prev2.open && // First bearish
        Math.abs(prev.close - prev.open) < totalRange * 0.3 && // Second small body
        last.close > last.open && // Third bullish
        last.close > (prev2.open + prev2.close) / 2) {
      return { direction: 'BULLISH', strength: 80, indicator: 'PA', reason: 'morning_star' }
    }

    // Evening star (3-candle bearish reversal)
    if (prev2.close > prev2.open && // First bullish
        Math.abs(prev.close - prev.open) < totalRange * 0.3 && // Second small body
        last.close < last.open && // Third bearish
        last.close < (prev2.open + prev2.close) / 2) {
      return { direction: 'BEARISH', strength: 80, indicator: 'PA', reason: 'evening_star' }
    }

    return { direction: 'NEUTRAL', strength: 0, indicator: 'PA' }
  }

  isUptrend(candles, lookback = 5) {
    const recent = candles.slice(-lookback)
    let upCount = 0
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].close > recent[i - 1].close) upCount++
    }
    return upCount >= lookback * 0.6
  }

  isDowntrend(candles, lookback = 5) {
    const recent = candles.slice(-lookback)
    let downCount = 0
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].close < recent[i - 1].close) downCount++
    }
    return downCount >= lookback * 0.6
  }

  /**
   * Calculate confluence score from individual signals
   */
  calculateConfluence(signals) {
    const weights = this.config.weights

    let bullishScore = 0
    let bearishScore = 0
    let bullishCount = 0
    let bearishCount = 0
    const details = []

    for (const signal of signals) {
      const weight = weights[signal.indicator.toLowerCase()] ||
                     weights[this.mapIndicatorName(signal.indicator)] || 15

      if (signal.direction === 'BULLISH') {
        bullishScore += (signal.strength / 100) * weight
        bullishCount++
        details.push({ ...signal, contribution: (signal.strength / 100) * weight })
      } else if (signal.direction === 'BEARISH') {
        bearishScore += (signal.strength / 100) * weight
        bearishCount++
        details.push({ ...signal, contribution: (signal.strength / 100) * weight })
      }
    }

    const direction = bullishScore > bearishScore ? 'BULLISH' :
                     bearishScore > bullishScore ? 'BEARISH' : 'NEUTRAL'

    const dominantScore = Math.max(bullishScore, bearishScore)
    const agreementCount = direction === 'BULLISH' ? bullishCount : bearishCount

    // Score is higher when more indicators agree
    const agreementBonus = agreementCount >= this.config.minIndicatorsAgreeing ? 1.2 : 1.0
    const score = Math.min(100, dominantScore * agreementBonus)

    return {
      direction,
      score: Math.round(score),
      bullishScore: Math.round(bullishScore),
      bearishScore: Math.round(bearishScore),
      bullishCount,
      bearishCount,
      agreementCount,
      meetsThreshold: score >= this.config.minConfluence &&
                      agreementCount >= this.config.minIndicatorsAgreeing,
      details,
    }
  }

  mapIndicatorName(name) {
    const map = {
      'RSI': 'rsi',
      'MACD': 'macd',
      'EMA': 'ema',
      'BB': 'bollingerBands',
      'PA': 'priceAction',
    }
    return map[name] || name.toLowerCase()
  }

  /**
   * Determine trading action based on confluence and position
   */
  determineAction(confluence, currentPosition) {
    // If confluence doesn't meet threshold, hold
    if (!confluence.meetsThreshold) {
      return {
        type: SIGNAL_TYPES.HOLD,
        reason: `Confluence ${confluence.score}% below threshold (${this.config.minConfluence}%) ` +
                `or insufficient agreement (${confluence.agreementCount}/${this.config.minIndicatorsAgreeing})`
      }
    }

    const { direction, score } = confluence

    // ENTRY signals (when not in position)
    if (currentPosition === 'NONE') {
      if (direction === 'BULLISH') {
        return {
          type: SIGNAL_TYPES.OPEN_CALL,
          reason: `Strong bullish confluence (${score}%) - ${confluence.bullishCount} indicators agree`
        }
      }
      if (direction === 'BEARISH') {
        return {
          type: SIGNAL_TYPES.OPEN_PUT,
          reason: `Strong bearish confluence (${score}%) - ${confluence.bearishCount} indicators agree`
        }
      }
    }

    // EXIT signals (when in position)
    if (currentPosition === 'LONG' && direction === 'BEARISH') {
      return {
        type: SIGNAL_TYPES.CLOSE_CALL,
        reason: `Bearish reversal detected (${score}%) - consider closing CALL position`
      }
    }

    if (currentPosition === 'SHORT' && direction === 'BULLISH') {
      return {
        type: SIGNAL_TYPES.CLOSE_PUT,
        reason: `Bullish reversal detected (${score}%) - consider closing PUT position`
      }
    }

    // Already in direction of signal - hold
    if ((currentPosition === 'LONG' && direction === 'BULLISH') ||
        (currentPosition === 'SHORT' && direction === 'BEARISH')) {
      return {
        type: SIGNAL_TYPES.HOLD,
        reason: `Already in ${currentPosition} position - signal confirms trend`
      }
    }

    return {
      type: SIGNAL_TYPES.HOLD,
      reason: 'No actionable signal'
    }
  }

  /**
   * Check if we're in cooldown period for this signal type
   */
  isInCooldown(action) {
    if (action.type === SIGNAL_TYPES.HOLD) return false
    if (!this.lastSignalTime) return false

    const hoursSinceLastSignal = (Date.now() - this.lastSignalTime) / (1000 * 60 * 60)

    // Only cooldown for same signal type
    if (this.lastSignal === action.type && hoursSinceLastSignal < this.config.cooldownHours) {
      return true
    }

    return false
  }

  /**
   * Create signal object
   */
  createSignal(type, score, reason, confluence = null) {
    return {
      type,
      action: this.getActionText(type),
      score,
      reason,
      confluence,
      timestamp: Date.now(),
      session: this.getCurrentSession(),
    }
  }

  getActionText(type) {
    const actions = {
      [SIGNAL_TYPES.OPEN_PUT]: 'Buy PUT',
      [SIGNAL_TYPES.OPEN_CALL]: 'Buy CALL',
      [SIGNAL_TYPES.CLOSE_PUT]: 'Sell PUT',
      [SIGNAL_TYPES.CLOSE_CALL]: 'Sell CALL',
      [SIGNAL_TYPES.HOLD]: 'Wait',
    }
    return actions[type] || 'Wait'
  }

  getCurrentSession() {
    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60

    if (hour >= SESSIONS.MORNING.start && hour < SESSIONS.MORNING.end) return 'MORNING'
    if (hour >= SESSIONS.MIDDAY.start && hour < SESSIONS.MIDDAY.end) return 'MIDDAY'
    if (hour >= SESSIONS.AFTERNOON.start && hour < SESSIONS.AFTERNOON.end) return 'AFTERNOON'
    if (hour >= SESSIONS.PRE_MARKET.start && hour < SESSIONS.PRE_MARKET.end) return 'PRE_MARKET'
    return 'CLOSED'
  }

  /**
   * Get a summary suitable for display
   */
  getSummary(signal) {
    if (signal.type === SIGNAL_TYPES.HOLD) {
      return {
        signal: 'NEUTRAL',
        action: 'Wait for clearer signal',
        strength: signal.score,
        details: signal.reason,
      }
    }

    const direction = signal.type.includes('CALL') ? 'CALL' : 'PUT'
    const isEntry = signal.type.includes('OPEN')

    return {
      signal: direction,
      action: isEntry ? `OPEN ${direction}` : `CLOSE ${direction}`,
      strength: signal.score,
      details: signal.reason,
      indicators: signal.confluence?.details?.filter(d => d.strength > 0) || [],
    }
  }
}

export default DailySignalAnalyzer
