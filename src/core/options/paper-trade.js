/**
 * Paper Trading Module for OI-WASP Strategy
 * Tracks forward testing without real money
 * Stores trades in localStorage for persistence
 */

const STORAGE_KEY = 'oi-wasp-paper-trades'

/**
 * Paper trade states
 */
export const TRADE_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED',
}

/**
 * Get all paper trades from storage
 * @returns {Array} Array of paper trades
 */
export function getPaperTrades() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch (e) {
    console.error('[Paper Trade] Failed to load trades:', e)
    return []
  }
}

/**
 * Save paper trades to storage
 * @param {Array} trades - Array of trades to save
 */
function savePaperTrades(trades) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades))
  } catch (e) {
    console.error('[Paper Trade] Failed to save trades:', e)
  }
}

/**
 * Create a new paper trade
 * @param {Object} trade - Trade details
 * @returns {Object} Created trade with ID
 */
export function createPaperTrade(trade) {
  const trades = getPaperTrades()

  const newTrade = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
    status: TRADE_STATUS.OPEN,

    // Trade details
    symbol: trade.symbol || 'SPY',
    type: trade.type, // CALL, PUT, CALL_BUTTERFLY, PUT_BUTTERFLY, IRON_CONDOR
    direction: trade.direction, // bullish, bearish, neutral
    legs: trade.legs || [],
    strikes: trade.strikes || [],

    // Entry conditions
    entryPrice: trade.entryPrice,
    entrySpot: trade.entrySpot,
    entryWasp: trade.entryWasp,
    entryDeviation: trade.entryDeviation,
    entryVix: trade.entryVix,
    entryGexRegime: trade.entryGexRegime,
    isOpExWeek: trade.isOpExWeek,

    // Position sizing
    contracts: trade.contracts || 1,
    maxProfit: trade.maxProfit,
    maxLoss: trade.maxLoss,
    riskReward: trade.riskReward,

    // Expiry
    expiry: trade.expiry, // Unix timestamp
    expiryDate: trade.expiryDate, // ISO string

    // Exit (filled when closed)
    exitPrice: null,
    exitSpot: null,
    exitAt: null,
    pnl: null,
    pnlPercent: null,
    result: null, // WIN, LOSS, BREAKEVEN

    // Notes
    rationale: trade.rationale,
    notes: trade.notes || '',
    tradeConditionsScore: trade.tradeConditionsScore,
  }

  trades.push(newTrade)
  savePaperTrades(trades)

  console.log('[Paper Trade] Created:', newTrade)
  return newTrade
}

/**
 * Close a paper trade
 * @param {string} tradeId - Trade ID
 * @param {Object} closeData - Close details
 * @returns {Object|null} Updated trade or null if not found
 */
export function closePaperTrade(tradeId, closeData) {
  const trades = getPaperTrades()
  const index = trades.findIndex(t => t.id === tradeId)

  if (index === -1) {
    console.error('[Paper Trade] Trade not found:', tradeId)
    return null
  }

  const trade = trades[index]

  trade.status = TRADE_STATUS.CLOSED
  trade.exitPrice = closeData.exitPrice
  trade.exitSpot = closeData.exitSpot
  trade.exitAt = new Date().toISOString()

  // Calculate P&L
  const entryValue = trade.entryPrice * 100 * trade.contracts
  const exitValue = closeData.exitPrice * 100 * trade.contracts

  trade.pnl = exitValue - entryValue
  trade.pnlPercent = ((exitValue - entryValue) / entryValue) * 100
  trade.result = trade.pnl > 0 ? 'WIN' : trade.pnl < 0 ? 'LOSS' : 'BREAKEVEN'
  trade.notes = closeData.notes || trade.notes

  savePaperTrades(trades)

  console.log('[Paper Trade] Closed:', trade)
  return trade
}

/**
 * Expire a paper trade (calculate at expiry)
 * @param {string} tradeId - Trade ID
 * @param {number} expirySpot - Spot price at expiry
 * @returns {Object|null} Updated trade
 */
