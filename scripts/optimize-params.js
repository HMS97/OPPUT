#!/usr/bin/env node
/**
 * Parameter Optimization for OI-WASP Strategy
 * Tests multiple parameter combinations to find optimal values
 */

const symbol = process.argv[2] || 'SPY'
const days = parseInt(process.argv[3]) || 365

console.log(`\n=== PARAMETER OPTIMIZATION: ${symbol} (${days} days) ===\n`)

async function fetchData(sym, numDays) {
  const endTime = Math.floor(Date.now() / 1000)
  const startTime = endTime - (numDays * 24 * 60 * 60)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${startTime}&period2=${endTime}`
  const response = await fetch(url)
  const data = await response.json()
  const result = data.chart.result[0]
  return result.timestamp.map((t, i) => ({
    time: t * 1000,
    close: result.indicators.quote[0].close[i],
    high: result.indicators.quote[0].high[i],
    low: result.indicators.quote[0].low[i],
  })).filter(c => c.close != null)
}

// Fetch VIX historical data
async function fetchVIXData(numDays) {
  const endTime = Math.floor(Date.now() / 1000)
  const startTime = endTime - (numDays * 24 * 60 * 60)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=${startTime}&period2=${endTime}`
  try {
    const response = await fetch(url)
    const data = await response.json()
    const result = data.chart.result[0]
    const vixMap = {}
    result.timestamp.forEach((t, i) => {
      const dateKey = new Date(t * 1000).toISOString().split('T')[0]
      vixMap[dateKey] = result.indicators.quote[0].close[i]
    })
    return vixMap
  } catch (e) {
    console.log('VIX data unavailable, using simulated')
    return null
  }
}

function calculateTrend(prices, period = 50) {
  if (prices.length < period) return 'neutral'
  const sma50 = prices.slice(-period).reduce((a, b) => a + b, 0) / period
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20
  const current = prices[prices.length - 1]
  if (current > sma50 * 1.02 && sma20 > sma50) return 'uptrend'
  if (current < sma50 * 0.98 && sma20 < sma50) return 'downtrend'
  return 'range'
}

