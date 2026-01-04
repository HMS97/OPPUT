#!/usr/bin/env node
/**
 * Strategy Optimization Experiments
 *
 * Tests all signal sources across different time periods and parameters
 * to find optimal configurations for each strategy.
 *
 * Usage:
 *   node scripts/optimize-strategies.js [--strategy <name>] [--period <days>]
 *
 * Examples:
 *   node scripts/optimize-strategies.js                    # Run all experiments
 *   node scripts/optimize-strategies.js --strategy oi-scalp
 *   node scripts/optimize-strategies.js --period 30
 */

const BACKEND_URL = 'http://localhost:3001'

// ============ Configuration ============

const STRATEGIES = {
  'oi-scalp': {
    name: 'OI-Scalp (Mean Reversion)',
    params: {
      waspPeriod: [5, 8, 10, 12],
      entryDeviation: [0.0005, 0.001, 0.0015, 0.002], // 0.05% to 0.2%
      targetPct: [0.001, 0.0015, 0.002, 0.0025],       // 0.1% to 0.25%
      stopPct: [0.001, 0.0015, 0.002],                 // 0.1% to 0.2%
    },
    timeframes: [5, 15],
  },
  'oi-trend': {
    name: 'OI-Trend (Trend Following)',
    params: {
      waspPeriod: [10, 15, 20],
      trendThreshold: [0.001, 0.002, 0.003],
      targetPct: [0.003, 0.005, 0.008],
      stopPct: [0.002, 0.003, 0.004],
    },
    timeframes: [15, 60],
  },
  'oi-hybrid': {
    name: 'OI-Hybrid (Adaptive)',
    params: {
      waspPeriod: [8, 10, 12],
      entryDeviation: [0.001, 0.0015, 0.002],
      adxPeriod: [14, 20],
      adxThreshold: [20, 25, 30],
    },
    timeframes: [5, 15],
  },
  'pattern': {
    name: 'Pattern Detector',
    params: {
      lookbackPeriod: [14, 20, 26],
      minStrength: [30, 40, 50],
      targetPct: [0.005, 0.008, 0.01],
      stopPct: [0.003, 0.005],
    },
    timeframes: [15, 60],
  },
}

const TIME_PERIODS = [
  { name: '1 Month', days: 30 },
  { name: '2 Months', days: 60 },
  { name: '3 Months', days: 90 },
  { name: '6 Months', days: 180 },
]

// ============ Data Fetching ============

function isRegularTradingHours(timestamp) {
  const date = new Date(timestamp)
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  })
  const parts = etFormatter.formatToParts(date)
  const hour = parseInt(parts.find(p => p.type === 'hour').value)
  const minute = parseInt(parts.find(p => p.type === 'minute').value)
  const totalMinutes = hour * 60 + minute
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60
}

async function fetchCandles(symbol, timeframe, startDate, endDate) {
  const startStr = startDate.toISOString().split('T')[0]
  const endStr = endDate.toISOString().split('T')[0]

  const intervalMap = { 5: '5min', 15: '15min', 60: '1h', 240: '4h' }
  const interval = intervalMap[timeframe] || '5min'

  const url = `${BACKEND_URL}/api/twelvedata/chart/${symbol}?timeframe=${timeframe}&start_date=${startStr}&end_date=${endStr}`

  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  const data = await response.json()

  if (!data.chart?.result?.[0]) {
    throw new Error('Invalid response from Twelve Data')
  }

  const result = data.chart.result[0]
  const timestamps = result.timestamp || []
  const quote = result.indicators?.quote?.[0] || {}

  return timestamps.map((ts, i) => ({
    time: ts * 1000,
    open: quote.open?.[i],
    high: quote.high?.[i],
    low: quote.low?.[i],
    close: quote.close?.[i],
    volume: quote.volume?.[i],
  })).filter(c => c.close && isRegularTradingHours(c.time))
}

// ============ Backtest Engine ============

function calculateSMA(candles, period) {
  const sma = []
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      sma.push(null)
    } else {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close
      }
      sma.push(sum / period)
    }
  }
  return sma
}

function calculateADX(candles, period = 14) {
  // Simplified ADX - returns array of ADX values
  const adx = []
  for (let i = 0; i < candles.length; i++) {
    if (i < period * 2) {
      adx.push(25) // Default neutral value
    } else {
      // Simplified: use price volatility as proxy for ADX
      let sumMove = 0
      for (let j = i - period; j < i; j++) {
        sumMove += Math.abs(candles[j + 1].close - candles[j].close)
      }
      const avgMove = sumMove / period
      const adxValue = (avgMove / candles[i].close) * 1000 // Scale to 0-50 range
      adx.push(Math.min(50, Math.max(10, adxValue)))
    }
  }
  return adx
}

