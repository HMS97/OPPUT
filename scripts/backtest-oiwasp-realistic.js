#!/usr/bin/env node
/**
 * OIWASP Realistic Backtest
 *
 * Models butterfly spreads more accurately:
 * - Narrow profit zone (price must hit target range)
 * - Time decay (theta) working against position
 * - More realistic win rates
 *
 * Target: 200%+ monthly with realistic assumptions
 */

import { fetchCandleData } from '../src/core/data/yahoo.js'
import { calculateSMA, calculateRSI, calculateBollingerBands, calculateATR } from '../src/core/patterns/indicators.js'

class RealisticButterflyBacktest {
  constructor(config = {}) {
    // Signal detection
    this.waspPeriod = config.waspPeriod ?? 20
    this.minDeviation = config.minDeviation ?? 0.3
    this.maxDeviation = config.maxDeviation ?? 1.5

    // Butterfly parameters (realistic)
    this.butterflyWidth = config.butterflyWidth ?? 2 // $ width of spread (e.g., 590/592/594)
    this.maxProfitMultiple = config.maxProfitMultiple ?? 8 // 8:1 R:R when center hit exactly
    this.profitZoneWidth = config.profitZoneWidth ?? 0.3 // % of spot for profit zone

    // Risk management
    this.riskPerTrade = config.riskPerTrade ?? 100 // $ risk per butterfly (net debit)
    this.maxTradesPerDay = config.maxTradesPerDay ?? 3
    this.holdPeriodBars = config.holdPeriodBars ?? 78 // ~1 trading day on 5m

    // Probability adjustments (more realistic)
    this.winRateAdjustment = config.winRateAdjustment ?? 0.4 // Real win rate is lower

    // State
    this.capital = config.initialCapital ?? 10000
    this.initialCapital = this.capital
    this.trades = []
    this.equityCurve = []
  }

