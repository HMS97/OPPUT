#!/usr/bin/env node
/**
 * OIWASP Strategy V2 - More Realistic Butterfly Model
 *
 * Key insight from original strategy:
 * 1. Calculate WASP from OI data
 * 2. When price deviates from WASP, predict price will revert
 * 3. Place butterfly centered at WASP (prediction target)
 * 4. Profit if price reverts to WASP zone
 *
 * Butterfly payoff:
 * - Max profit when price = center strike at expiry
 * - Max loss when price far from center strike
 * - Profit zone is narrow (butterfly wings)
 *
 * For 200%+ monthly returns with 8:1 R:R:
 * - Need ~13% win rate to break even (1/9)
 * - Need higher win rate for profit
 * - Key: accurate WASP prediction
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import { calculateSMA, calculateEMA, calculateRSI, calculateBollingerBands } from '../src/core/patterns/indicators.js'

class ButterflyBacktest {
  constructor(config = {}) {
    // WASP calculation
    this.waspPeriod = config.waspPeriod ?? 20
    this.emaFast = config.emaFast ?? 9
    this.emaSlow = config.emaSlow ?? 21

    // Entry conditions
    this.minDeviation = config.minDeviation ?? 0.3 // Min % deviation to enter
    this.maxDeviation = config.maxDeviation ?? 2.0 // Max % (too extended)
    this.trendFilter = config.trendFilter ?? true // Only trade with trend

    // Butterfly structure
    this.wingWidth = config.wingWidth ?? 0.5 // % width of profit zone
    this.maxProfit = 8 // Normalized max profit (8:1)
    this.maxLoss = 1 // Normalized max loss

    // Position sizing
    this.riskPerTrade = config.riskPerTrade ?? 5 // % of capital to risk
    this.maxConcurrent = config.maxConcurrent ?? 3
    this.holdPeriod = config.holdPeriod ?? 20 // Bars to hold (simulating expiry)

    // Results
    this.capital = config.initialCapital ?? 10000
    this.initialCapital = this.capital
    this.trades = []
    this.equityCurve = []
  }

  async run(candles) {
    console.log(`Running Butterfly Backtest: ${candles.length} candles`)

    this.trades = []
    this.capital = this.initialCapital
    this.equityCurve = [{ time: candles[0].time, equity: this.capital }]

    const closes = candles.map((c) => c.close)
    const wasp = calculateSMA(closes, this.waspPeriod)
    const emaF = calculateEMA(closes, this.emaFast)
    const emaS = calculateEMA(closes, this.emaSlow)
    const rsi = calculateRSI(closes, 14)
    const bb = calculateBollingerBands(closes, 20, 2)

    const openTrades = []
    let lastEntryBar = -20

    const minIdx = Math.max(this.waspPeriod, this.emaSlow, 25)

    for (let i = minIdx; i < candles.length; i++) {
      const candle = candles[i]
      const currentWASP = wasp[i]
      const fastEMA = emaF[i]
      const slowEMA = emaS[i]
      const currentRSI = rsi[i]
      const upperBB = bb.upper[i]
      const lowerBB = bb.lower[i]

      if (!currentWASP || !fastEMA || !slowEMA) continue

      // Check exits
      for (let j = openTrades.length - 1; j >= 0; j--) {
        const trade = openTrades[j]
        const barsHeld = i - trade.entryIndex

        // Calculate how close price is to target (WASP at entry)
        const targetWASP = trade.targetWASP
        const currentDist = Math.abs(candle.close - targetWASP) / targetWASP * 100

        // Butterfly payoff model
        let pnlMultiplier = 0

        if (barsHeld >= this.holdPeriod || currentDist <= this.wingWidth * 0.5) {
          // At expiry or in max profit zone
          if (currentDist <= this.wingWidth * 0.3) {
            // Near center - max profit
            pnlMultiplier = this.maxProfit * 0.9
          } else if (currentDist <= this.wingWidth * 0.6) {
            // In profit zone
            pnlMultiplier = this.maxProfit * 0.5
          } else if (currentDist <= this.wingWidth) {
            // Edge of profit zone
            pnlMultiplier = this.maxProfit * 0.2
          } else if (currentDist <= this.wingWidth * 2) {
            // Small loss
            pnlMultiplier = -this.maxLoss * 0.5
          } else {
            // Max loss
            pnlMultiplier = -this.maxLoss
          }

          const pnl = trade.riskAmount * pnlMultiplier
          this.capital += pnl
          trade.pnl = pnl
          trade.exitPrice = candle.close
          trade.exitTime = candle.time
          trade.barsHeld = barsHeld
          trade.exitDist = currentDist
          trade.exitReason = barsHeld >= this.holdPeriod ? 'Expiry' : 'Target hit'
          this.trades.push(trade)
          openTrades.splice(j, 1)
        }
      }

      // Check for new entries
      if (i - lastEntryBar >= 5 && openTrades.length < this.maxConcurrent) {
        const deviation = ((candle.close - currentWASP) / currentWASP) * 100
        const absDeviation = Math.abs(deviation)
        const trend = fastEMA > slowEMA ? 'UP' : 'DOWN'

        // Entry conditions
        const validDeviation = absDeviation >= this.minDeviation && absDeviation <= this.maxDeviation

        // Trend confirmation (trade reversion in direction of trend)
        let trendConfirm = true
        if (this.trendFilter) {
          // Price above WASP + uptrend = don't short (wait for pullback)
          // Price below WASP + downtrend = don't long (wait for bounce)
          if (deviation > 0 && trend === 'UP') {
            trendConfirm = false // Overextended in uptrend - wait
          }
          if (deviation < 0 && trend === 'DOWN') {
            trendConfirm = false // Overextended in downtrend - wait
          }
        }

        // RSI extremes enhance signal
        let rsiConfirm = true
        if (currentRSI > 70 && deviation < 0) rsiConfirm = false // Overbought but below WASP
        if (currentRSI < 30 && deviation > 0) rsiConfirm = false // Oversold but above WASP

        // BB confirmation
        const atBBExtreme = candle.close > upperBB || candle.close < lowerBB

        if (validDeviation && trendConfirm && rsiConfirm && atBBExtreme) {
          // Cap risk at initial capital to prevent unrealistic compounding
          const maxRiskBase = this.initialCapital * 0.5 // Max 50% of initial capital per trade
          const riskAmount = Math.min((this.capital * this.riskPerTrade) / 100, maxRiskBase)
          const trade = {
            entryPrice: candle.close,
            entryTime: candle.time,
            entryIndex: i,
            targetWASP: currentWASP,
            deviation,
            riskAmount,
            direction: deviation > 0 ? 'PUT' : 'CALL', // Mean reversion
          }
          openTrades.push(trade)
          lastEntryBar = i
        }
      }

      // Record equity
      this.equityCurve.push({ time: candle.time, equity: this.capital })
    }

    // Close remaining trades
    const lastCandle = candles[candles.length - 1]
    for (const trade of openTrades) {
      const currentDist = Math.abs(lastCandle.close - trade.targetWASP) / trade.targetWASP * 100
      const pnlMultiplier = currentDist <= this.wingWidth ? 2 : -0.5
      const pnl = trade.riskAmount * pnlMultiplier
      trade.pnl = pnl
      trade.exitPrice = lastCandle.close
      trade.barsHeld = candles.length - 1 - trade.entryIndex
      trade.exitReason = 'End of data'
      this.capital += pnl
      this.trades.push(trade)
    }

    return this.generateReport()
  }

  generateReport() {
    const winners = this.trades.filter((t) => t.pnl > 0)
    const losers = this.trades.filter((t) => t.pnl <= 0)

    const totalPnL = this.trades.reduce((s, t) => s + t.pnl, 0)
    const grossProfit = winners.reduce((s, t) => s + t.pnl, 0)
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))

    // Max drawdown
    let peak = this.initialCapital
    let maxDD = 0
    for (const p of this.equityCurve) {
      if (p.equity > peak) peak = p.equity
      const dd = ((peak - p.equity) / peak) * 100
      if (dd > maxDD) maxDD = dd
    }

    return {
      totalTrades: this.trades.length,
      winners: winners.length,
      losers: losers.length,
      winRate: this.trades.length > 0 ? (winners.length / this.trades.length) * 100 : 0,
      totalReturn: ((this.capital - this.initialCapital) / this.initialCapital) * 100,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
      avgWin: winners.length > 0 ? grossProfit / winners.length : 0,
      avgLoss: losers.length > 0 ? grossLoss / losers.length : 0,
      maxDrawdown: maxDD,
      finalEquity: this.capital,
      trades: this.trades,
    }
  }
}

async function main() {
  console.log('=' .repeat(80))
  console.log('OIWASP BUTTERFLY STRATEGY V2')
  console.log('Target: 200%+ monthly return')
  console.log('='.repeat(80))

  // Get data
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  console.log('\nFetching 5-minute SPY data...')
  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles?.length || 0} candles\n`)

  if (!candles || candles.length < 100) {
    console.error('Insufficient data')
    process.exit(1)
  }

  // Test configs
  const configs = [
    // Conservative
    { waspPeriod: 20, minDeviation: 0.4, riskPerTrade: 3, wingWidth: 0.3, holdPeriod: 30 },

    // Moderate
    { waspPeriod: 15, minDeviation: 0.3, riskPerTrade: 5, wingWidth: 0.4, holdPeriod: 25 },

    // Aggressive
    { waspPeriod: 10, minDeviation: 0.2, riskPerTrade: 8, wingWidth: 0.5, holdPeriod: 20 },

    // Very aggressive
    { waspPeriod: 10, minDeviation: 0.15, riskPerTrade: 10, wingWidth: 0.4, holdPeriod: 15, maxConcurrent: 5 },

    // Maximum aggression (for 200%+ target)
    { waspPeriod: 5, minDeviation: 0.1, riskPerTrade: 15, wingWidth: 0.5, holdPeriod: 10, maxConcurrent: 5, trendFilter: false },

    // Ultra aggressive
    { waspPeriod: 5, minDeviation: 0.08, riskPerTrade: 20, wingWidth: 0.6, holdPeriod: 8, maxConcurrent: 7, trendFilter: false },
  ]

  const results = []

  for (const config of configs) {
    const bt = new ButterflyBacktest({ ...config, initialCapital: 10000 })
    const result = await bt.run(candles)
    results.push({ config, result })

    console.log(`WASP=${config.waspPeriod} Dev=${config.minDeviation}% Risk=${config.riskPerTrade}% Wing=${config.wingWidth}%`)
    console.log(`  Trades: ${result.totalTrades}, WR: ${result.winRate.toFixed(1)}%, Return: ${result.totalReturn.toFixed(1)}%`)
    console.log(`  PF: ${result.profitFactor.toFixed(2)}, DD: ${result.maxDrawdown.toFixed(1)}%\n`)
  }

  // Sort by return
  results.sort((a, b) => b.result.totalReturn - a.result.totalReturn)

  console.log('='.repeat(80))
  console.log('BEST CONFIGURATIONS')
  console.log('='.repeat(80))

  for (let i = 0; i < Math.min(3, results.length); i++) {
    const { config, result } = results[i]
    console.log(`\n#${i + 1}: ${result.totalReturn.toFixed(1)}% Return`)
    console.log(`   WASP: ${config.waspPeriod}, MinDev: ${config.minDeviation}%, Risk: ${config.riskPerTrade}%`)
    console.log(`   Trades: ${result.totalTrades}, Win Rate: ${result.winRate.toFixed(1)}%`)
    console.log(`   Avg Win: $${result.avgWin.toFixed(2)}, Avg Loss: $${result.avgLoss.toFixed(2)}`)
    console.log(`   Max DD: ${result.maxDrawdown.toFixed(1)}%, Final: $${result.finalEquity.toFixed(2)}`)
  }

  // Check 200% target
  const best = results[0]
  console.log('\n' + '='.repeat(80))
  if (best.result.totalReturn >= 200) {
    console.log(`SUCCESS: ${best.result.totalReturn.toFixed(1)}% monthly return achieved!`)
  } else if (best.result.totalReturn >= 100) {
    console.log(`GOOD: ${best.result.totalReturn.toFixed(1)}% return - close to target!`)
  } else if (best.result.totalReturn > 0) {
    console.log(`POSITIVE: ${best.result.totalReturn.toFixed(1)}% return - needs tuning`)
  } else {
    console.log(`NEEDS WORK: ${best.result.totalReturn.toFixed(1)}% return`)
  }

  // Analysis
  console.log('\nTo achieve 200%+ monthly returns:')
  console.log('1. Use real-time OI/WASP data (not SMA proxy)')
  console.log('2. Focus on high-probability setups (earnings, FOMC)')
  console.log('3. Increase position size with proper risk management')
  console.log('4. Trade both calls and puts butterfly spreads')
  console.log('5. Compound gains throughout the month')
  console.log('='.repeat(80))

  // Show sample trades
  if (best.result.trades.length > 0) {
    console.log('\nSample winning trades:')
    const winners = best.result.trades.filter((t) => t.pnl > 0).slice(0, 5)
    for (const t of winners) {
      console.log(`  ${t.direction} @ $${t.entryPrice.toFixed(2)}, Target: $${t.targetWASP.toFixed(2)}, PnL: $${t.pnl.toFixed(2)} (${t.exitReason})`)
    }
  }
}

main().catch(console.error)
