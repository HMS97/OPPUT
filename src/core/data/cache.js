/**
 * SQLite Options Cache
 * Local cache for options data from Schwab API
 * Schema matches DoltHub data format for seamless migration
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../../../data/options.db')

const SCHEMA = `
-- Volatility history (matches DoltHub volatility_history)
CREATE TABLE IF NOT EXISTS volatility_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  hv_current REAL,
  iv_current REAL,
  iv_week_ago REAL,
  iv_month_ago REAL,
  iv_year_high REAL,
  iv_year_low REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, date)
);

-- Options chain data (matches DoltHub option_chain)
CREATE TABLE IF NOT EXISTS option_chain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  expiration TEXT NOT NULL,
  strike REAL NOT NULL,
  call_put TEXT NOT NULL,
  bid REAL,
  ask REAL,
  last_price REAL,
  volume INTEGER,
  open_interest INTEGER,
  iv REAL,
  delta REAL,
  gamma REAL,
  theta REAL,
  vega REAL,
  rho REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, date, expiration, strike, call_put)
);

-- Track last fetch times to avoid redundant API calls
CREATE TABLE IF NOT EXISTS fetch_metadata (
  symbol TEXT PRIMARY KEY,
  last_chain_fetch TEXT,
  last_quote_fetch TEXT
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_vol_symbol_date ON volatility_history(symbol, date);
CREATE INDEX IF NOT EXISTS idx_chain_symbol_date ON option_chain(symbol, date);
CREATE INDEX IF NOT EXISTS idx_chain_expiration ON option_chain(expiration);
CREATE INDEX IF NOT EXISTS idx_chain_call_put ON option_chain(call_put);
`

export class OptionsCache {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initialize()
  }

  initialize() {
    this.db.exec(SCHEMA)
  }

  // ================== Volatility Data ==================

  /**
   * Insert or update volatility data
   */
  upsertVolatility(symbol, date, data) {
    const stmt = this.db.prepare(`
      INSERT INTO volatility_history (symbol, date, hv_current, iv_current, iv_week_ago, iv_month_ago, iv_year_high, iv_year_low)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, date) DO UPDATE SET
        hv_current = excluded.hv_current,
        iv_current = excluded.iv_current,
        iv_week_ago = excluded.iv_week_ago,
        iv_month_ago = excluded.iv_month_ago,
        iv_year_high = excluded.iv_year_high,
        iv_year_low = excluded.iv_year_low
    `)

    stmt.run(
      symbol,
      date,
      data.hvCurrent ?? null,
      data.ivCurrent ?? null,
      data.ivWeekAgo ?? null,
      data.ivMonthAgo ?? null,
      data.ivYearHigh ?? null,
      data.ivYearLow ?? null
    )
  }

  /**
   * Query IV history - matches fetchIVHistory output format
   */
  queryIVHistory(symbol, startDate, endDate) {
    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]

    const stmt = this.db.prepare(`
      SELECT date, hv_current, iv_current, iv_week_ago, iv_month_ago, iv_year_high, iv_year_low
      FROM volatility_history
      WHERE symbol = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `)

    const rows = stmt.all(symbol, start, end)

    return rows.map(row => ({
      date: new Date(row.date),
      time: new Date(row.date).getTime(),
      hvCurrent: row.hv_current || 0,
      ivCurrent: row.iv_current || 0,
      ivWeekAgo: row.iv_week_ago || 0,
      ivMonthAgo: row.iv_month_ago || 0,
      ivYearHigh: row.iv_year_high || 0,
      ivYearLow: row.iv_year_low || 0,
    }))
  }

  // ================== Options Chain ==================

  /**
   * Insert or update options chain data
   */
  upsertOptionsChain(symbol, date, options) {
    const stmt = this.db.prepare(`
      INSERT INTO option_chain (symbol, date, expiration, strike, call_put, bid, ask, last_price, volume, open_interest, iv, delta, gamma, theta, vega, rho)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, date, expiration, strike, call_put) DO UPDATE SET
        bid = excluded.bid,
        ask = excluded.ask,
        last_price = excluded.last_price,
        volume = excluded.volume,
        open_interest = excluded.open_interest,
        iv = excluded.iv,
        delta = excluded.delta,
        gamma = excluded.gamma,
        theta = excluded.theta,
        vega = excluded.vega,
        rho = excluded.rho
    `)

    const insert = this.db.transaction((options) => {
      for (const opt of options) {
        const expStr = opt.expiration instanceof Date
          ? opt.expiration.toISOString().split('T')[0]
          : opt.expiration
        const callPut = opt.type === 'call' ? 'Call' : 'Put'

        stmt.run(
          symbol,
          date,
          expStr,
          opt.strike,
          callPut,
          opt.bid ?? null,
          opt.ask ?? null,
          opt.last ?? opt.lastPrice ?? null,
          opt.volume ?? null,
          opt.openInterest ?? null,
          opt.iv ?? null,
          opt.delta ?? null,
          opt.gamma ?? null,
          opt.theta ?? null,
          opt.vega ?? null,
          opt.rho ?? null
        )
      }
    })

    insert(options)
  }

  /**
   * Query options chain for a specific date - matches fetchOptionsChainForDate output
   */
  queryOptionsChainForDate(symbol, date, daysToExpiry = null) {
    const dateStr = date.toISOString().split('T')[0]

    let sql = `
      SELECT date, expiration, strike, call_put, bid, ask, iv, delta, gamma, theta, vega, open_interest
      FROM option_chain
      WHERE symbol = ? AND date = ?
    `
    const params = [symbol, dateStr]

    if (daysToExpiry) {
      sql += ` AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) <= ?`
      params.push(daysToExpiry)
    }

    sql += ` ORDER BY expiration, strike, call_put`

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params)

    return rows.map(row => ({
      date: new Date(row.date),
      expiration: new Date(row.expiration),
      strike: row.strike,
      type: row.call_put.toLowerCase(),
      bid: row.bid || 0,
      ask: row.ask || 0,
      iv: row.iv || 0,
      delta: row.delta || 0,
      gamma: row.gamma || 0,
      theta: row.theta || 0,
      vega: row.vega || 0,
      openInterest: row.open_interest || 0,
    }))
  }

  /**
   * Query ATM IV history - matches fetchATMIVHistory output
   */
  queryATMIVHistory(symbol, startDate, endDate, daysToExpiry = 30) {
    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]
    const minDTE = daysToExpiry - 10
    const maxDTE = daysToExpiry + 10

    const stmt = this.db.prepare(`
      SELECT date,
             AVG(iv) as avg_iv,
             AVG(CASE WHEN call_put = 'Call' THEN iv END) as call_iv,
             AVG(CASE WHEN call_put = 'Put' THEN iv END) as put_iv,
             COUNT(*) as option_count
      FROM option_chain
      WHERE symbol = ?
        AND date >= ? AND date <= ?
        AND delta >= 0.4 AND delta <= 0.6
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) >= ?
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) <= ?
      GROUP BY date
      ORDER BY date ASC
    `)

    const rows = stmt.all(symbol, start, end, minDTE, maxDTE)

    return rows.map(row => ({
      date: new Date(row.date),
      time: new Date(row.date).getTime(),
      avgIV: row.avg_iv || 0,
      callIV: row.call_iv || 0,
      putIV: row.put_iv || 0,
      optionCount: row.option_count || 0,
    }))
  }

  /**
   * Query IV skew history - matches fetchIVSkewHistory output
   */
  queryIVSkewHistory(symbol, startDate, endDate) {
    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]

    const stmt = this.db.prepare(`
      SELECT date,
             AVG(CASE WHEN call_put = 'Put' AND delta <= -0.20 AND delta >= -0.30 THEN iv END) as otm_put_iv,
             AVG(CASE WHEN call_put = 'Call' AND delta >= 0.20 AND delta <= 0.30 THEN iv END) as otm_call_iv,
             AVG(CASE WHEN delta >= 0.45 AND delta <= 0.55 THEN iv END) as atm_iv
      FROM option_chain
      WHERE symbol = ?
        AND date >= ? AND date <= ?
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) >= 20
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) <= 40
      GROUP BY date
      HAVING otm_put_iv IS NOT NULL AND otm_call_iv IS NOT NULL
      ORDER BY date ASC
    `)

    const rows = stmt.all(symbol, start, end)

    return rows.map(row => {
      const putIV = row.otm_put_iv || 0
      const callIV = row.otm_call_iv || 0
      const atmIV = row.atm_iv || 0

      return {
        date: new Date(row.date),
        time: new Date(row.date).getTime(),
        otmPutIV: putIV,
        otmCallIV: callIV,
        atmIV: atmIV,
        skew: putIV - callIV,
        skewRatio: callIV > 0 ? putIV / callIV : 1,
      }
    })
  }

  /**
   * Query OI WASP - matches fetchOIWASP output
   */
  queryOIWASP(symbol, startDate, endDate, daysToExpiry = 30) {
    const start = startDate.toISOString().split('T')[0]
    const end = endDate.toISOString().split('T')[0]
    const minDTE = daysToExpiry - 10
    const maxDTE = daysToExpiry + 10

    const stmt = this.db.prepare(`
      SELECT
        date,
        SUM(CASE WHEN call_put = 'Call' THEN strike * COALESCE(open_interest, 0) ELSE 0 END) /
          NULLIF(SUM(CASE WHEN call_put = 'Call' THEN COALESCE(open_interest, 0) ELSE 0 END), 0) as call_wasp,
        SUM(CASE WHEN call_put = 'Put' THEN strike * COALESCE(open_interest, 0) ELSE 0 END) /
          NULLIF(SUM(CASE WHEN call_put = 'Put' THEN COALESCE(open_interest, 0) ELSE 0 END), 0) as put_wasp,
        SUM(strike * COALESCE(open_interest, 0)) / NULLIF(SUM(COALESCE(open_interest, 0)), 0) as total_wasp,
        AVG(CASE WHEN delta >= 0.45 AND delta <= 0.55 THEN strike END) as atm_strike
      FROM option_chain
      WHERE symbol = ?
        AND date >= ? AND date <= ?
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) >= ?
        AND CAST((julianday(expiration) - julianday(date)) AS INTEGER) <= ?
      GROUP BY date
      ORDER BY date ASC
    `)

    const rows = stmt.all(symbol, start, end, minDTE, maxDTE)

    return rows.map(row => ({
      date: new Date(row.date),
      time: new Date(row.date).getTime(),
      callWASP: row.call_wasp || 0,
      putWASP: row.put_wasp || 0,
      totalWASP: row.total_wasp || 0,
      atmStrike: row.atm_strike || 0,
    }))
  }

  // ================== Metadata ==================

  /**
   * Get data availability for a symbol
   */
  getDataAvailability(symbol) {
    const volStmt = this.db.prepare(`
      SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(*) as record_count
      FROM volatility_history
      WHERE symbol = ?
    `)

    const chainStmt = this.db.prepare(`
      SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(DISTINCT date) as day_count
      FROM option_chain
      WHERE symbol = ?
    `)

    const volRow = volStmt.get(symbol)
    const chainRow = chainStmt.get(symbol)

    return {
      volatility: volRow?.min_date ? {
        minDate: new Date(volRow.min_date),
        maxDate: new Date(volRow.max_date),
        recordCount: volRow.record_count || 0,
      } : null,
      optionChain: chainRow?.min_date ? {
        minDate: new Date(chainRow.min_date),
        maxDate: new Date(chainRow.max_date),
        dayCount: chainRow.day_count || 0,
      } : null,
    }
  }

  /**
   * Set last fetch time for a symbol
   */
  setLastFetchTime(symbol, type) {
    const now = new Date().toISOString()

    if (type === 'chain') {
      this.db.prepare(`
        INSERT INTO fetch_metadata (symbol, last_chain_fetch)
        VALUES (?, ?)
        ON CONFLICT(symbol) DO UPDATE SET last_chain_fetch = excluded.last_chain_fetch
      `).run(symbol, now)
    } else if (type === 'quote') {
      this.db.prepare(`
        INSERT INTO fetch_metadata (symbol, last_quote_fetch)
        VALUES (?, ?)
        ON CONFLICT(symbol) DO UPDATE SET last_quote_fetch = excluded.last_quote_fetch
      `).run(symbol, now)
    }
  }

  /**
   * Get last fetch time for a symbol
   */
  getLastFetchTime(symbol, type) {
    const row = this.db.prepare(`
      SELECT last_chain_fetch, last_quote_fetch FROM fetch_metadata WHERE symbol = ?
    `).get(symbol)

    if (!row) return null

    const timeStr = type === 'chain' ? row.last_chain_fetch : row.last_quote_fetch
    return timeStr ? new Date(timeStr) : null
  }

  /**
   * Check if we have data for a specific date
   */
  hasDataForDate(symbol, date) {
    const dateStr = date.toISOString().split('T')[0]

    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM option_chain
      WHERE symbol = ? AND date = ?
    `).get(symbol, dateStr)

    return row.count > 0
  }

  close() {
    this.db.close()
  }
}

// Export singleton for convenience
let _cache = null

export function getCache() {
  if (!_cache) {
    _cache = new OptionsCache()
  }
  return _cache
}
