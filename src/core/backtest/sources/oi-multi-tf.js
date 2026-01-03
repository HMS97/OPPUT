/**
 * OI-WASP Multi-Timeframe Strategy
 *
 * Uses two timeframes:
 * - Higher TF (4H): Determines directional bias
 * - Lower TF (5m): Times entries with mean-reversion signals
 *
 * Only takes 5m signals that align with 4H bias:
 * - 4H price > WASP → Bullish bias → Only take CALL signals
 * - 4H price < WASP → Bearish bias → Only take PUT signals
 *
 * Best for: Filtered high-probability entries
 */

import { calculateSMA } from '../../patterns/indicators.js'
import { DataPipeline, getDataPipeline } from '../../data/pipeline.js'

export class OIMultiTFSource {
  constructor(config = {}) {
    this.name = 'OI-WASP Multi-TF'

    // Timeframes
    this.biasTimeframe = config.biasTimeframe ?? 240  // 4H for bias
    this.entryTimeframe = config.entryTimeframe ?? 5   // 5m for entries

    // Entry parameters (5m mean-reversion)
    this.waspPeriod = config.waspPeriod ?? 15
    this.entryDeviation = config.entryDeviation ?? 0.2
    this.strongDeviation = config.strongDeviation ?? 0.5

    // Bias parameters (4H)
    this.biasWaspPeriod = config.biasWaspPeriod ?? 10
    this.biasThreshold = config.biasThreshold ?? 0.1  // % above/below WASP for clear bias

    this.signalTypes = config.signalTypes ?? ['CALL', 'PUT']
    this.minStrength = config.minStrength ?? 10
    this.cooldownBars = config.cooldownBars ?? 1

    // Data pipeline
    this.pipeline = config.pipeline || getDataPipeline({ useDoltHubFallback: false, useUnicornProxy: true })

    this.lastSignalIndex = -1
    this.waspData = []
    this.dataLoaded = false

    // For multi-TF, we need to track bias candles separately
    this.currentBias = null  // 'BULLISH', 'BEARISH', or null

    console.log(`[OI-Multi-TF] Bias: ${this.biasTimeframe}m, Entry: ${this.entryTimeframe}m, Entry Dev: ${this.entryDeviation}%`)
  }

  async loadData(symbol, startDate, endDate) {
    try {
      console.log(`[OI-Multi-TF] Loading WASP data for ${symbol}...`)
      this.waspData = await this.pipeline.fetchOIWASP(symbol, startDate, endDate, 30)
      this.dataLoaded = true
      console.log(`[OI-Multi-TF] Loaded ${this.waspData.length} days of WASP data`)
    } catch (error) {
      console.error('[OI-Multi-TF] Failed to load data:', error.message)
      this.waspData = []
      this.dataLoaded = true
    }
  }

  findWASPForDate(timestamp) {
    const targetDate = new Date(timestamp).toISOString().split('T')[0]
    return this.waspData.find(w => w.date.toISOString().split('T')[0] === targetDate)
  }

  /**
   * Calculate WASP from candles (SMA-based)
   */
  calculateWASP(candles, index, period) {
    if (index < period) return null

    const startIdx = Math.max(0, index - period)
    const candleSlice = candles.slice(startIdx, index + 1)
    const closes = candleSlice.map(c => c.close)
    const smaValues = calculateSMA(closes, period)

    if (smaValues && smaValues.length > 0) {
      return smaValues[smaValues.length - 1]
    }
    return null
  }

  /**
   * Determine 4H bias from candle data
   * In real implementation, we'd load 4H candles separately
   * Here we simulate by using longer SMA period
   */
  determineBias(candles, index) {
    // Simulate 4H bias using longer period SMA on 5m candles
    // 4H = 48 5m candles, so use 48 * biasWaspPeriod for equivalent period
    const biasBars = Math.floor((this.biasTimeframe / this.entryTimeframe) * this.biasWaspPeriod)

    if (index < biasBars) return null

    const biasWasp = this.calculateWASP(candles, index, biasBars)
    if (!biasWasp) return null

    const currentPrice = candles[index].close
    const biasDeviation = ((currentPrice - biasWasp) / biasWasp) * 100

    if (biasDeviation > this.biasThreshold) {
      return 'BULLISH'
    } else if (biasDeviation < -this.biasThreshold) {
      return 'BEARISH'
    }
    return null  // No clear bias
  }

  analyze(candles, index) {
    if (index < this.waspPeriod + 50) {
      return null
    }

    // Check cooldown
    if (index - this.lastSignalIndex < this.cooldownBars) {
      return null
    }

    const candle = candles[index]
    const currentPrice = candle.close

    // Step 1: Determine 4H bias
    const bias = this.determineBias(candles, index)
    this.currentBias = bias

    // No trade if no clear bias
    if (!bias) {
      return null
    }

    // Step 2: Calculate 5m WASP for entry timing
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
      wasp = this.calculateWASP(candles, index, this.waspPeriod)
    }

    if (!wasp || wasp === 0) return null

    // Step 3: Check for mean-reversion entry
    const deviation = ((currentPrice - wasp) / wasp) * 100
    let signal = null

    // Mean reversion signals, BUT only in bias direction
    if (bias === 'BULLISH') {
      // Only take CALL signals (underpriced mean reversion)
      if (deviation <= -this.entryDeviation && this.signalTypes.includes('CALL')) {
        const isStrong = deviation <= -this.strongDeviation
        signal = this.createSignal('CALL', isStrong, Math.abs(deviation), currentPrice, wasp, candle, bias)
      }
    } else if (bias === 'BEARISH') {
      // Only take PUT signals (overpriced mean reversion)
      if (deviation >= this.entryDeviation && this.signalTypes.includes('PUT')) {
        const isStrong = deviation >= this.strongDeviation
        signal = this.createSignal('PUT', isStrong, deviation, currentPrice, wasp, candle, bias)
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

  createSignal(direction, isStrong, deviation, price, wasp, candle, bias) {
    const normalizedDev = Math.min(deviation, 1.0)
    const strength = Math.round(50 + normalizedDev * 50)

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
        bias: bias,
        strategy: 'Multi-Timeframe',
        note: `${bias} bias from ${this.biasTimeframe}m, entry on ${this.entryTimeframe}m`,
      },
    }
  }

  reset() {
    this.lastSignalIndex = -1
    this.currentBias = null
  }

  getConfig() {
    return {
      source: 'oi-multi-tf',
      biasTimeframe: this.biasTimeframe,
      entryTimeframe: this.entryTimeframe,
      waspPeriod: this.waspPeriod,
      entryDeviation: this.entryDeviation,
      biasThreshold: this.biasThreshold,
      signalTypes: this.signalTypes,
      minStrength: this.minStrength,
      dataSource: 'Unicorn API → SMA fallback',
    }
  }
}
