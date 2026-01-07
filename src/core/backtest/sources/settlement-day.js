/**
 * Settlement Day Signal Source (大结算日作战卡)
 *
 * Based on the "Major Settlement Day Hourly Playbook" strategy:
 * - Core rule: "Don't buy the dip, buy when selling pressure recedes"
 * - Targets: SPY, QQQ, Gold futures (best to worst: Gold > QQQ > SPY)
 * - Usage: Large-scale bond settlement days, month-end, quarter-end
 *
 * Time Windows (Pacific Time / Eastern Time):
 * - 05:15-05:30 PT (08:15-08:30 ET): Early SRF check
 * - 05:30-06:30 PT (08:30-09:30 ET): First cash pressure wave
 * - 06:30-07:15 PT (09:30-10:15 ET): ENTRY ZONE - first low point
 * - 07:15-08:30 PT (10:15-11:30 ET): Cash pressure easing
 * - 08:45-09:15 PT (11:45-12:15 ET): ON RRP positioning
 * - 09:45-10:15 PT (12:45-01:15 ET): ON RRP window
 * - 10:30-10:45 PT (01:30-01:45 ET): Afternoon SRF
 * - 11:30 PT (02:30 ET): Post-issuance window
 * - 12:15-12:30 PT (03:15-03:30 ET): NOISE ZONE - avoid trading
 * - 01:00-01:30 PT (04:00-04:30 ET): Final balance sheet cleanup
 *
 * Key Indicators (proxied):
 * - ES-SPY basis → Intraday momentum divergence
 * - 10Y TIPS real yield → VIX/volatility regime
 * - DXY → Not directly available, use price trend
 * - SRF/ON RRP → Settlement day calendar + time windows
 *
 * Settlement Days:
 * - 3rd Friday of month (Options Expiration)
 * - Last trading day of month (Month-end)
 * - Last trading day of quarter (Quarter-end - strongest)
 */

import {
  calculateSMA,
  calculateRSI,
  calculateATRArray,
  calculateBollingerPercentB
} from '../../patterns/indicators.js'

/**
 * Check if a date is a settlement day
 * @param {Date} date
 * @returns {Object} { isSettlement, type, strength }
 */
function checkSettlementDay(date) {
  const d = new Date(date)
  const dayOfWeek = d.getDay() // 0=Sun, 5=Fri
  const dayOfMonth = d.getDate()
  const month = d.getMonth()
  const year = d.getFullYear()

  // Get last day of month
  const lastDay = new Date(year, month + 1, 0).getDate()

  // Check options expiration (3rd Friday)
  // Third Friday is between day 15-21 and is a Friday
  const isThirdFriday = dayOfWeek === 5 && dayOfMonth >= 15 && dayOfMonth <= 21

  // Check month-end (last 2 trading days)
  const isMonthEnd = dayOfMonth >= lastDay - 2

  // Check quarter-end (March, June, September, December)
  const isQuarterEndMonth = [2, 5, 8, 11].includes(month)
  const isQuarterEnd = isMonthEnd && isQuarterEndMonth

  // Determine settlement type and strength
  if (isQuarterEnd && isThirdFriday) {
    // Quad witching - maximum settlement pressure
    return { isSettlement: true, type: 'QUAD_WITCH', strength: 100 }
  } else if (isQuarterEnd) {
    return { isSettlement: true, type: 'QUARTER_END', strength: 90 }
  } else if (isThirdFriday && isMonthEnd) {
    // OpEx + Month-end overlap
    return { isSettlement: true, type: 'OPEX_MONTH', strength: 85 }
  } else if (isThirdFriday) {
    return { isSettlement: true, type: 'OPEX', strength: 70 }
  } else if (isMonthEnd) {
    return { isSettlement: true, type: 'MONTH_END', strength: 60 }
  }

  return { isSettlement: false, type: null, strength: 0 }
}

/**
 * Get trading window based on time (Eastern Time)
 * @param {Date} date
 * @returns {Object} { window, phase, tradeable, isNoiseZone }
 */
