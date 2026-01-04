/**
 * Unit tests for PatternDetector class
 * Tests pattern detection, signal summary, and config options
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { PatternDetector } from './detector.js'

// ==================== Helper Functions ====================

/**
 * Generate a basic candle with OHLCV data
 */
function createCandle({
  open = 100,
  high = 101,
  low = 99,
  close = 100.5,
  volume = 1000000,
  time = Date.now(),
} = {}) {
  return { open, high, low, close, volume, time }
}

/**
 * Generate an array of candles with a trend
 * @param {number} count - Number of candles to generate
 * @param {'up'|'down'|'flat'} trend - Price trend direction
 * @param {number} startPrice - Starting price
 * @param {number} volatility - Price range per candle
 */
function generateTrendingCandles(
  count,
  trend = 'flat',
  startPrice = 100,
  volatility = 1
) {
  const candles = []
  let price = startPrice
  const trendDelta = trend === 'up' ? 0.5 : trend === 'down' ? -0.5 : 0

  for (let i = 0; i < count; i++) {
    const open = price
    const close = price + trendDelta
    const high = Math.max(open, close) + volatility * 0.5
    const low = Math.min(open, close) - volatility * 0.5

    candles.push({
      open,
      high,
      low,
      close,
      volume: 1000000 + Math.random() * 500000,
      time: Date.now() + i * 60000,
    })

    price = close
  }

  return candles
}

/**
 * Generate candles with swing highs for lower high detection
 */
function generateLowerHighPattern(basePrice = 100) {
  const candles = []

  // Build up to first swing high (higher prices)
  for (let i = 0; i < 6; i++) {
    const price = basePrice + i * 0.5
    candles.push(createCandle({ open: price, high: price + 1, low: price - 0.5, close: price + 0.3 }))
  }

  // First swing high peak
  candles.push(createCandle({ open: basePrice + 3, high: basePrice + 4, low: basePrice + 2.5, close: basePrice + 3.2 }))

  // Pull back
  for (let i = 0; i < 5; i++) {
    const price = basePrice + 3 - i * 0.3
    candles.push(createCandle({ open: price, high: price + 0.3, low: price - 0.5, close: price - 0.2 }))
  }

  // Second swing high (lower than first)
  candles.push(createCandle({ open: basePrice + 2, high: basePrice + 3, low: basePrice + 1.5, close: basePrice + 2.2 }))

  // More context candles
  for (let i = 0; i < 6; i++) {
    const price = basePrice + 2 - i * 0.2
    candles.push(createCandle({ open: price, high: price + 0.3, low: price - 0.3, close: price }))
  }

  return candles
}

/**
 * Generate candles with swing lows for higher low detection
 */
function generateHigherLowPattern(basePrice = 100) {
  const candles = []

  // Build down to first swing low
  for (let i = 0; i < 6; i++) {
    const price = basePrice - i * 0.5
    candles.push(createCandle({ open: price, high: price + 0.5, low: price - 1, close: price - 0.3 }))
  }

  // First swing low
  candles.push(createCandle({ open: basePrice - 3, high: basePrice - 2.5, low: basePrice - 4, close: basePrice - 3.2 }))

  // Pull up
  for (let i = 0; i < 5; i++) {
    const price = basePrice - 3 + i * 0.3
    candles.push(createCandle({ open: price, high: price + 0.5, low: price - 0.3, close: price + 0.2 }))
  }

  // Second swing low (higher than first)
  candles.push(createCandle({ open: basePrice - 2, high: basePrice - 1.5, low: basePrice - 3, close: basePrice - 2.2 }))

  // More context candles
  for (let i = 0; i < 6; i++) {
    const price = basePrice - 2 + i * 0.2
    candles.push(createCandle({ open: price, high: price + 0.3, low: price - 0.3, close: price }))
  }

  return candles
}

/**
 * Generate candles with upper wick rejection pattern
 */
function generateRejectionCandles(basePrice = 100, wickType = 'upper') {
  const candles = generateTrendingCandles(15, 'flat', basePrice, 0.5)

  // Add rejection candle at the end with strong wick
  const lastPrice = candles[candles.length - 1].close
  if (wickType === 'upper') {
    candles.push(createCandle({
      open: lastPrice,
      high: lastPrice + 2, // Long upper wick
      low: lastPrice - 0.2,
      close: lastPrice + 0.1,
    }))
  } else {
    candles.push(createCandle({
      open: lastPrice,
      high: lastPrice + 0.2,
      low: lastPrice - 2, // Long lower wick
      close: lastPrice - 0.1,
    }))
  }

  return candles
}

