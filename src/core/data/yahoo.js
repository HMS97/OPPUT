/**
 * Yahoo Finance Data Fetching Module
 * Handles fetching stock and options data with CORS proxy fallbacks
 */

import { CORS_PROXIES } from '../utils/constants.js'

/**
 * Timeframe configuration for Yahoo Finance API
 */
const TF_CONFIG = {
  5: { interval: '5m', range: '5d', lookback: 5 },
  15: { interval: '15m', range: '1mo', lookback: 15 },
  60: { interval: '60m', range: '3mo', lookback: 60 },
  240: { interval: '1d', range: '1y', lookback: 180 },
}

/**
 * Fetch URL through CORS proxies with retries
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {string} workerUrl - Optional Cloudflare Worker URL
 * @returns {Promise<Object|null>} Parsed JSON response or null
 */
export async function fetchWithProxy(url, options = {}, workerUrl = null) {
  // Try backend API first if path starts with /api
  if (url.startsWith('/api')) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        return await response.json()
      }
    } catch (e) {
      console.log('[Data] Backend unavailable')
    }
    return null
  }

  // Try Cloudflare Worker if configured
  if (workerUrl) {
    try {
      const workerResponse = await fetch(workerUrl, {
        ...options,
        signal: AbortSignal.timeout(8000),
      })
      if (workerResponse.ok) {
        const data = await workerResponse.json()
        if (data.success) {
          return data
        }
      }
    } catch (e) {
      console.log('[Data] Cloudflare Worker failed:', e.message)
    }
  }

  // Try direct fetch (may work in some environments)
  try {
    const directResponse = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
    })
    if (directResponse.ok) {
      return await directResponse.json()
    }
  } catch (e) {
    // Expected to fail due to CORS, continue to proxies
  }

  // Try each CORS proxy
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyFn = CORS_PROXIES[i]
    try {
      const proxyUrl = proxyFn(url)
      console.log(`[Data] Trying proxy ${i + 1}/${CORS_PROXIES.length}...`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(proxyUrl, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...options.headers,
        },
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const text = await response.text()
        try {
          const data = JSON.parse(text)
          console.log(`[Data] Proxy ${i + 1} succeeded`)
          return data
        } catch (e) {
          console.log(`[Data] Proxy ${i + 1} returned invalid JSON`)
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.log(`[Data] Proxy ${i + 1} timed out`)
      } else {
        console.log(`[Data] Proxy ${i + 1} failed:`, e.message)
      }
    }
  }

  throw new Error('All CORS proxies failed')
}

/**
 * Fetch spot price for a symbol
 * @param {string} symbol - Stock symbol (e.g., 'SPY')
 * @param {string} workerUrl - Optional Cloudflare Worker URL
 * @returns {Promise<{price: number, previousClose: number}>}
 */
