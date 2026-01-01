/**
 * DoltHub Options Data Client
 * Fetches historical options data from post-no-preference/options database
 * Data includes: bid, ask, IV, Greeks (delta, gamma, theta, vega, rho)
 * Date range: 2019 to present
 */

const DOLTHUB_API = 'https://www.dolthub.com/api/v1alpha1/post-no-preference/options'

/**
 * Execute SQL query against DoltHub options database
 * @param {string} sql - SQL query
 * @returns {Promise<Array>} - Query results
 */
async function queryDoltHub(sql) {
  const url = `${DOLTHUB_API}?q=${encodeURIComponent(sql)}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`DoltHub API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.query_execution_status !== 'Success') {
      throw new Error(`Query failed: ${data.query_execution_message}`)
    }

    return data.rows || []
  } catch (error) {
    console.error('[DoltHub] Query error:', error.message)
    throw error
  }
}

/**
 * Fetch historical IV data for a symbol
 * @param {string} symbol - Stock symbol (e.g., 'SPY')
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} - IV history [{date, iv_current, hv_current, ...}]
 */
export async function fetchIVHistory(symbol, startDate, endDate) {
  const start = startDate.toISOString().split('T')[0]
  const end = endDate.toISOString().split('T')[0]

  console.log(`[DoltHub] Fetching IV history for ${symbol}: ${start} to ${end}`)

  const sql = `
    SELECT date, hv_current, iv_current, iv_week_ago, iv_month_ago,
           iv_year_high, iv_year_low
    FROM volatility_history
    WHERE act_symbol = '${symbol}'
      AND date >= '${start}'
      AND date <= '${end}'
    ORDER BY date ASC
  `

  const rows = await queryDoltHub(sql)

  return rows.map(row => ({
    date: new Date(row.date),
    time: new Date(row.date).getTime(),
    hvCurrent: parseFloat(row.hv_current) || 0,
    ivCurrent: parseFloat(row.iv_current) || 0,
    ivWeekAgo: parseFloat(row.iv_week_ago) || 0,
    ivMonthAgo: parseFloat(row.iv_month_ago) || 0,
    ivYearHigh: parseFloat(row.iv_year_high) || 0,
    ivYearLow: parseFloat(row.iv_year_low) || 0,
  }))
}

/**
 * Fetch options chain for a specific date
 * @param {string} symbol - Stock symbol
 * @param {Date} date - Date to fetch
 * @param {number} daysToExpiry - Filter by days to expiration (optional)
 * @returns {Promise<Array>} - Options chain data
 */
export async function fetchOptionsChainForDate(symbol, date, daysToExpiry = null) {
  const dateStr = date.toISOString().split('T')[0]

  let sql = `
    SELECT date, expiration, strike, call_put, bid, ask, vol,
           delta, gamma, theta, vega
    FROM option_chain
    WHERE act_symbol = '${symbol}'
      AND date = '${dateStr}'
  `

  if (daysToExpiry) {
    sql += ` AND DATEDIFF(expiration, date) <= ${daysToExpiry}`
  }

  sql += ` ORDER BY expiration, strike, call_put`

  const rows = await queryDoltHub(sql)

  return rows.map(row => ({
    date: new Date(row.date),
    expiration: new Date(row.expiration),
    strike: parseFloat(row.strike),
    type: row.call_put.toLowerCase(), // 'call' or 'put'
    bid: parseFloat(row.bid) || 0,
    ask: parseFloat(row.ask) || 0,
    iv: parseFloat(row.vol) || 0, // vol is actually IV
    delta: parseFloat(row.delta) || 0,
    gamma: parseFloat(row.gamma) || 0,
    theta: parseFloat(row.theta) || 0,
    vega: parseFloat(row.vega) || 0,
  }))
}

/**
 * Fetch ATM (at-the-money) IV for date range
 * Uses delta ~0.5 calls as proxy for ATM
 * @param {string} symbol - Stock symbol
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {number} daysToExpiry - Target DTE (default 30)
 * @returns {Promise<Array>} - Daily ATM IV
 */
export async function fetchATMIVHistory(symbol, startDate, endDate, daysToExpiry = 30) {
  const start = startDate.toISOString().split('T')[0]
  const end = endDate.toISOString().split('T')[0]

  console.log(`[DoltHub] Fetching ATM IV for ${symbol}: ${start} to ${end}`)

  // Get average IV for options with delta near 0.5 (ATM calls)
  const sql = `
    SELECT date,
           AVG(vol) as avg_iv,
           AVG(CASE WHEN call_put = 'Call' THEN vol END) as call_iv,
           AVG(CASE WHEN call_put = 'Put' THEN vol END) as put_iv,
           COUNT(*) as option_count
    FROM option_chain
    WHERE act_symbol = '${symbol}'
      AND date >= '${start}'
      AND date <= '${end}'
      AND delta >= 0.4 AND delta <= 0.6
      AND DATEDIFF(expiration, date) >= ${daysToExpiry - 10}
      AND DATEDIFF(expiration, date) <= ${daysToExpiry + 10}
    GROUP BY date
    ORDER BY date ASC
  `

  const rows = await queryDoltHub(sql)

  return rows.map(row => ({
    date: new Date(row.date),
    time: new Date(row.date).getTime(),
    avgIV: parseFloat(row.avg_iv) || 0,
    callIV: parseFloat(row.call_iv) || 0,
    putIV: parseFloat(row.put_iv) || 0,
    optionCount: parseInt(row.option_count) || 0,
  }))
}