function runOIScalpBacktest(candles, config) {
  const { waspPeriod, entryDeviation, targetPct, stopPct } = config
  const sma = calculateSMA(candles, waspPeriod)

  const trades = []
  let inTrade = false
  let entryPrice = 0
  let direction = null
  let entryTime = 0

  for (let i = waspPeriod; i < candles.length; i++) {
    const candle = candles[i]
    const waspValue = sma[i]
    if (!waspValue) continue

    const deviation = (candle.close - waspValue) / waspValue

    if (!inTrade) {
      if (deviation < -entryDeviation) {
        inTrade = true
        direction = 'CALL'
        entryPrice = candle.close
        entryTime = candle.time
      } else if (deviation > entryDeviation) {
        inTrade = true
        direction = 'PUT'
        entryPrice = candle.close
        entryTime = candle.time
      }
    } else {
      const pnl = direction === 'CALL'
        ? (candle.close - entryPrice) / entryPrice
        : (entryPrice - candle.close) / entryPrice

      if (pnl >= targetPct || pnl <= -stopPct) {
        trades.push({ entryTime, exitTime: candle.time, direction, entryPrice, exitPrice: candle.close, pnl })
        inTrade = false
      }
    }
  }

  return calculateStats(trades)
}

function runOITrendBacktest(candles, config) {
  const { waspPeriod, trendThreshold, targetPct, stopPct } = config
  const sma = calculateSMA(candles, waspPeriod)
  const smaLong = calculateSMA(candles, waspPeriod * 2)

  const trades = []
  let inTrade = false
  let entryPrice = 0
  let direction = null
  let entryTime = 0

  for (let i = waspPeriod * 2; i < candles.length; i++) {
    const candle = candles[i]
    const shortSma = sma[i]
    const longSma = smaLong[i]
    if (!shortSma || !longSma) continue

    const trend = (shortSma - longSma) / longSma

    if (!inTrade) {
      if (trend > trendThreshold) {
        inTrade = true
        direction = 'CALL'
        entryPrice = candle.close
        entryTime = candle.time
      } else if (trend < -trendThreshold) {
        inTrade = true
        direction = 'PUT'
        entryPrice = candle.close
        entryTime = candle.time
      }
    } else {
      const pnl = direction === 'CALL'
        ? (candle.close - entryPrice) / entryPrice
        : (entryPrice - candle.close) / entryPrice

      if (pnl >= targetPct || pnl <= -stopPct) {
        trades.push({ entryTime, exitTime: candle.time, direction, entryPrice, exitPrice: candle.close, pnl })
        inTrade = false
      }
    }
  }

  return calculateStats(trades)
}

function runOIHybridBacktest(candles, config) {
  const { waspPeriod, entryDeviation, adxPeriod, adxThreshold } = config
  const sma = calculateSMA(candles, waspPeriod)
  const adx = calculateADX(candles, adxPeriod)

  const trades = []
  let inTrade = false
  let entryPrice = 0
  let direction = null
  let entryTime = 0

  for (let i = Math.max(waspPeriod, adxPeriod * 2); i < candles.length; i++) {
    const candle = candles[i]
    const waspValue = sma[i]
    const adxValue = adx[i]
    if (!waspValue) continue

    const deviation = (candle.close - waspValue) / waspValue
    const isTrending = adxValue > adxThreshold

    if (!inTrade) {
      if (isTrending) {
        // Trend following mode
        if (deviation > entryDeviation * 2) {
          inTrade = true
          direction = 'CALL' // Follow the trend up
          entryPrice = candle.close
          entryTime = candle.time
        } else if (deviation < -entryDeviation * 2) {
          inTrade = true
          direction = 'PUT' // Follow the trend down
          entryPrice = candle.close
          entryTime = candle.time
        }
      } else {
        // Mean reversion mode
        if (deviation < -entryDeviation) {
          inTrade = true
          direction = 'CALL'
          entryPrice = candle.close
          entryTime = candle.time
        } else if (deviation > entryDeviation) {
          inTrade = true
          direction = 'PUT'
          entryPrice = candle.close
          entryTime = candle.time
        }
      }
    } else {
      const targetPct = isTrending ? 0.003 : 0.002
      const stopPct = isTrending ? 0.002 : 0.0015

      const pnl = direction === 'CALL'
        ? (candle.close - entryPrice) / entryPrice
        : (entryPrice - candle.close) / entryPrice

      if (pnl >= targetPct || pnl <= -stopPct) {
        trades.push({ entryTime, exitTime: candle.time, direction, entryPrice, exitPrice: candle.close, pnl })
        inTrade = false
      }
    }
  }

  return calculateStats(trades)
}

