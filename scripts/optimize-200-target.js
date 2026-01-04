#!/usr/bin/env node
/**
 * OI-Scalp Optimizer - Target 200%+ Returns
 *
 * Iterates through parameter combinations to find optimal settings
 * with bankruptcy protection (equity cannot go below 0)
 *
 * Usage: node scripts/optimize-200-target.js
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  ButterflyExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Parameter grid to search
const PARAM_GRID = {
  // Timeframe options
  timeframe: [5],  // Focus on 5m for scalping

  // WASP period (SMA lookback)
  waspPeriod: [3, 5, 8, 10, 15],

  // Entry deviation % (smaller = more trades)
  entryDeviation: [0.05, 0.08, 0.1, 0.15, 0.2],

  // Exit strategy params
  exitType: ['target-stop'],
  targetPercent: [0.1, 0.15, 0.2, 0.3],
  stopPercent: [0.08, 0.1, 0.15, 0.2],

  // Leverage (options multiplier)
  leverage: [5, 8, 10, 15, 20],

  // Filters
  useFilters: [false],  // Disabled for more signals
  useWeekFilter: [false, true],

  // Position sizing
  positionPercent: [10, 15, 20, 25],
}

async function runSingleBacktest(config, candles) {
  const source = new OISignalSource({
    timeframe: config.timeframe,
    waspPeriod: config.waspPeriod,
    entryDeviation: config.entryDeviation,
    strongDeviation: config.entryDeviation * 2,
    useFilters: config.useFilters,
    useWeekFilter: config.useWeekFilter,
    minStrength: 10,
    signalTypes: ['CALL', 'PUT'],
    cooldownBars: 1,
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
    timeframe: config.timeframe,
  })

  const results = await engine.run()

  // Apply leverage
  const leveragedTrades = results.trades.map(t => ({
    ...t,
    pnlPercent: t.pnlPercent * config.leverage,
    pnl: t.pnl * config.leverage,
  }))

  // Calculate equity curve with compounding
  const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 100)

  // Get final equity (considering bankruptcy protection)
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
  const totalReturn = ((finalEquity - 10000) / 10000) * 100

  // Check if bankrupted
  const bankrupted = equityCurve.some(e => e.equity <= 0) || finalEquity <= 0

  // Calculate stats
  const stats = calculateStatistics(leveragedTrades, 10000)

  return {
    config,
    trades: leveragedTrades.length,
    totalReturn,
    winRate: stats.winRate,
    maxDrawdown: stats.maxDrawdown,
    sharpe: stats.sharpeRatio,
    expectancy: stats.expectancy,
    finalEquity,
    bankrupted,
    profitFactor: stats.profitFactor,
  }
}

function generateConfigs() {
  const configs = []

  for (const timeframe of PARAM_GRID.timeframe) {
    for (const waspPeriod of PARAM_GRID.waspPeriod) {
      for (const entryDeviation of PARAM_GRID.entryDeviation) {
        for (const targetPercent of PARAM_GRID.targetPercent) {
          for (const stopPercent of PARAM_GRID.stopPercent) {
            // Skip configs where target < stop (bad R:R)
            if (targetPercent < stopPercent) continue

            for (const leverage of PARAM_GRID.leverage) {
              for (const useFilters of PARAM_GRID.useFilters) {
                for (const useWeekFilter of PARAM_GRID.useWeekFilter) {
                  for (const positionPercent of PARAM_GRID.positionPercent) {
                    configs.push({
                      timeframe,
                      waspPeriod,
                      entryDeviation,
                      targetPercent,
                      stopPercent,
                      leverage,
                      useFilters,
                      useWeekFilter,
                      positionPercent,
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return configs
}

async function main() {
  console.log('=== OI-Scalp Optimizer - Target 200%+ Returns ===\n')

  // Fetch data
  console.log('Fetching SPY 5m data (3 months)...')
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles.length} candles\n`)

  // Generate all configs
  const allConfigs = generateConfigs()
  console.log(`Testing ${allConfigs.length} parameter combinations...\n`)

  const results = []
  let tested = 0
  let hits200 = 0

  for (const config of allConfigs) {
    tested++

    if (tested % 100 === 0) {
      process.stdout.write(`\rProgress: ${tested}/${allConfigs.length} (${hits200} hits so far)`)
    }

    try {
      const result = await runSingleBacktest(config, candles)

      // Skip bankrupted or low trade count
      if (result.bankrupted || result.trades < 10) continue

      results.push(result)

      if (result.totalReturn >= 200) {
        hits200++
      }
    } catch (e) {
      // Skip failed configs
    }
  }

  console.log(`\n\nTested ${tested} configurations, ${results.length} valid, ${hits200} achieved 200%+\n`)

  // Filter for 200%+ and sort by return
  const top200 = results
    .filter(r => r.totalReturn >= 200 && !r.bankrupted && r.maxDrawdown > -80)
    .sort((a, b) => b.totalReturn - a.totalReturn)
    .slice(0, 20)

  if (top200.length === 0) {
    console.log('No configurations achieved 200%+ returns without bankruptcy.')
    console.log('\nTop 10 by return (any level):')
    const topAny = results
      .filter(r => !r.bankrupted)
      .sort((a, b) => b.totalReturn - a.totalReturn)
      .slice(0, 10)

    topAny.forEach((r, i) => {
      console.log(`\n${i + 1}. Return: ${r.totalReturn.toFixed(1)}% | DD: ${r.maxDrawdown.toFixed(1)}% | Trades: ${r.trades}`)
      console.log(`   WASP: ${r.config.waspPeriod}, Dev: ${r.config.entryDeviation}, T/S: ${r.config.targetPercent}/${r.config.stopPercent}`)
      console.log(`   Leverage: ${r.config.leverage}x, Position: ${r.config.positionPercent}%, WeekFilter: ${r.config.useWeekFilter}`)
    })
    return
  }

  console.log('=== TOP 20 CONFIGURATIONS (200%+ Returns) ===\n')

  top200.forEach((r, i) => {
    console.log(`${i + 1}. Return: ${r.totalReturn.toFixed(1)}% | Win: ${r.winRate.toFixed(1)}% | DD: ${r.maxDrawdown.toFixed(1)}% | Trades: ${r.trades}`)
    console.log(`   WASP: ${r.config.waspPeriod}, Dev: ${r.config.entryDeviation}, Target: ${r.config.targetPercent}%, Stop: ${r.config.stopPercent}%`)
    console.log(`   Leverage: ${r.config.leverage}x, Position: ${r.config.positionPercent}%, WeekFilter: ${r.config.useWeekFilter}`)
    console.log(`   Sharpe: ${r.sharpe.toFixed(2)}, PF: ${r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}, Exp: ${r.expectancy.toFixed(2)}%`)
    console.log('')
  })

  // Best balanced config (high return, manageable DD)
  const balanced = results
    .filter(r => r.totalReturn >= 200 && !r.bankrupted && r.maxDrawdown > -50)
    .sort((a, b) => (b.totalReturn / Math.abs(b.maxDrawdown)) - (a.totalReturn / Math.abs(a.maxDrawdown)))
    [0]

  if (balanced) {
    console.log('=== RECOMMENDED BALANCED CONFIG ===')
    console.log(`Return: ${balanced.totalReturn.toFixed(1)}% | DD: ${balanced.maxDrawdown.toFixed(1)}% | Win: ${balanced.winRate.toFixed(1)}%`)
    console.log(`\nConfig for backtest UI:`)
    console.log(JSON.stringify({
      source: 'oi',
      timeframe: balanced.config.timeframe,
      waspPeriod: balanced.config.waspPeriod,
      entryDeviation: balanced.config.entryDeviation,
      exitStrategy: 'target-stop',
      targetPercent: balanced.config.targetPercent,
      stopPercent: balanced.config.stopPercent,
      leverageMultiplier: balanced.config.leverage,
      positionPercent: balanced.config.positionPercent,
      useFilters: balanced.config.useFilters,
      useWeekFilter: balanced.config.useWeekFilter,
    }, null, 2))
  }
}

main().catch(console.error)