export async function fetchSpotPrice(symbol, workerUrl = null) {
  console.log(`[Data] Fetching spot price for ${symbol}`)

  // Try Cloudflare Worker first
  if (workerUrl) {
    try {
      const response = await fetch(`${workerUrl}/quote/${symbol}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          return { price: data.price, previousClose: data.previousClose }
        }
      }
    } catch (e) {
      console.log('[Data] Worker failed, trying proxies')
    }
  }

  // Try backend API
  const backendData = await fetchWithProxy(`/api/quote/${symbol}`)
  if (backendData?.success) {
    return { price: backendData.price, previousClose: backendData.previousClose }
  }

  // Fallback to Yahoo Finance via CORS proxies
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
  const data = await fetchWithProxy(url)

  if (data?.chart?.result?.[0]) {
    const result = data.chart.result[0]
    const meta = result.meta
    const quotes = result.indicators?.quote?.[0]

    return {
      price: meta.regularMarketPrice,
      previousClose:
        meta.previousClose ||
        (quotes?.close ? quotes.close[quotes.close.length - 2] : null),
    }
  }

  throw new Error('Failed to fetch spot price')
}

/**
 * Fetch available options expiration dates
 * @param {string} symbol - Stock symbol
 * @param {string} workerUrl - Optional Cloudflare Worker URL
 * @returns {Promise<number[]>} Array of expiration timestamps
 */
export async function fetchOptionExpiries(symbol, workerUrl = null) {
  console.log(`[Data] Fetching options expiries for ${symbol}`)

  // Try Cloudflare Worker first
  if (workerUrl) {
    try {
      const response = await fetch(`${workerUrl}/options/${symbol}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.expirationDates) {
          return data.expirationDates
        }
      }
    } catch (e) {
      console.log('[Data] Worker failed, trying proxies')
    }
  }

  // Try backend API
  const backendData = await fetchWithProxy(`/api/options/${symbol}`)
  if (backendData?.success && backendData.expirationDates) {
    return backendData.expirationDates
  }

  // Fallback to Yahoo Finance via CORS proxies
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`
  const data = await fetchWithProxy(url)

  if (data?.optionChain?.result?.[0]?.expirationDates) {
    return data.optionChain.result[0].expirationDates
  }

  throw new Error('Failed to fetch expiries')
}

/**
 * Fetch options chain for a specific expiry
 * @param {string} symbol - Stock symbol
 * @param {number} expiry - Expiry timestamp
 * @param {string} workerUrl - Optional Cloudflare Worker URL
 * @returns {Promise<{calls: Array, puts: Array}>}
 */
export async function fetchOptionsChain(symbol, expiry, workerUrl = null) {
  console.log(`[Data] Fetching options chain for ${symbol} expiry ${expiry}`)

  // Try Cloudflare Worker first
  if (workerUrl) {
    try {
      const response = await fetch(`${workerUrl}/options/${symbol}/${expiry}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.options) {
          return { options: data.options }
        }
      }
    } catch (e) {
      console.log('[Data] Worker failed, trying proxies')
    }
  }

  // Try backend API
  const backendData = await fetchWithProxy(`/api/options/${symbol}/${expiry}`)
  if (backendData?.success && backendData.options) {
    return { options: backendData.options }
  }

  // Fallback to Yahoo Finance via CORS proxies
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}?date=${expiry}`
  const data = await fetchWithProxy(url)

  if (data?.optionChain?.result?.[0]) {
    return data.optionChain.result[0]
  }

  throw new Error('Failed to fetch options chain')
}

/**
 * Fetch candle data for a symbol
 * @param {string} symbol - Stock symbol
 * @param {number} timeframe - Timeframe in minutes (5, 15, 60, 240)
 * @param {Date|null} replayDatetime - Optional replay datetime for historical data
 * @returns {Promise<Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>>}
 */
export async function fetchCandleData(symbol, timeframe, replayDatetime = null) {
  const config = TF_CONFIG[timeframe] || TF_CONFIG[5]

  let url
  if (replayDatetime) {
    const endTime = Math.floor(replayDatetime.getTime() / 1000)
    const startTime = endTime - config.lookback * 24 * 60 * 60
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`
    console.log(
      `[Data] Yahoo replay: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`
    )
  } else {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&range=${config.range}`
  }

  const data = await fetchWithProxy(url)
  return parseYahooCandles(data, replayDatetime)
}

/**
 * Parse Yahoo Finance candle data
 * @param {Object} data - Yahoo Finance API response
 * @param {Date|null} cutoffTime - Optional cutoff for replay mode
 * @returns {Array} Parsed candles
 */
function parseYahooCandles(data, cutoffTime = null) {
  if (!data?.chart?.result?.[0]) {
    throw new Error('Invalid response format')
  }

  const result = data.chart.result[0]
  const timestamps = result.timestamp
  const quote = result.indicators.quote[0]

  if (!timestamps || !quote) {
    throw new Error('Missing price data')
  }

  const cutoffMs = cutoffTime ? cutoffTime.getTime() : null

  const candles = []
  for (let i = 0; i < timestamps.length; i++) {
    const candleTime = timestamps[i] * 1000

    if (cutoffMs && candleTime > cutoffMs) {
      continue
    }

    if (quote.open[i] != null && quote.close[i] != null) {
      candles.push({
        time: candleTime,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i] || 0,
      })
    }
  }

  return candles
}

/**
 * Fetch VIX (Volatility Index) value
 * @param {string} workerUrl - Optional Cloudflare Worker URL
 * @returns {Promise<{vix: number, previousClose: number, change: number, changePercent: number}>}
 */
export async function fetchVIX(workerUrl = null) {
  console.log('[Data] Fetching VIX')

  const symbol = '^VIX'

  // Try Cloudflare Worker first
  if (workerUrl) {
    try {
      const response = await fetch(`${workerUrl}/quote/${encodeURIComponent(symbol)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          return {
            vix: data.price,
            previousClose: data.previousClose,
            change: data.price - data.previousClose,
            changePercent: ((data.price - data.previousClose) / data.previousClose) * 100,
          }
        }
      }
    } catch (e) {
      console.log('[Data] Worker VIX failed, trying proxies')
    }
  }

  // Fallback to Yahoo Finance via CORS proxies
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
  const data = await fetchWithProxy(url)

  if (data?.chart?.result?.[0]) {
    const result = data.chart.result[0]
    const meta = result.meta
    const quotes = result.indicators?.quote?.[0]

    const currentVix = meta.regularMarketPrice
    const previousClose = meta.previousClose || (quotes?.close ? quotes.close[quotes.close.length - 2] : currentVix)

    return {
      vix: currentVix,
      previousClose,
      change: currentVix - previousClose,
      changePercent: ((currentVix - previousClose) / previousClose) * 100,
    }
  }

  throw new Error('Failed to fetch VIX')
}

