#!/usr/bin/env node
/**
 * OIWASP Backtest Script
 * Test OI-WASP strategy on SPY with various parameters
 * Target: 200%+ monthly return
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  FixedBarsExit,
  calculateStatistics,
} from '../src/core/backtest/index.js'

// Configuration to test
const TEST_CONFIGS = [
  // Aggressive settings for high returns
  { waspPeriod: 10, entryDeviation: 0.3, targetPercent: 2.0, stopPercent: 0.5, positionPercent: 50 },
  { waspPeriod: 10, entryDeviation: 0.2, targetPercent: 1.5, stopPercent: 0.3, positionPercent: 50 },
  { waspPeriod: 5, entryDeviation: 0.2, targetPercent: 1.0, stopPercent: 0.25, positionPercent: 100 },

  // Medium aggression
  { waspPeriod: 15, entryDeviation: 0.4, targetPercent: 1.5, stopPercent: 0.5, positionPercent: 30 },
  { waspPeriod: 20, entryDeviation: 0.5, targetPercent: 1.0, stopPercent: 0.5, positionPercent: 20 },

  // Butterfly-like R:R (8:1)
  { waspPeriod: 10, entryDeviation: 0.3, targetPercent: 4.0, stopPercent: 0.5, positionPercent: 50 },
  { waspPeriod: 5, entryDeviation: 0.15, targetPercent: 3.0, stopPercent: 0.4, positionPercent: 75 },

  // Scalping with high leverage
  { waspPeriod: 5, entryDeviation: 0.1, targetPercent: 0.5, stopPercent: 0.15, positionPercent: 100, bars: 5 },
]

async function runBacktest(config, candles) {
  const signalSource = new OISignalSource({
    waspPeriod: config.waspPeriod,
    entryDeviation: config.entryDeviation,
    strongDeviation: config.entryDeviation * 2,
    signalTypes: ['CALL', 'PUT'],
    minStrength: 20,
    cooldownBars: 2,
  })

  const exitStrategy = config.bars
    ? new FixedBarsExit(config.bars)
    : new TargetStopExit(config.targetPercent, config.stopPercent, 30)

  const engine = new BacktestEngine({
    signalSource,
    exitStrategy,
    candles,
    initialCapital: 10000,
    positionSize: 'percent',
    positionPercent: config.positionPercent,
    maxConcurrentTrades: 1,
    allowReversal: true,
  })

  try {
    const results = await engine.run()
    const stats = calculateStatistics(results.trades, 10000)
    return { results, stats, config }
  } catch (e) {
    return { error: e.message, config }
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('OIWASP Strategy Backtest - SPY')
  console.log('Target: 200%+ monthly return')
  console.log('='.repeat(80))

  // Fetch 1 month of 5-minute data for aggressive testing
  console.log('\nFetching SPY 5-minute data for 1 month...')
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  const candles5m = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles5m?.length || 0} 5-minute candles`)

  // Also fetch 15-minute data
  console.log('\nFetching SPY 15-minute data for 1 month...')
  const candles15m = await fetchCandleData('SPY', 15, { startDate, endDate })
  console.log(`Loaded ${candles15m?.length || 0} 15-minute candles`)

  // Fetch 1-hour data for 3 months
  const startDate3m = new Date()
  startDate3m.setDate(startDate3m.getDate() - 90)
  console.log('\nFetching SPY 1-hour data for 3 months...')
  const candles1h = await fetchCandleData('SPY', 60, { startDate: startDate3m, endDate })
  console.log(`Loaded ${candles1h?.length || 0} 1-hour candles`)

  if (!candles5m || candles5m.length < 50) {
    console.error('Failed to fetch sufficient candle data')
    process.exit(1)
  }

  console.log('\n' + '='.repeat(80))
  console.log('Running backtests with different configurations...')
  console.log('='.repeat(80))

  const allResults = []

  // Test each config with 5-minute data
  console.log('\n--- 5-Minute Timeframe Tests ---')
  for (const config of TEST_CONFIGS) {
    const result = await runBacktest(config, candles5m)
    if (!result.error) {
      allResults.push({ ...result, timeframe: '5m' })
      printResult(result, '5m')
    }
  }

  // Test each config with 15-minute data
  if (candles15m && candles15m.length >= 50) {
    console.log('\n--- 15-Minute Timeframe Tests ---')
    for (const config of TEST_CONFIGS) {
      const result = await runBacktest(config, candles15m)
      if (!result.error) {
        allResults.push({ ...result, timeframe: '15m' })
        printResult(result, '15m')
      }
    }
  }

  // Sort by total return
  allResults.sort((a, b) => {
    const returnA = ((a.results.equityCurve.slice(-1)[0]?.equity || 10000) - 10000) / 10000 * 100
    const returnB = ((b.results.equityCurve.slice(-1)[0]?.equity || 10000) - 10000) / 10000 * 100
    return returnB - returnA
  })

  console.log('\n' + '='.repeat(80))
  console.log('TOP 5 CONFIGURATIONS BY RETURN')
  console.log('='.repeat(80))

  for (let i = 0; i < Math.min(5, allResults.length); i++) {
    const r = allResults[i]
    const finalEquity = r.results.equityCurve.slice(-1)[0]?.equity || 10000
    const totalReturn = ((finalEquity - 10000) / 10000 * 100).toFixed(1)

    console.log(`\n#${i + 1}: ${totalReturn}% Return (${r.timeframe})`)
    console.log(`   Config: WASP=${r.config.waspPeriod}, Dev=${r.config.entryDeviation}%`)
    console.log(`   Target=${r.config.targetPercent}%, Stop=${r.config.stopPercent}%, Position=${r.config.positionPercent}%`)
    console.log(`   Trades: ${r.stats.totalTrades}, Win Rate: ${r.stats.winRate.toFixed(1)}%`)
    console.log(`   Max DD: ${r.stats.maxDrawdown.toFixed(1)}%, Sharpe: ${r.stats.sharpeRatio.toFixed(2)}`)
  }

  // Check if any achieved 200%+
  const achieved200 = allResults.filter(r => {
    const finalEquity = r.results.equityCurve.slice(-1)[0]?.equity || 10000
    return ((finalEquity - 10000) / 10000 * 100) >= 200
  })

  console.log('\n' + '='.repeat(80))
  if (achieved200.length > 0) {
    console.log(`SUCCESS: ${achieved200.length} configurations achieved 200%+ monthly return!`)
  } else {
    console.log('No configuration reached 200% target with current parameters.')
    console.log('\nTo achieve 200%+ returns, consider:')
    console.log('1. Using options leverage (10-100x) instead of underlying')
    console.log('2. Trading butterfly spreads with 8:1 R:R as per original strategy')
    console.log('3. Focusing on third week of month (monthly options expiry)')
    console.log('4. Using real-time OI data for true WASP calculation')
  }
  console.log('='.repeat(80))
}

function printResult(result, timeframe) {
  const { stats, config, results } = result
  const finalEquity = results.equityCurve.slice(-1)[0]?.equity || 10000
  const totalReturn = ((finalEquity - 10000) / 10000 * 100).toFixed(1)

  const configStr = `WASP=${config.waspPeriod} Dev=${config.entryDeviation}% Target=${config.targetPercent}% Stop=${config.stopPercent}% Pos=${config.positionPercent}%`
  const statsStr = `Trades=${stats.totalTrades} WR=${stats.winRate.toFixed(0)}% Return=${totalReturn}% DD=${stats.maxDrawdown.toFixed(1)}%`

  console.log(`[${timeframe}] ${configStr}`)
  console.log(`       ${statsStr}`)
}

main().catch(console.error)