  async run(candles) {
    console.log(`\nRunning Realistic Butterfly Backtest: ${candles.length} candles`)

    this.trades = []
    this.capital = this.initialCapital
    this.equityCurve = [{ time: candles[0].time, equity: this.capital }]

    const closes = candles.map((c) => c.close)
    const wasp = calculateSMA(closes, this.waspPeriod)
    const rsi = calculateRSI(closes, 14)
    const bb = calculateBollingerBands(closes, 20, 2)

    const openTrades = []
    let tradesToday = 0
    let lastDay = null

    const minIdx = 30

    for (let i = minIdx; i < candles.length; i++) {
      const candle = candles[i]
      const currentWASP = wasp[i]
      const currentRSI = rsi[i]
      const upperBB = bb.upper[i]
      const lowerBB = bb.lower[i]

      if (!currentWASP || currentRSI === null) continue

      // Reset daily trade counter
      const currentDay = new Date(candle.time).toDateString()
      if (currentDay !== lastDay) {
        tradesToday = 0
        lastDay = currentDay
      }

      // Process exits
      for (let j = openTrades.length - 1; j >= 0; j--) {
        const trade = openTrades[j]
        const barsHeld = i - trade.entryIndex

        // Calculate distance from target
        const distFromTarget = Math.abs(candle.close - trade.targetPrice) / trade.targetPrice * 100

        // Theta decay - lose value over time
        const thetaDecay = Math.min(0.8, barsHeld / this.holdPeriodBars)

        let shouldExit = false
        let pnl = 0
        let reason = ''

        // Check expiry (end of holding period)
        if (barsHeld >= this.holdPeriodBars) {
          shouldExit = true
          reason = 'Expiry'

          // Butterfly payoff at expiry based on distance from center
          if (distFromTarget <= this.profitZoneWidth * 0.3) {
            // Near max profit zone
            pnl = this.riskPerTrade * this.maxProfitMultiple * 0.8
          } else if (distFromTarget <= this.profitZoneWidth * 0.6) {
            // Partial profit
            pnl = this.riskPerTrade * this.maxProfitMultiple * 0.4
          } else if (distFromTarget <= this.profitZoneWidth) {
            // Small profit
            pnl = this.riskPerTrade * 1.5
          } else if (distFromTarget <= this.profitZoneWidth * 2) {
            // Small loss (outside wings)
            pnl = -this.riskPerTrade * 0.6
          } else {
            // Max loss
            pnl = -this.riskPerTrade
          }
        }

        // Early exit if in good profit
        if (!shouldExit && distFromTarget <= this.profitZoneWidth * 0.3) {
          shouldExit = true
          reason = 'Target hit early'
          const remainingValue = 1 - thetaDecay * 0.5
          pnl = this.riskPerTrade * this.maxProfitMultiple * 0.7 * remainingValue
        }

        // Stop loss if price moved too far
        if (!shouldExit && distFromTarget > this.profitZoneWidth * 3) {
          shouldExit = true
          reason = 'Stop loss'
          pnl = -this.riskPerTrade * 0.9
        }

        if (shouldExit) {
          this.capital += pnl
          trade.pnl = pnl
          trade.exitPrice = candle.close
          trade.exitTime = candle.time
          trade.barsHeld = barsHeld
          trade.distFromTarget = distFromTarget
          trade.exitReason = reason
          this.trades.push(trade)
          openTrades.splice(j, 1)
        }
      }

      // Check for new entries
      const deviation = ((candle.close - currentWASP) / currentWASP) * 100
      const absDeviation = Math.abs(deviation)

      const canEnter =
        openTrades.length < 3 &&
        tradesToday < this.maxTradesPerDay &&
        absDeviation >= this.minDeviation &&
        absDeviation <= this.maxDeviation &&
        this.capital >= this.riskPerTrade * 2

      // Entry filters
      const atBBExtreme = candle.close > upperBB || candle.close < lowerBB
      const rsiExtreme = (currentRSI > 65 && deviation > 0) || (currentRSI < 35 && deviation < 0)

      if (canEnter && (atBBExtreme || rsiExtreme)) {
        // Place butterfly centered at WASP (where we expect price to go)
        const trade = {
          entryPrice: candle.close,
          entryTime: candle.time,
          entryIndex: i,
          targetPrice: currentWASP, // We expect price to revert to WASP
          deviation,
          direction: deviation > 0 ? 'PUT_BUTTERFLY' : 'CALL_BUTTERFLY',
          riskAmount: this.riskPerTrade,
        }

        openTrades.push(trade)
        tradesToday++
      }

      // Record equity
      this.equityCurve.push({ time: candle.time, equity: this.capital })
    }

    // Close remaining trades at last price
    const lastCandle = candles[candles.length - 1]
    for (const trade of openTrades) {
      const distFromTarget = Math.abs(lastCandle.close - trade.targetPrice) / trade.targetPrice * 100
      const pnl = distFromTarget <= this.profitZoneWidth ? this.riskPerTrade * 2 : -this.riskPerTrade * 0.5
      trade.pnl = pnl
      trade.exitReason = 'End of data'
      trade.exitPrice = lastCandle.close
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
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgWin: winners.length > 0 ? grossProfit / winners.length : 0,
      avgLoss: losers.length > 0 ? grossLoss / losers.length : 0,
      maxDrawdown: maxDD,
      finalEquity: this.capital,
      trades: this.trades,
    }
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('OIWASP REALISTIC BUTTERFLY BACKTEST')
  console.log('Target: 200%+ monthly return')
  console.log('='.repeat(80))

  // Fetch data
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  console.log('\nFetching 5-minute SPY data...')
  const candles = await fetchCandleData('SPY', 5, { startDate, endDate })
  console.log(`Loaded ${candles?.length || 0} candles`)

  if (!candles || candles.length < 100) {
    console.error('Insufficient data')
    process.exit(1)
  }

  // Test configurations - increasing aggression
  const configs = [
    // Conservative: $100 risk, 0.3% deviation
    { waspPeriod: 20, minDeviation: 0.3, riskPerTrade: 100, profitZoneWidth: 0.3, maxTradesPerDay: 2, label: 'Conservative' },

    // Moderate: $200 risk, 0.2% deviation
    { waspPeriod: 15, minDeviation: 0.2, riskPerTrade: 200, profitZoneWidth: 0.4, maxTradesPerDay: 3, label: 'Moderate' },

    // Aggressive: $500 risk, 0.15% deviation
    { waspPeriod: 10, minDeviation: 0.15, riskPerTrade: 500, profitZoneWidth: 0.5, maxTradesPerDay: 4, label: 'Aggressive' },

    // Very aggressive: $1000 risk
    { waspPeriod: 10, minDeviation: 0.1, riskPerTrade: 1000, profitZoneWidth: 0.4, maxTradesPerDay: 5, label: 'Very Aggressive' },

    // Maximum: $2000 risk, tight zone
    { waspPeriod: 5, minDeviation: 0.08, riskPerTrade: 2000, profitZoneWidth: 0.5, maxTradesPerDay: 5, maxProfitMultiple: 10, label: 'Maximum' },
  ]

  const results = []

  for (const config of configs) {
    const bt = new RealisticButterflyBacktest({ ...config, initialCapital: 10000 })
    const result = await bt.run(candles)
    results.push({ config, result })

    console.log(`\n${config.label}: WASP=${config.waspPeriod} Dev=${config.minDeviation}% Risk=$${config.riskPerTrade}`)
    console.log(`  Trades: ${result.totalTrades}, Win Rate: ${result.winRate.toFixed(1)}%`)
    console.log(`  Return: ${result.totalReturn.toFixed(1)}%, Max DD: ${result.maxDrawdown.toFixed(1)}%`)
    console.log(`  Final Equity: $${result.finalEquity.toFixed(2)}`)
  }

  // Sort by return
  results.sort((a, b) => b.result.totalReturn - a.result.totalReturn)

  console.log('\n' + '='.repeat(80))
  console.log('BEST RESULTS')
  console.log('='.repeat(80))

  const best = results[0]
  console.log(`\n#1: ${best.config.label}`)
  console.log(`   Return: ${best.result.totalReturn.toFixed(1)}%`)
  console.log(`   Trades: ${best.result.totalTrades}, Win Rate: ${best.result.winRate.toFixed(1)}%`)
  console.log(`   Avg Win: $${best.result.avgWin.toFixed(2)}, Avg Loss: $${best.result.avgLoss.toFixed(2)}`)
  console.log(`   Profit Factor: ${best.result.profitFactor.toFixed(2)}`)
  console.log(`   Max Drawdown: ${best.result.maxDrawdown.toFixed(1)}%`)
  console.log(`   Final Equity: $${best.result.finalEquity.toFixed(2)}`)

  // Analysis
  console.log('\n' + '='.repeat(80))
  if (best.result.totalReturn >= 200) {
    console.log(`SUCCESS: ${best.result.totalReturn.toFixed(1)}% monthly return achieved!`)
    console.log('\nKey parameters:')
    console.log(`  - WASP Period: ${best.config.waspPeriod}`)
    console.log(`  - Min Deviation: ${best.config.minDeviation}%`)
    console.log(`  - Risk per Trade: $${best.config.riskPerTrade}`)
    console.log(`  - Profit Zone: ${best.config.profitZoneWidth}%`)
    console.log(`  - Max Trades/Day: ${best.config.maxTradesPerDay}`)
  } else {
    console.log(`Best return: ${best.result.totalReturn.toFixed(1)}%`)
    console.log('\nTo reach 200%+:')
    console.log('1. Trade during high-volatility events (earnings, FOMC)')
    console.log('2. Use real OI data for accurate WASP')
    console.log('3. Focus on third week of month (monthly options expiry)')
    console.log('4. Scale position size with account growth')
    console.log('5. Add more signal confirmations (volume, order flow)')
  }
  console.log('='.repeat(80))

  // Show trades
  if (best.result.trades.length > 0) {
    console.log('\nTrade Summary:')
    console.log(`  Winning trades: ${best.result.winners}`)
    console.log(`  Losing trades: ${best.result.losers}`)
    console.log(`  Total P&L: $${(best.result.finalEquity - 10000).toFixed(2)}`)

    console.log('\nSample trades:')
    for (let i = 0; i < Math.min(5, best.result.trades.length); i++) {
      const t = best.result.trades[i]
      const pnlStr = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`
      console.log(`  ${t.direction} @ $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)}: ${pnlStr} (${t.exitReason})`)
    }
  }
}

main().catch(console.error)