function getTradingWindow(date) {
  const d = new Date(date)
  // Convert to ET (UTC-5 or UTC-4 for DST)
  const etHour = d.getUTCHours() - 5 // Simplified, not accounting for DST
  const etMinute = d.getUTCMinutes()
  const timeInMinutes = etHour * 60 + etMinute

  // Trading windows in ET minutes from midnight
  const WINDOWS = {
    EARLY_SRF: { start: 8*60+15, end: 8*60+30, phase: 'early_check', tradeable: false },
    FIRST_PRESSURE: { start: 8*60+30, end: 9*60+30, phase: 'cash_pressure', tradeable: false },
    ENTRY_ZONE: { start: 9*60+30, end: 10*60+15, phase: 'first_low', tradeable: true },
    CASH_EASING: { start: 10*60+15, end: 11*60+30, phase: 'easing', tradeable: true },
    ON_RRP_POSITION: { start: 11*60+45, end: 12*60+15, phase: 'on_rrp_warning', tradeable: false },
    ON_RRP_WINDOW: { start: 12*60+45, end: 13*60+15, phase: 'on_rrp', tradeable: false },
    AFTERNOON_SRF: { start: 13*60+30, end: 13*60+45, phase: 'afternoon_srf', tradeable: true },
    POST_ISSUANCE: { start: 14*60+30, end: 15*60, phase: 'post_issuance', tradeable: true },
    NOISE_ZONE: { start: 15*60+15, end: 15*60+30, phase: 'noise', tradeable: false },
    FINAL_CLEANUP: { start: 16*60, end: 16*60+30, phase: 'cleanup', tradeable: false }
  }

  for (const [name, window] of Object.entries(WINDOWS)) {
    if (timeInMinutes >= window.start && timeInMinutes < window.end) {
      return {
        window: name,
        phase: window.phase,
        tradeable: window.tradeable,
        isNoiseZone: name === 'NOISE_ZONE'
      }
    }
  }

  // Default for regular trading hours
  if (timeInMinutes >= 9*60+30 && timeInMinutes < 16*60) {
    return { window: 'REGULAR', phase: 'regular', tradeable: true, isNoiseZone: false }
  }

  return { window: 'PRE_MARKET', phase: 'pre', tradeable: false, isNoiseZone: false }
}

/**
 * Simulate ES-SPY basis using momentum divergence
 * When momentum weakens but price stays flat = "basis contracting"
 */
function calculateBasisProxy(candles, index, lookback = 10) {
  if (index < lookback) return null

  const slice = candles.slice(index - lookback, index + 1)
  const closes = slice.map(c => c.close)
  const volumes = slice.map(c => c.volume || 1)

  // Price momentum
  const priceChange = (closes[closes.length - 1] - closes[0]) / closes[0]

  // Volume-weighted momentum (proxy for "futures pressure")
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3
  const volumeRatio = recentVolume / avgVolume

  // If volume is dropping but price is stable/recovering = selling pressure receding
  // If volume is high and price dropping = selling pressure continuing
  const basisStrength = priceChange * 100 - (volumeRatio - 1) * 50

  return {
    priceChange: priceChange * 100,
    volumeRatio,
    basisStrength,
    isReceding: basisStrength > -0.1, // Pressure receding when strength > -0.1
    isIntensifying: basisStrength < -0.3
  }
}

