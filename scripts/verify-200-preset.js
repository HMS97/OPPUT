#!/usr/bin/env node
/**
 * Verify the 200% preset configuration works correctly
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
  console.log('=== Verifying 200% Preset ===\n')

  // Suppress logs
  const origLog = console.log
  console.log = () => {}

  // Fetch data (60 days max for 5m data from Yahoo)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 60)

  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })

  console.log = origLog
  console.log(`Loaded ${candles.length} candles\n`)

  // Use the validated preset config
  const config = {
    waspPeriod: 8,
    entryDeviation: 0.1,
    targetPercent: 0.25,
    stopPercent: 0.15,
    leverage: 8,  // Realistic butterfly spread leverage
    useUnderlyingPnL: true,  // Exit based on underlying price
  }

  console.log('Config:', config)

  console.log = () => {}

  const source = new OISignalSource({
    timeframe: 5,
    waspPeriod: config.waspPeriod,
    entryDeviation: config.entryDeviation,
    strongDeviation: config.entryDeviation * 2,
    useFilters: false,
    useWeekFilter: false,
    minStrength: 10,
    signalTypes: ['CALL', 'PUT'],
    cooldownBars: 1,
  })

  // Use underlying P&L for exit decisions
  const exit = new TargetStopExit(config.targetPercent, config.stopPercent, 50, false)

  const engine = new BacktestEngine({
    signalSource: source,
    exitStrategy: exit,
    candles,
    initialCapital: 10000,
    positionSize: 'percent',
    positionPercent: 10,  // 10% of capital per trade
    maxConcurrentTrades: 1,
    timeframe: 5,
  })

  const results = await engine.run()

  // Apply leverage (simulate options leverage)
  // Use dynamic contract sizing from engine
  const leveragedTrades = results.trades.map(t => {
    const direction = t.signal === 'CALL' ? 1 : -1
    const underlyingPnL = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * direction
    const leveragedPnLPercent = underlyingPnL * config.leverage

    // Calculate dollar P&L based on actual position (contracts * option price * 100)
    const positionCost = t.contracts * t.optionEntryPrice * 100
    const pnl = (leveragedPnLPercent / 100) * positionCost

    return {
      ...t,
      pnlPercent: leveragedPnLPercent,
      pnl: pnl,
    }
  })

  // Debug: Show sample trades
  console.log = origLog
  console.log('\nSample trades:')
  leveragedTrades.slice(0, 5).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.signal} Qty:${t.contracts} OptEntry:$${t.optionEntryPrice?.toFixed(2)} Entry:${t.entryPrice?.toFixed(2)} Exit:${t.exitPrice?.toFixed(2)} pnl%:${t.pnlPercent?.toFixed(2)}% pnl:$${t.pnl?.toFixed(2)}`)
  })
  console.log = () => {}

  // Calculate equity curve using actual dollar P&L
  const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 10, true)
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
  const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve.map(e => e.equity)) : 10000
  const totalReturn = ((finalEquity - 10000) / 10000) * 100

  const stats = calculateStatistics(leveragedTrades, 10000)

  console.log = origLog

  console.log('\n=== VERIFICATION RESULTS ===')
  console.log(`Trades: ${leveragedTrades.length}`)
  console.log(`Total Return: ${totalReturn.toFixed(0)}%`)
  console.log(`Win Rate: ${stats.winRate.toFixed(0)}%`)
  console.log(`Max Drawdown: ${stats.maxDrawdown.toFixed(0)}%`)
  console.log(`Final Equity: $${finalEquity.toFixed(2)}`)
  console.log(`Min Equity: $${minEquity.toFixed(2)}`)
  console.log(`Bankrupted: ${minEquity <= 0 ? 'YES' : 'NO'}`)

  if (totalReturn >= 200 && minEquity > 0) {
    console.log('\n✅ VERIFICATION PASSED: 200%+ returns achieved without bankruptcy!')
  } else if (minEquity <= 0) {
    console.log('\n❌ VERIFICATION FAILED: Bankruptcy occurred!')
  } else {
    console.log(`\n⚠️ Returns below 200% target (got ${totalReturn.toFixed(0)}%)`)
  }
}

main().catch(console.error)
