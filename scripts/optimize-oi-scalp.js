#!/usr/bin/env node
/**
 * OI-Scalp Parameter Optimizer
 * Uses Twelve Data (same as UI) to find optimal backtest config
 *
 * REQUIRES: Backend server running (`npm start`)
 */

import { fetchTwelveDataCandles } from '../src/core/data/twelvedata.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Parameter grid to test
const PARAM_GRID = {
  waspPeriod: [8, 12, 15, 20],
  entryDeviation: [0.05, 0.08, 0.10, 0.15, 0.20],
  targetPercent: [0.25, 0.5, 0.75, 1.0],
  stopPercent: [0.15, 0.25, 0.35, 0.5],
  leverage: [10, 20, 35],
}

// Fixed params
const FIXED = {
  timeframe: 5,
  positionPercent: 10,
  minStrength: 10,
  useFilters: false,
  useWeekFilter: false,
  cooldownBars: 1,
}

const log = console.log
let suppressOutput = false
const originalLog = console.log
function suppress() { console.log = () => {} }
function restore() { console.log = originalLog }

async function runBacktest(candles, config, debug = false) {
  if (!debug) suppress()

  try {
    const sourceConfig = {
      timeframe: FIXED.timeframe,
      waspPeriod: config.waspPeriod,
      entryDeviation: config.entryDeviation,
      strongDeviation: config.entryDeviation * 2,
      useFilters: FIXED.useFilters,
      useWeekFilter: FIXED.useWeekFilter,
      minStrength: FIXED.minStrength,
      signalTypes: ['CALL', 'PUT'],
      cooldownBars: FIXED.cooldownBars,
    }

    if (debug) {
      console.log('[DEBUG] OISignalSource config:', JSON.stringify(sourceConfig, null, 2))
    }

    const source = new OISignalSource(sourceConfig)

    const exit = new TargetStopExit(config.targetPercent, config.stopPercent, 50, false)

    const engine = new BacktestEngine({
      signalSource: source,
      exitStrategy: exit,
      candles,
      initialCapital: 10000,
      positionSize: 'percent',
      positionPercent: FIXED.positionPercent,
      maxConcurrentTrades: 1,
      timeframe: FIXED.timeframe,
    })

    const results = await engine.run()

    // Apply leverage (same as UI)
    const leveragedTrades = results.trades.map(t => {
      const direction = t.signal === 'CALL' ? 1 : -1
      const underlyingPnL = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * direction
      return {
        ...t,
        pnlPercent: underlyingPnL * config.leverage,
        pnl: (underlyingPnL * config.leverage / 100) * 10000 * (FIXED.positionPercent / 100),
      }
    })

    const stats = calculateStatistics(leveragedTrades, 10000)
    const equityCurve = calculateEquityCurve(leveragedTrades, 10000, 100, false)
    const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : 10000
    const totalReturn = ((finalEquity - 10000) / 10000) * 100

    restore()

    return {
      trades: leveragedTrades.length,
      totalReturn,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      maxDrawdown: stats.maxDrawdown,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
      sharpe: stats.sharpeRatio || 0,
    }
  } catch (e) {
    restore()
    return { error: e.message }
  }
}

