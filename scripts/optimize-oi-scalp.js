#!/usr/bin/env node
/**
 * OI-Scalp Optimization Script
 *
 * Runs parameter sweeps to find optimal OI-WASP settings for 200%+ monthly returns
 * Based on original NVDA strategy from nvida-option_stragety/ screenshots
 *
 * Usage:
 *   node scripts/optimize-oi-scalp.js [--quick|--thorough]
 *
 * Options:
 *   --quick     Fast sweep with fewer parameter combinations (default)
 *   --thorough  Full parameter sweep (takes longer)
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import { BacktestEngine, OISignalSource, TargetStopExit, ButterflyExit, calculateStatistics } from '../src/core/backtest/index.js'

const PRESETS = {
  // Butterfly 8x - matches original NVDA strategy
  'butterfly-8x': {
    name: 'Butterfly 8x (Original)',
    timeframe: 5,
    source: {
      waspPeriod: 10,
      entryDeviation: 0.15,
      strongDeviation: 0.3,
      useFilters: false,
      useWeekFilter: false,
      cooldownBars: 1,
    },
    exit: {
      type: 'butterfly',
      profitZoneWidth: 0.3,
      holdPeriodBars: 60,
    },
    leverage: 8,
    minStrength: 20,
    positionPercent: 20,
  },

  // Target-Stop 8x - simpler exit
  'target-stop-8x': {
    name: 'Target-Stop 8x',
    timeframe: 5,
    source: {
      waspPeriod: 8,
      entryDeviation: 0.1,
      strongDeviation: 0.2,
      useFilters: false,
      useWeekFilter: false,
      cooldownBars: 1,
    },
    exit: {
      type: 'target-stop',
      targetPercent: 0.3,
      stopPercent: 0.15,
    },
    leverage: 8,
    minStrength: 15,
    positionPercent: 25,
  },

  // High frequency 8x - more trades
  'high-freq-8x': {
    name: 'High Freq 8x',
    timeframe: 5,
    source: {
      waspPeriod: 5,
      entryDeviation: 0.08,
      strongDeviation: 0.16,
      useFilters: false,
      useWeekFilter: false,
      cooldownBars: 1,
    },
    exit: {
      type: 'target-stop',
      targetPercent: 0.2,
      stopPercent: 0.1,
    },
    leverage: 8,
    minStrength: 10,
    positionPercent: 30,
  },

  // Conservative 5x - lower risk
  'conservative-5x': {
    name: 'Conservative 5x',
    timeframe: 15,
    source: {
      waspPeriod: 15,
      entryDeviation: 0.2,
      strongDeviation: 0.4,
      useFilters: true,
      useWeekFilter: false,
      cooldownBars: 2,
    },
    exit: {
      type: 'target-stop',
      targetPercent: 0.4,
      stopPercent: 0.2,
    },
    leverage: 5,
    minStrength: 30,
    positionPercent: 15,
  },

  // Week 3-4 Focus 8x - original strategy timing
  'week34-8x': {
    name: 'Week 3-4 Focus 8x',
    timeframe: 5,
    source: {
      waspPeriod: 10,
      entryDeviation: 0.15,
      strongDeviation: 0.3,
      useFilters: false,
      useWeekFilter: true,  // Only week 3-4
      cooldownBars: 1,
    },
    exit: {
      type: 'butterfly',
      profitZoneWidth: 0.4,
      holdPeriodBars: 78,
    },
    leverage: 8,
    minStrength: 25,
    positionPercent: 25,
  },
}

// Parameter ranges for sweep
const PARAM_RANGES = {
  waspPeriod: [10, 15, 20],
  entryDeviation: [0.15, 0.2, 0.3, 0.5],
  targetPercent: [0.2, 0.3, 0.5],
  stopPercent: [0.3, 0.5, 0.8],
  leverage: [3, 5, 8, 10],
}

async function runBacktest(preset, candles, verbose = false) {
  const source = new OISignalSource({
    timeframe: preset.timeframe,
    ...preset.source,
    minStrength: preset.minStrength,
    signalTypes: ['CALL', 'PUT'],
  })

  let exit
  if (preset.exit.type === 'butterfly') {
    exit = new ButterflyExit({
      timeframe: preset.timeframe,
      profitZoneWidth: preset.exit.profitZoneWidth,
      holdPeriodBars: preset.exit.holdPeriodBars,
    })
  } else {
    exit = new TargetStopExit(preset.exit.targetPercent, preset.exit.stopPercent)
  }

  const engine = new BacktestEngine({
    signalSource: source,
    exitStrategy: exit,
    candles,
    initialCapital: 10000,
    positionSize: 'percent',
    positionPercent: preset.positionPercent ?? 10,
    maxConcurrentTrades: 1,
  })

  const results = await engine.run()

  // Apply leverage
  const leveragedTrades = results.trades.map(t => ({
    ...t,
    pnlPercent: t.pnlPercent * preset.leverage,
    pnl: t.pnl * preset.leverage,
  }))

  const stats = calculateStatistics(leveragedTrades, 10000)

  if (verbose) {
    console.log(`\n${preset.name}:`)
    console.log(`  Trades: ${stats.totalTrades}`)
    console.log(`  Win Rate: ${stats.winRate.toFixed(1)}%`)
    console.log(`  Total Return: ${stats.totalReturn.toFixed(1)}%`)
    console.log(`  Max DD: ${stats.maxDrawdown.toFixed(1)}%`)
    console.log(`  Sharpe: ${stats.sharpeRatio.toFixed(2)}`)
    console.log(`  Expectancy: ${stats.expectancy.toFixed(2)}%`)
  }

  return {
    preset: preset.name,
    trades: stats.totalTrades,
    winRate: stats.winRate,
    totalReturn: stats.totalReturn,
    maxDrawdown: stats.maxDrawdown,
    sharpe: stats.sharpeRatio,
    expectancy: stats.expectancy,
  }
}

async function runPresets() {
  console.log('Fetching SPY data...')

  // Fetch 3 months of 5m data
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles.length} candles`)

  console.log('\n=== Running Preset Backtests ===')

  const results = []
  for (const [key, preset] of Object.entries(PRESETS)) {
    try {
      const result = await runBacktest(preset, candles, true)
      results.push(result)
    } catch (error) {
      console.log(`  Error: ${error.message}`)
    }
  }

  console.log('\n=== Summary ===')
  console.log('Preset                       | Trades | Win% | Return | MaxDD | Sharpe')
  console.log('-'.repeat(75))
  for (const r of results) {
    const name = r.preset.padEnd(28)
    const trades = String(r.trades).padStart(6)
    const winRate = `${r.winRate.toFixed(0)}%`.padStart(5)
    const ret = `${r.totalReturn.toFixed(0)}%`.padStart(7)
    const dd = `${r.maxDrawdown.toFixed(0)}%`.padStart(6)
    const sharpe = r.sharpe.toFixed(2).padStart(6)
    console.log(`${name} | ${trades} | ${winRate} | ${ret} | ${dd} | ${sharpe}`)
  }
}

async function runParameterSweep(quick = true) {
  console.log(`Running ${quick ? 'quick' : 'thorough'} parameter sweep...`)

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - (quick ? 30 : 90))

  const candles = await fetchCandleData('SPY', 15, { startDate, endDate })
  console.log(`Loaded ${candles.length} candles`)

  const results = []
  const params = quick
    ? { waspPeriod: [15], entryDeviation: [0.2, 0.3], targetPercent: [0.3], stopPercent: [0.5], leverage: [5, 8] }
    : PARAM_RANGES

  let total = Object.values(params).reduce((a, b) => a * b.length, 1)
  let count = 0

  for (const waspPeriod of params.waspPeriod) {
    for (const entryDeviation of params.entryDeviation) {
      for (const targetPercent of params.targetPercent) {
        for (const stopPercent of params.stopPercent) {
          for (const leverage of params.leverage) {
            count++
            process.stdout.write(`\rTesting ${count}/${total}...`)

            const preset = {
              name: `w${waspPeriod}_d${entryDeviation}_t${targetPercent}_s${stopPercent}_l${leverage}`,
              timeframe: 15,
              source: {
                waspPeriod,
                entryDeviation,
                useFilters: false,
                useWeekFilter: false,
              },
              exit: {
                type: 'target-stop',
                targetPercent,
                stopPercent,
              },
              leverage,
              minStrength: 30,
            }

            try {
              const result = await runBacktest(preset, candles, false)
              results.push(result)
            } catch (e) {
              // Skip failed configs
            }
          }
        }
      }
    }
  }

  console.log('\n\n=== Top 10 Configurations ===')
  results
    .filter(r => r.trades >= 5)
    .sort((a, b) => b.totalReturn - a.totalReturn)
    .slice(0, 10)
    .forEach((r, i) => {
      console.log(`${i+1}. ${r.preset}`)
      console.log(`   Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
    })
}

// Main
const args = process.argv.slice(2)
const mode = args.includes('--thorough') ? 'thorough'
           : args.includes('--sweep') ? 'sweep'
           : 'presets'

if (mode === 'sweep' || mode === 'thorough') {
  runParameterSweep(mode !== 'thorough').catch(console.error)
} else {
  runPresets().catch(console.error)
}
