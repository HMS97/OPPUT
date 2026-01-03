/**
 * OI-WASP Trend-Following Strategy
 *
 * Unlike mean-reversion (scalping), this trades WITH the trend:
 * - Price breaks above WASP with momentum → CALL (bullish trend)
 * - Price breaks below WASP with momentum → PUT (bearish trend)
 *
 * Best for: 1H, 4H timeframes where trends develop
 */

import { calculateSMA, calculateEMA } from '../../patterns/indicators.js'
import { DataPipeline, getDataPipeline } from '../../data/pipeline.js'

export class OITrendSource {
  constructor(config = {}) {
    this.name = 'OI-WASP Trend'
    this.timeframe = config.timeframe ?? 60  // Default 1H

    // Trend parameters (scale with timeframe)
    this.waspPeriod = config.waspPeriod ?? 15
    this.breakoutThreshold = config.breakoutThreshold ?? 0.3  // % above/below WASP to confirm breakout
    this.momentumBars = config.momentumBars ?? 3  // Bars to confirm momentum direction

    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 30
    this.cooldownBars = config.cooldownBars ?? 5  // More cooldown for trend trades

    // Data pipeline
    this.pipeline = config.pipeline || getDataPipeline({ useDoltHubFallback: false, useUnicornProxy: true })

    this.lastSignalIndex = -1
    this.waspData = []
    this.dataLoaded = false

    console.log(`[OI-Trend] Timeframe: ${this.timeframe}m, Breakout: ${this.breakoutThreshold}%, Momentum: ${this.momentumBars} bars`)
  }

  async loadData(symbol, startDate, endDate) {
    try {
      console.log(`[OI-Trend] Loading WASP data for ${symbol}...`)
      this.waspData = await this.pipeline.fetchOIWASP(symbol, startDate, endDate, 30)
      this.dataLoaded = true
      console.log(`[OI-Trend] Loaded ${this.waspData.length} days of WASP data`)
    } catch (error) {
      console.error('[OI-Trend] Failed to load data:', error.message)
      this.waspData = []
      this.dataLoaded = true
    }
  }

  findWASPForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]
    return this.waspData.find(w => w.date.toISOString().split('T')[0] === targetDate)
  }

  /**
   * Calculate momentum: are we trending up or down?
   */
  calculateMomentum(candles, index) {
    if (index < this.momentumBars) return 0

    let upBars = 0
    let downBars = 0

    for (let i = index - this.momentumBars + 1; i <= index; i++) {
      if (candles[i].close > candles[i].open) upBars++
      else if (candles[i].close < candles[i].open) downBars++
    }

    // Strong momentum = all bars in same direction
    if (upBars >= this.momentumBars - 1) return 1   // Bullish
    if (downBars >= this.momentumBars - 1) return -1 // Bearish
    return 0  // No clear momentum
  }

  analyze(candles, index) {
    if (index < this.waspPeriod + this.momentumBars + 5) {
      return null
    }

    // Check cooldown
    if (index - this.lastSignalIndex < this.cooldownBars) {
      return null
    }

    const candle = candles[index]
    const currentPrice = candle.close
    let wasp = null

    // Try real WASP from API
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

    // Calculate deviation and momentum
    const deviation = ((currentPrice - wasp) / wasp) * 100
    const momentum = this.calculateMomentum(candles, index)

    let signal = null

    // TREND-FOLLOWING LOGIC (opposite of mean reversion!)
    // Breakout above WASP + bullish momentum → CALL
    if (deviation >= this.breakoutThreshold && momentum > 0) {
      if (this.signalTypes.includes('CALL')) {
        signal = this.createSignal('CALL', deviation, currentPrice, wasp, candle, momentum)
      }
    }
    // Breakout below WASP + bearish momentum → PUT
    else if (deviation <= -this.breakoutThreshold && momentum < 0) {
      if (this.signalTypes.includes('PUT')) {
        signal = this.createSignal('PUT', Math.abs(deviation), currentPrice, wasp, candle, momentum)
      }
    }

    if (signal && signal.strength < this.minStrength) {
      return null
    }

    if (signal) {
      this.lastSignalIndex = index
    }

    return signal
  }

  createSignal(direction, deviation, price, wasp, candle, momentum) {
    // Strength based on breakout magnitude
    const normalizedDev = Math.min(deviation, 2.0)
    const strength = Math.round(40 + normalizedDev * 30)

    const isStrong = deviation >= this.breakoutThreshold * 2
    const type = isStrong ? `STRONG_${direction}` : direction

    return {
      type,
      direction,
      strength: Math.min(100, Math.max(30, strength)),
      source: this.name,
      price,
      time: candle.time,
      metadata: {
        deviation: deviation.toFixed(2),
        wasp: wasp.toFixed(2),
        momentum: momentum > 0 ? 'BULLISH' : 'BEARISH',
        strategy: 'Trend Following',
        note: 'Trading WITH breakout direction',
      },
    }
  }

  reset() {
    this.lastSignalIndex = -1
  }

  getConfig() {
    return {
      source: 'oi-trend',
      timeframe: this.timeframe,
      waspPeriod: this.waspPeriod,
      breakoutThreshold: this.breakoutThreshold,
      momentumBars: this.momentumBars,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      dataSource: 'Unicorn API → SMA fallback',
    }
  }
}
