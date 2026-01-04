/**
 * Trade execution and management for backtesting
 * Uses Black-Scholes for option pricing
 */

import { calculateOptionPrice, calculateDaysToExpiry } from './option-pricing.js'

/**
 * @typedef {Object} Trade
 * @property {number} id - Trade ID
 * @property {string} signal - CALL or PUT
 * @property {string} signalType - Full signal type (STRONG_CALL, CALL, etc)
 * @property {number} strength - Signal strength 0-100
 * @property {string} source - Signal source name
 * @property {number} entryPrice - Entry stock price
 * @property {number} entryTime - Entry timestamp
 * @property {number} entryIndex - Candle index at entry
 * @property {number|null} exitPrice - Exit stock price (null if open)
 * @property {number|null} exitTime - Exit timestamp (null if open)
 * @property {number|null} exitIndex - Candle index at exit (null if open)
 * @property {string|null} exitReason - Why trade was closed
 * @property {number} barsHeld - Number of bars held
 * @property {number} pnl - Profit/loss in dollars
 * @property {number} pnlPercent - Profit/loss as percentage of option entry price
 * @property {Object} metadata - Additional signal-specific data
 * @property {string} optionType - Option type (CALL/PUT)
 * @property {number} strike - Option strike price (ATM)
 * @property {string} expiry - Option expiration date
 * @property {number} contracts - Number of contracts
 * @property {number} optionEntryPrice - Option contract entry price
 * @property {number} optionExitPrice - Option contract exit price
 * @property {number} daysToExpiry - Days to expiry at entry
 */

let tradeIdCounter = 0

// Default IV for SPY options (18%)
const DEFAULT_IV = 0.18
const DEFAULT_DAYS_TO_EXPIRY = 5  // Weekly options (Friday expiry)

/**
 * Calculate the next Friday expiry from a given date
 * @param {number} timestamp - Entry timestamp
 * @returns {{expiry: string, daysToExpiry: number}}
 */
function getNextFridayExpiry(timestamp) {
  const date = new Date(timestamp)
  const dayOfWeek = date.getDay()
  // Days until next Friday (5 = Friday)
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7
  const expiryDate = new Date(date)
  expiryDate.setDate(expiryDate.getDate() + daysUntilFriday)

  return {
    expiry: expiryDate.toISOString().slice(0, 10),
    daysToExpiry: daysUntilFriday,
  }
}

/**
 * Create a new trade from a signal with proper option pricing
 * @param {Object} signal - Signal object
 * @param {Object} candle - Entry candle
 * @param {number} candleIndex - Index of entry candle
 * @returns {Trade}
 */
export function createTrade(signal, candle, candleIndex) {
  const direction = signal.direction || signal.type.replace('STRONG_', '')
  const strikePrice = Math.round(candle.close) // ATM strike
  const { expiry, daysToExpiry } = getNextFridayExpiry(candle.time)

  // Calculate option price at entry using Black-Scholes
  const iv = signal.iv || DEFAULT_IV
  const optionEntry = calculateOptionPrice(
    candle.close,
    strikePrice,
    direction,
    daysToExpiry,
    iv
  )

  return {
    id: ++tradeIdCounter,
    signal: direction,
    signalType: signal.type,
    strength: signal.strength,
    source: signal.source,
    // Stock prices
    entryPrice: candle.close,
    entryTime: candle.time,
    entryIndex: candleIndex,
    exitPrice: null,
    exitTime: null,
    exitIndex: null,
    exitReason: null,
    barsHeld: 0,
    pnl: 0,
    pnlPercent: 0,
    highPrice: candle.close,
    lowPrice: candle.close,
    metadata: signal.metadata || {},
    // Option details
    optionType: direction,
    strike: strikePrice,
    expiry,
    contracts: signal.contracts || 1,
    // Option pricing
    optionEntryPrice: optionEntry.price,
    optionExitPrice: null,
    daysToExpiry,
    entryDelta: optionEntry.delta,
    iv,
  }
}