function runPatternBacktest(candles, config) {
  const { lookbackPeriod, minStrength, targetPct, stopPct } = config

  // Simplified pattern detection
  const trades = []
  let inTrade = false
  let entryPrice = 0
  let direction = null
  let entryTime = 0

  for (let i = lookbackPeriod; i < candles.length; i++) {
    const candle = candles[i]

    // Calculate RSI-like strength
    let gains = 0, losses = 0
    for (let j = i - lookbackPeriod; j < i; j++) {
      const change = candles[j + 1].close - candles[j].close
      if (change > 0) gains += change
      else losses -= change
    }
    const rs = losses > 0 ? gains / losses : 100
    const rsi = 100 - (100 / (1 + rs))
    const strength = Math.abs(rsi - 50) * 2 // 0-100 scale

    if (!inTrade && strength >= minStrength) {
      if (rsi < 30) {
        inTrade = true
        direction = 'CALL' // Oversold
        entryPrice = candle.close
        entryTime = candle.time
      } else if (rsi > 70) {
        inTrade = true
        direction = 'PUT' // Overbought
        entryPrice = candle.close
        entryTime = candle.time
      }
    } else if (inTrade) {
      const pnl = direction === 'CALL'
        ? (candle.close - entryPrice) / entryPrice
        : (entryPrice - candle.close) / entryPrice

      if (pnl >= targetPct || pnl <= -stopPct) {
        trades.push({ entryTime, exitTime: candle.time, direction, entryPrice, exitPrice: candle.close, pnl })
        inTrade = false
      }
    }
  }

  return calculateStats(trades)
}

function calculateStats(trades) {
  if (trades.length === 0) {
    return { trades: 0, winRate: 0, totalReturn: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0 }
  }

  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)

  const winRate = (wins.length / trades.length) * 100
  const totalReturn = trades.reduce((sum, t) => sum + t.pnl, 0) * 100
  const avgWin = wins.length > 0 ? (wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length) * 100 : 0
  const avgLoss = losses.length > 0 ? (losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) * 100 : 0

  const grossWins = wins.reduce((sum, t) => sum + t.pnl, 0)
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0))
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0

  // Calculate max drawdown
  let equity = 10000
  let peak = equity
  let maxDrawdown = 0
  for (const trade of trades) {
    equity *= (1 + trade.pnl)
    peak = Math.max(peak, equity)
    const drawdown = (peak - equity) / peak * 100
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  }

  return {
    trades: trades.length,
    winRate: winRate.toFixed(1),
    totalReturn: totalReturn.toFixed(2),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    profitFactor: profitFactor.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(1),
  }
}

// ============ Optimization Loop ============

function* paramCombinations(params) {
  const keys = Object.keys(params)
  const values = keys.map(k => params[k])

  function* combine(index, current) {
    if (index === keys.length) {
      yield { ...current }
      return
    }
    for (const value of values[index]) {
      current[keys[index]] = value
      yield* combine(index + 1, current)
    }
  }

  yield* combine(0, {})
}

async function optimizeStrategy(strategyKey, strategyConfig, period) {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - period.days)

  console.log(`\n  Testing ${period.name} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`)

  const results = []

  for (const timeframe of strategyConfig.timeframes) {
    console.log(`    Timeframe: ${timeframe}m`)

    // Fetch data once per timeframe
    let candles
    try {
      candles = await fetchCandles('SPY', timeframe, startDate, endDate)
      console.log(`    Fetched ${candles.length} candles`)
    } catch (error) {
      console.log(`    Error fetching data: ${error.message}`)
      continue
    }

    if (candles.length < 100) {
      console.log(`    Insufficient data, skipping`)
      continue
    }

    // Test all parameter combinations
    let tested = 0
    for (const params of paramCombinations(strategyConfig.params)) {
      let stats
      switch (strategyKey) {
        case 'oi-scalp':
          stats = runOIScalpBacktest(candles, params)
          break
        case 'oi-trend':
          stats = runOITrendBacktest(candles, params)
          break
        case 'oi-hybrid':
          stats = runOIHybridBacktest(candles, params)
          break
        case 'pattern':
          stats = runPatternBacktest(candles, params)
          break
      }

      if (stats && stats.trades >= 10) {
        results.push({
          period: period.name,
          timeframe,
          params,
          ...stats,
        })
      }
      tested++
    }
    console.log(`    Tested ${tested} parameter combinations`)
  }

  return results
}

