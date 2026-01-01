#!/usr/bin/env node
/**
 * CLI Backtest Script for OI-WASP Strategy
 * Run: node scripts/backtest-cli.js [symbol] [days]
 */

const symbol = process.argv[2] || 'SPY'
const days = parseInt(process.argv[3]) || 365

console.log(`\nFetching ${days} days of ${symbol} data for backtest...\n`)

// Fetch historical data from Yahoo Finance
async function fetchHistoricalData(sym, numDays) {
  const endTime = Math.floor(Date.now() / 1000)
  const startTime = endTime - (numDays * 24 * 60 * 60)

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${startTime}&period2=${endTime}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!data.chart?.result?.[0]) {
      throw new Error('No data returned')
    }

    const result = data.chart.result[0]
    const timestamps = result.timestamp
    const quote = result.indicators.quote[0]

    const candles = []
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close[i] != null) {
        candles.push({
          time: timestamps[i] * 1000,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0,
        })
      }
    }

    return candles
  } catch (e) {
    console.error('Failed to fetch data:', e.message)
    process.exit(1)
  }
}

// Backtest implementation (inline to avoid module issues)
function calculateSyntheticWASP(prices, period = 20) {
  if (prices.length < period) return prices[prices.length - 1]
  const recent = prices.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / period
}

function calculateVolRegime(prices, period = 20) {
  if (prices.length < period) return 'high_vol'
  const returns = []
  for (let i = 1; i < Math.min(period, prices.length); i++) {
    returns.push((prices[prices.length - i] - prices[prices.length - i - 1]) / prices[prices.length - i - 1])
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length
  const volatility = Math.sqrt(variance) * Math.sqrt(252)
  return volatility < 0.20 ? 'low_vol' : 'high_vol'
}

function calculateButterflyPnL(entrySpot, exitSpot, centerStrike, wingWidth = 5, netDebit = 0.55) {
  const intrinsicValue = Math.max(0, wingWidth - Math.abs(exitSpot - centerStrike))
  return {
    pnl: (intrinsicValue - netDebit) * 100,
    pnlPercent: ((intrinsicValue - netDebit) / netDebit) * 100,
  }
}

function runBacktest(candles, config = {}) {
  const {
    deviationThreshold = 1.5,
    holdingPeriod = 5,
    wingWidth = 5,
    netDebit = 0.55,
    accountSize = 10000,
    maxPositionPct = 0.33,
    waspPeriod = 20,
  } = config

  const trades = []
  let currentAccount = accountSize
  let openPosition = null
  let winCount = 0, lossCount = 0
  const startIdx = Math.max(waspPeriod, 30)

  for (let i = startIdx; i < candles.length; i++) {
    const candle = candles[i]
    const prices = candles.slice(0, i + 1).map(c => c.close)
    const spot = candle.close
    const wasp = calculateSyntheticWASP(prices, waspPeriod)
    const volRegime = calculateVolRegime(prices, waspPeriod)
    const deviation = ((spot - wasp) / wasp) * 100

    if (openPosition) {
      openPosition.daysHeld++
      if (openPosition.daysHeld >= holdingPeriod) {
        const result = calculateButterflyPnL(openPosition.entrySpot, spot, openPosition.centerStrike, wingWidth, netDebit)
        const tradePnL = result.pnl * openPosition.contracts
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
          deviation: openPosition.deviation,
          contracts: openPosition.contracts,
          pnl: tradePnL,
          pnlPercent: result.pnlPercent,
          result: tradePnL > 0 ? 'WIN' : 'LOSS',
        })
        openPosition = null
      }
    }

    if (!openPosition && volRegime === 'low_vol' && Math.abs(deviation) >= deviationThreshold) {
      const maxRisk = currentAccount * maxPositionPct
      const contracts = Math.floor(maxRisk / (netDebit * 100))
      if (contracts > 0) {
        const centerStrike = Math.round(wasp / 5) * 5
        openPosition = {
          entryDate: candle.time,
          entrySpot: spot,
          centerStrike,
          wasp,
          deviation,
          direction: deviation > 0 ? 'PUT_BUTTERFLY' : 'CALL_BUTTERFLY',
          contracts,
          daysHeld: 0,
        }
      }
    }
  }

  const totalTrades = trades.length
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0
  const totalPnL = currentAccount - accountSize
  const totalReturn = (totalPnL / accountSize) * 100
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0
  const profitFactor = avgLoss > 0 && lossCount > 0 ? (avgWin * winCount) / (avgLoss * lossCount) : avgWin > 0 ? Infinity : 0

  return {
    summary: { startingCapital: accountSize, endingCapital: currentAccount, totalReturn, totalTrades, winCount, lossCount, winRate, avgWin, avgLoss, profitFactor },
    trades,
    config: { deviationThreshold, holdingPeriod, wingWidth, netDebit, maxPositionPct },
  }
}