export function expirePaperTrade(tradeId, expirySpot) {
  const trades = getPaperTrades()
  const index = trades.findIndex(t => t.id === tradeId)

  if (index === -1) return null

  const trade = trades[index]
  trade.status = TRADE_STATUS.EXPIRED
  trade.exitSpot = expirySpot
  trade.exitAt = new Date().toISOString()

  // Calculate butterfly P&L at expiry
  if (trade.type.includes('BUTTERFLY')) {
    const centerStrike = trade.strikes[1] || trade.strikes[0]
    const wingWidth = 5 // Assuming $5 wings
    const intrinsicValue = Math.max(0, wingWidth - Math.abs(expirySpot - centerStrike))
    trade.exitPrice = intrinsicValue
    trade.pnl = (intrinsicValue - trade.entryPrice) * 100 * trade.contracts
    trade.pnlPercent = ((intrinsicValue - trade.entryPrice) / trade.entryPrice) * 100
  } else if (trade.type === 'CALL') {
    const strike = trade.strikes[0]
    const intrinsic = Math.max(0, expirySpot - strike)
    trade.exitPrice = intrinsic
    trade.pnl = (intrinsic - trade.entryPrice) * 100 * trade.contracts
    trade.pnlPercent = trade.entryPrice > 0 ? ((intrinsic - trade.entryPrice) / trade.entryPrice) * 100 : 0
  } else if (trade.type === 'PUT') {
    const strike = trade.strikes[0]
    const intrinsic = Math.max(0, strike - expirySpot)
    trade.exitPrice = intrinsic
    trade.pnl = (intrinsic - trade.entryPrice) * 100 * trade.contracts
    trade.pnlPercent = trade.entryPrice > 0 ? ((intrinsic - trade.entryPrice) / trade.entryPrice) * 100 : 0
  }

  trade.result = trade.pnl > 0 ? 'WIN' : trade.pnl < 0 ? 'LOSS' : 'BREAKEVEN'

  savePaperTrades(trades)
  return trade
}

/**
 * Get open paper trades
 * @returns {Array} Open trades
 */
export function getOpenPaperTrades() {
  return getPaperTrades().filter(t => t.status === TRADE_STATUS.OPEN)
}

/**
 * Get closed paper trades
 * @returns {Array} Closed trades
 */
export function getClosedPaperTrades() {
  return getPaperTrades().filter(t => t.status !== TRADE_STATUS.OPEN)
}

/**
 * Delete a paper trade
 * @param {string} tradeId - Trade ID
 * @returns {boolean} Success
 */
export function deletePaperTrade(tradeId) {
  const trades = getPaperTrades()
  const filtered = trades.filter(t => t.id !== tradeId)

  if (filtered.length === trades.length) {
    return false // Not found
  }

  savePaperTrades(filtered)
  return true
}

/**
 * Clear all paper trades
 */
export function clearPaperTrades() {
  savePaperTrades([])
}

/**
 * Get paper trading statistics
 * @returns {Object} Statistics
 */
export function getPaperTradeStats() {
  const trades = getPaperTrades()
  const closed = trades.filter(t => t.status !== TRADE_STATUS.OPEN)

  if (closed.length === 0) {
    return {
      totalTrades: 0,
      openTrades: trades.filter(t => t.status === TRADE_STATUS.OPEN).length,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      bestTrade: null,
      worstTrade: null,
    }
  }

  const wins = closed.filter(t => t.result === 'WIN')
  const losses = closed.filter(t => t.result === 'LOSS')

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0)
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0

  const sortedByPnl = [...closed].sort((a, b) => (b.pnl || 0) - (a.pnl || 0))

  return {
    totalTrades: trades.length,
    openTrades: trades.filter(t => t.status === TRADE_STATUS.OPEN).length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor: avgLoss > 0 && losses.length > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : avgWin > 0 ? Infinity : 0,
    bestTrade: sortedByPnl[0] || null,
    worstTrade: sortedByPnl[sortedByPnl.length - 1] || null,
  }
}

/**
 * Export paper trades to CSV
 * @returns {string} CSV content
 */
export function exportPaperTradesToCSV() {
  const trades = getPaperTrades()

  const headers = [
    'ID', 'Created', 'Status', 'Symbol', 'Type', 'Direction',
    'Strikes', 'Entry Price', 'Entry Spot', 'Entry WASP', 'Entry Deviation',
    'VIX', 'GEX Regime', 'OpEx Week', 'Contracts', 'Max Profit', 'Max Loss',
    'Exit Price', 'Exit Spot', 'Exit At', 'P&L', 'P&L %', 'Result',
    'Rationale', 'Notes'
  ]

  const rows = trades.map(t => [
    t.id,
    t.createdAt,
    t.status,
    t.symbol,
    t.type,
    t.direction,
    t.strikes.join('/'),
    t.entryPrice,
    t.entrySpot,
    t.entryWasp,
    t.entryDeviation,
    t.entryVix,
    t.entryGexRegime,
    t.isOpExWeek,
    t.contracts,
    t.maxProfit,
    t.maxLoss,
    t.exitPrice,
    t.exitSpot,
    t.exitAt,
    t.pnl,
    t.pnlPercent,
    t.result,
    t.rationale,
    t.notes
  ])

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v || ''}"`).join(','))].join('\n')
  return csv
}
