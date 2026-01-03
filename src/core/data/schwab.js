/**
 * Charles Schwab Trader API Client
 * Fetches real-time options data with Greeks, IV, and open interest
 *
 * API Documentation: https://developer.schwab.com/
 * Rate Limit: 120 requests per minute
 */

import { TokenManager, getTokenManager } from './token-manager.js'
import { RateLimiter, getRateLimiter } from './rate-limiter.js'
import { OptionsCache, getCache } from './cache.js'

const SCHWAB_BASE_URL = 'https://api.schwabapi.com/marketdata/v1'

export class SchwabClient {
  constructor(options = {}) {
    this.tokenManager = options.tokenManager || getTokenManager()
    this.rateLimiter = options.rateLimiter || getRateLimiter()
    this.cache = options.cache || getCache()
    this.cacheResults = options.cacheResults ?? true
  }

  /**
   * Make an authenticated request to Schwab API
   * @param {string} endpoint - API endpoint (e.g., '/chains')
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} - API response
   */
  async request(endpoint, params = {}) {
    // Enforce rate limit
    await this.rateLimiter.waitForSlot()

    // Get valid access token
    const token = await this.tokenManager.getAccessToken()

    // Build URL with query params
    const url = new URL(`${SCHWAB_BASE_URL}${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value)
      }
    })

    console.log(`[Schwab] Request: ${endpoint}`)

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Schwab API error (${response.status}): ${errorText}`)
    }