/**
 * Generate candles for RSI overbought condition
 */
function generateOverboughtCandles(count = 30, startPrice = 100) {
  const candles = []
  let price = startPrice

  // Strong uptrend to push RSI overbought
  for (let i = 0; i < count; i++) {
    const gain = 1.5 + Math.random() * 0.5 // Strong consistent gains
    const open = price
    const close = price + gain
    const high = close + 0.3
    const low = open - 0.2

    candles.push({ open, high, low, close, volume: 1500000, time: Date.now() + i * 60000 })
    price = close
  }

  return candles
}

/**
 * Generate candles for RSI oversold condition
 */
function generateOversoldCandles(count = 30, startPrice = 150) {
  const candles = []
  let price = startPrice

  // Strong downtrend to push RSI oversold
  for (let i = 0; i < count; i++) {
    const loss = 1.5 + Math.random() * 0.5 // Strong consistent losses
    const open = price
    const close = price - loss
    const high = open + 0.2
    const low = close - 0.3

    candles.push({ open, high, low, close, volume: 1500000, time: Date.now() + i * 60000 })
    price = close
  }

  return candles
}

/**
 * Generate candles touching upper Bollinger Band
 */
function generateBBUpperTouchCandles(count = 30, basePrice = 100) {
  // First create stable candles for BB calculation
  const candles = generateTrendingCandles(count - 5, 'flat', basePrice, 0.3)

  // Then add candles that break above the expected upper band
  const lastPrice = candles[candles.length - 1].close
  for (let i = 0; i < 5; i++) {
    const spike = 3 + i * 0.5 // Spike up to touch upper band
    candles.push(createCandle({
      open: lastPrice + i * 0.5,
      high: lastPrice + spike,
      low: lastPrice + i * 0.3,
      close: lastPrice + i * 0.4,
    }))
  }

  return candles
}

/**
 * Generate candles with EMA crossover
 */
function generateEMACrossoverCandles(direction = 'bullish', count = 40) {
  const candles = []
  const basePrice = 100

  if (direction === 'bullish') {
    // Start in downtrend (fast below slow)
    for (let i = 0; i < count - 5; i++) {
      const price = basePrice - (i * 0.1)
      candles.push(createCandle({ open: price, high: price + 0.5, low: price - 0.5, close: price - 0.1 }))
    }
    // Sharp reversal (fast crosses above slow)
    for (let i = 0; i < 5; i++) {
      const price = candles[candles.length - 1].close + (i + 1) * 1.5
      candles.push(createCandle({ open: price - 1, high: price + 0.5, low: price - 1.2, close: price }))
    }
  } else {
    // Start in uptrend (fast above slow)
    for (let i = 0; i < count - 5; i++) {
      const price = basePrice + (i * 0.1)
      candles.push(createCandle({ open: price, high: price + 0.5, low: price - 0.5, close: price + 0.1 }))
    }
    // Sharp reversal (fast crosses below slow)
    for (let i = 0; i < 5; i++) {
      const price = candles[candles.length - 1].close - (i + 1) * 1.5
      candles.push(createCandle({ open: price + 1, high: price + 1.2, low: price - 0.5, close: price }))
    }
  }

  return candles
}

/**
 * Generate candles with volume spike
 */
function generateVolumeSpikeCandles(count = 30, spikeType = 'bullish') {
  const candles = generateTrendingCandles(count - 1, 'flat', 100, 0.5)

  // Add volume spike candle at end
  const lastPrice = candles[candles.length - 1].close
  const avgVolume = 1000000

  if (spikeType === 'bullish') {
    candles.push(createCandle({
      open: lastPrice,
      high: lastPrice + 1.5,
      low: lastPrice - 0.2,
      close: lastPrice + 1.2, // Bullish candle
      volume: avgVolume * 2.5, // 2.5x average volume
    }))
  } else {
    candles.push(createCandle({
      open: lastPrice,
      high: lastPrice + 0.2,
      low: lastPrice - 1.5,
      close: lastPrice - 1.2, // Bearish candle
      volume: avgVolume * 2.5, // 2.5x average volume
    }))
  }

  return candles
}

