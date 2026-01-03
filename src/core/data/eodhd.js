/**
 * EODHD Options Data Client
 * Simple API key auth, no OAuth required
 * https://eodhd.com/financial-apis/stock-options-data
 */

const EODHD_BASE = 'https://eodhd.com/api'

export class EODHDClient {
  constructor(apiKey = process.env.EODHD_API_KEY) {
    this.apiKey = apiKey
  }

  async request(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('EODHD_API_KEY not configured')
    }

    const url = new URL(`${EODHD_BASE}${endpoint}`)
    url.searchParams.set('api_token', this.apiKey)
    url.searchParams.set('fmt', 'json')
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, v)
    })

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`EODHD error: ${response.status}`)
    }
    return response.json()
  }

  /**
   * Fetch options chain for a symbol
   */
  async fetchOptionsChain(symbol, exchange = 'US') {
    const data = await this.request(`/options/${symbol}.${exchange}`)
    return this.parseOptionsChain(data)
  }

  parseOptionsChain(data) {
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
  calculateWASP(options, daysToExpiry = 30) {
    const now = new Date()
    const filtered = options.filter(opt => {
      const dte = Math.round((opt.expiration - now) / (1000 * 60 * 60 * 24))
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

  /**
   * Calculate ATM IV
   */
  calculateATMIV(options, underlyingPrice, daysToExpiry = 30) {
    const now = new Date()
    const filtered = options.filter(opt => {
      const dte = Math.round((opt.expiration - now) / (1000 * 60 * 60 * 24))
      const moneyness = Math.abs(opt.strike - underlyingPrice) / underlyingPrice
      return dte >= (daysToExpiry - 10) && dte <= (daysToExpiry + 10) && moneyness < 0.02
    })

    if (filtered.length === 0) return null

    const avgIV = filtered.reduce((s, o) => s + (o.iv || 0), 0) / filtered.length
    return { avgIV }
  }

  hasCredentials() {
    return !!this.apiKey
  }
}

// Singleton
let _client = null
export function getEODHDClient() {
  if (!_client) _client = new EODHDClient()
  return _client
}
