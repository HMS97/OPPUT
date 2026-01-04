#!/usr/bin/env node
/**
 * OI-Scalp Optimizer V3 - Using Option P&L (no double leverage)
 *
 * Now that TargetStopExit uses OPTION P&L (not underlying), we:
 * 1. Don't apply additional leverage (options already have 5-15x built-in)
 * 2. Use option-level targets (20-50% profit, 20-50% stop)
 * 3. Focus on win rate + expectancy
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Parameter grid for option-level trading
const PARAM_GRID = {
  waspPeriod: [5, 8, 10, 15, 20],
  entryDeviation: [0.1, 0.15, 0.2, 0.25, 0.3],
  // OPTION-level targets (not underlying!)
  targetPercent: [15, 20, 25, 30, 40, 50],
  stopPercent: [20, 30, 40, 50, 60],
  // Position sizing only (no leverage multiplier)
  positionPercent: [10, 20, 30, 40, 50],
}

const originalLog = console.log
function suppressLogs() { console.log = () => {} }
function restoreLogs() { console.log = originalLog }

async function runBacktest(config, candles) {
  suppressLogs()

  try {
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

    // Use option-level targets (useOptionPnL = true by default now)
    const exit = new TargetStopExit(config.targetPercent, config.stopPercent, 50, true)

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

    const results = await engine.run()

    // NO additional leverage - options already have built-in leverage
    const trades = results.trades

    // Calculate equity curve with compounding
    const equityCurve = calculateEquityCurve(trades, 10000, 100)
    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
    const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve.map(e => e.equity)) : 10000
    const totalReturn = ((finalEquity - 10000) / 10000) * 100

    const stats = calculateStatistics(trades, 10000)

    restoreLogs()

    return {
      config,
      trades: trades.length,
      totalReturn,
      winRate: stats.winRate,
      maxDrawdown: stats.maxDrawdown,
      sharpe: stats.sharpeRatio,
      expectancy: stats.expectancy,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
      finalEquity,
      minEquity,
      bankrupted: minEquity <= 0,
      profitFactor: stats.profitFactor,
    }
  } catch (e) {
    restoreLogs()
    return null
  }
}

function generateConfigs() {
  const configs = []

  for (const waspPeriod of PARAM_GRID.waspPeriod) {
    for (const entryDeviation of PARAM_GRID.entryDeviation) {
      for (const targetPercent of PARAM_GRID.targetPercent) {
        for (const stopPercent of PARAM_GRID.stopPercent) {
          for (const positionPercent of PARAM_GRID.positionPercent) {
            configs.push({
              waspPeriod,
              entryDeviation,
              targetPercent,
              stopPercent,
              positionPercent,
            })
          }
        }
      }
    }
  }

  return configs
}

async function main() {
  originalLog('=== OI-Scalp Optimizer V3 (Option P&L) ===\n')

  originalLog('Fetching SPY 5m data (3 months)...')
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  suppressLogs()
  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  restoreLogs()

  originalLog(`Loaded ${candles.length} candles\n`)

  const allConfigs = generateConfigs()
  originalLog(`Testing ${allConfigs.length} combinations...\n`)

  const results = []
  let tested = 0

  for (const config of allConfigs) {
    tested++
    if (tested % 500 === 0) {
      process.stdout.write(`\rProgress: ${tested}/${allConfigs.length}`)
    }

    const result = await runBacktest(config, candles)
    if (result && !result.bankrupted && result.trades >= 15) {
      results.push(result)
    }
  }

  originalLog(`\n\nValid results: ${results.length}\n`)

  // Sort by total return
  const sorted = results.sort((a, b) => b.totalReturn - a.totalReturn)

  // Filter for 200%+
  const hits200 = sorted.filter(r => r.totalReturn >= 200 && r.minEquity > 100)

  if (hits200.length > 0) {
    originalLog(`\n=== TOP 10 CONFIGS (200%+ returns) ===\n`)
    hits200.slice(0, 10).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Pos=${r.config.positionPercent}%`)
      originalLog(`   Expectancy: ${r.expectancy.toFixed(1)}% | AvgWin: ${r.avgWin.toFixed(0)}% | AvgLoss: ${r.avgLoss.toFixed(0)}%`)
      originalLog('')
    })
  } else {
    originalLog(`\nNo configs hit 200%. Top 20 by return:\n`)
    sorted.slice(0, 20).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades} | Exp: ${r.expectancy.toFixed(1)}%`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Pos=${r.config.positionPercent}%`)
    })

    // Also show configs with best expectancy
    originalLog(`\n=== TOP 10 by EXPECTANCY ===\n`)
    const byExpectancy = [...results].sort((a, b) => b.expectancy - a.expectancy)
    byExpectancy.slice(0, 10).forEach((r, i) => {
      originalLog(`${i + 1}. Exp: ${r.expectancy.toFixed(1)}% | Win: ${r.winRate.toFixed(0)}% | Return: ${r.totalReturn.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Pos=${r.config.positionPercent}%`)
    })
  }
}

main().catch(e => { restoreLogs(); console.error(e) })
