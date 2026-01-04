#!/usr/bin/env node
/**
 * OI-Scalp Optimizer V2 - Cleaner, faster, focused on 200%+ returns
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Focused parameter grid - skip known bad combinations
const PARAM_GRID = {
  waspPeriod: [5, 8, 10, 15, 20],
  entryDeviation: [0.1, 0.15, 0.2, 0.25, 0.3],
  targetPercent: [0.15, 0.2, 0.25, 0.3, 0.4],
  stopPercent: [0.1, 0.15, 0.2, 0.25],
  leverage: [3, 5, 8, 10],
  positionPercent: [5, 10, 15, 20],
}

// Suppress console.log during backtests
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
      timeframe: 5,
    })

    const results = await engine.run()

    // Apply leverage
    const leveragedTrades = results.trades.map(t => ({
      ...t,
      pnlPercent: t.pnlPercent * config.leverage,
      pnl: t.pnl * config.leverage,
    }))

    // Calculate equity curve
    const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 100)
    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
    const minEquity = Math.min(...equityCurve.map(e => e.equity))
    const totalReturn = ((finalEquity - 10000) / 10000) * 100

    // Stats
    const stats = calculateStatistics(leveragedTrades, 10000)

    restoreLogs()

    return {
      config,
      trades: leveragedTrades.length,
      totalReturn,
      winRate: stats.winRate,
      maxDrawdown: stats.maxDrawdown,
      sharpe: stats.sharpeRatio,
      expectancy: stats.expectancy,
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
          // Skip bad R:R (target should be >= stop for scalping)
          if (targetPercent < stopPercent) continue

          for (const leverage of PARAM_GRID.leverage) {
            for (const positionPercent of PARAM_GRID.positionPercent) {
              // Skip ultra-risky combos
              if (leverage * positionPercent > 100) continue

              configs.push({
                waspPeriod,
                entryDeviation,
                targetPercent,
                stopPercent,
                leverage,
                positionPercent,
              })
            }
          }
        }
      }
    }
  }

  return configs
}

async function main() {
  originalLog('=== OI-Scalp Optimizer V2 ===\n')

  originalLog('Fetching SPY 5m data...')
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
    if (tested % 200 === 0) {
      process.stdout.write(`\rProgress: ${tested}/${allConfigs.length}`)
    }

    const result = await runBacktest(config, candles)
    if (result && !result.bankrupted && result.trades >= 20) {
      results.push(result)
    }
  }

  originalLog(`\n\nValid results: ${results.length}\n`)

  // Sort by return
  const sorted = results.sort((a, b) => b.totalReturn - a.totalReturn)

  // Filter for 200%+
  const hits200 = sorted.filter(r => r.totalReturn >= 200 && r.maxDrawdown > -70)

  if (hits200.length > 0) {
    originalLog(`\n=== TOP 10 CONFIGS (200%+ returns) ===\n`)
    hits200.slice(0, 10).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
      originalLog('')
    })

    // Best balanced (highest return/DD ratio)
    const balanced = hits200
      .sort((a, b) => (b.totalReturn / Math.abs(b.maxDrawdown || 1)) - (a.totalReturn / Math.abs(a.maxDrawdown || 1)))
      [0]

    if (balanced) {
      originalLog(`\n=== RECOMMENDED CONFIG ===`)
      originalLog(`Return: ${balanced.totalReturn.toFixed(0)}% | DD: ${balanced.maxDrawdown.toFixed(0)}%`)
      originalLog(`WASP: ${balanced.config.waspPeriod}`)
      originalLog(`Entry Deviation: ${balanced.config.entryDeviation}%`)
      originalLog(`Target: ${balanced.config.targetPercent}%`)
      originalLog(`Stop: ${balanced.config.stopPercent}%`)
      originalLog(`Leverage: ${balanced.config.leverage}x`)
      originalLog(`Position: ${balanced.config.positionPercent}%`)
    }
  } else {
    originalLog(`\nNo configs hit 200%. Top 10:\n`)
    sorted.slice(0, 10).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
    })
  }
}

main().catch(e => { restoreLogs(); console.error(e) })
