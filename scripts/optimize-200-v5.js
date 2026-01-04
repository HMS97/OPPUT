#!/usr/bin/env node
/**
 * OI-Scalp Optimizer V5 - Fine-tuning for 200%+
 * Building on V4 results, expanding leverage range
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import {
  BacktestEngine,
  OISignalSource,
  TargetStopExit,
  calculateStatistics,
  calculateEquityCurve
} from '../src/core/backtest/index.js'

// Fine-tuned parameter grid based on V4 results
const PARAM_GRID = {
  waspPeriod: [5, 6, 7, 8, 10, 12, 15],
  entryDeviation: [0.06, 0.08, 0.1, 0.12],
  targetPercent: [0.15, 0.2, 0.25, 0.3, 0.35],
  stopPercent: [0.1, 0.12, 0.15, 0.2],
  leverage: [12, 15, 18, 20, 25],
  positionPercent: [5, 8, 10],
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
      cooldownBars: 1,
    })

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

    const leveragedTrades = results.trades.map(t => {
      const direction = t.signal === 'CALL' ? 1 : -1
      const underlyingPnL = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * direction
      return {
        ...t,
        pnlPercent: underlyingPnL * config.leverage,
        pnl: (underlyingPnL * config.leverage / 100) * 10000 * (config.positionPercent / 100),
      }
    })

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
      expectancy: stats.expectancy,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
      finalEquity,
      minEquity,
      bankrupted: minEquity <= 0,
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
          if (targetPercent < stopPercent * 0.8) continue

          for (const leverage of PARAM_GRID.leverage) {
            for (const positionPercent of PARAM_GRID.positionPercent) {
              if (leverage * positionPercent > 200) continue

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
  originalLog('=== OI-Scalp Optimizer V5 (Fine-tuning) ===\n')

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
    if (result && !result.bankrupted && result.trades >= 20 && result.minEquity > 100) {
      results.push(result)
    }
  }

  originalLog(`\n\nValid results: ${results.length}\n`)

  const sorted = results.sort((a, b) => b.totalReturn - a.totalReturn)
  const hits200 = sorted.filter(r => r.totalReturn >= 200 && r.maxDrawdown > -40)

  if (hits200.length > 0) {
    originalLog(`\n=== CONFIGS WITH 200%+ RETURNS ===\n`)
    hits200.slice(0, 15).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
      originalLog('')
    })

    // Best balanced
    const best = hits200[0]
    originalLog(`\n=== BEST CONFIG FOR PRESET ===`)
    originalLog(JSON.stringify({
      waspPeriod: best.config.waspPeriod,
      entryDeviation: best.config.entryDeviation,
      targetPercent: best.config.targetPercent,
      stopPercent: best.config.stopPercent,
      leverage: best.config.leverage,
      positionPercent: best.config.positionPercent,
      expectedReturn: best.totalReturn.toFixed(0) + '%',
      expectedWinRate: best.winRate.toFixed(0) + '%',
      expectedDrawdown: best.maxDrawdown.toFixed(0) + '%',
    }, null, 2))
  } else {
    originalLog(`\nNo 200%+ with <40% DD. Top 10:\n`)
    sorted.slice(0, 10).forEach((r, i) => {
      originalLog(`${i + 1}. Return: ${r.totalReturn.toFixed(0)}% | Win: ${r.winRate.toFixed(0)}% | DD: ${r.maxDrawdown.toFixed(0)}% | Trades: ${r.trades}`)
      originalLog(`   WASP=${r.config.waspPeriod} Dev=${r.config.entryDeviation} T/S=${r.config.targetPercent}/${r.config.stopPercent} Lev=${r.config.leverage}x Pos=${r.config.positionPercent}%`)
    })
  }
}

main().catch(e => { restoreLogs(); console.error(e) })
