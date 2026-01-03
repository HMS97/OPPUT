/**
 * Data Pipeline - Unified Data Access Layer
 *
 * In Node.js environment (scripts, server):
 * 1. Check local SQLite cache
 * 2. If today and cache miss → fetch from Schwab API
 * 3. If historical and cache miss → fallback to DoltHub
 *
 * In Browser environment (frontend):
 * - Uses DoltHub directly (no SQLite/Schwab)
 *
 * This provides seamless migration from DoltHub to Schwab while
 * building up local historical data over time.
 */

import * as dolthub from './dolthub.js'
import { EODHDClient, getEODHDClient } from './eodhd.js'
import { UnicornClient, getUnicornClient } from './unicorn.js'

// Detect environment
const isBrowser = typeof window !== 'undefined'

// Server proxy URL for browser access to EODHD/Unicorn
const SERVER_PROXY_URL = 'http://localhost:3001'

// Dynamic imports for Node.js only (null in browser)
let OptionsCache = null
let getCache = null

export class DataPipeline {
  constructor(config = {}) {
    this.useDoltHubFallback = config.useDoltHubFallback ?? true
    this.preferLive = config.preferLive ?? false
    this.useUnicornProxy = config.useUnicornProxy ?? true // Use Unicorn proxy for live data
    this.isBrowser = isBrowser
    this._eodhd = null
    this._unicorn = null
    this._cache = null
    this._proxyAvailable = null // Cache proxy availability check
  }

  /**
   * Get the Unicorn client (Node.js only)
   */
  get unicorn() {
    if (!this._unicorn) {
      this._unicorn = getUnicornClient()
    }
    return this._unicorn
  }

  /**
   * Check if server Unicorn proxy is available (browser only)
   * Uses 500ms timeout to avoid blocking - proxy is optional
   */
  async _checkProxyAvailable() {
    if (!this.isBrowser) return false
    if (this._proxyAvailable !== null) return this._proxyAvailable

    try {
      const response = await fetch(`${SERVER_PROXY_URL}/api/unicorn/status`, {
        signal: AbortSignal.timeout(500) // Fast timeout - proxy is optional
      })
      const data = await response.json()
      this._proxyAvailable = data.success && data.configured
      return this._proxyAvailable
    } catch {
      this._proxyAvailable = false
      return false
    }
  }