function formatParams(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === 'number' && v < 1 ? (v * 100).toFixed(2) + '%' : v}`)
    .join(', ')
}

async function runOptimization(targetStrategy = null, targetPeriod = null) {
  console.log('=== Strategy Optimization Experiments ===')
  console.log(`Started: ${new Date().toISOString()}\n`)

  const allResults = {}

  for (const [key, config] of Object.entries(STRATEGIES)) {
    if (targetStrategy && key !== targetStrategy) continue

    console.log(`\n${'='.repeat(60)}`)
    console.log(`Strategy: ${config.name}`)
    console.log('='.repeat(60))

    allResults[key] = []

    for (const period of TIME_PERIODS) {
      if (targetPeriod && period.days !== targetPeriod) continue

      const results = await optimizeStrategy(key, config, period)
      allResults[key].push(...results)

      // Delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1000))
    }

    // Find best configuration for this strategy
    if (allResults[key].length > 0) {
      // Sort by profit factor (balance of wins/losses)
      const sorted = [...allResults[key]].sort((a, b) => {
        // Prioritize: profit factor > total return > win rate
        const scoreA = parseFloat(a.profitFactor) * 10 + parseFloat(a.totalReturn) + parseFloat(a.winRate) / 10
        const scoreB = parseFloat(b.profitFactor) * 10 + parseFloat(b.totalReturn) + parseFloat(b.winRate) / 10
        return scoreB - scoreA
      })

      console.log(`\n  Top 5 Configurations:`)
      console.log('  ' + '-'.repeat(100))
      console.log(`  ${'Period'.padEnd(12)} ${'TF'.padEnd(4)} ${'Trades'.padEnd(7)} ${'Win%'.padEnd(7)} ${'Return'.padEnd(9)} ${'PF'.padEnd(6)} ${'MaxDD'.padEnd(7)} Parameters`)
      console.log('  ' + '-'.repeat(100))

      for (const result of sorted.slice(0, 5)) {
        console.log(`  ${result.period.padEnd(12)} ${(result.timeframe + 'm').padEnd(4)} ${result.trades.toString().padEnd(7)} ${(result.winRate + '%').padEnd(7)} ${(result.totalReturn + '%').padEnd(9)} ${result.profitFactor.padEnd(6)} ${(result.maxDrawdown + '%').padEnd(7)} ${formatParams(result.params)}`)
      }

      // Best overall
      console.log(`\n  BEST CONFIG: ${config.name}`)
      console.log(`  Period: ${sorted[0].period}, Timeframe: ${sorted[0].timeframe}m`)
      console.log(`  Parameters: ${formatParams(sorted[0].params)}`)
      console.log(`  Performance: ${sorted[0].trades} trades, ${sorted[0].winRate}% win rate, ${sorted[0].totalReturn}% return, ${sorted[0].profitFactor} PF`)
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('OPTIMIZATION SUMMARY')
  console.log('='.repeat(60))

  for (const [key, results] of Object.entries(allResults)) {
    if (results.length === 0) continue

    const best = results.sort((a, b) => {
      const scoreA = parseFloat(a.profitFactor) * 10 + parseFloat(a.totalReturn)
      const scoreB = parseFloat(b.profitFactor) * 10 + parseFloat(b.totalReturn)
      return scoreB - scoreA
    })[0]

    console.log(`\n${STRATEGIES[key].name}:`)
    console.log(`  Best: ${best.period}, ${best.timeframe}m`)
    console.log(`  Params: ${formatParams(best.params)}`)
    console.log(`  Stats: ${best.trades} trades, ${best.winRate}% win, ${best.totalReturn}% return, PF ${best.profitFactor}`)
  }

  console.log(`\nCompleted: ${new Date().toISOString()}`)
}

// ============ CLI ============

const args = process.argv.slice(2)
let targetStrategy = null
let targetPeriod = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--strategy' && args[i + 1]) {
    targetStrategy = args[i + 1]
  }
  if (args[i] === '--period' && args[i + 1]) {
    targetPeriod = parseInt(args[i + 1])
  }
}

runOptimization(targetStrategy, targetPeriod).catch(console.error)
