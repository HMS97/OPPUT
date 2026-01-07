/**
 * Backtest Statistics Calculator
 * Comprehensive performance metrics
 */

/**
 * Calculate comprehensive statistics from closed trades
 * @param {Array} trades - Array of closed trades
 * @param {number} initialCapital - Starting capital
 * @returns {Object} - Statistics object
 */
export function calculateStatistics(trades, initialCapital = 10000) {
  if (!trades || trades.length === 0) {
    return getEmptyStats()
  }

  console.log('[STATS DEBUG] Received trades[0].pnlPercent:', trades[0]?.pnlPercent)

  // Separate winners and losers
  const winners = trades.filter((t) => t.pnl > 0)
  const losers = trades.filter((t) => t.pnl < 0)
  const breakeven = trades.filter((t) => t.pnl === 0)

  // Basic metrics
  const totalTrades = trades.length
  const winCount = winners.length
  const lossCount = losers.length
  const winRate = (winCount / totalTrades) * 100

  // P&L calculations
  const totalPnL = trades.reduce((sum, t) => sum + t.pnlPercent, 0)
  const avgTradePnL = totalPnL / totalTrades

  const grossProfit = winners.reduce((sum, t) => sum + t.pnlPercent, 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnlPercent, 0))

  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0

  // Profit factor
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Payoff ratio (reward/risk)
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0

  // Expectancy per trade
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss

  // Holding period stats
  const holdingPeriods = trades.map((t) => t.barsHeld)
  const avgHoldingPeriod = holdingPeriods.reduce((a, b) => a + b, 0) / totalTrades

  // Consecutive wins/losses
  let currentStreak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  let isWinStreak = true

  for (const trade of trades) {
    if (trade.pnl > 0) {
      if (isWinStreak) {
        currentStreak++
        maxWinStreak = Math.max(maxWinStreak, currentStreak)
      } else {
        currentStreak = 1
        isWinStreak = true
      }
    } else if (trade.pnl < 0) {
      if (!isWinStreak) {
        currentStreak++
        maxLossStreak = Math.max(maxLossStreak, currentStreak)
      } else {
        currentStreak = 1
        isWinStreak = false
      }
    }
  }

  // Drawdown analysis
  const drawdownStats = calculateDrawdown(trades, initialCapital)

  // Sharpe and Sortino ratios
  const returns = trades.map((t) => t.pnlPercent)
  const sharpeRatio = calculateSharpeRatio(returns)
  const sortinoRatio = calculateSortinoRatio(returns)

  // Stats by signal type
  const statsBySignalType = calculateStatsBySignalType(trades)

  // Stats by direction
  const statsByDirection = calculateStatsByDirection(trades)

  return {
    // Basic metrics
    totalTrades,
    winCount,
    lossCount,
    breakevenCount: breakeven.length,
    winRate,

    // P&L metrics
    totalPnL,
    totalReturn: totalPnL,
    avgTradePnL,
    grossProfit,
    grossLoss,
    avgWin,
    avgLoss,

    // Risk metrics
    profitFactor,
    expectancy,
    payoffRatio,

    // Drawdown
    maxDrawdown: drawdownStats.maxDrawdown,
    maxDrawdownDuration: drawdownStats.maxDrawdownDuration,
    currentDrawdown: drawdownStats.currentDrawdown,

    // Risk-adjusted returns
    sharpeRatio,
    sortinoRatio,
    calmarRatio: drawdownStats.maxDrawdown !== 0 ? totalPnL / Math.abs(drawdownStats.maxDrawdown) : 0,

    // Streaks
    consecutiveWins: maxWinStreak,
    consecutiveLosses: maxLossStreak,
    avgHoldingPeriod,

    // Breakdowns
    statsBySignalType,
    statsByDirection,
  }
}

/**
 * Calculate drawdown metrics
 * @param {Array} trades - Trades
 * @param {number} initialCapital - Starting capital
 * @returns {Object}
 */