/**
 * Fetch IV skew (put IV vs call IV) history
 * @param {string} symbol - Stock symbol
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} - Daily IV skew data
 */
export async function fetchIVSkewHistory(symbol, startDate, endDate) {
  const start = startDate.toISOString().split('T')[0]
  const end = endDate.toISOString().split('T')[0]

  console.log(`[DoltHub] Fetching IV skew for ${symbol}: ${start} to ${end}`)

  // Compare OTM put IV (delta -0.25) vs OTM call IV (delta 0.25)
  const sql = `
    SELECT date,
           AVG(CASE WHEN call_put = 'Put' AND delta <= -0.20 AND delta >= -0.30 THEN vol END) as otm_put_iv,
           AVG(CASE WHEN call_put = 'Call' AND delta >= 0.20 AND delta <= 0.30 THEN vol END) as otm_call_iv,
           AVG(CASE WHEN delta >= 0.45 AND delta <= 0.55 THEN vol END) as atm_iv
    FROM option_chain
    WHERE act_symbol = '${symbol}'
      AND date >= '${start}'
      AND date <= '${end}'
      AND DATEDIFF(expiration, date) >= 20
      AND DATEDIFF(expiration, date) <= 40
    GROUP BY date
    HAVING otm_put_iv IS NOT NULL AND otm_call_iv IS NOT NULL
    ORDER BY date ASC
  `

  const rows = await queryDoltHub(sql)

  return rows.map(row => {
    const putIV = parseFloat(row.otm_put_iv) || 0
    const callIV = parseFloat(row.otm_call_iv) || 0
    const atmIV = parseFloat(row.atm_iv) || 0

    return {
      date: new Date(row.date),
      time: new Date(row.date).getTime(),
      otmPutIV: putIV,
      otmCallIV: callIV,
      atmIV: atmIV,
      // Skew: positive = puts more expensive (bearish fear)
      skew: putIV - callIV,
      skewRatio: callIV > 0 ? putIV / callIV : 1,
    }
  })
}

/**
 * Fetch Open Interest weighted average strike prices (WASP) for OIWASP strategy
 * @param {string} symbol - Stock symbol
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {number} daysToExpiry - Target DTE (default 30)
 * @returns {Promise<Array>} - Daily WASP data [{date, callWASP, putWASP, totalWASP, spotProxy}]
 */
export async function fetchOIWASP(symbol, startDate, endDate, daysToExpiry = 30) {
  const start = startDate.toISOString().split('T')[0]
  const end = endDate.toISOString().split('T')[0]

  console.log(`[DoltHub] Fetching OI WASP for ${symbol}: ${start} to ${end}`)

  // Calculate weighted average strike by open interest
  // Note: DoltHub option_chain may have 'open_interest' or 'oi' column
  // We'll use volume (vol) as a proxy if OI not available
  const sql = `
    SELECT
      date,
      SUM(CASE WHEN call_put = 'Call' THEN strike * vol ELSE 0 END) /
        NULLIF(SUM(CASE WHEN call_put = 'Call' THEN vol ELSE 0 END), 0) as call_wasp,
      SUM(CASE WHEN call_put = 'Put' THEN strike * vol ELSE 0 END) /
        NULLIF(SUM(CASE WHEN call_put = 'Put' THEN vol ELSE 0 END), 0) as put_wasp,
      SUM(strike * vol) / NULLIF(SUM(vol), 0) as total_wasp,
      AVG(CASE WHEN delta >= 0.45 AND delta <= 0.55 THEN strike END) as atm_strike
    FROM option_chain
    WHERE act_symbol = '${symbol}'
      AND date >= '${start}'
      AND date <= '${end}'
      AND DATEDIFF(expiration, date) >= ${daysToExpiry - 10}
      AND DATEDIFF(expiration, date) <= ${daysToExpiry + 10}
    GROUP BY date
    ORDER BY date ASC
  `

  try {
    const rows = await queryDoltHub(sql)

    return rows.map(row => ({
      date: new Date(row.date),
      time: new Date(row.date).getTime(),
      callWASP: parseFloat(row.call_wasp) || 0,
      putWASP: parseFloat(row.put_wasp) || 0,
      totalWASP: parseFloat(row.total_wasp) || 0,
      atmStrike: parseFloat(row.atm_strike) || 0,
    }))
  } catch (error) {
    console.error('[DoltHub] WASP query error:', error.message)
    return []
  }
}

/**
 * Check data availability for a symbol
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{minDate: Date, maxDate: Date, recordCount: number}>}
 */
export async function checkDataAvailability(symbol) {
  const sql = `
    SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(*) as record_count
    FROM volatility_history
    WHERE act_symbol = '${symbol}'
  `

  const rows = await queryDoltHub(sql)

  if (rows.length === 0 || !rows[0].min_date) {
    return null
  }

  return {
    minDate: new Date(rows[0].min_date),
    maxDate: new Date(rows[0].max_date),
    recordCount: parseInt(rows[0].record_count) || 0,
  }
}
