/**
 * Local Express server for Yahoo Finance & EODHD API proxy
 * Handles crumb/cookie authentication that CORS proxies can't handle
 * Proxies EODHD requests to keep API key server-side
 */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

// EODHD API configuration
const EODHD_BASE = 'https://eodhd.com/api'
const EODHD_API_KEY = process.env.EODHD_API_KEY

const YAHOO_BASE = 'https://query1.finance.yahoo.com'

// Enable CORS for all origins (dev mode)
app.use(cors())

// Cache crumb and cookies
let cachedCrumb = null
let cachedCookies = null
let crumbExpiry = 0

async function getCrumbAndCookies() {
  const now = Date.now()
  if (cachedCrumb && cachedCookies && crumbExpiry > now) {
    return { crumb: cachedCrumb, cookies: cachedCookies }
  }

  console.log('[Server] Fetching new crumb...')

  // Step 1: Get cookies from Yahoo Finance page
  const pageResponse = await fetch('https://finance.yahoo.com/quote/SPY', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  })

  const cookies = pageResponse.headers.get('set-cookie') || ''

  // Step 2: Get crumb using cookies
  const crumbResponse = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Cookie: cookies,
      },
    }
  )

  const crumb = await crumbResponse.text()

  if (crumb && !crumb.includes('error')) {
    cachedCrumb = crumb
    cachedCookies = cookies
    crumbExpiry = now + 30 * 60 * 1000 // Cache for 30 minutes
    console.log('[Server] Got crumb:', crumb.substring(0, 10) + '...')
    return { crumb, cookies }
  }

  throw new Error('Failed to get crumb')
}

async function fetchYahoo(url) {
  try {
    // Try with crumb first for options endpoints
    if (url.includes('/v7/finance/options')) {
      const { crumb, cookies } = await getCrumbAndCookies()
      const urlWithCrumb = url + (url.includes('?') ? '&' : '?') + `crumb=${crumb}`

      const response = await fetch(urlWithCrumb, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json',
          Cookie: cookies,
        },
      })

      if (response.ok) {
        return await response.json()
      }
    }

    // Fallback: try without crumb (works for some endpoints)
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Yahoo returned ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('[Server] Fetch error:', error.message)
    throw error
  }
}

