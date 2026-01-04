/**
 * Twelve Data API Integration
 *
 * Free tier: 800 API calls/day
 * Historical intraday data: Several months to 1 year for equities
 *
 * Uses backend proxy at /api/twelvedata/chart/:symbol which reads
 * TWELVEDATA_API_KEY from environment variable.
 */

/**
 * Fetch candle data from Twelve Data via backend proxy
 * @param {string} symbol - Stock symbol (e.g., 'SPY')
 * @param {number} timeframe - Timeframe in minutes (5, 15, 60, 240)
 * @param {Object} options - Options
 * @param {string} options.apiKey - Optional API key (uses backend env if not provided)
 * @param {Date} options.startDate - Start date
 * @param {Date} options.endDate - End date
 * @returns {Promise<Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>>}
 */
export async function fetchTwelveDataCandles(symbol, timeframe, options = {}) {
  const { apiKey, startDate, endDate } = options

  // Try backend proxy first (uses env variable for API key)
  const backendUrl = buildBackendUrl(symbol, timeframe, startDate, endDate)
  console.log(`[TwelveData] Trying backend proxy: ${backendUrl}`)

  try {
    const response = await fetch(backendUrl, {
      signal: AbortSignal.timeout(30000),
    })

    if (response.ok) {
      const data = await response.json()

      if (data.chart?.result?.[0]) {
        const result = data.chart.result[0]
        const timestamps = result.timestamp || []
        const quote = result.indicators?.quote?.[0] || {}

        console.log(`[TwelveData] Backend returned ${timestamps.length} candles`)

        const candles = timestamps.map((ts, i) => ({
          time: ts * 1000,
          open: quote.open?.[i] || 0,
          high: quote.high?.[i] || 0,
          low: quote.low?.[i] || 0,
          close: quote.close?.[i] || 0,
          volume: quote.volume?.[i] || 0,
        })).filter(c => c.close > 0)

        // Filter to regular trading hours
        const filteredCandles = candles.filter(c => isRegularTradingHours(c.time))
        console.log(`[TwelveData] ${filteredCandles.length} candles after filtering to market hours`)

        return filteredCandles
      }

      // Check for error in response
      if (data.success === false) {
        throw new Error(data.error || 'Backend returned error')
      }
    }
  } catch (error) {
    console.log(`[TwelveData] Backend error: ${error.message}`)
  }

  // Fallback: Direct API call with user-provided API key
  if (apiKey) {
    console.log('[TwelveData] Falling back to direct API call...')
    return fetchTwelveDataDirect(symbol, timeframe, apiKey, startDate, endDate)
  }

  throw new Error('Twelve Data: Backend not configured. Set TWELVEDATA_API_KEY in .env or enter API key manually.')
}

/**
 * Build backend proxy URL
 */
function buildBackendUrl(symbol, timeframe, startDate, endDate) {
  const params = new URLSearchParams({ timeframe: timeframe.toString() })
  if (startDate) params.append('start_date', formatDate(startDate))
  if (endDate) params.append('end_date', formatDate(endDate))
  return `http://localhost:3001/api/twelvedata/chart/${symbol}?${params.toString()}`
}

/**
 * Direct Twelve Data API call (fallback when backend unavailable)
 */
async function fetchTwelveDataDirect(symbol, timeframe, apiKey, startDate, endDate) {
  const INTERVAL_MAP = { 5: '5min', 15: '15min', 60: '1h', 240: '4h' }
  const interval = INTERVAL_MAP[timeframe] || '5min'

  const params = new URLSearchParams({
    symbol,
    interval,
    apikey: apiKey,
    outputsize: '5000',
    format: 'JSON',
    timezone: 'America/New_York',  // ET timezone for market hours alignment
  })

  // Use market hours timestamps to ensure complete data
  if (startDate) params.append('start_date', formatDateTime(startDate, '09:30:00'))
  if (endDate) params.append('end_date', formatDateTime(endDate, '16:00:00'))

  const url = `https://api.twelvedata.com/time_series?${params.toString()}`
  console.log(`[TwelveData] Direct API call to ${symbol} ${interval}...`)

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`)
  }

  const data = await response.json()

  if (data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message}`)
  }

  if (!data.values || !Array.isArray(data.values)) {
    throw new Error('Invalid response format from Twelve Data')
  }

  console.log(`[TwelveData] Received ${data.values.length} candles`)

  const candles = data.values
    .map(v => ({
      time: new Date(v.datetime).getTime(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    }))
    .filter(c => !isNaN(c.time) && !isNaN(c.close))
    .reverse()

  const filteredCandles = candles.filter(c => isRegularTradingHours(c.time))
  console.log(`[TwelveData] ${filteredCandles.length} candles after filtering to market hours`)

  return filteredCandles
}

/**
 * Format date for Twelve Data API (YYYY-MM-DD)
 * The server will append market hours (09:30:00 / 16:00:00)
 */
function formatDate(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Format date with time for direct API calls (YYYY-MM-DD HH:mm:ss)
 */
function formatDateTime(date, time = '09:30:00') {
  return `${formatDate(date)} ${time}`
}

/**
 * Check if timestamp is within regular trading hours (9:30 AM - 4:00 PM ET)
 */
function isRegularTradingHours(timestamp) {
  const date = new Date(timestamp)

  // Get hour and minute in ET timezone
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
 * Validate Twelve Data API key by making a test request
 * @param {string} apiKey - API key to validate
 * @returns {Promise<boolean>}
 */
export async function validateTwelveDataApiKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return false
  }

  try {
    const url = `${TWELVE_DATA_BASE_URL}/time_series?symbol=SPY&interval=1day&outputsize=1&apikey=${apiKey}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json()
    return data.status !== 'error'

  } catch (error) {
    console.error('[TwelveData] API key validation error:', error.message)
    return false
  }
}

/**
 * Get data limits for Twelve Data
 * Twelve Data provides more historical data than Yahoo Finance
 */
export const TWELVE_DATA_LIMITS = {
  5: { label: '6 months', days: 180 },
  15: { label: '6 months', days: 180 },
  60: { label: '1 year', days: 365 },
  240: { label: '2 years', days: 730 },
}