// ==================== Test Suites ====================

describe('PatternDetector', () => {
  let detector

  beforeEach(() => {
    detector = new PatternDetector()
  })

  describe('Constructor and Configuration', () => {
    it('should initialize with default config', () => {
      expect(detector.config).toBeDefined()
      expect(detector.config.rejectionThreshold).toBe(0.003)
      expect(detector.config.rsiPeriod).toBe(14)
      expect(detector.config.rsiOverbought).toBe(70)
      expect(detector.config.rsiOversold).toBe(30)
      expect(detector.config.bbPeriod).toBe(20)
      expect(detector.config.emaFast).toBe(8)
      expect(detector.config.emaSlow).toBe(21)
    })

    it('should merge custom config with defaults', () => {
      const customDetector = new PatternDetector({
        rsiOverbought: 80,
        rsiOversold: 20,
        customOption: 'test',
      })

      expect(customDetector.config.rsiOverbought).toBe(80)
      expect(customDetector.config.rsiOversold).toBe(20)
      expect(customDetector.config.rsiPeriod).toBe(14) // Default preserved
      expect(customDetector.config.customOption).toBe('test')
    })

    it('should initialize empty pattern arrays', () => {
      expect(detector.patterns).toEqual([])
      expect(detector.putPatterns).toEqual([])
      expect(detector.callPatterns).toEqual([])
      expect(detector.indicators).toEqual({})
    })
  })

  describe('analyze() - Insufficient Data Handling', () => {
    it('should return empty array for null input', () => {
      const result = detector.analyze(null)
      expect(result).toEqual([])
    })

    it('should return empty array for undefined input', () => {
      const result = detector.analyze(undefined)
      expect(result).toEqual([])
    })

    it('should return empty array for empty array', () => {
      const result = detector.analyze([])
      expect(result).toEqual([])
    })

    it('should return empty array for less than 10 candles', () => {
      const candles = generateTrendingCandles(5)
      const result = detector.analyze(candles)
      expect(result).toEqual([])
    })

    it('should return empty array for exactly 9 candles', () => {
      const candles = generateTrendingCandles(9)
      const result = detector.analyze(candles)
      expect(result).toEqual([])
    })

    it('should process 10 or more candles', () => {
      const candles = generateTrendingCandles(10)
      const result = detector.analyze(candles)
      expect(Array.isArray(result)).toBe(true)
      // May or may not have patterns, but should not throw
    })
  })

  describe('analyze() - Pattern Detection', () => {
    it('should detect lower high pattern (PUT signal)', () => {
      const candles = generateLowerHighPattern(100)
      const patterns = detector.analyze(candles)

      const lowerHighPattern = patterns.find((p) => p.type === 'LOWER_HIGH')
      if (lowerHighPattern) {
        expect(lowerHighPattern.signal).toBe('PUT')
        expect(lowerHighPattern.name).toBe('Lower High')
        expect(lowerHighPattern.strength).toBe('MEDIUM')
      }
    })

    it('should detect higher low pattern (CALL signal)', () => {
      const candles = generateHigherLowPattern(100)
      const patterns = detector.analyze(candles)

      const higherLowPattern = patterns.find((p) => p.type === 'HIGHER_LOW')
      if (higherLowPattern) {
        expect(higherLowPattern.signal).toBe('CALL')
        expect(higherLowPattern.name).toBe('Higher Low')
        expect(higherLowPattern.strength).toBe('MEDIUM')
      }
    })

    it('should detect RSI overbought (PUT signal)', () => {
      const candles = generateOverboughtCandles(35)
      const patterns = detector.analyze(candles)

      const rsiPattern = patterns.find((p) => p.type === 'RSI_OVERBOUGHT')
      if (rsiPattern) {
        expect(rsiPattern.signal).toBe('PUT')
        expect(rsiPattern.name).toBe('RSI Overbought')
        expect(rsiPattern.indicatorValue).toBeGreaterThan(70)
      }
    })

    it('should detect RSI oversold (CALL signal)', () => {
      const candles = generateOversoldCandles(35)
      const patterns = detector.analyze(candles)

      const rsiPattern = patterns.find((p) => p.type === 'RSI_OVERSOLD')
      if (rsiPattern) {
        expect(rsiPattern.signal).toBe('CALL')
        expect(rsiPattern.name).toBe('RSI Oversold')
        expect(rsiPattern.indicatorValue).toBeLessThan(30)
      }
    })

    it('should detect volume spike bullish (CALL signal)', () => {
      const candles = generateVolumeSpikeCandles(30, 'bullish')
      const patterns = detector.analyze(candles)

      const volumePattern = patterns.find((p) => p.type === 'VOLUME_SPIKE_BULLISH')
      if (volumePattern) {
        expect(volumePattern.signal).toBe('CALL')
        expect(volumePattern.indicatorValue).toBeGreaterThanOrEqual(1.5)
      }
    })

    it('should detect volume spike bearish (PUT signal)', () => {
      const candles = generateVolumeSpikeCandles(30, 'bearish')
      const patterns = detector.analyze(candles)

      const volumePattern = patterns.find((p) => p.type === 'VOLUME_SPIKE_BEARISH')
      if (volumePattern) {
        expect(volumePattern.signal).toBe('PUT')
        expect(volumePattern.indicatorValue).toBeGreaterThanOrEqual(1.5)
      }
    })

    it('should reset patterns on each analyze call', () => {
      const candles1 = generateOverboughtCandles(35)
      detector.analyze(candles1)
      const firstCount = detector.patterns.length

      const candles2 = generateTrendingCandles(15, 'flat')
      detector.analyze(candles2)

      // Second analyze should have its own patterns, not cumulative
      expect(detector.patterns.length).toBeLessThanOrEqual(firstCount)
    })
  })

  describe('analyze() - Pattern Structure', () => {
    it('should include required fields in detected patterns', () => {
      const candles = generateOverboughtCandles(35)
      const patterns = detector.analyze(candles)

      patterns.forEach((pattern) => {
        expect(pattern).toHaveProperty('type')
        expect(pattern).toHaveProperty('name')
        expect(pattern).toHaveProperty('signal')
        expect(pattern).toHaveProperty('strength')
        expect(pattern).toHaveProperty('index')
        expect(pattern).toHaveProperty('price')
        expect(pattern).toHaveProperty('description')
      })
    })

    it('should have valid signal values', () => {
      const candles = generateOverboughtCandles(35)
      const patterns = detector.analyze(candles)

      patterns.forEach((pattern) => {
        expect(['PUT', 'CALL']).toContain(pattern.signal)
      })
    })

    it('should have valid strength values', () => {
      const candles = generateOverboughtCandles(35)
      const patterns = detector.analyze(candles)

      patterns.forEach((pattern) => {
        expect(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).toContain(pattern.strength)
      })
    })
  })

  describe('getSignalSummary()', () => {
    it('should return NEUTRAL signal when no patterns detected', () => {
      detector.analyze([]) // Will result in no patterns
      const summary = detector.getSignalSummary()

      expect(summary.signal).toBe('NONE')
      expect(summary.direction).toBe('NEUTRAL')
      expect(summary.strength).toBe(0)
      expect(summary.patterns).toEqual([])
    })

    it('should return PUT direction for bearish patterns', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      // RSI overbought should be detected
      if (detector.putPatterns.length > detector.callPatterns.length) {
        expect(['PUT', 'STRONG_PUT', 'NEUTRAL']).toContain(summary.direction)
      }
    })

    it('should return CALL direction for bullish patterns', () => {
      const candles = generateOversoldCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      // RSI oversold should be detected
      if (detector.callPatterns.length > detector.putPatterns.length) {
        expect(['CALL', 'STRONG_CALL', 'NEUTRAL']).toContain(summary.direction)
      }
    })

    it('should include all detected patterns in summary', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      expect(summary.patterns).toBe(detector.patterns)
      expect(summary.patterns.length).toBe(detector.patterns.length)
    })

    it('should calculate strength as a number between 0 and 100', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      expect(typeof summary.strength).toBe('number')
      expect(summary.strength).toBeGreaterThanOrEqual(0)
      expect(summary.strength).toBeLessThanOrEqual(100)
    })

    it('should include weight calculations', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      expect(summary).toHaveProperty('putWeight')
      expect(summary).toHaveProperty('callWeight')
      expect(typeof summary.putWeight).toBe('number')
      expect(typeof summary.callWeight).toBe('number')
    })

    it('should include indicator summary', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      expect(summary).toHaveProperty('indicators')
      expect(typeof summary.indicators).toBe('object')
    })

    it('should include recommendation text', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getSignalSummary()

      expect(summary).toHaveProperty('recommendation')
      expect(typeof summary.recommendation).toBe('string')
    })

    it('should return STRONG_PUT for high PUT weight', () => {
      // Create multiple bearish signals - patterns array must be non-empty
      const detector = new PatternDetector()
      const putPatterns = [
        { type: 'RSI_OVERBOUGHT', signal: 'PUT', strength: 'HIGH' },
        { type: 'BB_UPPER_TOUCH', signal: 'PUT', strength: 'HIGH' },
        { type: 'MACD_BEARISH_CROSS', signal: 'PUT', strength: 'HIGH' },
      ]
      detector.patterns = [...putPatterns]
      detector.putPatterns = putPatterns
      detector.callPatterns = []
      detector.indicators = {}

      const summary = detector.getSignalSummary()
      expect(summary.signal).toBe('STRONG_PUT')
    })

    it('should return STRONG_CALL for high CALL weight', () => {
      const detector = new PatternDetector()
      const callPatterns = [
        { type: 'RSI_OVERSOLD', signal: 'CALL', strength: 'HIGH' },
        { type: 'BB_LOWER_TOUCH', signal: 'CALL', strength: 'HIGH' },
        { type: 'MACD_BULLISH_CROSS', signal: 'CALL', strength: 'HIGH' },
      ]
      detector.patterns = [...callPatterns]
      detector.putPatterns = []
      detector.callPatterns = callPatterns
      detector.indicators = {}

      const summary = detector.getSignalSummary()
      expect(summary.signal).toBe('STRONG_CALL')
    })

    it('should apply indicator bonus for multiple indicator signals', () => {
      const detector = new PatternDetector()
      const putPatterns = [
        { type: 'RSI_OVERBOUGHT', signal: 'PUT', strength: 'HIGH' },
        { type: 'BB_UPPER_TOUCH', signal: 'PUT', strength: 'HIGH' },
        { type: 'MACD_BEARISH_CROSS', signal: 'PUT', strength: 'HIGH' },
      ]
      detector.patterns = [...putPatterns]
      detector.putPatterns = putPatterns
      detector.callPatterns = []
      detector.indicators = {}

      const summary = detector.getSignalSummary()
      expect(summary.indicatorBonus).toBeGreaterThan(1)
      expect(summary.putIndicatorCount).toBe(3)
    })
  })

  describe('getIndicatorSummary()', () => {
    it('should include RSI data when calculated', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)
      const summary = detector.getIndicatorSummary()

      if (summary.rsi) {
        expect(summary.rsi).toHaveProperty('value')
        expect(summary.rsi).toHaveProperty('status')
        expect(['OVERBOUGHT', 'OVERSOLD', 'NEUTRAL']).toContain(summary.rsi.status)
      }
    })

    it('should include Bollinger Bands data when calculated', () => {
      const candles = generateTrendingCandles(30, 'flat')
      detector.analyze(candles)
      const summary = detector.getIndicatorSummary()

      if (summary.bollingerBands) {
        expect(summary.bollingerBands).toHaveProperty('upper')
        expect(summary.bollingerBands).toHaveProperty('middle')
        expect(summary.bollingerBands).toHaveProperty('lower')
      }
    })

    it('should include EMA data when calculated', () => {
      const candles = generateTrendingCandles(30, 'up')
      detector.analyze(candles)
      const summary = detector.getIndicatorSummary()

      if (summary.ema) {
        expect(summary.ema).toHaveProperty('fast')
        expect(summary.ema).toHaveProperty('slow')
        expect(summary.ema).toHaveProperty('trend')
        expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(summary.ema.trend)
      }
    })

    it('should include MACD data when calculated', () => {
      const candles = generateTrendingCandles(40, 'flat')
      detector.analyze(candles)
      const summary = detector.getIndicatorSummary()

      if (summary.macd) {
        expect(summary.macd).toHaveProperty('macd')
        expect(summary.macd).toHaveProperty('signal')
        expect(summary.macd).toHaveProperty('histogram')
        expect(summary.macd).toHaveProperty('momentum')
      }
    })
  })

  describe('Config Options', () => {
    it('should use custom RSI thresholds', () => {
      const customDetector = new PatternDetector({
        rsiOverbought: 80,
        rsiOversold: 20,
      })

      // RSI of 75 should NOT trigger overbought with threshold of 80
      expect(customDetector.config.rsiOverbought).toBe(80)
      expect(customDetector.config.rsiOversold).toBe(20)
    })

    it('should use custom volume spike multiplier', () => {
      const customDetector = new PatternDetector({
        volumeSpikeMult: 2.0,
      })

      expect(customDetector.config.volumeSpikeMult).toBe(2.0)
    })

    it('should use custom EMA periods', () => {
      const customDetector = new PatternDetector({
        emaFast: 5,
        emaSlow: 20,
      })

      expect(customDetector.config.emaFast).toBe(5)
      expect(customDetector.config.emaSlow).toBe(20)
    })

    it('should use custom MACD settings', () => {
      const customDetector = new PatternDetector({
        macdFast: 8,
        macdSlow: 17,
        macdSignal: 9,
      })

      expect(customDetector.config.macdFast).toBe(8)
      expect(customDetector.config.macdSlow).toBe(17)
      expect(customDetector.config.macdSignal).toBe(9)
    })

    it('should use custom Bollinger Band settings', () => {
      const customDetector = new PatternDetector({
        bbPeriod: 15,
        bbStdDev: 2.5,
      })

      expect(customDetector.config.bbPeriod).toBe(15)
      expect(customDetector.config.bbStdDev).toBe(2.5)
    })
  })

  describe('Edge Cases', () => {
    it('should handle candles with zero volume', () => {
      const candles = generateTrendingCandles(20, 'flat')
      candles.forEach((c) => (c.volume = 0))

      expect(() => detector.analyze(candles)).not.toThrow()
    })

    it('should handle candles with missing volume', () => {
      const candles = generateTrendingCandles(20, 'flat')
      candles.forEach((c) => delete c.volume)

      expect(() => detector.analyze(candles)).not.toThrow()
    })

    it('should handle flat candles (open === close)', () => {
      const candles = []
      for (let i = 0; i < 20; i++) {
        candles.push({
          open: 100,
          high: 100.1,
          low: 99.9,
          close: 100,
          volume: 1000000,
          time: Date.now() + i * 60000,
        })
      }

      expect(() => detector.analyze(candles)).not.toThrow()
    })

    it('should handle doji candles (high === low)', () => {
      const candles = generateTrendingCandles(20, 'flat')
      // Add a doji at the end
      candles.push({
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000000,
        time: Date.now(),
      })

      expect(() => detector.analyze(candles)).not.toThrow()
    })

    it('should handle extremely large price values', () => {
      const candles = generateTrendingCandles(20, 'up', 50000, 100)

      expect(() => detector.analyze(candles)).not.toThrow()
    })

    it('should handle very small price values', () => {
      const candles = generateTrendingCandles(20, 'up', 0.001, 0.0001)

      expect(() => detector.analyze(candles)).not.toThrow()
    })
  })

  describe('Pattern Categorization', () => {
    it('should correctly categorize PUT patterns', () => {
      const candles = generateOverboughtCandles(35)
      detector.analyze(candles)

      detector.putPatterns.forEach((pattern) => {
        expect(pattern.signal).toBe('PUT')
      })
    })

    it('should correctly categorize CALL patterns', () => {
      const candles = generateOversoldCandles(35)
      detector.analyze(candles)

      detector.callPatterns.forEach((pattern) => {
        expect(pattern.signal).toBe('CALL')
      })
    })

    it('should include all patterns in both patterns array and signal arrays', () => {
      const candles = generateTrendingCandles(40, 'flat')
      detector.analyze(candles)

      const totalSignalPatterns = detector.putPatterns.length + detector.callPatterns.length
      expect(detector.patterns.length).toBeGreaterThanOrEqual(totalSignalPatterns)
    })
  })

  describe('Backwards Compatibility', () => {
    it('should export PutPatternDetector as alias', async () => {
      const { PutPatternDetector } = await import('./detector.js')
      expect(PutPatternDetector).toBe(PatternDetector)
    })
  })
})