function calculateDrawdown(trades, initialCapital) {
  if (trades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownDuration: 0, currentDrawdown: 0 }
  }

  // Use dollar-based equity for accurate drawdown calculation
  let equity = initialCapital
  let peak = equity
  let maxDrawdown = 0
  let currentDrawdown = 0
  let drawdownStart = null
  let maxDrawdownDuration = 0
  let currentDrawdownDuration = 0

  for (let i = 0; i < trades.length; i++) {
    // Use dollar P&L for equity calculation
    const pnlDollar = trades[i].pnl || 0
    equity += pnlDollar

    // Ensure equity doesn't go negative
    equity = Math.max(0, equity)

    if (equity > peak) {
      peak = equity
      if (drawdownStart !== null) {
        maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration)
        drawdownStart = null
        currentDrawdownDuration = 0
      }
    } else if (peak > 0) {
      currentDrawdown = ((equity - peak) / peak) * 100
      maxDrawdown = Math.min(maxDrawdown, currentDrawdown)

      if (drawdownStart === null) {
        drawdownStart = i
      }
      currentDrawdownDuration++
    }
  }

  return {
    maxDrawdown,
    maxDrawdownDuration: Math.max(maxDrawdownDuration, currentDrawdownDuration),
    currentDrawdown,
  }
}

/**
 * Calculate Sharpe Ratio
 * @param {Array} returns - Array of trade returns
 * @param {number} riskFreeRate - Risk-free rate (annualized %)
 * @returns {number}
 */
function calculateSharpeRatio(returns, riskFreeRate = 0) {
  if (returns.length < 2) return 0

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const stdDev = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
  )

  if (stdDev === 0) return 0

  // Assume ~252 trading days per year for annualization
  const annualizationFactor = Math.sqrt(252 / returns.length)
  return ((avgReturn - riskFreeRate / 252) / stdDev) * annualizationFactor
}

/**
 * Calculate Sortino Ratio (only considers downside volatility)
 * @param {Array} returns - Array of trade returns
 * @param {number} targetReturn - Target return (default 0)
 * @returns {number}
 */
function calculateSortinoRatio(returns, targetReturn = 0) {
  if (returns.length < 2) return 0

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const downsideReturns = returns.filter((r) => r < targetReturn)

  if (downsideReturns.length === 0) return avgReturn > 0 ? Infinity : 0

  const downsideDeviation = Math.sqrt(
    downsideReturns.reduce((sum, r) => sum + Math.pow(r - targetReturn, 2), 0) / downsideReturns.length
  )

  if (downsideDeviation === 0) return 0

  const annualizationFactor = Math.sqrt(252 / returns.length)
  return ((avgReturn - targetReturn) / downsideDeviation) * annualizationFactor
}

/**
 * Calculate stats grouped by signal type
 * @param {Array} trades - Trades
 * @returns {Object}
 */
function calculateStatsBySignalType(trades) {
  const groups = {}

  for (const trade of trades) {
    const type = trade.signalType
    if (!groups[type]) {
      groups[type] = []
    }
    groups[type].push(trade)
  }

  const result = {}
  for (const [type, typeTrades] of Object.entries(groups)) {
    const wins = typeTrades.filter((t) => t.pnl > 0).length
    const total = typeTrades.length
    const avgPnL = typeTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / total

    result[type] = {
      count: total,
      winRate: (wins / total) * 100,
      avgPnL,
    }
  }

  return result
}

/**
 * Calculate stats grouped by direction (CALL vs PUT)
 * @param {Array} trades - Trades
 * @returns {Object}
 */
function calculateStatsByDirection(trades) {
  const calls = trades.filter((t) => t.signal === 'CALL')
  const puts = trades.filter((t) => t.signal === 'PUT')

  return {
    CALL: {
      count: calls.length,
      winRate: calls.length > 0 ? (calls.filter((t) => t.pnl > 0).length / calls.length) * 100 : 0,
      avgPnL: calls.length > 0 ? calls.reduce((sum, t) => sum + t.pnlPercent, 0) / calls.length : 0,
    },
    PUT: {
      count: puts.length,
      winRate: puts.length > 0 ? (puts.filter((t) => t.pnl > 0).length / puts.length) * 100 : 0,
      avgPnL: puts.length > 0 ? puts.reduce((sum, t) => sum + t.pnlPercent, 0) / puts.length : 0,
    },
  }
}

/**
 * Empty stats object
 * @returns {Object}
 */