async function main() {
  log('═'.repeat(70))
  log(' OI-SCALP PARAMETER OPTIMIZATION')
  log('═'.repeat(70))
  log('')
  log('Fetching 6 months of 5m data from Twelve Data...')

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 180)

  suppress()
  let candles
  try {
    candles = await fetchTwelveDataCandles('SPY', 5, { startDate, endDate })
  } catch (e) {
    restore()
    log(`ERROR: ${e.message}`)
    log('Make sure backend is running: npm start')
    process.exit(1)
  }
  restore()

  if (!candles || candles.length < 100) {
    log(`ERROR: Insufficient data (${candles?.length || 0} candles)`)
    process.exit(1)
  }

  log(`Loaded ${candles.length} candles`)
  log(`Date range: ${new Date(candles[0].time).toISOString().split('T')[0]} to ${new Date(candles[candles.length-1].time).toISOString().split('T')[0]}`)
  log('')

  // Generate all combinations
  const combinations = []
  for (const wasp of PARAM_GRID.waspPeriod) {
    for (const dev of PARAM_GRID.entryDeviation) {
      for (const target of PARAM_GRID.targetPercent) {
        for (const stop of PARAM_GRID.stopPercent) {
          // Skip invalid R:R ratios (target should be >= stop for positive expectancy)
          if (target < stop) continue
          for (const lev of PARAM_GRID.leverage) {
            combinations.push({
              waspPeriod: wasp,
              entryDeviation: dev,
              targetPercent: target,
              stopPercent: stop,
              leverage: lev,
            })
          }
        }
      }
    }
  }

  log(`Testing ${combinations.length} parameter combinations...`)
  log('')

  const results = []
  let progress = 0

  for (const config of combinations) {
    progress++
    if (progress % 50 === 0 || progress === combinations.length) {
      process.stdout.write(`\rProgress: ${progress}/${combinations.length} (${Math.round(progress/combinations.length*100)}%)`)
    }

    const result = await runBacktest(candles, config)

    if (!result.error && result.trades >= 30) {  // Minimum 30 trades for significance
      results.push({ config, ...result })
    }
  }

  log('\n')

  if (results.length === 0) {
    log('No valid results found. Try adjusting parameters.')
    process.exit(1)
  }

  // Sort by different metrics
  const byReturn = [...results].sort((a, b) => b.totalReturn - a.totalReturn)
  const byPF = [...results].sort((a, b) => b.profitFactor - a.profitFactor)
  const byWinRate = [...results].sort((a, b) => b.winRate - a.winRate)
  const bySharpe = [...results].sort((a, b) => b.sharpe - a.sharpe)

  // Composite score (balanced)
  const scored = results.map(r => ({
    ...r,
    score: (r.profitFactor * 20) + (r.winRate * 0.5) + (r.totalReturn > 0 ? Math.min(r.totalReturn, 500) * 0.1 : r.totalReturn * 0.2) - (Math.abs(r.maxDrawdown) * 2)
  })).sort((a, b) => b.score - a.score)

  log('═'.repeat(70))
  log(' TOP 10 BY TOTAL RETURN')
  log('═'.repeat(70))
  printResults(byReturn.slice(0, 10))

  log('')
  log('═'.repeat(70))
  log(' TOP 10 BY PROFIT FACTOR')
  log('═'.repeat(70))
  printResults(byPF.slice(0, 10))

  log('')
  log('═'.repeat(70))
  log(' TOP 10 BY WIN RATE')
  log('═'.repeat(70))
  printResults(byWinRate.slice(0, 10))

  log('')
  log('═'.repeat(70))
  log(' TOP 10 BALANCED (COMPOSITE SCORE)')
  log('═'.repeat(70))
  printResults(scored.slice(0, 10))

  log('')
  log('═'.repeat(70))
  log(' RECOMMENDED CONFIG')
  log('═'.repeat(70))
  const best = scored[0]
  log('')
  log(`  WASP Period:     ${best.config.waspPeriod}`)
  log(`  Entry Deviation: ${best.config.entryDeviation}%`)
  log(`  Target:          ${best.config.targetPercent}%`)
  log(`  Stop:            ${best.config.stopPercent}%`)
  log(`  Leverage:        ${best.config.leverage}x`)
  log('')
  log(`  Results (6 months):`)
  log(`    Total Return:  ${best.totalReturn.toFixed(1)}%`)
  log(`    Win Rate:      ${best.winRate.toFixed(1)}%`)
  log(`    Profit Factor: ${best.profitFactor.toFixed(2)}`)
  log(`    Max Drawdown:  ${best.maxDrawdown.toFixed(1)}%`)
  log(`    Trades:        ${best.trades}`)
  log('')

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    dataRange: {
      start: new Date(candles[0].time).toISOString(),
      end: new Date(candles[candles.length-1].time).toISOString(),
      candles: candles.length,
    },
    testedCombinations: combinations.length,
    validResults: results.length,
    recommended: best,
    topByReturn: byReturn.slice(0, 5),
    topByPF: byPF.slice(0, 5),
    topByWinRate: byWinRate.slice(0, 5),
    topBalanced: scored.slice(0, 5),
  }

  const fs = await import('fs')
  fs.writeFileSync('scripts/oi-scalp-optimal.json', JSON.stringify(output, null, 2))
  log('Results saved to scripts/oi-scalp-optimal.json')
}

function printResults(results) {
  log('')
  log('  WASP  Dev%   Tgt%  Stop%  Lev   Return%   WR%    PF    DD%   Trades')
  log('  ────  ────   ────  ─────  ───   ───────   ────   ────  ────  ──────')
  for (const r of results) {
    const c = r.config
    log(`  ${String(c.waspPeriod).padStart(4)}  ${c.entryDeviation.toFixed(2).padStart(4)}   ${c.targetPercent.toFixed(2).padStart(4)}  ${c.stopPercent.toFixed(2).padStart(5)}  ${String(c.leverage).padStart(3)}x  ${r.totalReturn.toFixed(1).padStart(7)}%  ${r.winRate.toFixed(1).padStart(4)}%  ${r.profitFactor.toFixed(2).padStart(4)}  ${r.maxDrawdown.toFixed(1).padStart(4)}%  ${String(r.trades).padStart(6)}`)
  }
}

main().catch(e => {
  restore()
  console.error('Fatal error:', e)
  process.exit(1)
})
