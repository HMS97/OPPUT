/**
 * Unicorn Data Services Options API Client
 * EODHD Marketplace: https://eodhd.com/marketplace/unicornbay/options
 *
 * Provides:
 * - Daily updated options data for 6,000+ US stocks
 * - 2-year historical data
 * - Greeks, IV, OI, bid/ask prices
 */

const UNICORN_BASE = 'https://eodhd.com/api/mp/unicornbay'

export class UnicornClient {
  constructor(apiKey = null) {
    // In browser, apiKey will be null (use proxy)
    // In Node.js, use env variable
    this.apiKey = apiKey || (typeof process !== 'undefined' ? process.env?.EODHD_API_KEY : null)
    this.isBrowser = typeof window !== 'undefined'
  }

  /**
   * Build URL with proper encoding for bracket params
   */
  _buildUrl(endpoint, params = {}) {
    const url = new URL(`${UNICORN_BASE}${endpoint}`)
    if (this.apiKey) {
      url.searchParams.set('api_token', this.apiKey)
    }

    // Handle nested params like filter[symbol], page[limit]
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value)
      }
    })

    return url.toString()
  }

  /**
   * Make API request
   */
  async request(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('EODHD_API_KEY not configured')
    }

    const url = this._buildUrl(endpoint, params)
    const response = await fetch(url)

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Unicorn API error ${response.status}: ${text.substring(0, 100)}`)
    }

    return response.json()
  }

  /**
   * Fetch options contracts for a symbol
   * @param {string} symbol - Stock symbol (e.g., 'SPY')
   * @param {Object} options - Filter options
   * @param {number} options.dteMin - Minimum days to expiry
   * @param {number} options.dteMax - Maximum days to expiry
   * @param {string} options.type - 'call' or 'put' (optional)
   * @param {number} options.limit - Max records (default 1000)
   */
  async fetchOptionsContracts(symbol, options = {}) {
    const params = {
      'filter[underlying_symbol]': symbol.toUpperCase(),
    }

    if (options.dteMin !== undefined) {
      params['filter[dte_gte]'] = options.dteMin
    }
    if (options.dteMax !== undefined) {
      params['filter[dte_lte]'] = options.dteMax
    }
    if (options.type) {
      params['filter[type]'] = options.type.toLowerCase()
    }
    if (options.strikeMin !== undefined) {
      params['filter[strike_gte]'] = options.strikeMin
    }
    if (options.strikeMax !== undefined) {
      params['filter[strike_lte]'] = options.strikeMax
    }
    if (options.tradetime) {
      params['filter[tradetime]'] = options.tradetime
    }

    params['page[limit]'] = options.limit || 1000
    params['page[offset]'] = options.offset || 0

    const data = await this.request('/options/contracts', params)
    return this._parseContractsResponse(data)
  }

  /**
   * Parse API response to standard format
   */
  _parseContractsResponse(data) {
    const options = (data.data || []).map(item => {
      const attr = item.attributes
      return {
        contract: attr.contract,
        symbol: attr.underlying_symbol,
        expiration: new Date(attr.exp_date),
        expirationType: attr.expiration_type,
        type: attr.type, // 'call' or 'put'
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
        rho: attr.rho || 0,
        dte: attr.dte,
        moneyness: attr.moneyness,
        tradetime: attr.tradetime ? new Date(attr.tradetime) : null,
        midpoint: attr.midpoint || 0,
      }
    })

    return {
      options,
      meta: data.meta,
      total: data.meta?.total || options.length,
    }
  }

  /**
   * Fetch all options for WASP calculation (paginated)
   * @param {string} symbol - Stock symbol
   * @param {number} daysToExpiry - Target DTE (will fetch ±10 days)
   */
  async fetchOptionsForWASP(symbol, daysToExpiry = 30) {
    const allOptions = []
    let offset = 0
    const limit = 1000
    const dteMin = Math.max(0, daysToExpiry - 10)
    const dteMax = daysToExpiry + 10

    // Fetch all pages
    while (true) {
      const result = await this.fetchOptionsContracts(symbol, {
        dteMin,
        dteMax,
        limit,
        offset,
      })

      allOptions.push(...result.options)

      if (result.options.length < limit || allOptions.length >= result.total) {
        break
      }
      offset += limit

      // Safety limit
      if (offset > 10000) break
    }

    return allOptions
  }

  /**
   * Calculate WASP from options data
   * @param {Array} options - Options contracts array
   */
  calculateWASP(options) {
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
      optionCount: options.length,
    }
  }

  /**
   * Get live WASP for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} daysToExpiry - Target DTE
   */
  async getLiveWASP(symbol, daysToExpiry = 30) {
    const options = await this.fetchOptionsForWASP(symbol, daysToExpiry)
    const wasp = this.calculateWASP(options)

    return {
      date: new Date(),
      time: Date.now(),
      symbol,
      ...wasp,
      daysToExpiry,
      source: 'unicorn',
    }
  }

  /**
   * Fetch historical options for a specific date
   * Uses tradetime filter
   * @param {string} symbol - Stock symbol
   * @param {string} date - Date string YYYY-MM-DD
   * @param {number} daysToExpiry - Target DTE
   */
  async fetchHistoricalOptions(symbol, date, daysToExpiry = 30) {
    const allOptions = []
    let offset = 0
    const limit = 1000

    while (true) {
      const result = await this.fetchOptionsContracts(symbol, {
        tradetime: date,
        limit,
        offset,
      })

      allOptions.push(...result.options)

      if (result.options.length < limit || allOptions.length >= result.total) {
        break
      }
      offset += limit

      if (offset > 10000) break
    }

    // Filter by DTE range
    const dteMin = Math.max(0, daysToExpiry - 10)
    const dteMax = daysToExpiry + 10

    return allOptions.filter(opt => opt.dte >= dteMin && opt.dte <= dteMax)
  }

  /**
   * Get historical WASP for a date range
   * @param {string} symbol - Stock symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {number} daysToExpiry - Target DTE
   */
  async getHistoricalWASP(symbol, startDate, endDate, daysToExpiry = 30) {
    const results = []
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0]

      try {
        const options = await this.fetchHistoricalOptions(symbol, dateStr, daysToExpiry)

        if (options.length > 0) {
          const wasp = this.calculateWASP(options)
          results.push({
            date: new Date(dateStr),
            time: new Date(dateStr).getTime(),
            ...wasp,
            source: 'unicorn',
          })
        }
      } catch (error) {
        console.warn(`[Unicorn] Failed to fetch ${dateStr}:`, error.message)
      }

      // Move to next day
      current.setDate(current.getDate() + 1)
    }

    return results
  }

  hasCredentials() {
    return !!this.apiKey
  }
}

// Singleton
let _client = null
export function getUnicornClient() {
  if (!_client) _client = new UnicornClient()
  return _client
}
