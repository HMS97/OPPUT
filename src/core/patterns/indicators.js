/**
 * Technical Indicators Module
 * RSI, Bollinger Bands, EMA, MACD calculations
 */

/**
 * Calculate RSI (Relative Strength Index)
 * @param {number[]} prices - Array of closing prices
 * @param {number} period - RSI period (default 14)
 * @returns {(number|null)[]} Array of RSI values
 */
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return []

  const rsi = new Array(prices.length).fill(null)
  let gains = 0
  let losses = 0

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1]
    if (change > 0) gains += change
    else losses -= change
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // Calculate subsequent RSI values using smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }

  return rsi
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} prices - Array of closing prices
 * @param {number} period - BB period (default 20)
 * @param {number} stdDev - Number of standard deviations (default 2)
 * @returns {{ upper: (number|null)[], middle: (number|null)[], lower: (number|null)[] }}
 */
export function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  const bb = {
    upper: new Array(prices.length).fill(null),
    middle: new Array(prices.length).fill(null),
    lower: new Array(prices.length).fill(null),
  }

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1)
    const sma = slice.reduce((a, b) => a + b, 0) / period
    const variance =
      slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period
    const std = Math.sqrt(variance)

    bb.middle[i] = sma
    bb.upper[i] = sma + stdDev * std
    bb.lower[i] = sma - stdDev * std
  }

  return bb
}

/**
 * Calculate EMA (Exponential Moving Average)
 * @param {number[]} prices - Array of prices
 * @param {number} period - EMA period
 * @returns {(number|null)[]} Array of EMA values
 */
export function calculateEMA(prices, period) {
  const ema = new Array(prices.length).fill(null)
  const multiplier = 2 / (period + 1)

  // Start with SMA for first EMA value
  let sum = 0
  for (let i = 0; i < period && i < prices.length; i++) {
    sum += prices[i]
  }

  if (prices.length >= period) {
    ema[period - 1] = sum / period

    for (let i = period; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1]
    }
  }

  return ema
}

/**
 * Calculate SMA (Simple Moving Average)
 * @param {number[]} values - Array of values
 * @param {number} period - SMA period
 * @returns {(number|null)[]} Array of SMA values
 */
export function calculateSMA(values, period) {
  const sma = new Array(values.length).fill(null)

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1)
    sma[i] = slice.reduce((a, b) => a + b, 0) / period
  }

  return sma
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} prices - Array of closing prices
 * @param {number} fastPeriod - Fast EMA period (default 12)
 * @param {number} slowPeriod - Slow EMA period (default 26)
 * @param {number} signalPeriod - Signal line EMA period (default 9)
 * @returns {{ macdLine: (number|null)[], signalLine: (number|null)[], histogram: (number|null)[] }}
 */
export function calculateMACD(
  prices,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
) {
  const emaFast = calculateEMA(prices, fastPeriod)
  const emaSlow = calculateEMA(prices, slowPeriod)

  const macdLine = new Array(prices.length).fill(null)
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine[i] = emaFast[i] - emaSlow[i]
    }
  }

  // Signal line is EMA of MACD line
  const validMacd = macdLine.filter((v) => v !== null)
  const signalEma = calculateEMA(validMacd, signalPeriod)

  const signalLine = new Array(prices.length).fill(null)
  let signalIdx = 0
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalEma[signalIdx] || null
      signalIdx++
    }
  }

  // Histogram
  const histogram = new Array(prices.length).fill(null)
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i] - signalLine[i]
    }
  }

  return { macdLine, signalLine, histogram }
}

/**
 * Calculate ATR (Average True Range)
 * @param {Array<{high: number, low: number, close: number}>} candles - Array of OHLC candles
 * @param {number} period - ATR period (default 14)
 * @returns {number} Current ATR value
 */
export function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0

  let atrSum = 0
  for (let i = 1; i < Math.min(period + 1, candles.length); i++) {
    const high = candles[candles.length - i].high
    const low = candles[candles.length - i].low
    const prevClose = candles[candles.length - i - 1].close
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    atrSum += tr
  }

  return atrSum / period
}

/**
 * Calculate ATR array for all candles
 * @param {Array<{high: number, low: number, close: number}>} candles - Array of OHLC candles
 * @param {number} period - ATR period (default 14)
 * @returns {(number|null)[]} Array of ATR values
 */
