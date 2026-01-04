/**
 * Option Pricing Module using Black-Scholes
 * Calculates option prices for accurate backtest P&L
 */

/**
 * Standard normal CDF approximation
 */
function normCDF(x) {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)

  return 0.5 * (1.0 + sign * y)
}

/**
 * Black-Scholes option pricing
 * @param {Object} params - Pricing parameters
 * @param {number} params.S - Current stock price
 * @param {number} params.K - Strike price
 * @param {number} params.T - Time to expiry in years
 * @param {number} params.sigma - Implied volatility (decimal, e.g., 0.20 for 20%)
 * @param {number} params.r - Risk-free rate (decimal, e.g., 0.05 for 5%)
 * @param {string} params.type - 'call' or 'put'
 * @returns {number} - Option price
 */
export function blackScholesPrice({ S, K, T, sigma, r = 0.05, type = 'call' }) {
  if (T <= 0) {
    // At expiration, return intrinsic value
    return type === 'call'
      ? Math.max(0, S - K)
      : Math.max(0, K - S)
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)

  if (type === 'call') {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
  } else {
    return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
  }
}

/**
 * Calculate option delta (for position sizing and P&L estimation)
 */
export function blackScholesDelta({ S, K, T, sigma, r = 0.05, type = 'call' }) {
  if (T <= 0) {
    if (type === 'call') return S > K ? 1 : 0
    return S < K ? -1 : 0
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))

  if (type === 'call') {
    return normCDF(d1)
  } else {
    return normCDF(d1) - 1
  }
}

/**
 * Calculate option price for a trade entry/exit
 * @param {number} stockPrice - Current stock price
 * @param {number} strike - Option strike price (ATM if not provided)
 * @param {string} optionType - 'CALL' or 'PUT'
 * @param {number} daysToExpiry - Days until expiration (default: 7 for weekly)
 * @param {number} iv - Implied volatility as decimal (default: 0.18 for SPY)
 * @returns {Object} - Option price and greeks
 */
export function calculateOptionPrice(stockPrice, strike, optionType, daysToExpiry = 7, iv = 0.18) {
  const K = strike || Math.round(stockPrice)  // ATM if not specified
  const T = daysToExpiry / 365
  const type = optionType.toLowerCase()

  const price = blackScholesPrice({ S: stockPrice, K, T, sigma: iv, type })
  const delta = blackScholesDelta({ S: stockPrice, K, T, sigma: iv, type })

  return {
    price: Math.round(price * 100) / 100,  // Round to cents
    delta: Math.round(delta * 100) / 100,
    strike: K,
    type: optionType,
    daysToExpiry,
    iv,
    intrinsic: type === 'call' ? Math.max(0, stockPrice - K) : Math.max(0, K - stockPrice),
    extrinsic: Math.max(0, price - (type === 'call' ? Math.max(0, stockPrice - K) : Math.max(0, K - stockPrice))),
  }
}

/**
 * Calculate trade P&L based on option prices
 * @param {Object} entryOption - Entry option details
 * @param {Object} exitOption - Exit option details
 * @param {number} contracts - Number of contracts
 * @returns {Object} - P&L details
 */
export function calculateOptionPnL(entryOption, exitOption, contracts = 1) {
  const entryValue = entryOption.price * 100 * contracts  // Options are 100 shares per contract
  const exitValue = exitOption.price * 100 * contracts
  const pnlDollars = exitValue - entryValue
  const pnlPercent = (pnlDollars / entryValue) * 100

  return {
    entryValue,
    exitValue,
    pnlDollars,
    pnlPercent,
    contracts,
  }
}

/**
 * Calculate time to expiry in days from entry time
 * Uses next Friday as default expiry (weekly options)
 */
export function calculateDaysToExpiry(entryTime, exitTime, initialDays = 7) {
  const entryMs = typeof entryTime === 'number' ? entryTime : new Date(entryTime).getTime()
  const exitMs = typeof exitTime === 'number' ? exitTime : new Date(exitTime).getTime()

  // Calculate trading days between entry and exit (approximate)
  const msBetween = exitMs - entryMs
  const daysBetween = msBetween / (1000 * 60 * 60 * 24)
  const tradingDaysBetween = daysBetween * (5 / 7)  // Rough approximation

  return Math.max(0, initialDays - tradingDaysBetween)
}

/**
 * Estimate IV based on VIX or use default
 * SPY options typically trade at ~0.9x VIX
 */
export function estimateIV(vix = null) {
  if (vix) {
    return (vix / 100) * 0.9  // SPY options typically ~90% of VIX
  }
  return 0.18  // Default 18% IV for SPY
}