// Main
async function main() {
  const candles = await fetchHistoricalData(symbol, days)
  console.log(`Loaded ${candles.length} candles from ${new Date(candles[0].time).toLocaleDateString()} to ${new Date(candles[candles.length-1].time).toLocaleDateString()}`)

  console.log('\n' + '='.repeat(60))
  console.log('OI-WASP BUTTERFLY STRATEGY BACKTEST')
  console.log('='.repeat(60))

  // Test multiple deviation thresholds
  const thresholds = [1.0, 1.5, 2.0, 2.5]

  console.log('\nTesting different deviation thresholds:\n')
  console.log('Threshold | Trades | Win Rate | Return | Profit Factor')
  console.log('-'.repeat(55))

  for (const threshold of thresholds) {
    const results = runBacktest(candles, { deviationThreshold: threshold })
    const s = results.summary
    console.log(`   ${threshold.toFixed(1)}%    |   ${String(s.totalTrades).padStart(3)}  |  ${s.winRate.toFixed(1)}%   | ${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(1)}%  |    ${s.profitFactor.toFixed(2)}`)
  }

  // Detailed report for 1.5% threshold (from strategy)
  console.log('\n' + '='.repeat(60))
  console.log('DETAILED RESULTS (1.5% Deviation Threshold)')
  console.log('='.repeat(60))

  const mainResults = runBacktest(candles, { deviationThreshold: 1.5 })
  const s = mainResults.summary

  console.log(`\nCapital: $${s.startingCapital.toLocaleString()} -> $${s.endingCapital.toLocaleString()}`)
  console.log(`Return: ${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(2)}%`)
  console.log(`Trades: ${s.totalTrades} (${s.winCount} wins, ${s.lossCount} losses)`)
  console.log(`Win Rate: ${s.winRate.toFixed(1)}%`)
  console.log(`Avg Win: $${s.avgWin.toFixed(0)} | Avg Loss: $${s.avgLoss.toFixed(0)}`)
  console.log(`Profit Factor: ${s.profitFactor.toFixed(2)}`)

  if (mainResults.trades.length > 0) {
    console.log('\nLast 10 Trades:')
    console.log('-'.repeat(80))
    const recent = mainResults.trades.slice(-10)
    for (const t of recent) {
      const date = new Date(t.entryDate).toLocaleDateString()
      const dir = t.direction.includes('PUT') ? 'PUT' : 'CALL'
      console.log(`${date} | ${dir} BF @ $${t.centerStrike} | Dev: ${t.deviation > 0 ? '+' : ''}${t.deviation.toFixed(1)}% | Entry: $${t.entrySpot.toFixed(2)} -> Exit: $${t.exitSpot.toFixed(2)} | P&L: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(0)} [${t.result}]`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('INTERPRETATION:')
  console.log('='.repeat(60))
  console.log(`
Strategy uses synthetic WASP (20-day SMA as proxy for OI-weighted price).
In real trading, actual OI data would improve signal quality.

Key findings from ${symbol} backtest:
- Win rate of ${s.winRate.toFixed(0)}% ${s.winRate >= 50 ? 'meets' : 'below'} the 50%+ target
- Profit factor of ${s.profitFactor.toFixed(1)} ${s.profitFactor >= 1.5 ? 'is healthy' : 'needs improvement'}
- Average win ($${s.avgWin.toFixed(0)}) vs loss ($${s.avgLoss.toFixed(0)}) ratio: ${(s.avgWin/s.avgLoss).toFixed(1)}:1

Notes:
- This backtest uses daily data (actual strategy uses intraday)
- Real OI data would provide better WASP calculations
- 3rd week of month (OpEx) typically has higher accuracy
`)
}

main().catch(console.error)
