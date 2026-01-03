/**
 * Yahoo Finance Data Fetching Module
 * Handles fetching stock and options data with CORS proxy fallbacks
 * Includes localStorage caching for candle data
 */

import { CORS_PROXIES } from '../utils/constants.js'

// ================== Candle Data Cache ==================

const CACHE_PREFIX = 'opput_candle_'
const CACHE_EXPIRY_MS = 60 * 60 * 1000 // 1 hour for intraday data

/**
 * Generate cache key for candle data
 */
function getCacheKey(symbol, timeframe, startDate, endDate) {
  const start = startDate ? startDate.toISOString().split('T')[0] : 'default'
  const end = endDate ? endDate.toISOString().split('T')[0] : 'default'
  return `${CACHE_PREFIX}${symbol}_${timeframe}_${start}_${end}`
}

/**
 * Get cached candle data
 * @returns {Array|null} Cached candles or null if not found/expired
 */
function getCachedCandles(symbol, timeframe, startDate, endDate) {
  try {
    const key = getCacheKey(symbol, timeframe, startDate, endDate)
    const cached = localStorage.getItem(key)
    if (!cached) return null

    const { data, timestamp } = JSON.parse(cached)
    const age = Date.now() - timestamp

    // Check expiry - intraday data expires after 1 hour, daily after 24 hours
    const expiry = timeframe >= 240 ? 24 * 60 * 60 * 1000 : CACHE_EXPIRY_MS
    if (age > expiry) {
      localStorage.removeItem(key)
      return null
    }

    console.log(`[Cache] Hit for ${symbol} ${timeframe}m (${data.length} candles, ${Math.round(age / 1000)}s old)`)
    return data
  } catch (e) {
    console.log('[Cache] Error reading cache:', e.message)
    return null
  }
}

/**
 * Cache candle data
 */
function setCachedCandles(symbol, timeframe, startDate, endDate, candles) {
  try {
    const key = getCacheKey(symbol, timeframe, startDate, endDate)
    const cacheData = {
      data: candles,
      timestamp: Date.now(),
    }
    localStorage.setItem(key, JSON.stringify(cacheData))
    console.log(`[Cache] Stored ${candles.length} candles for ${symbol} ${timeframe}m`)

    // Cleanup old cache entries (keep only last 10)
    cleanupCache()
  } catch (e) {
    console.log('[Cache] Error writing cache:', e.message)
    // If localStorage is full, clear old entries
    if (e.name === 'QuotaExceededError') {
      clearOldCache()
    }
  }
}

/**
 * Clean up old cache entries
 */
function cleanupCache() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        const cached = localStorage.getItem(key)
        if (cached) {
          const { timestamp } = JSON.parse(cached)
          keys.push({ key, timestamp })
        }
      }
    }

    // Keep only 10 most recent entries
    if (keys.length > 10) {
      keys.sort((a, b) => b.timestamp - a.timestamp)
      keys.slice(10).forEach(({ key }) => localStorage.removeItem(key))
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * Clear all candle cache
 */
function clearOldCache() {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
    console.log(`[Cache] Cleared ${keysToRemove.length} old entries`)
  } catch (e) {
    // Ignore
  }
}

/**
 * Force clear all candle cache (for manual refresh)
 */
export function clearCandleCache() {
  clearOldCache()
  console.log('[Cache] All candle cache cleared')
}

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
 * Fetch candle data for a symbol (with localStorage caching)
 * @param {string} symbol - Stock symbol
 * @param {number} timeframe - Timeframe in minutes (5, 15, 60, 240)
 * @param {Object|Date|null} options - Options object or replay datetime for backward compatibility
 * @param {Date|null} options.startDate - Start date for custom range
 * @param {Date|null} options.endDate - End date for custom range
 * @param {Date|null} options.replayDatetime - Replay datetime for historical data
 * @param {boolean} options.skipCache - Skip cache and force fetch
 * @returns {Promise<Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>>}
 */