export class SettlementDaySource {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.timeframe - Candle timeframe in minutes (5, 15, 60, 240)
   * @param {number} config.minStrength - Minimum signal strength
   * @param {string[]} config.signalTypes - Signal types to include ['CALL', 'PUT']
   * @param {boolean} config.settlementOnly - Only trade on settlement days (default true)
   * @param {boolean} config.requirePressureRecede - Require selling pressure to recede (default true)
   * @param {number} config.entryWindow - Which window to enter (1=first_low, 2=easing, 3=all)
   * @param {number} config.lookback - Lookback period for momentum (default 10)
   * @param {number} config.rsiOversold - RSI oversold threshold (default 35)
   * @param {number} config.rsiOverbought - RSI overbought threshold (default 65)
   */
  constructor(config = {}) {
    this.name = 'Settlement Day'
    this.timeframe = config.timeframe ?? 5
    this.minStrength = config.minStrength ?? 30
    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']

    // Strategy-specific settings
    this.settlementOnly = config.settlementOnly ?? true
    this.requirePressureRecede = config.requirePressureRecede ?? true
    this.entryWindow = config.entryWindow ?? 2 // 1=aggressive (first_low), 2=conservative (easing), 3=all
    this.lookback = config.lookback ?? 10
    this.rsiOversold = config.rsiOversold ?? 35
    this.rsiOverbought = config.rsiOverbought ?? 65

    // Cooldown
    this.cooldownBars = config.cooldownBars ?? 6
    this.lastSignalIndex = -1

    // Position sizing based on signal type (from original strategy)
    this.positionSizes = {
      FIRST_LOW: 0.25,      // 20-30% on first entry
      EASING_TRUE: 0.25,    // Add 20-30% on confirmed easing
      EASING_FALSE: 0,      // Don't add on false easing
      AFTERNOON: 0.25,      // Final position
    }

    // Cached indicators
    this.cachedIndicators = null
    this.cachedCandleCount = 0

    console.log(`[Settlement] Timeframe: ${this.timeframe}m, Settlement Only: ${this.settlementOnly}, Entry Window: ${this.entryWindow}`)
  }

  /**
   * Calculate all indicators
   */
  calculateIndicators(candles) {
    if (this.cachedIndicators && this.cachedCandleCount === candles.length) {
      return this.cachedIndicators
    }

    const closes = candles.map(c => c.close)

    this.cachedIndicators = {
      rsi: calculateRSI(closes, 14),
      sma20: calculateSMA(closes, 20),
      sma50: calculateSMA(closes, 50),
      percentB: calculateBollingerPercentB(closes, 20),
      atr: calculateATRArray(candles, 14)
    }

    this.cachedCandleCount = candles.length
    return this.cachedIndicators
  }

  /**
   * Check if true easing vs false easing (from original strategy)
   * True easing: Price recovers + selling pressure recedes + no new stress
   * False easing: Price recovers but pressure continues
   */
  checkEasingType(candles, index) {
    const basisProxy = calculateBasisProxy(candles, index, this.lookback)
    if (!basisProxy) return { type: 'unknown', confidence: 0 }

    const indicators = this.calculateIndicators(candles)
    const rsi = indicators.rsi[index]

    // True easing conditions:
    // 1. Selling pressure receding (basis proxy improving)
    // 2. RSI not making new lows
    // 3. Price above short-term support

    const priceRecovering = candles[index].close > candles[index - 1].close
    const pressureReceding = basisProxy.isReceding
    const rsiImproving = rsi && rsi > 30

    if (pressureReceding && priceRecovering && rsiImproving) {
      return { type: 'true', confidence: 0.8 }
    } else if (priceRecovering && !pressureReceding) {
      // False easing - price recovering but pressure still on
      return { type: 'false', confidence: 0.6 }
    }

    return { type: 'unknown', confidence: 0.3 }
  }