function getEmptyStats() {
  return {
    totalTrades: 0,
    winCount: 0,
    lossCount: 0,
    breakevenCount: 0,
    winRate: 0,
    totalPnL: 0,
    totalReturn: 0,
    avgTradePnL: 0,
    grossProfit: 0,
    grossLoss: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    payoffRatio: 0,
    maxDrawdown: 0,
    maxDrawdownDuration: 0,
    currentDrawdown: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    avgHoldingPeriod: 0,
    statsBySignalType: {},
    statsByDirection: { CALL: { count: 0, winRate: 0, avgPnL: 0 }, PUT: { count: 0, winRate: 0, avgPnL: 0 } },
  }
}

/**
 * Run Monte Carlo simulation
 * @param {Array} trades - Closed trades
 * @param {number} iterations - Number of simulations
 * @returns {Object} - Distribution of outcomes
 */
export function monteCarloSimulation(trades, iterations = 1000) {
  if (trades.length < 10) {
    return null
  }

  const returns = trades.map((t) => t.pnlPercent)
  const results = []

  for (let i = 0; i < iterations; i++) {
    // Shuffle returns (random order)
    const shuffled = [...returns].sort(() => Math.random() - 0.5)

    // Calculate equity curve
    let equity = 100
    let peak = 100
    let maxDD = 0

    for (const ret of shuffled) {
      equity += ret
      peak = Math.max(peak, equity)
      const dd = ((equity - peak) / peak) * 100
      maxDD = Math.min(maxDD, dd)
    }

    results.push({
      finalEquity: equity,
      totalReturn: equity - 100,
      maxDrawdown: maxDD,
    })
  }

  // Calculate percentiles
  const sortedReturns = results.map((r) => r.totalReturn).sort((a, b) => a - b)
  const sortedDrawdowns = results.map((r) => r.maxDrawdown).sort((a, b) => a - b)

  const getPercentile = (arr, p) => arr[Math.floor(arr.length * p)]

  return {
    iterations,
    medianReturn: getPercentile(sortedReturns, 0.5),
    returnDistribution: {
      p5: getPercentile(sortedReturns, 0.05),
      p25: getPercentile(sortedReturns, 0.25),
      p50: getPercentile(sortedReturns, 0.5),
      p75: getPercentile(sortedReturns, 0.75),
      p95: getPercentile(sortedReturns, 0.95),
    },
    maxDrawdownDistribution: {
      p5: getPercentile(sortedDrawdowns, 0.05),
      p25: getPercentile(sortedDrawdowns, 0.25),
      p50: getPercentile(sortedDrawdowns, 0.5),
      p75: getPercentile(sortedDrawdowns, 0.75),
      p95: getPercentile(sortedDrawdowns, 0.95),
    },
    probabilityOfRuin: results.filter((r) => r.finalEquity <= 0).length / iterations,
    probabilityOfProfit: results.filter((r) => r.totalReturn > 0).length / iterations,
  }
}

/**
 * Calculate equity curve from trades
 * @param {Array} trades - Closed trades
 * @param {number} initialCapital - Starting capital
 * @param {number} positionPercent - Position size as % of capital (default 100 for full capital)
 * @param {boolean} useDollarPnL - If true, use trade.pnl directly instead of pnlPercent calculation
 * @returns {Array} - Equity curve points
 */
export function calculateEquityCurve(trades, initialCapital = 10000, positionPercent = 100, useDollarPnL = false) {
  if (trades.length === 0) return []

  const curve = [{ time: trades[0].entryTime, equity: initialCapital, drawdown: 0 }]

  let equity = initialCapital
  let peak = initialCapital
  const positionFraction = positionPercent / 100

  for (const trade of trades) {
    // BANKRUPTCY CHECK: Stop if equity is at or below 0
    if (equity <= 0) {
      console.log('[EquityCurve] BANKRUPTCY - stopping equity calculation')
      break
    }

    let pnlDollars
    if (useDollarPnL && trade.pnl !== undefined) {
      // Use actual dollar P&L from trade (accounts for dynamic contracts)
      pnlDollars = trade.pnl
    } else {
      // Position size as fraction of CURRENT equity (compounding)
      const positionSize = equity * positionFraction
      pnlDollars = (trade.pnlPercent / 100) * positionSize
    }

    equity += pnlDollars

    // FLOOR AT ZERO: Equity cannot go negative
    equity = Math.max(0, equity)

    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((equity - peak) / peak) * 100 : -100

    curve.push({
      time: trade.exitTime,
      equity,
      drawdown,
    })
  }

  return curve
}
