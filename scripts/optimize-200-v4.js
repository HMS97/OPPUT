#!/usr/bin/env node
/**
 * OI-Scalp Optimizer V4 - Underlying-based with manual leverage
 *
 * The Black-Scholes option pricing has too much theta decay for scalping.
 * This version uses underlying price moves with manual leverage multiplier,
 * similar to how the original NVDA strategy worked.
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Parameter grid - underlying-level targets with leverage
const PARAM_GRID = {
  waspPeriod: [5, 8, 10, 15],
  entryDeviation: [0.08, 0.1, 0.15, 0.2],
  // UNDERLYING-level targets (small moves)
  targetPercent: [0.15, 0.2, 0.25, 0.3, 0.4],
  stopPercent: [0.1, 0.15, 0.2, 0.3],
  // Manual leverage (simulates options behavior)
  leverage: [5, 8, 10, 15],
  positionPercent: [5, 10, 15, 20],
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
      cooldownBars: 1,  // Fast cooldown for scalping
    })

    // Use UNDERLYING price targets (useOptionPnL = false)
    const exit = new TargetStopExit(config.targetPercent, config.stopPercent, 30, false)

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

    // Apply leverage to underlying moves
    const leveragedTrades = results.trades.map(t => {
      // For underlying-based exit, recalculate P&L from price movement
      const direction = t.signal === 'CALL' ? 1 : -1
      const underlyingPnL = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * direction
      return {
        ...t,
        pnlPercent: underlyingPnL * config.leverage,
        pnl: (underlyingPnL * config.leverage / 100) * 10000 * (config.positionPercent / 100),
      }
    })

    // Calculate equity curve
    const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 100)
    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
    const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve.map(e => e.equity)) : 10000
    const totalReturn = ((finalEquity - 10000) / 10000) * 100

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
          // Good R:R: target >= stop
          if (targetPercent < stopPercent * 0.8) continue

          for (const leverage of PARAM_GRID.leverage) {
            for (const positionPercent of PARAM_GRID.positionPercent) {
              // Risk limit: leverage * position <= 150%
              if (leverage * positionPercent > 150) continue

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
  originalLog('=== OI-Scalp Optimizer V4 (Underlying + Leverage) ===\n')

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
    if (tested % 200 === 0) {
      process.stdout.write(`\rProgress: ${tested}/${allConfigs.length}`)
    }

    const result = await runBacktest(config, candles)
    if (result && !result.bankrupted && result.trades >= 20 && result.minEquity > 100) {
      results.push(result)
    }
  }

  originalLog(`\n\nValid results: ${results.length}\n`)

  // Sort by total return
  const sorted = results.sort((a, b) => b.totalReturn - a.totalReturn)

  // Filter for 200%+
  const hits200 = sorted.filter(r => r.totalReturn >= 200)

  if (hits200.length > 0) {
    originalLog(`\n=== TOP 15 CONFIGS (200%+ returns) ===\n`)
    hits200.slice(0, 15).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
      originalLog(`   Exp: ${r.expectancy.toFixed(1)}% | AvgWin: ${r.avgWin.toFixed(1)}% | AvgLoss: ${r.avgLoss.toFixed(1)}% | MinEq: $${r.minEquity.toFixed(0)}`)
      originalLog('')
    })

    // Best balanced (return / DD ratio)
    const balanced = hits200
      .filter(r => r.maxDrawdown > -60)  // Max 60% drawdown
      .sort((a, b) => (b.totalReturn / Math.abs(b.maxDrawdown || 1)) - (a.totalReturn / Math.abs(a.maxDrawdown || 1)))
      [0]

    if (balanced) {
      originalLog(`\n=== RECOMMENDED BALANCED CONFIG ===`)
      originalLog(`Return: ${balanced.totalReturn.toFixed(0)}% | DD: ${balanced.maxDrawdown.toFixed(0)}% | Win: ${balanced.winRate.toFixed(0)}%`)
      originalLog(`\nFor apply200PercentPreset():`)
      originalLog(`  waspPeriod: ${balanced.config.waspPeriod}`)
      originalLog(`  entryDeviation: ${balanced.config.entryDeviation}`)
      originalLog(`  targetPercent: ${balanced.config.targetPercent}`)
      originalLog(`  stopPercent: ${balanced.config.stopPercent}`)
      originalLog(`  leverage: ${balanced.config.leverage}`)
      originalLog(`  positionPercent: ${balanced.config.positionPercent}`)
    }
  } else {
    originalLog(`\nNo configs hit 200%. Top 20 by return:\n`)
    sorted.slice(0, 20).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
    })
  }
}

main().catch(e => { restoreLogs(); console.error(e) })
