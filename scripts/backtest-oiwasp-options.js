#!/usr/bin/env node
/**
 * OIWASP Options Backtest Script
 * Simulates butterfly spread strategy for SPY
 * Target: 200%+ monthly return
 *
 * Key insight from original strategy:
 * - Butterfly spread: $55 risk → $445 max profit (8:1 R:R)
 * - Only need ~13% win rate to break even (1/9 wins)
 * - Focus on mean reversion when price deviates from WASP
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import { calculateSMA, calculateBollingerBands, calculateRSI } from '../src/core/patterns/indicators.js'

// Butterfly spread parameters (from original strategy screenshot)
const BUTTERFLY_CONFIG = {
  maxProfit: 445, // Max profit per spread
  maxLoss: 55, // Max loss per spread (net debit)
  riskRewardRatio: 8.09, // 445/55
  breakeven: { lower: 175.55, upper: 184.45 }, // Example breakeven range
}

class OIWASPOptionsBacktest {
  constructor(config = {}) {
    // Signal detection
    this.waspPeriod = config.waspPeriod ?? 10
    this.entryDeviation = config.entryDeviation ?? 0.3 // % deviation to enter
    this.rsiPeriod = config.rsiPeriod ?? 14
    this.rsiOversold = config.rsiOversold ?? 30
    this.rsiOverbought = config.rsiOverbought ?? 70
    this.bbPeriod = config.bbPeriod ?? 20
    this.bbStdDev = config.bbStdDev ?? 2

    // Trade management
    this.contractsPerTrade = config.contractsPerTrade ?? 10 // Number of butterfly contracts
    this.maxConcurrentTrades = config.maxConcurrentTrades ?? 3
    this.maxPositionPercent = config.maxPositionPercent ?? 33 // Max % of capital per trade
    this.cooldownBars = config.cooldownBars ?? 3

    // Butterfly spread model
    this.maxProfit = BUTTERFLY_CONFIG.maxProfit
    this.maxLoss = BUTTERFLY_CONFIG.maxLoss

    // Results
    this.trades = []
    this.signals = []
    this.initialCapital = config.initialCapital ?? 10000
    this.capital = this.initialCapital
    this.equityCurve = []
  }

  async run(candles) {
    console.log(`\nRunning OIWASP Options Backtest...`)
    console.log(`Candles: ${candles.length}, Period: ${new Date(candles[0].time).toLocaleDateString()} - ${new Date(candles[candles.length - 1].time).toLocaleDateString()}`)

    this.trades = []
    this.signals = []
    this.capital = this.initialCapital
    this.equityCurve = [{ time: candles[0].time, equity: this.capital }]

    // Calculate indicators for all candles
    const closes = candles.map((c) => c.close)
    const wasp = calculateSMA(closes, this.waspPeriod)
    const rsi = calculateRSI(closes, this.rsiPeriod)
    const bb = calculateBollingerBands(closes, this.bbPeriod, this.bbStdDev)

    let lastSignalIndex = -10
    const openTrades = []

    const minIndex = Math.max(this.waspPeriod, this.rsiPeriod, this.bbPeriod) + 5
    console.log(`Starting from index ${minIndex}, checking ${candles.length - minIndex} candles`)

    for (let i = minIndex; i < candles.length; i++) {
      const candle = candles[i]
      const currentWASP = wasp[i]
      const currentRSI = rsi[i]
      // BB returns object with arrays, not array of objects
      const currentBB = {
        upper: bb.upper[i],
        middle: bb.middle[i],
        lower: bb.lower[i],
      }

      if (!currentWASP || currentRSI === null || !currentBB.middle) continue

      // Check for exits on open trades
      for (let j = openTrades.length - 1; j >= 0; j--) {
        const trade = openTrades[j]
        const result = this.checkButterflyExit(trade, candle, i)
        if (result.exit) {
          trade.exitPrice = candle.close
          trade.exitTime = candle.time
          trade.exitIndex = i
          trade.barsHeld = i - trade.entryIndex
          trade.pnl = result.pnl
          trade.exitReason = result.reason
          this.capital += result.pnl
          this.trades.push(trade)
          openTrades.splice(j, 1)
        }
      }

      // Check for new entry signals
      if (i - lastSignalIndex >= this.cooldownBars && openTrades.length < this.maxConcurrentTrades) {
        const deviation = ((candle.close - currentWASP) / currentWASP) * 100
        // Debug first few candles
        if (i < minIndex + 5) {
          console.log(`  [${i}] Price: $${candle.close.toFixed(2)}, WASP: $${currentWASP.toFixed(2)}, Dev: ${deviation.toFixed(3)}%, RSI: ${currentRSI?.toFixed(1)}`)
        }

        const signal = this.detectSignal(candle, currentWASP, currentRSI, currentBB, i)
        if (signal) {
          this.signals.push(signal)
          lastSignalIndex = i

          // Calculate position size (risk max 33% per trade)
          const maxRisk = this.capital * (this.maxPositionPercent / 100)
          const contracts = Math.floor(maxRisk / this.maxLoss)

          if (contracts > 0) {
            const trade = {
              entryPrice: candle.close,
              entryTime: candle.time,
              entryIndex: i,
              signal: signal.direction,
              signalType: signal.type,
              strength: signal.strength,
              contracts,
              maxRisk: contracts * this.maxLoss,
              maxProfit: contracts * this.maxProfit,
              deviation: signal.deviation,
              wasp: currentWASP,
              rsi: currentRSI,
              // Target price is entry price moved toward WASP
              targetPrice:
                signal.direction === 'CALL'
                  ? candle.close * (1 + this.entryDeviation / 100 * 2) // Price should move up
                  : candle.close * (1 - this.entryDeviation / 100 * 2), // Price should move down
            }
            openTrades.push(trade)
          }
        }
      }

      // Record equity
      const unrealized = openTrades.reduce((sum, t) => {
        const pnl = this.calculateUnrealizedPnL(t, candle)
        return sum + pnl
      }, 0)
      this.equityCurve.push({
        time: candle.time,
        equity: this.capital + unrealized,
      })
    }

    // Close remaining trades at end
    const lastCandle = candles[candles.length - 1]
    for (const trade of openTrades) {
      trade.exitPrice = lastCandle.close
      trade.exitTime = lastCandle.time
      trade.exitIndex = candles.length - 1
      trade.barsHeld = candles.length - 1 - trade.entryIndex
      trade.pnl = this.calculateButterflyPnL(trade, lastCandle)
      trade.exitReason = 'End of data'
      this.capital += trade.pnl
      this.trades.push(trade)
    }

    return this.generateReport()
  }

  detectSignal(candle, wasp, rsi, bb, index) {
    const deviation = ((candle.close - wasp) / wasp) * 100

    // Price above WASP = overvalued = expect mean reversion DOWN = PUT butterfly
    // Price below WASP = undervalued = expect mean reversion UP = CALL butterfly
    if (Math.abs(deviation) < this.entryDeviation) {
      return null // Not enough deviation
    }

    let direction, type, strength

    if (deviation > 0) {
      // Price above WASP - bearish signal
      direction = 'PUT'
      type = deviation > this.entryDeviation * 2 ? 'STRONG_PUT' : 'PUT'

      // Confirm with RSI (overbought = better PUT signal)
      const rsiConfirm = rsi > 60 ? 1 : rsi > this.rsiOverbought ? 1.5 : 0.5

      // Confirm with BB (above upper band = better PUT signal)
      const bbConfirm = candle.close > bb.upper ? 1.5 : candle.close > bb.middle ? 1 : 0.5

      strength = Math.min(100, 40 + deviation * 20 * rsiConfirm * bbConfirm)
    } else {
      // Price below WASP - bullish signal
      direction = 'CALL'
      type = Math.abs(deviation) > this.entryDeviation * 2 ? 'STRONG_CALL' : 'CALL'

      // Confirm with RSI (oversold = better CALL signal)
      const rsiConfirm = rsi < 40 ? 1 : rsi < this.rsiOversold ? 1.5 : 0.5

      // Confirm with BB (below lower band = better CALL signal)
      const bbConfirm = candle.close < bb.lower ? 1.5 : candle.close < bb.middle ? 1 : 0.5

      strength = Math.min(100, 40 + Math.abs(deviation) * 20 * rsiConfirm * bbConfirm)
    }

    return {
      direction,
      type,
      strength,
      deviation,
      price: candle.close,
      wasp,
      rsi,
      time: candle.time,
      index,
    }
  }

  checkButterflyExit(trade, candle, index) {
    const barsHeld = index - trade.entryIndex

    // Butterfly expiration (typically 3-7 DTE, ~50-100 bars on 5m)
    const maxHold = 100 // bars

    // Calculate price move toward target
    const priceMove = trade.signal === 'CALL' ? candle.close - trade.entryPrice : trade.entryPrice - candle.close

    const movePercent = (priceMove / trade.entryPrice) * 100

    // Butterfly payoff model:
    // - Max profit when price hits center of butterfly
    // - Max loss when price moves away from center
    // - Time decay accelerates near expiration

    // Check for max profit scenario (price hit target zone)
    if (movePercent >= this.entryDeviation * 1.5) {
      // Assume 80% of max profit (not perfect center hit)
      return {
        exit: true,
        pnl: trade.contracts * this.maxProfit * 0.8,
        reason: 'Target zone hit',
      }
    }

    // Check for stop loss (price moved against us significantly)
    if (movePercent <= -this.entryDeviation) {
      // Full loss
      return {
        exit: true,
        pnl: -trade.maxRisk,
        reason: 'Stop loss (price reversal)',
      }
    }

    // Time decay exit (close before expiration)
    if (barsHeld >= maxHold * 0.8) {
      // Pro-rate based on position
      const partialProfit = movePercent > 0 ? trade.contracts * movePercent * 50 : -trade.maxRisk * 0.5
      return {
        exit: true,
        pnl: partialProfit,
        reason: 'Time decay exit',
      }
    }

    return { exit: false }
  }

  calculateButterflyPnL(trade, candle) {
    const priceMove = trade.signal === 'CALL' ? candle.close - trade.entryPrice : trade.entryPrice - candle.close

    const movePercent = (priceMove / trade.entryPrice) * 100

    if (movePercent >= this.entryDeviation) {
      return trade.contracts * this.maxProfit * (movePercent / this.entryDeviation) * 0.5
    } else if (movePercent > 0) {
      return trade.contracts * movePercent * 30
    } else {
      // Losing trade
      const lossRatio = Math.min(1, Math.abs(movePercent) / this.entryDeviation)
      return -trade.maxRisk * lossRatio
    }
  }

  calculateUnrealizedPnL(trade, candle) {
    return this.calculateButterflyPnL(trade, candle)
  }

  generateReport() {
    const winningTrades = this.trades.filter((t) => t.pnl > 0)
    const losingTrades = this.trades.filter((t) => t.pnl <= 0)

    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0)
    const totalReturn = (totalPnL / this.initialCapital) * 100

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0)
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0))

    const winRate = this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0

    // Calculate max drawdown
    let peak = this.initialCapital
    let maxDD = 0
    for (const point of this.equityCurve) {
      if (point.equity > peak) peak = point.equity
      const dd = ((peak - point.equity) / peak) * 100
      if (dd > maxDD) maxDD = dd
    }

    return {
      trades: this.trades,
      signals: this.signals,
      equityCurve: this.equityCurve,
      stats: {
        totalTrades: this.trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        profitFactor,
        totalPnL,
        totalReturn,
        avgWin,
        avgLoss,
        maxDrawdown: maxDD,
        finalEquity: this.capital,
        initialCapital: this.initialCapital,
      },
    }
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('OIWASP OPTIONS STRATEGY BACKTEST - SPY')
  console.log('Simulating Butterfly Spreads with 8:1 R:R')
  console.log('Target: 200%+ monthly return')
  console.log('='.repeat(80))

  // Fetch data
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  console.log('\nFetching SPY 5-minute data for 1 month...')
  const candles5m = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles5m?.length || 0} candles`)

  if (!candles5m || candles5m.length < 100) {
    console.error('Failed to fetch sufficient data')
    process.exit(1)
  }

  // Test configurations
  const configs = [
    // Base configuration
    { waspPeriod: 10, entryDeviation: 0.3, maxPositionPercent: 33 },

    // Aggressive
    { waspPeriod: 5, entryDeviation: 0.2, maxPositionPercent: 50 },

    // Very aggressive
    { waspPeriod: 5, entryDeviation: 0.15, maxPositionPercent: 60 },

    // Ultra aggressive with confirmation
    { waspPeriod: 5, entryDeviation: 0.1, maxPositionPercent: 75, rsiOversold: 35, rsiOverbought: 65 },

    // Maximum aggression
    { waspPeriod: 3, entryDeviation: 0.08, maxPositionPercent: 100, cooldownBars: 1 },
  ]

  console.log('\n' + '='.repeat(80))
  console.log('Testing configurations...')
  console.log('='.repeat(80))

  const results = []

  for (const config of configs) {
    const backtest = new OIWASPOptionsBacktest({
      ...config,
      initialCapital: 10000,
    })

    const result = await backtest.run(candles5m)
    results.push({ config, result })

    console.log(
      `\nWASP=${config.waspPeriod} Dev=${config.entryDeviation}% Pos=${config.maxPositionPercent}%`
    )
    console.log(
      `  Trades: ${result.stats.totalTrades}, Win Rate: ${result.stats.winRate.toFixed(1)}%`
    )
    console.log(
      `  Total Return: ${result.stats.totalReturn.toFixed(1)}%, Max DD: ${result.stats.maxDrawdown.toFixed(1)}%`
    )
    console.log(
      `  Final Equity: $${result.stats.finalEquity.toFixed(2)} (from $${result.stats.initialCapital})`
    )
  }

  // Sort by return
  results.sort((a, b) => b.result.stats.totalReturn - a.result.stats.totalReturn)

  console.log('\n' + '='.repeat(80))
  console.log('TOP RESULTS BY RETURN')
  console.log('='.repeat(80))

  for (let i = 0; i < Math.min(3, results.length); i++) {
    const { config, result } = results[i]
    console.log(`\n#${i + 1}: ${result.stats.totalReturn.toFixed(1)}% Return`)
    console.log(`   Config: WASP=${config.waspPeriod}, Dev=${config.entryDeviation}%, Position=${config.maxPositionPercent}%`)
    console.log(`   Trades: ${result.stats.totalTrades}, Win Rate: ${result.stats.winRate.toFixed(1)}%`)
    console.log(`   Profit Factor: ${result.stats.profitFactor.toFixed(2)}, Max DD: ${result.stats.maxDrawdown.toFixed(1)}%`)
    console.log(`   Avg Win: $${result.stats.avgWin.toFixed(2)}, Avg Loss: $${result.stats.avgLoss.toFixed(2)}`)
  }

  // Check if 200% achieved
  const best = results[0]
  console.log('\n' + '='.repeat(80))
  if (best.result.stats.totalReturn >= 200) {
    console.log(`SUCCESS: Achieved ${best.result.stats.totalReturn.toFixed(1)}% monthly return!`)
    console.log('\nOptimal Configuration:')
    console.log(JSON.stringify(best.config, null, 2))
  } else {
    console.log(`Best return: ${best.result.stats.totalReturn.toFixed(1)}%`)
    console.log('\nTo reach 200% target with butterfly spreads:')
    console.log('1. Increase position size (higher risk)')
    console.log('2. More aggressive entry deviation (more signals)')
    console.log('3. Use real-time OI data for better WASP accuracy')
    console.log('4. Focus on high-volatility periods (earnings, FOMC)')
    console.log('5. Combine with intraday momentum signals')
  }
  console.log('='.repeat(80))

  // Print sample trades
  if (best.result.trades.length > 0) {
    console.log('\nSample Trades (first 10):')
    console.log('-'.repeat(80))
    for (let i = 0; i < Math.min(10, best.result.trades.length); i++) {
      const t = best.result.trades[i]
      console.log(
        `${i + 1}. ${t.signal} @ $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)} | ` +
          `PnL: $${t.pnl.toFixed(2)} | ${t.exitReason}`
      )
    }
  }
}

main().catch(console.error)
