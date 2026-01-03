/**
 * Trade execution and management for backtesting
 */

/**
 * @typedef {Object} Trade
 * @property {number} id - Trade ID
 * @property {string} signal - CALL or PUT
 * @property {string} signalType - Full signal type (STRONG_CALL, CALL, etc)
 * @property {number} strength - Signal strength 0-100
 * @property {string} source - Signal source name
 * @property {number} entryPrice - Entry price
 * @property {number} entryTime - Entry timestamp
 * @property {number} entryIndex - Candle index at entry
 * @property {number|null} exitPrice - Exit price (null if open)
 * @property {number|null} exitTime - Exit timestamp (null if open)
 * @property {number|null} exitIndex - Candle index at exit (null if open)
 * @property {string|null} exitReason - Why trade was closed
 * @property {number} barsHeld - Number of bars held
 * @property {number} pnl - Profit/loss in points
 * @property {number} pnlPercent - Profit/loss as percentage
 * @property {Object} metadata - Additional signal-specific data
 * @property {string} optionType - Option type (CALL/PUT)
 * @property {number} strike - Option strike price (ATM)
 * @property {string} expiry - Option expiration date
 * @property {number} contracts - Number of contracts
 */

let tradeIdCounter = 0

/**
 * Calculate the next Friday expiry from a given date
 * @param {number} timestamp - Entry timestamp
 * @returns {string} - Expiry date as YYYY-MM-DD
 */
function getNextFridayExpiry(timestamp) {
  const date = new Date(timestamp)
  const dayOfWeek = date.getDay()
  // Days until next Friday (5 = Friday)
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7
  date.setDate(date.getDate() + daysUntilFriday)
  return date.toISOString().slice(0, 10)
}

/**
 * Create a new trade from a signal
 * @param {Object} signal - Signal object
 * @param {Object} candle - Entry candle
 * @param {number} candleIndex - Index of entry candle
 * @returns {Trade}
 */
export function createTrade(signal, candle, candleIndex) {
  const direction = signal.direction || signal.type.replace('STRONG_', '')
  const strikePrice = Math.round(candle.close) // ATM strike

  return {
    id: ++tradeIdCounter,
    signal: direction,
    signalType: signal.type,
    strength: signal.strength,
    source: signal.source,
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
    expiry: getNextFridayExpiry(candle.time),
    contracts: signal.contracts || 1,
  }
}

/**
 * Update an open trade with current candle data
 * @param {Trade} trade - Trade to update
 * @param {Object} candle - Current candle
 */
export function updateTrade(trade, candle) {
  trade.barsHeld++
  trade.highPrice = Math.max(trade.highPrice, candle.high)
  trade.lowPrice = Math.min(trade.lowPrice, candle.low)

  // Calculate unrealized P&L
  const direction = trade.signal === 'CALL' ? 1 : -1
  trade.pnl = (candle.close - trade.entryPrice) * direction
  trade.pnlPercent = (trade.pnl / trade.entryPrice) * 100
}

/**
 * Close a trade
 * @param {Trade} trade - Trade to close
 * @param {Object} candle - Exit candle
 * @param {number} candleIndex - Index of exit candle
 * @param {string} reason - Exit reason
 * @returns {Trade} - Closed trade
 */
export function closeTrade(trade, candle, candleIndex, reason) {
  const exitPrice = candle.close
  const direction = trade.signal === 'CALL' ? 1 : -1

  trade.exitPrice = exitPrice
  trade.exitTime = candle.time
  trade.exitIndex = candleIndex
  trade.exitReason = reason
  trade.pnl = (exitPrice - trade.entryPrice) * direction
  trade.pnlPercent = (trade.pnl / trade.entryPrice) * 100

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