    return response.json()
  }

  /**
   * Fetch options chain for a symbol
   * @param {string} symbol - Stock symbol (e.g., 'SPY')
   * @param {Object} options - API options
   * @returns {Promise<{options: Array, underlyingPrice: number}>}
   */
  async fetchOptionsChain(symbol, options = {}) {
    const params = {
      symbol: symbol.toUpperCase(),
      contractType: options.contractType || 'ALL',
      includeUnderlyingQuote: true,
      strategy: 'SINGLE',
      range: options.range || 'ALL',
    }

    // Filter by strike count if specified
    if (options.strikeCount) {
      params.strikeCount = options.strikeCount
    }

    // Filter by expiration date range
    if (options.fromDate) {
      params.fromDate = options.fromDate
    }
    if (options.toDate) {
      params.toDate = options.toDate
    }

    const data = await this.request('/chains', params)
    const parsed = this.parseOptionsChain(data)

    // Cache the results if enabled
    if (this.cacheResults && parsed.options.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      this.cache.upsertOptionsChain(symbol, today, parsed.options)
      this.cache.setLastFetchTime(symbol, 'chain')
    }

    return parsed
  }

  /**
   * Parse Schwab options chain response into normalized format
   * @param {Object} data - Raw API response
   * @returns {{options: Array, underlyingPrice: number}}
   */
  parseOptionsChain(data) {
    const options = []
    const underlyingPrice = data.underlyingPrice || data.underlying?.last || 0

    // Parse call options
    if (data.callExpDateMap) {
      for (const [expDateKey, strikes] of Object.entries(data.callExpDateMap)) {
        // expDateKey format: "2025-01-17:10" (date:daysToExpiry)
        const expiration = expDateKey.split(':')[0]

        for (const [strikeStr, contracts] of Object.entries(strikes)) {
          const contract = contracts[0] // Get first contract at this strike

          options.push({
            expiration: new Date(expiration),
            strike: parseFloat(strikeStr),
            type: 'call',
            bid: contract.bid || 0,
            ask: contract.ask || 0,
            last: contract.last || 0,
            volume: contract.totalVolume || 0,
            openInterest: contract.openInterest || 0,
            iv: contract.volatility || 0,
            delta: contract.delta || 0,
            gamma: contract.gamma || 0,
            theta: contract.theta || 0,
            vega: contract.vega || 0,
            rho: contract.rho || 0,
            inTheMoney: contract.inTheMoney || false,
          })
        }
      }
    }

    // Parse put options
    if (data.putExpDateMap) {
      for (const [expDateKey, strikes] of Object.entries(data.putExpDateMap)) {
        const expiration = expDateKey.split(':')[0]

        for (const [strikeStr, contracts] of Object.entries(strikes)) {
          const contract = contracts[0]

          options.push({
            expiration: new Date(expiration),
            strike: parseFloat(strikeStr),
            type: 'put',
            bid: contract.bid || 0,
            ask: contract.ask || 0,
            last: contract.last || 0,
            volume: contract.totalVolume || 0,
            openInterest: contract.openInterest || 0,
            iv: contract.volatility || 0,
            delta: contract.delta || 0,
            gamma: contract.gamma || 0,
            theta: contract.theta || 0,
            vega: contract.vega || 0,
            rho: contract.rho || 0,
            inTheMoney: contract.inTheMoney || false,
          })
        }
      }
    }

    return { options, underlyingPrice }
  }

  /**
   * Calculate WASP (Weighted Average Strike Price) from options chain
   * Uses real open interest data
   * @param {Array} options - Parsed options array
   * @param {number} daysToExpiry - Target DTE filter
   * @returns {{callWASP: number, putWASP: number, totalWASP: number}}
   */
  calculateWASP(options, daysToExpiry = 30) {
    const now = new Date()

    // Filter options by DTE range (±10 days from target)
    const filtered = options.filter(opt => {
      const dte = Math.round((opt.expiration - now) / (1000 * 60 * 60 * 24))
      return dte >= (daysToExpiry - 10) && dte <= (daysToExpiry + 10)
    })

    if (filtered.length === 0) {
      console.warn('[Schwab] No options found in DTE range for WASP calculation')
      return { callWASP: 0, putWASP: 0, totalWASP: 0 }
    }

    let callWaspNum = 0, callWaspDen = 0
    let putWaspNum = 0, putWaspDen = 0

    for (const opt of filtered) {
      const oi = opt.openInterest || 0

      if (opt.type === 'call') {
        callWaspNum += opt.strike * oi
        callWaspDen += oi
      } else {
        putWaspNum += opt.strike * oi
        putWaspDen += oi
      }
    }

    const totalNum = callWaspNum + putWaspNum
    const totalDen = callWaspDen + putWaspDen

    return {
      callWASP: callWaspDen > 0 ? callWaspNum / callWaspDen : 0,
      putWASP: putWaspDen > 0 ? putWaspNum / putWaspDen : 0,
      totalWASP: totalDen > 0 ? totalNum / totalDen : 0,
      callOI: callWaspDen,
      putOI: putWaspDen,
      totalOI: totalDen,
    }
  }

  /**
   * Calculate ATM (at-the-money) IV from options chain
   * @param {Array} options - Parsed options array
   * @param {number} underlyingPrice - Current underlying price
   * @param {number} daysToExpiry - Target DTE filter
   * @returns {{avgIV: number, callIV: number, putIV: number}}
   */
  calculateATMIV(options, underlyingPrice, daysToExpiry = 30) {
    const now = new Date()

    // Filter ATM options (within 2% of underlying price) in DTE range
    const filtered = options.filter(opt => {
      const dte = Math.round((opt.expiration - now) / (1000 * 60 * 60 * 24))
      const moneyness = Math.abs(opt.strike - underlyingPrice) / underlyingPrice
      return dte >= (daysToExpiry - 10) && dte <= (daysToExpiry + 10) && moneyness < 0.02
    })

    if (filtered.length === 0) {
      console.warn('[Schwab] No ATM options found for IV calculation')
      return null
    }

    const calls = filtered.filter(o => o.type === 'call')
    const puts = filtered.filter(o => o.type === 'put')

    const avgIV = filtered.reduce((sum, o) => sum + (o.iv || 0), 0) / filtered.length
    const callIV = calls.length > 0
      ? calls.reduce((sum, o) => sum + (o.iv || 0), 0) / calls.length
      : 0
    const putIV = puts.length > 0
      ? puts.reduce((sum, o) => sum + (o.iv || 0), 0) / puts.length
      : 0

    return { avgIV, callIV, putIV }
  }

  /**
   * Calculate IV skew (put IV vs call IV)
   * @param {Array} options - Parsed options array
   * @param {number} underlyingPrice - Current underlying price
   * @param {number} daysToExpiry - Target DTE filter
   * @returns {{otmPutIV: number, otmCallIV: number, atmIV: number, skew: number}}
   */
  calculateIVSkew(options, underlyingPrice, daysToExpiry = 30) {
    const now = new Date()

    // Filter options in DTE range
    const filtered = options.filter(opt => {
      const dte = Math.round((opt.expiration - now) / (1000 * 60 * 60 * 24))
      return dte >= 20 && dte <= 40
    })

    // OTM puts: delta between -0.30 and -0.20
    const otmPuts = filtered.filter(o =>
      o.type === 'put' && o.delta <= -0.20 && o.delta >= -0.30
    )

    // OTM calls: delta between 0.20 and 0.30
    const otmCalls = filtered.filter(o =>
      o.type === 'call' && o.delta >= 0.20 && o.delta <= 0.30
    )

    // ATM options: delta near 0.5
    const atm = filtered.filter(o =>
      o.delta >= 0.45 && o.delta <= 0.55
    )

    const otmPutIV = otmPuts.length > 0
      ? otmPuts.reduce((sum, o) => sum + (o.iv || 0), 0) / otmPuts.length
      : 0
    const otmCallIV = otmCalls.length > 0
      ? otmCalls.reduce((sum, o) => sum + (o.iv || 0), 0) / otmCalls.length
      : 0
    const atmIV = atm.length > 0
      ? atm.reduce((sum, o) => sum + (o.iv || 0), 0) / atm.length
      : 0

    return {
      otmPutIV,
      otmCallIV,
      atmIV,
      skew: otmPutIV - otmCallIV,
      skewRatio: otmCallIV > 0 ? otmPutIV / otmCallIV : 1,
    }
  }

  /**
   * Fetch and calculate WASP for a symbol (convenience method)
   * @param {string} symbol - Stock symbol
   * @param {number} daysToExpiry - Target DTE
   * @returns {Promise<Object>} - WASP data with timestamp
   */
  async fetchWASP(symbol, daysToExpiry = 30) {
    const { options, underlyingPrice } = await this.fetchOptionsChain(symbol)
    const wasp = this.calculateWASP(options, daysToExpiry)

    return {
      date: new Date(),
      time: Date.now(),
      symbol,
      underlyingPrice,
      ...wasp,
    }
  }

  /**
   * Fetch and calculate ATM IV for a symbol (convenience method)
   * @param {string} symbol - Stock symbol
   * @param {number} daysToExpiry - Target DTE
   * @returns {Promise<Object>} - IV data with timestamp
   */
  async fetchATMIV(symbol, daysToExpiry = 30) {
    const { options, underlyingPrice } = await this.fetchOptionsChain(symbol)
    const iv = this.calculateATMIV(options, underlyingPrice, daysToExpiry)

    if (!iv) {
      return null
    }

    // Also cache as volatility data
    if (this.cacheResults) {
      const today = new Date().toISOString().split('T')[0]
      this.cache.upsertVolatility(symbol, today, {
        ivCurrent: iv.avgIV,
        hvCurrent: null, // Would need separate calculation
      })
    }

    return {
      date: new Date(),
      time: Date.now(),
      symbol,
      underlyingPrice,
      ...iv,
    }
  }

  /**
   * Check if API is available and credentials are valid
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      if (!this.tokenManager.hasCredentials()) {
        console.log('[Schwab] No credentials configured')
        return false
      }

      // Try to get a valid token
      await this.tokenManager.getAccessToken()

      // Make a simple request
      await this.request('/quotes', { symbols: 'SPY' })

      console.log('[Schwab] Health check passed')
      return true
    } catch (error) {
      console.error('[Schwab] Health check failed:', error.message)
      return false
    }
  }
}

// Export singleton
let _schwabClient = null

export function getSchwabClient() {
  if (!_schwabClient) {
    _schwabClient = new SchwabClient()
  }
  return _schwabClient
}