  /**
   * Fetch WASP from Unicorn proxy (browser only)
   */
  async _fetchWASPFromProxy(symbol, daysToExpiry = 30) {
    const response = await fetch(
      `${SERVER_PROXY_URL}/api/unicorn/wasp/${symbol}?dte=${daysToExpiry}`
    )
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`)
    }
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Proxy request failed')
    }
    return {
      date: new Date(),
      time: Date.now(),
      callWASP: data.callWASP,
      putWASP: data.putWASP,
      totalWASP: data.totalWASP,
      callOI: data.callOI,
      putOI: data.putOI,
      totalOI: data.totalOI,
      source: 'unicorn-proxy',
    }
  }

  /**
   * Fetch historical WASP from Unicorn proxy (browser only)
   */
  async _fetchHistoricalWASPFromProxy(symbol, date, daysToExpiry = 30) {
    const response = await fetch(
      `${SERVER_PROXY_URL}/api/unicorn/wasp/${symbol}/history?date=${date}&dte=${daysToExpiry}`
    )
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`)
    }
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Proxy request failed')
    }
    return {
      date: new Date(date),
      time: new Date(date).getTime(),
      callWASP: data.callWASP,
      putWASP: data.putWASP,
      totalWASP: data.totalWASP,
      callOI: data.callOI,
      putOI: data.putOI,
      source: 'unicorn-proxy',
    }
  }

  /**
   * Fetch options chain from Unicorn proxy (browser only)
   */
  async _fetchOptionsFromProxy(symbol, dteMin, dteMax) {
    let url = `${SERVER_PROXY_URL}/api/unicorn/options/${symbol}?limit=1000`
    if (dteMin !== undefined) url += `&dte_min=${dteMin}`
    if (dteMax !== undefined) url += `&dte_max=${dteMax}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`)
    }
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Proxy request failed')
    }
    return {
      options: data.options,
      total: data.total,
    }
  }

  /**
   * Initialize Node.js modules (SQLite, Schwab client)
   * Call this in Node.js scripts before using the pipeline
   */
  static async initNodeModules() {
    if (isBrowser) return

    try {
      const cacheModule = await import('./cache.js')
      OptionsCache = cacheModule.OptionsCache
      getCache = cacheModule.getCache
      console.log('[Pipeline] Node.js modules loaded')
    } catch (error) {
      console.warn('[Pipeline] Failed to load Node.js modules:', error.message)
    }
  }

  /**
   * Get the cache instance (Node.js only)
   */
  get cache() {
    if (this.isBrowser) return null
    if (this._cache) return this._cache
    if (getCache) {
      this._cache = getCache()
      return this._cache
    }
    return null
  }

  /**
   * Get the EODHD client (works in browser too)
   */
  get eodhd() {
    if (!this._eodhd) {
      this._eodhd = getEODHDClient()
    }
    return this._eodhd
  }

  /**
   * Get today's date string
   */
  _today() {
    return new Date().toISOString().split('T')[0]
  }

  /**
   * Check if a date is today
   */
  _isToday(date) {
    return date.toISOString().split('T')[0] === this._today()
  }

  // ================== IV History ==================

  /**
   * Fetch IV history - combines cache + live data + fallback
   * Matches dolthub.fetchIVHistory signature
   */
  async fetchIVHistory(symbol, startDate, endDate) {
    // Browser: use DoltHub directly
    if (this.isBrowser) {
      return dolthub.fetchIVHistory(symbol, startDate, endDate)
    }

    const today = this._today()

    console.log(`[Pipeline] Fetching IV history for ${symbol}`)

    // Get cached data first
    let data = this.cache ? this.cache.queryIVHistory(symbol, startDate, endDate) : []

    // If end date includes today, try to get live data
    if (endDate.toISOString().split('T')[0] >= today) {
      try {
        const liveData = await this._fetchAndCacheLiveIV(symbol)
        if (liveData) {
          // Merge: remove today from cached data if exists, add live
          data = [
            ...data.filter(d => d.date.toISOString().split('T')[0] !== today),
            liveData,
          ]
        }
      } catch (error) {
        console.warn('[Pipeline] Failed to fetch live IV:', error.message)
        // Continue with cached data
      }
    }

    // If no data and fallback enabled, try DoltHub
    if (data.length === 0 && this.useDoltHubFallback) {
      console.log('[Pipeline] Cache empty, falling back to DoltHub')
      try {
        return await dolthub.fetchIVHistory(symbol, startDate, endDate)
      } catch (error) {
        console.error('[Pipeline] DoltHub fallback failed:', error.message)
        return []
      }
    }

    return data.sort((a, b) => a.date - b.date)
  }

  /**
   * Fetch live IV from Schwab and cache it
   */
  async _fetchAndCacheLiveIV(symbol) {
    if (!this.eodhd.hasCredentials()) {
      return null
    }

    const { options, underlyingPrice } = await this.eodhd.fetchOptionsChain(symbol)
    const atmIV = this.eodhd.calculateATMIV(options, underlyingPrice)

    if (!atmIV) return null

    const today = new Date()
    const ivData = {
      date: today,
      time: today.getTime(),
      ivCurrent: atmIV.avgIV,
      hvCurrent: null,
      ivWeekAgo: null,
      ivMonthAgo: null,
      ivYearHigh: null,
      ivYearLow: null,
    }

    // Cache the data
    if (this.cache) {
      this.cache.upsertVolatility(symbol, this._today(), ivData)
    }

    return ivData
  }

  // ================== Options Chain ==================

  /**
   * Fetch options chain for a specific date
   * Matches dolthub.fetchOptionsChainForDate signature
   */
  async fetchOptionsChainForDate(symbol, date, daysToExpiry = null) {
    // Browser: use DoltHub directly
    if (this.isBrowser) {
      return dolthub.fetchOptionsChainForDate(symbol, date, daysToExpiry)
    }

    const dateStr = date.toISOString().split('T')[0]
    const today = this._today()

    console.log(`[Pipeline] Fetching options chain for ${symbol} on ${dateStr}`)

    // Check cache first
    let cached = this.cache ? this.cache.queryOptionsChainForDate(symbol, date, daysToExpiry) : []
    if (cached.length > 0) {
      console.log(`[Pipeline] Cache hit: ${cached.length} options`)
      return cached
    }

    // If today, fetch from EODHD
    if (dateStr === today && this.eodhd.hasCredentials()) {
      try {
        const { options } = await this.eodhd.fetchOptionsChain(symbol)
        return options
      } catch (error) {
        console.warn('[Pipeline] EODHD fetch failed:', error.message)
      }
    }

    // Historical or Schwab failed - try DoltHub fallback
    if (this.useDoltHubFallback) {
      console.log('[Pipeline] Falling back to DoltHub')
      try {
        return await dolthub.fetchOptionsChainForDate(symbol, date, daysToExpiry)
      } catch (error) {
        console.error('[Pipeline] DoltHub fallback failed:', error.message)
      }
    }

    return []
  }

  // ================== ATM IV History ==================

  /**
   * Fetch ATM IV history
   * Matches dolthub.fetchATMIVHistory signature
   */
  async fetchATMIVHistory(symbol, startDate, endDate, daysToExpiry = 30) {
    // Browser: use DoltHub directly
    if (this.isBrowser) {
      return dolthub.fetchATMIVHistory(symbol, startDate, endDate, daysToExpiry)
    }

    console.log(`[Pipeline] Fetching ATM IV history for ${symbol}`)

    // Check cache first
    let data = this.cache ? this.cache.queryATMIVHistory(symbol, startDate, endDate, daysToExpiry) : []

    // Try to add live data for today
    if (endDate.toISOString().split('T')[0] >= this._today() && this.eodhd.hasCredentials()) {
      try {
        const { options, underlyingPrice } = await this.eodhd.fetchOptionsChain(symbol)
        const atmIV = this.eodhd.calculateATMIV(options, underlyingPrice, daysToExpiry)
        if (atmIV) {
          const now = new Date()
          data = [
            ...data.filter(d => d.date.toISOString().split('T')[0] !== this._today()),
            { date: now, time: now.getTime(), avgIV: atmIV.avgIV, callIV: 0, putIV: 0, optionCount: 1 },
          ]
        }
      } catch (error) {
        console.warn('[Pipeline] Failed to fetch live ATM IV:', error.message)
      }
    }

    // Fallback to DoltHub if empty
    if (data.length === 0 && this.useDoltHubFallback) {
      console.log('[Pipeline] Falling back to DoltHub for ATM IV')
      try {
        return await dolthub.fetchATMIVHistory(symbol, startDate, endDate, daysToExpiry)
      } catch (error) {
        console.error('[Pipeline] DoltHub fallback failed:', error.message)
        return []
      }
    }

    return data.sort((a, b) => a.date - b.date)
  }

  // ================== IV Skew ==================

  /**
   * Fetch IV skew history
   * Matches dolthub.fetchIVSkewHistory signature
   */
  async fetchIVSkewHistory(symbol, startDate, endDate) {
    // Browser: use DoltHub directly
    if (this.isBrowser) {
      return dolthub.fetchIVSkewHistory(symbol, startDate, endDate)
    }

    console.log(`[Pipeline] Fetching IV skew history for ${symbol}`)

    // Check cache first
    let data = this.cache ? this.cache.queryIVSkewHistory(symbol, startDate, endDate) : []

    // Live skew not supported by EODHD (no OTM delta filtering)
    // Skip live fetch, rely on cache/DoltHub

    // Fallback to DoltHub if empty
    if (data.length === 0 && this.useDoltHubFallback) {
      console.log('[Pipeline] Falling back to DoltHub for IV skew')
      try {
        return await dolthub.fetchIVSkewHistory(symbol, startDate, endDate)
      } catch (error) {
        console.error('[Pipeline] DoltHub fallback failed:', error.message)
        return []
      }
    }

    return data.sort((a, b) => a.date - b.date)
  }

  // ================== OI WASP ==================

  /**
   * Fetch OI-weighted average strike prices (WASP)
   * Uses Unicorn API only (no DoltHub fallback)
   *
   * Data source:
   * - Browser: Unicorn Proxy (via server.js)
   * - Node.js: Unicorn API direct
   */
  async fetchOIWASP(symbol, startDate, endDate, daysToExpiry = 30) {
    console.log(`[Pipeline] Fetching OI WASP for ${symbol} via Unicorn API`)

    // Browser: use Unicorn proxy
    if (this.isBrowser) {
      const proxyAvailable = await this._checkProxyAvailable()
      if (!proxyAvailable) {
        console.warn('[Pipeline] Unicorn proxy not available. Start server with: npm start')
        return []
      }

      try {
        console.log('[Pipeline] Fetching WASP from Unicorn proxy...')
        const liveWASP = await this._fetchWASPFromProxy(symbol, daysToExpiry)
        return [liveWASP]
      } catch (error) {
        console.error('[Pipeline] Unicorn proxy failed:', error.message)
        return []
      }
    }

    // Node.js mode - use Unicorn API directly
    if (!this.unicorn.hasCredentials()) {
      console.warn('[Pipeline] EODHD_API_KEY not configured')
      return []
    }

    try {
      console.log('[Pipeline] Fetching WASP from Unicorn API...')
      const wasp = await this.unicorn.getLiveWASP(symbol, daysToExpiry)

      if (wasp.totalWASP > 0) {
        return [{
          date: wasp.date,
          time: wasp.time,
          callWASP: wasp.callWASP,
          putWASP: wasp.putWASP,
          totalWASP: wasp.totalWASP,
          callOI: wasp.callOI,
          putOI: wasp.putOI,
          source: 'unicorn'
        }]
      }
      return []
    } catch (error) {
      console.error('[Pipeline] Unicorn API failed:', error.message)
      return []
    }
  }

  // ================== Data Availability ==================

  /**
   * Check data availability for a symbol
   * Matches dolthub.checkDataAvailability signature
   */
  async checkDataAvailability(symbol) {
    // Browser: use DoltHub directly
    if (this.isBrowser) {
      return dolthub.checkDataAvailability(symbol)
    }

    // Check local cache first
    if (this.cache) {
      const local = this.cache.getDataAvailability(symbol)

      if (local.volatility || local.optionChain) {
        return {
          source: 'cache',
          minDate: local.volatility?.minDate || local.optionChain?.minDate,
          maxDate: local.volatility?.maxDate || local.optionChain?.maxDate,
          recordCount: local.volatility?.recordCount || local.optionChain?.dayCount || 0,
        }
      }
    }

    // Check DoltHub if fallback enabled
    if (this.useDoltHubFallback) {
      try {
        const dolthubData = await dolthub.checkDataAvailability(symbol)
        if (dolthubData) {
          return {
            source: 'dolthub',
            ...dolthubData,
          }
        }
      } catch (error) {
        console.warn('[Pipeline] DoltHub availability check failed:', error.message)
      }
    }

    return null
  }

  // ================== Live Data (Unicorn) ==================

  /**
   * Get live WASP data (from Unicorn direct or via proxy)
   */
  async getLiveWASP(symbol, daysToExpiry = 30) {
    // Browser: use proxy
    if (this.isBrowser) {
      const proxyAvailable = await this._checkProxyAvailable()
      if (!proxyAvailable) {
        throw new Error('Unicorn proxy not available')
      }
      return this._fetchWASPFromProxy(symbol, daysToExpiry)
    }

    // Node.js: use direct Unicorn client
    if (!this.unicorn.hasCredentials()) {
      throw new Error('EODHD_API_KEY not configured')
    }
    return this.unicorn.getLiveWASP(symbol, daysToExpiry)
  }

  /**
   * Get live options chain (from Unicorn direct or via proxy)
   */
  async getLiveOptionsChain(symbol, daysToExpiry = 30) {
    // Browser: use proxy
    if (this.isBrowser) {
      const proxyAvailable = await this._checkProxyAvailable()
      if (!proxyAvailable) {
        throw new Error('Unicorn proxy not available')
      }
      const dteMin = Math.max(0, daysToExpiry - 10)
      const dteMax = daysToExpiry + 10
      return this._fetchOptionsFromProxy(symbol, dteMin, dteMax)
    }

    // Node.js: use direct Unicorn client
    if (!this.unicorn.hasCredentials()) {
      throw new Error('EODHD_API_KEY not configured')
    }
    const options = await this.unicorn.fetchOptionsForWASP(symbol, daysToExpiry)
    return { options, total: options.length }
  }

  /**
   * Check if Unicorn API is available (direct or via proxy)
   */
  async isUnicornAvailable() {
    if (this.isBrowser) {
      return this._checkProxyAvailable()
    }
    return this.unicorn.hasCredentials()
  }

  /**
   * @deprecated Use isUnicornAvailable instead
   */
  async isEODHDAvailable() {
    return this.isUnicornAvailable()
  }
}

// Export singleton
let _pipeline = null

export function getDataPipeline(config = {}) {
  if (!_pipeline) {
    _pipeline = new DataPipeline(config)
  }
  return _pipeline
}