// GET /api/chart/:symbol - Fetch candle data with windowed fetching for long intraday ranges
app.get('/api/chart/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const interval = req.query.interval || '5m'
    const range = req.query.range
    const period1 = parseInt(req.query.period1)
    const period2 = parseInt(req.query.period2)

    // For daily data, use EODHD (2+ years history)
    if ((interval === '1d' || interval === 'd') && EODHD_API_KEY && period1 && period2) {
      console.log('[Server] Using EODHD for daily data...')
      const fromDate = new Date(period1 * 1000).toISOString().split('T')[0]
      const toDate = new Date(period2 * 1000).toISOString().split('T')[0]

      const eodhUrl = `${EODHD_BASE}/eod/${symbol}.US?api_token=${EODHD_API_KEY}&period=d&from=${fromDate}&to=${toDate}&fmt=json`
      const eodhRes = await fetch(eodhUrl)
      const eodhData = await eodhRes.json()

      if (Array.isArray(eodhData) && eodhData.length > 0) {
        const timestamps = eodhData.map(d => Math.floor(new Date(d.date).getTime() / 1000))
        return res.json({
          chart: {
            result: [{
              meta: { symbol, currency: 'USD', source: 'eodhd' },
              timestamp: timestamps,
              indicators: {
                quote: [{
                  open: eodhData.map(d => d.open),
                  high: eodhData.map(d => d.high),
                  low: eodhData.map(d => d.low),
                  close: eodhData.map(d => d.close),
                  volume: eodhData.map(d => d.volume),
                }]
              }
            }]
          }
        })
      }
    }

    // For intraday with long range, fetch in 25-day windows and stitch
    const WINDOW_DAYS = 25 // Safe margin under Yahoo's ~30 day limit
    const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60

    if (period1 && period2 && (period2 - period1) > WINDOW_SECONDS) {
      console.log(`[Server] Long intraday range detected, fetching in ${WINDOW_DAYS}-day windows...`)

      let allTimestamps = []
      let allQuotes = { open: [], high: [], low: [], close: [], volume: [] }
      let windowStart = period1
      let windowCount = 0

      while (windowStart < period2) {
        const windowEnd = Math.min(windowStart + WINDOW_SECONDS, period2)
        const windowUrl = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=${interval}&period1=${windowStart}&period2=${windowEnd}`

        console.log(`[Server] Window ${++windowCount}: ${new Date(windowStart*1000).toISOString().split('T')[0]} to ${new Date(windowEnd*1000).toISOString().split('T')[0]}`)

        try {
          const windowData = await fetchYahoo(windowUrl)
          if (windowData?.chart?.result?.[0]) {
            const result = windowData.chart.result[0]
            const quote = result.indicators?.quote?.[0]

            if (result.timestamp && quote) {
              allTimestamps.push(...result.timestamp)
              allQuotes.open.push(...quote.open)
              allQuotes.high.push(...quote.high)
              allQuotes.low.push(...quote.low)
              allQuotes.close.push(...quote.close)
              allQuotes.volume.push(...quote.volume)
            }
          }
        } catch (e) {
          console.log(`[Server] Window ${windowCount} failed: ${e.message}`)
        }

        windowStart = windowEnd
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200))
      }

      if (allTimestamps.length > 0) {
        console.log(`[Server] Stitched ${allTimestamps.length} candles from ${windowCount} windows`)
        return res.json({
          chart: {
            result: [{
              meta: { symbol, currency: 'USD', source: 'yahoo-windowed' },
              timestamp: allTimestamps,
              indicators: { quote: [allQuotes] }
            }]
          }
        })
      }
    }

    // Standard single fetch for short ranges
    let url
    if (period1 && period2) {
      url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=${interval}&period1=${period1}&period2=${period2}`
    } else {
      url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=${interval}&range=${range || '5d'}`
    }
    console.log(`[Server] Fetching chart: ${url}`)
    const data = await fetchYahoo(url)
    return res.json(data)
  } catch (error) {
    console.error('[Server] Chart error:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/quote/:symbol
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=2d`

    const data = await fetchYahoo(url)

    if (data.chart?.result?.[0]) {
      const result = data.chart.result[0]
      const meta = result.meta
      const quotes = result.indicators?.quote?.[0]

      res.json({
        success: true,
        symbol,
        price: meta.regularMarketPrice,
        previousClose:
          meta.previousClose ||
          (quotes?.close ? quotes.close[quotes.close.length - 2] : null),
        timestamp: Date.now(),
      })
    } else {
      throw new Error('Invalid quote response')
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/options/:symbol (get expiries)
app.get('/api/options/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const url = `${YAHOO_BASE}/v7/finance/options/${symbol}`

    const data = await fetchYahoo(url)

    if (data.optionChain?.result?.[0]) {
      const result = data.optionChain.result[0]
      res.json({
        success: true,
        symbol,
        expirationDates: result.expirationDates,
        strikes: result.strikes,
        quote: result.quote,
        timestamp: Date.now(),
      })
    } else {
      throw new Error('Invalid options response')
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/options/:symbol/:expiry (get chain)
app.get('/api/options/:symbol/:expiry', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const expiry = req.params.expiry
    const url = `${YAHOO_BASE}/v7/finance/options/${symbol}?date=${expiry}`

    const data = await fetchYahoo(url)

    if (data.optionChain?.result?.[0]) {
      const result = data.optionChain.result[0]
      // Flatten options array - Yahoo returns [{calls, puts}], frontend expects {calls, puts}
      const optionsData = result.options?.[0] || { calls: [], puts: [] }
      res.json({
        success: true,
        symbol,
        expiry: parseInt(expiry),
        quote: result.quote,
        options: optionsData,
        timestamp: Date.now(),
      })
    } else {
      throw new Error('Invalid options chain response')
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ================== EODHD Endpoints ==================

/**
 * Fetch EODHD options chain and calculate WASP
 */
async function fetchEODHDOptions(symbol, exchange = 'US') {
  if (!EODHD_API_KEY) {
    throw new Error('EODHD_API_KEY not configured')
  }

  const url = `${EODHD_BASE}/options/${symbol}.${exchange}?api_token=${EODHD_API_KEY}&fmt=json`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`EODHD error: ${response.status}`)
  }

  return response.json()
}

/**
 * Parse EODHD options data to standard format
 */
function parseOptionsChain(data) {
  const options = []
  const underlyingPrice = data.lastTradePrice || 0

  for (const expDate of Object.keys(data.data || {})) {
    const expData = data.data[expDate]

    // Calls
    for (const opt of expData.calls || []) {
      options.push({
        expiration: new Date(expDate),
        strike: opt.strike,
        type: 'call',
        bid: opt.bid || 0,
        ask: opt.ask || 0,
        last: opt.lastPrice || 0,
        volume: opt.volume || 0,
        openInterest: opt.openInterest || 0,
        iv: opt.impliedVolatility || 0,
        delta: opt.delta || 0,
        gamma: opt.gamma || 0,
        theta: opt.theta || 0,
        vega: opt.vega || 0,
      })
    }

    // Puts
    for (const opt of expData.puts || []) {
      options.push({
        expiration: new Date(expDate),
        strike: opt.strike,
        type: 'put',
        bid: opt.bid || 0,
        ask: opt.ask || 0,
        last: opt.lastPrice || 0,
        volume: opt.volume || 0,
        openInterest: opt.openInterest || 0,
        iv: opt.impliedVolatility || 0,
        delta: opt.delta || 0,
        gamma: opt.gamma || 0,
        theta: opt.theta || 0,
        vega: opt.vega || 0,
      })
    }
  }

  return { options, underlyingPrice }
}

/**
 * Calculate WASP from options chain
 */
function calculateWASP(options, daysToExpiry = 30) {
  const now = new Date()
  const filtered = options.filter(opt => {
    const dte = Math.round((new Date(opt.expiration) - now) / (1000 * 60 * 60 * 24))
    return dte >= (daysToExpiry - 10) && dte <= (daysToExpiry + 10)
  })

  let callNum = 0, callDen = 0, putNum = 0, putDen = 0

  for (const opt of filtered) {
    const oi = opt.openInterest || 0
    if (opt.type === 'call') {
      callNum += opt.strike * oi
      callDen += oi
    } else {
      putNum += opt.strike * oi
      putDen += oi
    }
  }

  return {
    callWASP: callDen > 0 ? callNum / callDen : 0,
    putWASP: putDen > 0 ? putNum / putDen : 0,
    totalWASP: (callDen + putDen) > 0 ? (callNum + putNum) / (callDen + putDen) : 0,
    callOI: callDen,
    putOI: putDen,
  }
}

// GET /api/eodhd/options/:symbol - Full options chain
app.get('/api/eodhd/options/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const data = await fetchEODHDOptions(symbol)
    const { options, underlyingPrice } = parseOptionsChain(data)

    res.json({
      success: true,
      symbol,
      underlyingPrice,
      options,
      optionCount: options.length,
      timestamp: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/eodhd/wasp/:symbol - Calculate WASP
app.get('/api/eodhd/wasp/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const daysToExpiry = parseInt(req.query.dte) || 30
    const data = await fetchEODHDOptions(symbol)
    const { options, underlyingPrice } = parseOptionsChain(data)
    const wasp = calculateWASP(options, daysToExpiry)

    res.json({
      success: true,
      symbol,
      underlyingPrice,
      daysToExpiry,
      ...wasp,
      timestamp: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/eodhd/status - Check if EODHD is configured
app.get('/api/eodhd/status', (req, res) => {
  res.json({
    success: true,
    configured: !!EODHD_API_KEY,
    timestamp: Date.now(),
  })
})

// ================== Unicorn Marketplace Endpoints ==================

const UNICORN_BASE = 'https://eodhd.com/api/mp/unicornbay'

/**
 * Helper: Add days to a date and return YYYY-MM-DD
 */
function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result.toISOString().split('T')[0]
}

/**
 * Fetch options from Unicorn API with pagination
 */
async function fetchUnicornOptions(symbol, params = {}) {
  if (!EODHD_API_KEY) {
    throw new Error('EODHD_API_KEY not configured')
  }

  const url = new URL(`${UNICORN_BASE}/options/contracts`)
  url.searchParams.set('api_token', EODHD_API_KEY)
  url.searchParams.set('filter[underlying_symbol]', symbol.toUpperCase())

  // Convert DTE to expiration date filters
  const today = new Date()
  if (params.dteMin !== undefined) {
    url.searchParams.set('filter[exp_date_from]', addDays(today, params.dteMin))
  }
  if (params.dteMax !== undefined) {
    url.searchParams.set('filter[exp_date_to]', addDays(today, params.dteMax))
  }

  // Other filters
  if (params.type) url.searchParams.set('filter[type]', params.type)
  if (params.tradetime) url.searchParams.set('filter[tradetime_eq]', params.tradetime)
  if (params.expDateFrom) url.searchParams.set('filter[exp_date_from]', params.expDateFrom)
  if (params.expDateTo) url.searchParams.set('filter[exp_date_to]', params.expDateTo)

  url.searchParams.set('page[limit]', params.limit || 1000)
  url.searchParams.set('page[offset]', params.offset || 0)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Unicorn API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Parse Unicorn response to standard format
 */
function parseUnicornOptions(data) {
  return (data.data || []).map(item => {
    const attr = item.attributes
    return {
      contract: attr.contract,
      symbol: attr.underlying_symbol,
      expiration: attr.exp_date,
      type: attr.type,
      strike: attr.strike,
      bid: attr.bid || 0,
      ask: attr.ask || 0,
      last: attr.last || 0,
      volume: attr.volume || 0,
      openInterest: attr.open_interest || 0,
      iv: attr.volatility || 0,
      delta: attr.delta || 0,
      gamma: attr.gamma || 0,
      theta: attr.theta || 0,
      vega: attr.vega || 0,
      dte: attr.dte,
      tradetime: attr.tradetime,
    }
  })
}

/**
 * Calculate WASP from Unicorn options
 */
function calculateUnicornWASP(options) {
  let callNum = 0, callDen = 0, putNum = 0, putDen = 0

  for (const opt of options) {
    const oi = opt.openInterest || 0
    if (oi === 0) continue

    if (opt.type === 'call') {
      callNum += opt.strike * oi
      callDen += oi
    } else if (opt.type === 'put') {
      putNum += opt.strike * oi
      putDen += oi
    }
  }

  return {
    callWASP: callDen > 0 ? callNum / callDen : 0,
    putWASP: putDen > 0 ? putNum / putDen : 0,
    totalWASP: (callDen + putDen) > 0 ? (callNum + putNum) / (callDen + putDen) : 0,
    callOI: callDen,
    putOI: putDen,
    totalOI: callDen + putDen,
  }
}

// GET /api/unicorn/options/:symbol - Fetch options contracts
app.get('/api/unicorn/options/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const dteMin = req.query.dte_min ? parseInt(req.query.dte_min) : undefined
    const dteMax = req.query.dte_max ? parseInt(req.query.dte_max) : undefined
    const type = req.query.type
    const limit = parseInt(req.query.limit) || 1000

    const data = await fetchUnicornOptions(symbol, { dteMin, dteMax, type, limit })
    const options = parseUnicornOptions(data)

    res.json({
      success: true,
      symbol,
      options,
      total: data.meta?.total || options.length,
      timestamp: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/unicorn/wasp/:symbol - Calculate live WASP
app.get('/api/unicorn/wasp/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const daysToExpiry = parseInt(req.query.dte) || 30
    const dteMin = Math.max(0, daysToExpiry - 10)
    const dteMax = daysToExpiry + 10

    // Fetch all options in DTE range (with pagination)
    let allOptions = []
    let offset = 0
    const limit = 1000

    while (true) {
      const data = await fetchUnicornOptions(symbol, { dteMin, dteMax, limit, offset })
      const options = parseUnicornOptions(data)
      allOptions.push(...options)

      if (options.length < limit || allOptions.length >= (data.meta?.total || 0)) break
      offset += limit
      if (offset > 10000) break // Safety limit
    }

    const wasp = calculateUnicornWASP(allOptions)

    res.json({
      success: true,
      symbol,
      daysToExpiry,
      ...wasp,
      optionCount: allOptions.length,
      source: 'unicorn',
      timestamp: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/unicorn/wasp/:symbol/history - Get historical WASP for a date
app.get('/api/unicorn/wasp/:symbol/history', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    const date = req.query.date // YYYY-MM-DD
    const daysToExpiry = parseInt(req.query.dte) || 30

    if (!date) {
      return res.status(400).json({ success: false, error: 'date parameter required (YYYY-MM-DD)' })
    }

    // Fetch options for that tradetime
    let allOptions = []
    let offset = 0
    const limit = 1000

    while (true) {
      const data = await fetchUnicornOptions(symbol, { tradetime: date, limit, offset })
      const options = parseUnicornOptions(data)
      allOptions.push(...options)

      if (options.length < limit || allOptions.length >= (data.meta?.total || 0)) break
      offset += limit
      if (offset > 10000) break
    }

    // Filter by DTE range
    const dteMin = Math.max(0, daysToExpiry - 10)
    const dteMax = daysToExpiry + 10
    const filtered = allOptions.filter(opt => opt.dte >= dteMin && opt.dte <= dteMax)

    const wasp = calculateUnicornWASP(filtered)

    res.json({
      success: true,
      symbol,
      date,
      daysToExpiry,
      ...wasp,
      optionCount: filtered.length,
      source: 'unicorn',
      timestamp: Date.now(),
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/unicorn/status - Check Unicorn API status
app.get('/api/unicorn/status', (req, res) => {
  res.json({
    success: true,
    configured: !!EODHD_API_KEY,
    source: 'unicorn-marketplace',
    timestamp: Date.now(),
  })
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Yahoo Finance & EODHD Proxy',
    eodhd: !!EODHD_API_KEY,
    timestamp: Date.now(),
  })
})

app.listen(PORT, () => {
  console.log(`[Server] API proxy running on http://localhost:${PORT}`)
  console.log('[Server] Yahoo Finance endpoints:')
  console.log('  GET /api/chart/:symbol    (candle data)')
  console.log('  GET /api/quote/:symbol')
  console.log('  GET /api/options/:symbol')
  console.log('  GET /api/options/:symbol/:expiry')
  console.log('[Server] Unicorn Options endpoints:')
  console.log(`  GET /api/unicorn/options/:symbol  ${EODHD_API_KEY ? '(configured)' : '(not configured)'}`)
  console.log(`  GET /api/unicorn/wasp/:symbol     ${EODHD_API_KEY ? '(configured)' : '(not configured)'}`)
  console.log(`  GET /api/unicorn/wasp/:symbol/history`)
  console.log('  GET /api/unicorn/status')
})