/**
 * Generate simulated SPY data for demo purposes
 * @param {number} timeframe - Timeframe in minutes
 * @returns {Array} Simulated candles
 */
export function generateDemoData(timeframe) {
  const candles = []
  let price = 590
  const now = Date.now()
  const intervalMs = timeframe * 60 * 1000

  // Phase 1: Uptrend
  for (let i = 0; i < 60; i++) {
    const open = price
    const change = price * 0.001 * (0.3 + Math.random() * 0.7)
    const close = open + change
    const high = close + Math.abs(change) * Math.random() * 0.3
    const low = open - Math.abs(change) * Math.random() * 0.2
    candles.push({
      time: now - (100 - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000,
    })
    price = close
  }

  const peakPrice = price

  // Phase 2: First rejection at resistance
  for (let i = 60; i < 70; i++) {
    const open = price
    const high = peakPrice * 1.003 + Math.random() * 0.5
    const close = open - price * 0.001 * Math.random()
    const low = Math.min(open, close) - Math.abs(open - close) * 0.2
    candles.push({
      time: now - (100 - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000,
    })
    price = close
  }

  // Phase 3: Small pullback
  for (let i = 70; i < 80; i++) {
    const open = price
    const change = price * 0.0008 * (Math.random() - 0.6)
    const close = open + change
    const high = Math.max(open, close) + Math.abs(change) * 0.3
    const low = Math.min(open, close) - Math.abs(change) * 0.3
    candles.push({
      time: now - (100 - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000,
    })
    price = close
  }

  // Phase 4: Lower high attempt with rejection
  const lowerHighTarget = peakPrice * 0.998
  for (let i = 80; i < 90; i++) {
    const open = price
    const high = lowerHighTarget + Math.random() * 0.3
    const close = open - price * 0.0005 * (1 + Math.random())
    const low = close - Math.abs(open - close) * 0.2
    candles.push({
      time: now - (100 - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000,
    })
    price = close
  }

  // Phase 5: Recent candles with strong rejection wicks
  for (let i = 90; i < 105; i++) {
    const open = price
    const wickSize = price * 0.002 * (1 + Math.random())
    const high = open + wickSize
    const body = price * 0.0003 * (1 + Math.random())
    const close = open - body
    const low = close - body * 0.3
    candles.push({
      time: now - (100 - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000,
    })
    price = close
  }

  return candles
}