/**
 * Update an open trade with current candle data
 * Uses option pricing for P&L calculation
 * @param {Trade} trade - Trade to update
 * @param {Object} candle - Current candle
 * @param {number} timeframeMinutes - Candle timeframe in minutes (for time decay calc)
 */
export function updateTrade(trade, candle, timeframeMinutes = 5) {
  trade.barsHeld++
  trade.highPrice = Math.max(trade.highPrice, candle.high)
  trade.lowPrice = Math.min(trade.lowPrice, candle.low)

  // Calculate remaining days to expiry (account for time decay)
  const tradingMinutesPerDay = 390  // 6.5 hours
  const minutesHeld = trade.barsHeld * timeframeMinutes
  const daysHeld = minutesHeld / tradingMinutesPerDay
  const remainingDays = Math.max(0.1, trade.daysToExpiry - daysHeld)

  // Calculate current option price
  const currentOption = calculateOptionPrice(
    candle.close,
    trade.strike,
    trade.signal,
    remainingDays,
    trade.iv || DEFAULT_IV
  )

  // Calculate unrealized P&L based on option prices
  trade.optionCurrentPrice = currentOption.price
  trade.pnl = (currentOption.price - trade.optionEntryPrice) * 100 * trade.contracts
  trade.pnlPercent = ((currentOption.price - trade.optionEntryPrice) / trade.optionEntryPrice) * 100
}

/**
 * Close a trade with proper option pricing
 * @param {Trade} trade - Trade to close
 * @param {Object} candle - Exit candle
 * @param {number} candleIndex - Index of exit candle
 * @param {string} reason - Exit reason
 * @param {number} timeframeMinutes - Candle timeframe in minutes
 * @returns {Trade} - Closed trade
 */
export function closeTrade(trade, candle, candleIndex, reason, timeframeMinutes = 5) {
  const exitStockPrice = candle.close

  // Calculate remaining days to expiry
  const tradingMinutesPerDay = 390  // 6.5 hours
  const minutesHeld = trade.barsHeld * timeframeMinutes
  const daysHeld = minutesHeld / tradingMinutesPerDay
  const remainingDays = Math.max(0.01, trade.daysToExpiry - daysHeld)  // Min 0.01 to avoid NaN

  // Calculate exit option price
  const exitOption = calculateOptionPrice(
    exitStockPrice,
    trade.strike,
    trade.signal,
    remainingDays,
    trade.iv || DEFAULT_IV
  )

  trade.exitPrice = exitStockPrice
  trade.exitTime = candle.time
  trade.exitIndex = candleIndex
  trade.exitReason = reason

  // Option P&L (per contract = 100 shares)
  trade.optionExitPrice = exitOption.price
  trade.exitDelta = exitOption.delta
  trade.pnl = (exitOption.price - trade.optionEntryPrice) * 100 * trade.contracts
  trade.pnlPercent = ((exitOption.price - trade.optionEntryPrice) / trade.optionEntryPrice) * 100
  trade.remainingDays = remainingDays

  return trade
}

/**
 * Check if trade hit max adverse excursion
 * @param {Trade} trade - Trade to check
 * @returns {number} - Max adverse excursion as percentage
 */
export function getMaxAdverseExcursion(trade) {
  const direction = trade.signal === 'CALL' ? 1 : -1
  if (direction === 1) {
    return ((trade.lowPrice - trade.entryPrice) / trade.entryPrice) * 100
  } else {
    return ((trade.entryPrice - trade.highPrice) / trade.entryPrice) * 100
  }
}

/**
 * Check if trade hit max favorable excursion
 * @param {Trade} trade - Trade to check
 * @returns {number} - Max favorable excursion as percentage
 */
export function getMaxFavorableExcursion(trade) {
  const direction = trade.signal === 'CALL' ? 1 : -1
  if (direction === 1) {
    return ((trade.highPrice - trade.entryPrice) / trade.entryPrice) * 100
  } else {
    return ((trade.entryPrice - trade.lowPrice) / trade.entryPrice) * 100
  }
}

/**
 * Reset trade ID counter (for testing)
 */
export function resetTradeIdCounter() {
  tradeIdCounter = 0
}