export function calculateATRArray(candles, period = 14) {
  const atr = new Array(candles.length).fill(null)
  if (candles.length < period + 1) return atr

  // Calculate True Range for each candle
  const trValues = []
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trValues.push(tr)
  }

  // Calculate ATR using smoothed average
  let atrVal = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  atr[period] = atrVal

  for (let i = period; i < trValues.length; i++) {
    atrVal = (atrVal * (period - 1) + trValues[i]) / period
    atr[i + 1] = atrVal
  }

  return atr
}

/**
 * Calculate ADX (Average Directional Index)
 * Measures trend strength: ADX > 25 = trending, ADX < 25 = range-bound
 * @param {Array<{high: number, low: number, close: number}>} candles - Array of OHLC candles
 * @param {number} period - ADX period (default 14)
 * @returns {(number|null)[]} Array of ADX values
 */
export function calculateADX(candles, period = 14) {
  const adx = new Array(candles.length).fill(null)
  if (candles.length < period * 2) return adx

  // Calculate +DM, -DM, and TR
  const plusDM = []
  const minusDM = []
  const tr = []

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevHigh = candles[i - 1].high
    const prevLow = candles[i - 1].low
    const prevClose = candles[i - 1].close

    // True Range
    const trVal = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    tr.push(trVal)

    // Directional Movement
    const upMove = high - prevHigh
    const downMove = prevLow - low

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  // Smoothed values
  const smoothTR = []
  const smoothPlusDM = []
  const smoothMinusDM = []

  // Initial smoothed values (first period sum)
  let sumTR = tr.slice(0, period).reduce((a, b) => a + b, 0)
  let sumPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0)
  let sumMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0)

  smoothTR.push(sumTR)
  smoothPlusDM.push(sumPlusDM)
  smoothMinusDM.push(sumMinusDM)

  // Subsequent smoothed values
  for (let i = period; i < tr.length; i++) {
    sumTR = smoothTR[smoothTR.length - 1] - smoothTR[smoothTR.length - 1] / period + tr[i]
    sumPlusDM = smoothPlusDM[smoothPlusDM.length - 1] - smoothPlusDM[smoothPlusDM.length - 1] / period + plusDM[i]
    sumMinusDM = smoothMinusDM[smoothMinusDM.length - 1] - smoothMinusDM[smoothMinusDM.length - 1] / period + minusDM[i]

    smoothTR.push(sumTR)
    smoothPlusDM.push(sumPlusDM)
    smoothMinusDM.push(sumMinusDM)
  }

  // Calculate +DI, -DI, and DX
  const dx = []
  for (let i = 0; i < smoothTR.length; i++) {
    const plusDI = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0
    const minusDI = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0
    const diSum = plusDI + minusDI
    const dxVal = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0
    dx.push(dxVal)
  }

  // Calculate ADX (smoothed DX)
  if (dx.length >= period) {
    let adxSum = dx.slice(0, period).reduce((a, b) => a + b, 0) / period
    adx[period * 2] = adxSum

    for (let i = period; i < dx.length; i++) {
      adxSum = (adxSum * (period - 1) + dx[i]) / period
      adx[period + 1 + i] = adxSum
    }
  }

  return adx
}

/**
 * Calculate Bollinger Band %B
 * %B = (Price - Lower Band) / (Upper Band - Lower Band)
 * %B < 0 = below lower band, %B > 1 = above upper band
 * @param {number[]} prices - Array of closing prices
 * @param {number} period - BB period (default 20)
 * @param {number} stdDev - Number of standard deviations (default 2)
 * @returns {(number|null)[]} Array of %B values
 */
export function calculateBollingerPercentB(prices, period = 20, stdDev = 2) {
  const bb = calculateBollingerBands(prices, period, stdDev)
  const percentB = new Array(prices.length).fill(null)

  for (let i = 0; i < prices.length; i++) {
    if (bb.upper[i] !== null && bb.lower[i] !== null) {
      const range = bb.upper[i] - bb.lower[i]
      if (range > 0) {
        percentB[i] = (prices[i] - bb.lower[i]) / range
      }
    }
  }

  return percentB
}