export async function fetchCandleData(symbol, timeframe, options = null) {
  const config = TF_CONFIG[timeframe] || TF_CONFIG[5]

  // Handle backward compatibility: options can be a Date (replayDatetime) or an object
  let startDate = null
  let endDate = null
  let replayDatetime = null
  let skipCache = false

  if (options instanceof Date) {
    // Backward compatibility: third param is replayDatetime
    replayDatetime = options
  } else if (options && typeof options === 'object') {
    startDate = options.startDate
    endDate = options.endDate
    replayDatetime = options.replayDatetime
    skipCache = options.skipCache || false
  }

  // Check cache first (only for browser environment with localStorage)
  if (typeof localStorage !== 'undefined' && !skipCache && !replayDatetime) {
    const cached = getCachedCandles(symbol, timeframe, startDate, endDate)
    if (cached) {
      return cached
    }
  }

  // Build API URL parameters
  let apiUrl, yahooUrl
  if (startDate && endDate) {
    const startTime = Math.floor(startDate.getTime() / 1000)
    const endTime = Math.floor(endDate.getTime() / 1000)
    apiUrl = `/api/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`
    yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`
    console.log(
      `[Data] Custom range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
    )
  } else if (replayDatetime) {
    const endTime = Math.floor(replayDatetime.getTime() / 1000)
    const startTime = endTime - config.lookback * 24 * 60 * 60
    apiUrl = `/api/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`
    yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`
    console.log(
      `[Data] Replay: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`
    )
  } else {
    apiUrl = `/api/chart/${symbol}?interval=${config.interval}&range=${config.range}`
    yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&range=${config.range}`
  }

  // Try backend API first (handles crumb/cookie auth)
  let data = null
  const backendUrl = `http://localhost:3001${apiUrl}`
  console.log(`[Data] Trying backend: ${backendUrl}`)

  try {
    const response = await fetch(backendUrl, {
      signal: AbortSignal.timeout(10000),
    })
    console.log(`[Data] Backend response status: ${response.status}`)

    if (response.ok) {
      data = await response.json()
      if (data.chart?.result?.[0]) {
        console.log(`[Data] Got ${data.chart.result[0].timestamp?.length || 0} candles from backend`)
      } else {
        console.log('[Data] Backend returned invalid format:', JSON.stringify(data).substring(0, 100))
        data = null // Invalid response, try proxies
      }
    } else {
      console.log('[Data] Backend error:', response.status, response.statusText)
    }
  } catch (e) {
    console.log('[Data] Backend API error:', e.name, e.message)
  }

  // Fallback to CORS proxies
  if (!data) {
    console.log('[Data] Falling back to CORS proxies...')
    data = await fetchWithProxy(yahooUrl)
  }
  // Handle Yahoo 422 errors (date range too long)
  if (data?.success === false && data?.error?.includes('422')) {
    throw new Error('Date range too long for this timeframe. Yahoo Finance has limited historical data for intraday intervals. Try reducing the date range or using a longer timeframe.')
  }

  const candles = parseYahooCandles(data, replayDatetime)

  // Cache the result (only for browser environment)
  if (typeof localStorage !== 'undefined' && !replayDatetime && candles.length > 0) {
    setCachedCandles(symbol, timeframe, startDate, endDate, candles)
  }

  return candles
}

/**
 * Check if timestamp is within regular trading hours (9:30 AM - 4:00 PM ET)
 * @param {number} timestamp - Unix timestamp in ms
 * @returns {boolean}
 */
function isRegularTradingHours(timestamp) {
  const date = new Date(timestamp)

  // Get hour and minute in ET timezone using Intl API
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  })

  const parts = etFormatter.formatToParts(date)
  const hour = parseInt(parts.find(p => p.type === 'hour').value)
  const minute = parseInt(parts.find(p => p.type === 'minute').value)

  const totalMinutes = hour * 60 + minute

  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30   // 9:30 AM ET
  const marketClose = 16 * 60      // 4:00 PM ET

  return totalMinutes >= marketOpen && totalMinutes < marketClose
}

/**
 * Parse Yahoo Finance candle data
 * @param {Object} data - Yahoo Finance API response
 * @param {Date|null} cutoffTime - Optional cutoff for replay mode
 * @param {boolean} filterMarketHours - Filter to regular trading hours only
 * @returns {Array} Parsed candles
 */
function parseYahooCandles(data, cutoffTime = null, filterMarketHours = true) {
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

    // Filter out pre/post market candles
    if (filterMarketHours && !isRegularTradingHours(candleTime)) {
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
