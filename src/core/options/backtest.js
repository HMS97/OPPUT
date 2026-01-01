/**
 * Backtest Module for OI-WASP Strategy
 * Tests the butterfly spread strategy on historical price data
 *
 * Strategy Rules (from Chinese trading post):
 * 1. Calculate synthetic WASP from price action (proxy for OI-WASP)
 * 2. Enter butterfly when spot deviates >1.5% from WASP in low vol
 * 3. Hold until expiry (weekly)
 * 4. Max position 1/3 of account
 */

/**
 * Calculate synthetic WASP using rolling mean (proxy for OI-based WASP)
 * In real trading, this would use actual OI data
 */
function calculateSyntheticWASP(prices, period = 20) {
  if (prices.length < period) return prices[prices.length - 1]
  const recent = prices.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / period
}

/**
 * Calculate volatility regime (proxy for GEX)
 * Low vol = positive GEX environment
 */
function calculateVolRegime(prices, period = 20) {
  if (prices.length < period) return 'high_vol'

  const returns = []
  for (let i = 1; i < Math.min(period, prices.length); i++) {
    returns.push((prices[prices.length - i] - prices[prices.length - i - 1]) / prices[prices.length - i - 1])
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length
  const volatility = Math.sqrt(variance) * Math.sqrt(252) // Annualized

  return volatility < 0.20 ? 'low_vol' : 'high_vol' // 20% threshold
}

/**
 * Simulate butterfly spread P&L
 * @param {number} entrySpot - Spot price at entry
 * @param {number} exitSpot - Spot price at exit/expiry
 * @param {number} centerStrike - Center strike of butterfly
 * @param {number} wingWidth - Distance to wing strikes (default $5)
 * @param {number} netDebit - Cost to enter (typically $0.50-$1.00)
 */
function calculateButterflyPnL(entrySpot, exitSpot, centerStrike, wingWidth = 5, netDebit = 0.55) {
  // Butterfly payoff at expiry
  const intrinsicValue = Math.max(0, wingWidth - Math.abs(exitSpot - centerStrike))
  const pnl = (intrinsicValue - netDebit) * 100 // Per contract

  return {
    entrySpot,
    exitSpot,
    centerStrike,
    netDebit,
    intrinsicValue,
    pnl,
    pnlPercent: (pnl / (netDebit * 100)) * 100,
    maxProfit: (wingWidth - netDebit) * 100,
    maxLoss: netDebit * 100,
  }
}

/**
 * Run backtest on historical data
 * @param {Array} candles - Array of {time, open, high, low, close, volume}
 * @param {Object} config - Strategy configuration
 */
export function runBacktest(candles, config = {}) {
  const {
    deviationThreshold = 1.5,    // % deviation to enter
    holdingPeriod = 5,           // Days to hold (weekly expiry)
    wingWidth = 5,               // Butterfly wing width
    netDebit = 0.55,             // Cost per butterfly
    accountSize = 10000,         // Starting account
    maxPositionPct = 0.33,       // Max 1/3 of account per trade
    waspPeriod = 20,             // Period for WASP calculation
  } = config

  const trades = []
  const equity = [{ date: candles[0]?.time, value: accountSize }]
  let currentAccount = accountSize
  let openPosition = null
  let winCount = 0
  let lossCount = 0

  // Need enough history for WASP calculation
  const startIdx = Math.max(waspPeriod, 30)

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i]
    const prices = candles.slice(0, i + 1).map(c => c.close)

    const spot = candle.close
    const wasp = calculateSyntheticWASP(prices, waspPeriod)
    const volRegime = calculateVolRegime(prices, waspPeriod)
    const deviation = ((spot - wasp) / wasp) * 100

    // Check if we have an open position to close
    if (openPosition) {
      openPosition.daysHeld++

      // Close at expiry (holding period)
      if (openPosition.daysHeld >= holdingPeriod) {
        const result = calculateButterflyPnL(
          openPosition.entrySpot,
          spot,
          openPosition.centerStrike,
          wingWidth,
          netDebit
        )

        const contracts = openPosition.contracts
        const tradePnL = result.pnl * contracts
        currentAccount += tradePnL

        if (tradePnL > 0) winCount++
        else lossCount++

        trades.push({
          entryDate: openPosition.entryDate,
          exitDate: candle.time,
          direction: openPosition.direction,
          entrySpot: openPosition.entrySpot,
          exitSpot: spot,
          centerStrike: openPosition.centerStrike,
          wasp: openPosition.wasp,
          deviation: openPosition.deviation,
          contracts,
          netDebit,
          pnl: tradePnL,
          pnlPercent: result.pnlPercent,
          accountAfter: currentAccount,
          result: tradePnL > 0 ? 'WIN' : 'LOSS',
        })

        openPosition = null
      }
    }

    // Look for new entry if no position
    if (!openPosition && volRegime === 'low_vol') {
      const absDeviation = Math.abs(deviation)

      if (absDeviation >= deviationThreshold) {
        // Calculate position size
        const maxRisk = currentAccount * maxPositionPct
        const contracts = Math.floor(maxRisk / (netDebit * 100))

        if (contracts > 0) {
          // Round center strike to nearest $5
          const centerStrike = Math.round(wasp / 5) * 5
          const direction = deviation > 0 ? 'PUT_BUTTERFLY' : 'CALL_BUTTERFLY'

          openPosition = {
            entryDate: candle.time,
            entrySpot: spot,
            centerStrike,
            wasp,
            deviation,
            direction,
            contracts,
            daysHeld: 0,
          }
        }
      }
    }

    // Track equity curve
    if (i % 5 === 0 || i === candles.length - 1) {
      equity.push({ date: candle.time, value: currentAccount })
    }
  }

  // Calculate statistics
  const totalTrades = trades.length
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0
  const totalPnL = currentAccount - accountSize
  const totalReturn = (totalPnL / accountSize) * 100

  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0
  const profitFactor = avgLoss > 0 ? (avgWin * winCount) / (avgLoss * lossCount) : 0

  // Calculate max drawdown
  let maxEquity = accountSize
  let maxDrawdown = 0
  for (const eq of equity) {
    maxEquity = Math.max(maxEquity, eq.value)
    const drawdown = ((maxEquity - eq.value) / maxEquity) * 100
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  }

  return {
    summary: {
      startDate: candles[startIdx]?.time,
      endDate: candles[candles.length - 1]?.time,
      totalDays: candles.length - startIdx,
      startingCapital: accountSize,
      endingCapital: Math.round(currentAccount * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalTrades,
      winCount,
      lossCount,
      winRate: Math.round(winRate * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    },
    trades,
    equity,
    config: {
      deviationThreshold,
      holdingPeriod,
      wingWidth,
      netDebit,
      maxPositionPct,
    },
  }
}

/**
 * Format backtest results for display
 */
export function formatBacktestReport(results) {
  const { summary, trades, config } = results

  const report = []
  report.push('=' .repeat(60))
  report.push('OI-WASP BUTTERFLY STRATEGY BACKTEST RESULTS')
  report.push('=' .repeat(60))
  report.push('')
  report.push('STRATEGY CONFIGURATION:')
  report.push(`  Deviation Threshold: ${config.deviationThreshold}%`)
  report.push(`  Holding Period: ${config.holdingPeriod} days`)
  report.push(`  Wing Width: $${config.wingWidth}`)
  report.push(`  Net Debit: $${config.netDebit}`)
  report.push(`  Max Position: ${config.maxPositionPct * 100}% of account`)
  report.push('')
  report.push('PERFORMANCE SUMMARY:')
  report.push(`  Period: ${new Date(summary.startDate).toLocaleDateString()} - ${new Date(summary.endDate).toLocaleDateString()}`)
  report.push(`  Total Days: ${summary.totalDays}`)
  report.push(`  Starting Capital: $${summary.startingCapital.toLocaleString()}`)
  report.push(`  Ending Capital: $${summary.endingCapital.toLocaleString()}`)
  report.push(`  Total Return: ${summary.totalReturn}%`)
  report.push('')
  report.push('TRADE STATISTICS:')
  report.push(`  Total Trades: ${summary.totalTrades}`)
  report.push(`  Winners: ${summary.winCount}`)
  report.push(`  Losers: ${summary.lossCount}`)
  report.push(`  Win Rate: ${summary.winRate}%`)
  report.push(`  Avg Win: $${summary.avgWin}`)
  report.push(`  Avg Loss: $${summary.avgLoss}`)
  report.push(`  Profit Factor: ${summary.profitFactor}`)
  report.push(`  Max Drawdown: ${summary.maxDrawdown}%`)
  report.push('')

  if (trades.length > 0) {
    report.push('RECENT TRADES:')
    const recentTrades = trades.slice(-10)
    for (const t of recentTrades) {
      const date = new Date(t.entryDate).toLocaleDateString()
      report.push(`  ${date} | ${t.direction} @ $${t.centerStrike} | Dev: ${t.deviation.toFixed(1)}% | P&L: $${t.pnl.toFixed(0)} (${t.result})`)
    }
  }

  report.push('')
  report.push('=' .repeat(60))

  return report.join('\n')
}

/**
 * Quick backtest with default settings
 */
export async function quickBacktest(candles) {
  const results = runBacktest(candles, {
    deviationThreshold: 1.5,
    holdingPeriod: 5,
    wingWidth: 5,
    netDebit: 0.55,
    accountSize: 10000,
    maxPositionPct: 0.33,
  })

  return {
    results,
    report: formatBacktestReport(results),
  }
}