  /**
   * Analyze candles at a specific index
   */
  analyze(candles, index) {
    // Need enough history
    if (index < Math.max(this.lookback, 20) + 10) {
      return null
    }

    // Check cooldown
    if (index - this.lastSignalIndex < this.cooldownBars) {
      return null
    }

    const candle = candles[index]
    const currentPrice = candle.close

    // Check if settlement day
    const settlement = checkSettlementDay(candle.time)
    if (this.settlementOnly && !settlement.isSettlement) {
      return null
    }

    // Get trading window
    const window = getTradingWindow(candle.time)

    // Skip noise zone
    if (window.isNoiseZone) {
      return null
    }

    // Skip non-tradeable windows if strict mode
    if (!window.tradeable && this.entryWindow !== 3) {
      return null
    }

    // Check if in correct entry window
    const validEntryWindow =
      (this.entryWindow === 1 && window.phase === 'first_low') ||
      (this.entryWindow === 2 && (window.phase === 'first_low' || window.phase === 'easing')) ||
      (this.entryWindow === 3) // All windows

    if (!validEntryWindow) {
      return null
    }

    // Calculate indicators
    const indicators = this.calculateIndicators(candles)
    const rsi = indicators.rsi[index]
    const percentB = indicators.percentB[index]
    const atr = indicators.atr[index]

    // Get basis proxy (selling pressure indicator)
    const basisProxy = calculateBasisProxy(candles, index, this.lookback)

    // Core strategy: "Don't buy the dip, buy when selling pressure recedes"
    if (this.requirePressureRecede && basisProxy && !basisProxy.isReceding) {
      return null
    }

    // Determine signal direction
    let direction = null
    let isStrong = false

    // CALL signal conditions (buy dip recovery)
    if (this.signalTypes.includes('CALL')) {
      // Condition A: Basis not continuing to weaken (pressure receding)
      const conditionA = basisProxy?.isReceding ?? true

      // Condition B: RSI oversold or recovering from oversold
      const conditionB = rsi && rsi < this.rsiOversold

      // Condition C: Price at lower Bollinger Band
      const conditionC = percentB && percentB < 0.3

      if (conditionA && (conditionB || conditionC)) {
        direction = 'CALL'
        isStrong = conditionB && conditionC
      }
    }

    // PUT signal conditions (sell recovery at resistance)
    if (!direction && this.signalTypes.includes('PUT')) {
      // Condition A: Basis not continuing to strengthen
      const conditionA = basisProxy?.isIntensifying ?? false

      // Condition B: RSI overbought
      const conditionB = rsi && rsi > this.rsiOverbought

      // Condition C: Price at upper Bollinger Band
      const conditionC = percentB && percentB > 0.8

      if ((conditionA || conditionB) && (conditionB || conditionC)) {
        direction = 'PUT'
        isStrong = conditionB && conditionC
      }
    }

    if (!direction) {
      return null
    }

    // Calculate signal strength
    // Base strength from settlement type
    let strength = settlement.isSettlement ? Math.min(settlement.strength, 70) : 50

    // Add strength for window timing
    if (window.phase === 'first_low') strength += 10
    if (window.phase === 'easing') strength += 15
    if (window.phase === 'post_issuance') strength += 5

    // Add strength for pressure receding
    if (basisProxy?.isReceding) strength += 10

    // Add strength for RSI confirmation
    if (direction === 'CALL' && rsi < 30) strength += 10
    if (direction === 'PUT' && rsi > 70) strength += 10

    // Cap at 100
    strength = Math.min(100, strength)

    // Check minimum strength
    if (strength < this.minStrength) {
      return null
    }

    // Check easing type for position sizing metadata
    const easingType = this.checkEasingType(candles, index)

    this.lastSignalIndex = index

    return {
      type: isStrong ? `STRONG_${direction}` : direction,
      direction,
      strength,
      source: this.name,
      price: currentPrice,
      time: candle.time,
      metadata: {
        settlementType: settlement.type || 'REGULAR',
        settlementStrength: settlement.strength,
        tradingWindow: window.window,
        windowPhase: window.phase,
        basisProxy: basisProxy?.basisStrength?.toFixed(2) || 'N/A',
        pressureReceding: basisProxy?.isReceding ?? 'N/A',
        easingType: easingType.type,
        easingConfidence: easingType.confidence,
        positionSize: this.positionSizes[window.phase === 'first_low' ? 'FIRST_LOW' :
          (easingType.type === 'true' ? 'EASING_TRUE' : 'EASING_FALSE')] || 0.25,
        rsi: rsi?.toFixed(0),
        percentB: percentB?.toFixed(2),
        strategy: 'Settlement Day Playbook (大结算日作战卡)',
        note: '反埋伏: Buy when selling pressure recedes, not at the dip'
      }
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
      source: 'settlement-day',
      timeframe: this.timeframe,
      settlementOnly: this.settlementOnly,
      requirePressureRecede: this.requirePressureRecede,
      entryWindow: this.entryWindow,
      lookback: this.lookback,
      rsiOversold: this.rsiOversold,
      rsiOverbought: this.rsiOverbought,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      windows: {
        1: 'First Low Only (09:30-10:15 ET)',
        2: 'First Low + Easing (09:30-11:30 ET)',
        3: 'All Windows'
      },
      settlementTypes: ['QUAD_WITCH', 'QUARTER_END', 'OPEX_MONTH', 'OPEX', 'MONTH_END'],
      strategy: 'Settlement Day Counter-Ambush (大结算日反埋伏)'
    }
  }
}
