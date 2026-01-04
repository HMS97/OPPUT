#!/usr/bin/env node
/**
 * Debug single backtest to understand equity curve behavior
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

async function main() {
  console.log('=== Debug Backtest ===\n')

  // Fetch data
  console.log('Fetching SPY 5m data...')
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)  // Just 1 month for debug

  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles.length} candles\n`)

  // Config with OPTION-level targets (not underlying)
  // Options have ~5-15x leverage inherently, so:
  // - 20% option target ≈ 1-2% underlying move
  // - 30% option stop ≈ 1.5-3% underlying move
  const config = {
    waspPeriod: 10,
    entryDeviation: 0.15,  // 0.15% underlying deviation triggers entry
    targetPercent: 25,     // 25% OPTION profit target
    stopPercent: 35,       // 35% OPTION stop loss
    leverage: 1,           // No additional leverage (options already leveraged)
    positionPercent: 20,   // 20% of capital per trade
  }

  console.log('Config:', config)

  const source = new OISignalSource({
    timeframe: 5,
    waspPeriod: config.waspPeriod,
    entryDeviation: config.entryDeviation,
    strongDeviation: config.entryDeviation * 2,
    useFilters: false,
    useWeekFilter: false,
    minStrength: 10,
    signalTypes: ['CALL', 'PUT'],
    cooldownBars: 2,
  })

  const exit = new TargetStopExit(config.targetPercent, config.stopPercent)

  const engine = new BacktestEngine({
    signalSource: source,
    exitStrategy: exit,
    candles,
    initialCapital: 10000,
    positionSize: 'percent',
    positionPercent: config.positionPercent,
    maxConcurrentTrades: 1,
    timeframe: 5,
  })

  console.log('\nRunning backtest...')
  const results = await engine.run()

  console.log(`\nRaw trades: ${results.trades.length}`)
  if (results.trades.length > 0) {
    console.log('\nFirst 5 trades (before leverage):')
    results.trades.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i+1}. ${t.signal} Entry: ${t.entryPrice.toFixed(2)} Exit: ${t.exitPrice?.toFixed(2)} PnL%: ${t.pnlPercent.toFixed(2)}%`)
    })
  }

  // Apply leverage
  const leveragedTrades = results.trades.map(t => ({
    ...t,
    pnlPercent: t.pnlPercent * config.leverage,
    pnl: t.pnl * config.leverage,
  }))

  console.log('\nFirst 5 trades (after leverage):')
  leveragedTrades.slice(0, 5).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.signal} PnL%: ${t.pnlPercent.toFixed(2)}%`)
  })

  // Calculate equity curve WITHOUT compounding first
  console.log('\n--- Simple additive equity (no compounding) ---')
  let simpleEquity = 10000
  for (const trade of leveragedTrades) {
    const posSize = 10000 * (config.positionPercent / 100)  // Fixed position size
    const pnlDollars = (trade.pnlPercent / 100) * posSize
    simpleEquity += pnlDollars
    if (simpleEquity < 0) simpleEquity = 0
  }
  console.log(`Final equity (simple): $${simpleEquity.toFixed(2)}`)
  console.log(`Return (simple): ${((simpleEquity - 10000) / 10000 * 100).toFixed(1)}%`)

  // Calculate equity curve WITH compounding
  console.log('\n--- Compounding equity ---')
  const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 100)
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
  console.log(`Final equity (compounded): $${finalEquity.toFixed(2)}`)
  console.log(`Return (compounded): ${((finalEquity - 10000) / 10000 * 100).toFixed(1)}%`)

  console.log('\nEquity curve (first 10 points):')
  equityCurve.slice(0, 10).forEach((e, i) => {
    console.log(`  ${i}. Equity: $${e.equity.toFixed(2)} DD: ${e.drawdown.toFixed(1)}%`)
  })

  // Stats
  const stats = calculateStatistics(leveragedTrades, 10000)
  console.log('\n--- Statistics ---')
  console.log(`Win Rate: ${stats.winRate.toFixed(1)}%`)
  console.log(`Avg Win: ${stats.avgWin.toFixed(2)}%`)
  console.log(`Avg Loss: ${stats.avgLoss.toFixed(2)}%`)
  console.log(`Max DD: ${stats.maxDrawdown.toFixed(1)}%`)
  console.log(`Expectancy: ${stats.expectancy.toFixed(2)}%`)
}

main().catch(console.error)