function calculateVolatility(prices, period = 20) {
  if (prices.length < period) return 0.25
  const returns = []
  for (let i = 1; i < period; i++) {
    returns.push((prices[prices.length - i] - prices[prices.length - i - 1]) / prices[prices.length - i - 1])
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(252)
}

function runBacktest(candles, vixData, config) {
  const {
    deviationThreshold = 1.5,
    holdingPeriod = 5,
    wingWidth = 5,
    netDebit = 0.55,
    accountSize = 10000,
    requireRange = true,
    vixThreshold = 20,
    useVixFilter = true,
  } = config

  const trades = []
  let account = accountSize
  let position = null
  let wins = 0, losses = 0

  for (let i = 50; i < candles.length; i++) {
    const prices = candles.slice(0, i + 1).map(c => c.close)
    const spot = candles[i].close
    const wasp = prices.slice(-20).reduce((a, b) => a + b, 0) / 20
    const deviation = ((spot - wasp) / wasp) * 100
    const trend = calculateTrend(prices)
    const vol = calculateVolatility(prices)

    // Get VIX for this date
    const dateKey = new Date(candles[i].time).toISOString().split('T')[0]
    const vix = vixData ? vixData[dateKey] : (vol * 100) // Use realized vol as proxy if no VIX

    // Close position at expiry
    if (position) {
      position.daysHeld++
      if (position.daysHeld >= holdingPeriod) {
        const intrinsic = Math.max(0, wingWidth - Math.abs(spot - position.centerStrike))
        const pnl = (intrinsic - netDebit) * 100 * position.contracts
        account += pnl
        if (pnl > 0) wins++
        else losses++
        trades.push({ ...position, exitSpot: spot, pnl, result: pnl > 0 ? 'WIN' : 'LOSS' })
        position = null
      }
    }

    // Entry conditions
    const isRangeOk = !requireRange || trend === 'range'
    const isVixOk = !useVixFilter || (vix && vix < vixThreshold)
    const isLowVol = vol < 0.20
    const canEnter = isRangeOk && isVixOk && isLowVol && Math.abs(deviation) >= deviationThreshold

    if (!position && canEnter) {
      const maxRisk = account * 0.33
      const contracts = Math.floor(maxRisk / (netDebit * 100))
      if (contracts > 0) {
        position = {
          entryDate: candles[i].time,
          entrySpot: spot,
          centerStrike: Math.round(wasp / 5) * 5,
          deviation,
          direction: deviation > 0 ? 'PUT_BF' : 'CALL_BF',
          contracts,
          daysHeld: 0,
          vix,
        }
      }
    }
  }

  const totalTrades = trades.length
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const totalReturn = ((account - accountSize) / accountSize) * 100

  return { account, totalReturn, totalTrades, wins, losses, winRate, trades }
}

async function main() {
  console.log('Fetching data...')
  const [candles, vixData] = await Promise.all([
    fetchData(symbol, days),
    fetchVIXData(days),
  ])

  console.log(`Loaded ${candles.length} days of ${symbol}`)
  console.log(`VIX data: ${vixData ? 'Available' : 'Using volatility proxy'}\n`)

  // Parameter ranges to test
  const deviationThresholds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
  const vixThresholds = [15, 18, 20, 22, 25, 30]
  const holdingPeriods = [3, 5, 7]
  const rangeFilters = [true, false]

  const results = []

  // Test all combinations
  console.log('Testing parameter combinations...\n')

  for (const devThresh of deviationThresholds) {
    for (const vixThresh of vixThresholds) {
      for (const holdDays of holdingPeriods) {
        for (const useRange of rangeFilters) {
          const result = runBacktest(candles, vixData, {
            deviationThreshold: devThresh,
            vixThreshold: vixThresh,
            holdingPeriod: holdDays,
            requireRange: useRange,
            useVixFilter: true,
          })

          results.push({
            devThresh,
            vixThresh,
            holdDays,
            useRange,
            ...result,
          })
        }
      }
    }
  }

  // Sort by win rate (primary) and return (secondary)
  results.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate
    return b.totalReturn - a.totalReturn
  })

  // Filter to show only profitable or high win-rate results
  const goodResults = results.filter(r => r.totalTrades >= 3 && (r.winRate >= 30 || r.totalReturn > 0))

  console.log('='.repeat(100))
  console.log('TOP PARAMETER COMBINATIONS (by Win Rate)')
  console.log('='.repeat(100))
  console.log('Dev%  | VIX< | Hold | Range | Trades | Wins | Losses | Win% | Return% | Final $')
  console.log('-'.repeat(100))

  for (const r of goodResults.slice(0, 20)) {
    console.log(
      `${r.devThresh.toFixed(1).padStart(4)}  | ` +
      `${String(r.vixThresh).padStart(4)} | ` +
      `${String(r.holdDays).padStart(4)} | ` +
      `${r.useRange ? ' Yes ' : ' No  '} | ` +
      `${String(r.totalTrades).padStart(6)} | ` +
      `${String(r.wins).padStart(4)} | ` +
      `${String(r.losses).padStart(6)} | ` +
      `${r.winRate.toFixed(1).padStart(4)}% | ` +
      `${(r.totalReturn >= 0 ? '+' : '') + r.totalReturn.toFixed(1).padStart(6)}% | ` +
      `$${r.account.toFixed(0).padStart(6)}`
    )
  }

  // Find best by different criteria
  console.log('\n' + '='.repeat(100))
  console.log('BEST PARAMETERS BY CRITERIA')
  console.log('='.repeat(100))

  const withTrades = results.filter(r => r.totalTrades >= 3)

  const bestWinRate = withTrades.reduce((best, r) => r.winRate > best.winRate ? r : best, withTrades[0])
  const bestReturn = withTrades.reduce((best, r) => r.totalReturn > best.totalReturn ? r : best, withTrades[0])
  const bestRiskAdjusted = withTrades.reduce((best, r) => {
    const score = r.winRate * 0.5 + Math.max(0, r.totalReturn) * 0.5
    const bestScore = best.winRate * 0.5 + Math.max(0, best.totalReturn) * 0.5
    return score > bestScore ? r : best
  }, withTrades[0])

  console.log(`\nBest Win Rate:`)
  console.log(`  Dev: ${bestWinRate.devThresh}% | VIX: <${bestWinRate.vixThresh} | Hold: ${bestWinRate.holdDays}d | Range: ${bestWinRate.useRange}`)
  console.log(`  Result: ${bestWinRate.winRate.toFixed(1)}% win rate, ${bestWinRate.totalReturn.toFixed(1)}% return, ${bestWinRate.totalTrades} trades`)

  console.log(`\nBest Total Return:`)
  console.log(`  Dev: ${bestReturn.devThresh}% | VIX: <${bestReturn.vixThresh} | Hold: ${bestReturn.holdDays}d | Range: ${bestReturn.useRange}`)
  console.log(`  Result: ${bestReturn.winRate.toFixed(1)}% win rate, ${bestReturn.totalReturn.toFixed(1)}% return, ${bestReturn.totalTrades} trades`)

  console.log(`\nBest Risk-Adjusted (balanced):`)
  console.log(`  Dev: ${bestRiskAdjusted.devThresh}% | VIX: <${bestRiskAdjusted.vixThresh} | Hold: ${bestRiskAdjusted.holdDays}d | Range: ${bestRiskAdjusted.useRange}`)
  console.log(`  Result: ${bestRiskAdjusted.winRate.toFixed(1)}% win rate, ${bestRiskAdjusted.totalReturn.toFixed(1)}% return, ${bestRiskAdjusted.totalTrades} trades`)

  // Compare with original parameters
  console.log('\n' + '='.repeat(100))
  console.log('ORIGINAL vs OPTIMIZED')
  console.log('='.repeat(100))

  const original = runBacktest(candles, vixData, {
    deviationThreshold: 1.5,
    vixThreshold: 20,
    holdingPeriod: 5,
    requireRange: true,
    useVixFilter: true,
  })

  console.log(`\nOriginal (Dev: 1.5%, VIX: <20, Hold: 5d, Range: Yes):`)
  console.log(`  ${original.totalTrades} trades, ${original.winRate.toFixed(1)}% win rate, ${original.totalReturn.toFixed(1)}% return`)

  console.log(`\nOptimized (Dev: ${bestRiskAdjusted.devThresh}%, VIX: <${bestRiskAdjusted.vixThresh}, Hold: ${bestRiskAdjusted.holdDays}d, Range: ${bestRiskAdjusted.useRange}):`)
  console.log(`  ${bestRiskAdjusted.totalTrades} trades, ${bestRiskAdjusted.winRate.toFixed(1)}% win rate, ${bestRiskAdjusted.totalReturn.toFixed(1)}% return`)

  console.log('\n' + '='.repeat(100))
  console.log('RECOMMENDED PARAMETERS')
  console.log('='.repeat(100))
  console.log(`
Based on ${days}-day backtest of ${symbol}:

  deviationThreshold: ${bestRiskAdjusted.devThresh}%
  vixThreshold: ${bestRiskAdjusted.vixThresh}
  holdingPeriod: ${bestRiskAdjusted.holdDays} days
  requireRangeMarket: ${bestRiskAdjusted.useRange}

Note: These are optimized for HISTORICAL data using synthetic WASP.
Real OI data may produce different optimal parameters.
Forward-test with paper trading before using real capital.
`)
}

main().catch(console.error)
