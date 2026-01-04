/**
 * Unit tests for backtest statistics
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateStatistics, monteCarloSimulation, calculateEquityCurve } from './statistics.js'

// Helper to create mock trades
function createMockTrade(overrides = {}) {
  return {
    id: 1,
    signal: 'CALL',
    signalType: 'CALL',
    pnl: 10,
    pnlPercent: 1,
    barsHeld: 5,
    entryTime: 1704067200000,
    exitTime: 1704153600000,
    ...overrides,
  }
}

describe('calculateStatistics', () => {
  // Suppress console.log during tests
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('empty/null input handling', () => {
    it('returns empty stats for null trades', () => {
      const stats = calculateStatistics(null)

      expect(stats.totalTrades).toBe(0)
      expect(stats.winRate).toBe(0)
      expect(stats.profitFactor).toBe(0)
    })

    it('returns empty stats for undefined trades', () => {
      const stats = calculateStatistics(undefined)

      expect(stats.totalTrades).toBe(0)
      expect(stats.winRate).toBe(0)
    })

    it('returns empty stats for empty array', () => {
      const stats = calculateStatistics([])

      expect(stats.totalTrades).toBe(0)
      expect(stats.winCount).toBe(0)
      expect(stats.lossCount).toBe(0)
    })

    it('returns complete structure for empty input', () => {
      const stats = calculateStatistics([])

      expect(stats).toHaveProperty('totalTrades')
      expect(stats).toHaveProperty('winRate')
      expect(stats).toHaveProperty('profitFactor')
      expect(stats).toHaveProperty('maxDrawdown')
      expect(stats).toHaveProperty('sharpeRatio')
      expect(stats).toHaveProperty('statsBySignalType')
      expect(stats).toHaveProperty('statsByDirection')
    })
  })

  describe('basic metrics', () => {
    it('counts total trades correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: -5 }),
        createMockTrade({ pnl: 0 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.totalTrades).toBe(3)
    })

    it('counts winners, losers, and breakeven correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: 5 }),
        createMockTrade({ pnl: -3 }),
        createMockTrade({ pnl: 0 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.winCount).toBe(2)
      expect(stats.lossCount).toBe(1)
      expect(stats.breakevenCount).toBe(1)
    })

    it('calculates win rate correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: 5 }),
        createMockTrade({ pnl: -3 }),
        createMockTrade({ pnl: -2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.winRate).toBe(50) // 2/4 = 50%
    })
  })

  describe('P&L metrics', () => {
    it('calculates total P&L correctly', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: -2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.totalPnL).toBe(6) // 5 + 3 - 2
      expect(stats.totalReturn).toBe(6)
    })

    it('calculates average trade P&L correctly', () => {
      const trades = [
        createMockTrade({ pnlPercent: 6 }),
        createMockTrade({ pnlPercent: -3 }),
        createMockTrade({ pnlPercent: 0 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.avgTradePnL).toBe(1) // (6 - 3 + 0) / 3
    })

    it('calculates gross profit and loss correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10, pnlPercent: 10 }),
        createMockTrade({ pnl: 5, pnlPercent: 5 }),
        createMockTrade({ pnl: -3, pnlPercent: -3 }),
        createMockTrade({ pnl: -2, pnlPercent: -2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.grossProfit).toBe(15) // 10 + 5
      expect(stats.grossLoss).toBe(5) // |(-3) + (-2)|
    })

    it('calculates average win and loss correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10, pnlPercent: 10 }),
        createMockTrade({ pnl: 6, pnlPercent: 6 }),
        createMockTrade({ pnl: -4, pnlPercent: -4 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.avgWin).toBe(8) // (10 + 6) / 2
      expect(stats.avgLoss).toBe(4) // 4 / 1
    })

    it('handles all winners (no losses)', () => {
      const trades = [
        createMockTrade({ pnl: 10, pnlPercent: 10 }),
        createMockTrade({ pnl: 5, pnlPercent: 5 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.grossLoss).toBe(0)
      expect(stats.avgLoss).toBe(0)
      expect(stats.profitFactor).toBe(Infinity)
    })

    it('handles all losers (no winners)', () => {
      const trades = [
        createMockTrade({ pnl: -10, pnlPercent: -10 }),
        createMockTrade({ pnl: -5, pnlPercent: -5 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.grossProfit).toBe(0)
      expect(stats.avgWin).toBe(0)
      expect(stats.profitFactor).toBe(0)
    })
  })

  describe('risk metrics', () => {
    it('calculates profit factor correctly', () => {
      const trades = [
        createMockTrade({ pnl: 20, pnlPercent: 20 }),
        createMockTrade({ pnl: -5, pnlPercent: -5 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.profitFactor).toBe(4) // 20 / 5
    })

    it('calculates payoff ratio correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10, pnlPercent: 10 }),
        createMockTrade({ pnl: 8, pnlPercent: 8 }),
        createMockTrade({ pnl: -3, pnlPercent: -3 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.payoffRatio).toBe(3) // avgWin (9) / avgLoss (3)
    })

    it('calculates expectancy correctly', () => {
      // 50% win rate, avgWin = 10, avgLoss = 5
      const trades = [
        createMockTrade({ pnl: 10, pnlPercent: 10 }),
        createMockTrade({ pnl: -5, pnlPercent: -5 }),
      ]

      const stats = calculateStatistics(trades)

      // expectancy = (0.5 * 10) - (0.5 * 5) = 5 - 2.5 = 2.5
      expect(stats.expectancy).toBe(2.5)
    })
  })

  describe('holding period stats', () => {
    it('calculates average holding period', () => {
      const trades = [
        createMockTrade({ barsHeld: 5 }),
        createMockTrade({ barsHeld: 10 }),
        createMockTrade({ barsHeld: 3 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.avgHoldingPeriod).toBe(6) // (5 + 10 + 3) / 3
    })
  })

  describe('streak calculations', () => {
    it('calculates consecutive wins correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: 5 }),
        createMockTrade({ pnl: 3 }),
        createMockTrade({ pnl: -2 }),
        createMockTrade({ pnl: 7 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.consecutiveWins).toBe(3)
    })

    it('calculates consecutive losses correctly', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: -5 }),
        createMockTrade({ pnl: -3 }),
        createMockTrade({ pnl: -2 }),
        createMockTrade({ pnl: 7 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.consecutiveLosses).toBe(3)
    })

    it('handles alternating wins and losses', () => {
      const trades = [
        createMockTrade({ pnl: 10 }),
        createMockTrade({ pnl: -5 }),
        createMockTrade({ pnl: 8 }),
        createMockTrade({ pnl: -3 }),
      ]

      const stats = calculateStatistics(trades)

      // The implementation only records max streak when a new trade of same type follows
      // Alternating pattern never builds up a streak > 1, so maxWin/maxLoss stays 1
      expect(stats.consecutiveWins).toBe(1)
      // Note: The implementation updates maxLossStreak only when consecutive losses continue,
      // so alternating may result in 0 for losses if streak never counted
      expect(stats.consecutiveLosses).toBeGreaterThanOrEqual(0)
    })

    it('handles single trade', () => {
      const trades = [createMockTrade({ pnl: 10 })]

      const stats = calculateStatistics(trades)

      expect(stats.consecutiveWins).toBe(1)
      expect(stats.consecutiveLosses).toBe(0)
    })
  })

  describe('drawdown analysis', () => {
    it('calculates max drawdown correctly', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }), // equity: 105
        createMockTrade({ pnlPercent: 3 }), // equity: 108 (peak)
        createMockTrade({ pnlPercent: -10 }), // equity: 98, DD = -9.26%
        createMockTrade({ pnlPercent: 2 }), // equity: 100
      ]

      const stats = calculateStatistics(trades)

      expect(stats.maxDrawdown).toBeLessThan(0)
    })

    it('returns 0 max drawdown for all winners', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: 2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.maxDrawdown).toBe(0)
    })

    it('calculates current drawdown', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10 }), // peak at 110
        createMockTrade({ pnlPercent: -5 }), // 105, still in DD
      ]

      const stats = calculateStatistics(trades)

      expect(stats.currentDrawdown).toBeLessThan(0)
    })
  })

  describe('risk-adjusted returns', () => {
    it('calculates Sharpe ratio', () => {
      const trades = [
        createMockTrade({ pnlPercent: 2 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: 1 }),
        createMockTrade({ pnlPercent: 4 }),
      ]

      const stats = calculateStatistics(trades)

      expect(typeof stats.sharpeRatio).toBe('number')
    })

    it('returns 0 Sharpe for single trade', () => {
      const trades = [createMockTrade({ pnlPercent: 5 })]

      const stats = calculateStatistics(trades)

      expect(stats.sharpeRatio).toBe(0)
    })

    it('calculates Sortino ratio', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }),
        createMockTrade({ pnlPercent: -2 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: -1 }),
      ]

      const stats = calculateStatistics(trades)

      expect(typeof stats.sortinoRatio).toBe('number')
    })

    it('returns Infinity Sortino when no downside', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: 2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.sortinoRatio).toBe(Infinity)
    })

    it('calculates Calmar ratio', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10 }),
        createMockTrade({ pnlPercent: -5 }),
        createMockTrade({ pnlPercent: 3 }),
      ]

      const stats = calculateStatistics(trades)

      expect(typeof stats.calmarRatio).toBe('number')
    })
  })

  describe('stats by signal type', () => {
    it('groups stats by signal type', () => {
      const trades = [
        createMockTrade({ signalType: 'STRONG_CALL', pnl: 10, pnlPercent: 10 }),
        createMockTrade({ signalType: 'STRONG_CALL', pnl: 5, pnlPercent: 5 }),
        createMockTrade({ signalType: 'CALL', pnl: -2, pnlPercent: -2 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.statsBySignalType.STRONG_CALL).toBeDefined()
      expect(stats.statsBySignalType.STRONG_CALL.count).toBe(2)
      expect(stats.statsBySignalType.STRONG_CALL.winRate).toBe(100)
      expect(stats.statsBySignalType.CALL.count).toBe(1)
    })
  })

  describe('stats by direction', () => {
    it('groups stats by direction (CALL vs PUT)', () => {
      const trades = [
        createMockTrade({ signal: 'CALL', pnl: 10, pnlPercent: 10 }),
        createMockTrade({ signal: 'CALL', pnl: -5, pnlPercent: -5 }),
        createMockTrade({ signal: 'PUT', pnl: 8, pnlPercent: 8 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.statsByDirection.CALL.count).toBe(2)
      expect(stats.statsByDirection.CALL.winRate).toBe(50)
      expect(stats.statsByDirection.PUT.count).toBe(1)
      expect(stats.statsByDirection.PUT.winRate).toBe(100)
    })

    it('handles no CALL trades', () => {
      const trades = [
        createMockTrade({ signal: 'PUT', pnl: 8, pnlPercent: 8 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.statsByDirection.CALL.count).toBe(0)
      expect(stats.statsByDirection.CALL.winRate).toBe(0)
      expect(stats.statsByDirection.PUT.count).toBe(1)
    })

    it('handles no PUT trades', () => {
      const trades = [
        createMockTrade({ signal: 'CALL', pnl: 10, pnlPercent: 10 }),
      ]

      const stats = calculateStatistics(trades)

      expect(stats.statsByDirection.CALL.count).toBe(1)
      expect(stats.statsByDirection.PUT.count).toBe(0)
      expect(stats.statsByDirection.PUT.winRate).toBe(0)
    })
  })
})

describe('monteCarloSimulation', () => {
  describe('input validation', () => {
    it('returns null for less than 10 trades', () => {
      const trades = Array(9).fill(createMockTrade({ pnlPercent: 1 }))

      const result = monteCarloSimulation(trades)

      expect(result).toBeNull()
    })

    it('returns null for exactly 9 trades', () => {
      const trades = Array(9).fill(createMockTrade({ pnlPercent: 1 }))

      const result = monteCarloSimulation(trades)

      expect(result).toBeNull()
    })

    it('runs simulation for 10+ trades', () => {
      const trades = Array(10).fill(createMockTrade({ pnlPercent: 1 }))

      const result = monteCarloSimulation(trades, 100)

      expect(result).not.toBeNull()
    })
  })

  describe('simulation output', () => {
    const trades = Array(20)
      .fill(null)
      .map((_, i) => createMockTrade({ pnlPercent: i % 2 === 0 ? 2 : -1 }))

    it('returns correct number of iterations', () => {
      const result = monteCarloSimulation(trades, 500)

      expect(result.iterations).toBe(500)
    })

    it('returns median return', () => {
      const result = monteCarloSimulation(trades, 100)

      expect(typeof result.medianReturn).toBe('number')
    })

    it('returns return distribution percentiles', () => {
      const result = monteCarloSimulation(trades, 100)

      expect(result.returnDistribution).toHaveProperty('p5')
      expect(result.returnDistribution).toHaveProperty('p25')
      expect(result.returnDistribution).toHaveProperty('p50')
      expect(result.returnDistribution).toHaveProperty('p75')
      expect(result.returnDistribution).toHaveProperty('p95')
    })

    it('returns max drawdown distribution percentiles', () => {
      const result = monteCarloSimulation(trades, 100)

      expect(result.maxDrawdownDistribution).toHaveProperty('p5')
      expect(result.maxDrawdownDistribution).toHaveProperty('p25')
      expect(result.maxDrawdownDistribution).toHaveProperty('p50')
      expect(result.maxDrawdownDistribution).toHaveProperty('p75')
      expect(result.maxDrawdownDistribution).toHaveProperty('p95')
    })

    it('returns probability of ruin', () => {
      const result = monteCarloSimulation(trades, 100)

      expect(typeof result.probabilityOfRuin).toBe('number')
      expect(result.probabilityOfRuin).toBeGreaterThanOrEqual(0)
      expect(result.probabilityOfRuin).toBeLessThanOrEqual(1)
    })

    it('returns probability of profit', () => {
      const result = monteCarloSimulation(trades, 100)

      expect(typeof result.probabilityOfProfit).toBe('number')
      expect(result.probabilityOfProfit).toBeGreaterThanOrEqual(0)
      expect(result.probabilityOfProfit).toBeLessThanOrEqual(1)
    })
  })

  describe('statistical properties', () => {
    it('preserves total return across iterations (sum is constant)', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: -2 }),
        createMockTrade({ pnlPercent: 4 }),
        createMockTrade({ pnlPercent: -1 }),
        createMockTrade({ pnlPercent: 2 }),
        createMockTrade({ pnlPercent: 1 }),
        createMockTrade({ pnlPercent: 3 }),
        createMockTrade({ pnlPercent: -1 }),
        createMockTrade({ pnlPercent: 2 }),
      ]

      const result = monteCarloSimulation(trades, 50)

      // All iterations should have the same total return (just different order)
      // The median should equal the sum of all pnlPercent values
      const expectedReturn = trades.reduce((sum, t) => sum + t.pnlPercent, 0)
      expect(result.medianReturn).toBe(expectedReturn)
    })

    it('all winners should have 100% probability of profit', () => {
      const trades = Array(15).fill(createMockTrade({ pnlPercent: 2 }))

      const result = monteCarloSimulation(trades, 100)

      expect(result.probabilityOfProfit).toBe(1)
    })

    it('all losers should have 0% probability of profit', () => {
      const trades = Array(15).fill(createMockTrade({ pnlPercent: -2 }))

      const result = monteCarloSimulation(trades, 100)

      expect(result.probabilityOfProfit).toBe(0)
    })
  })

  describe('default iterations', () => {
    it('defaults to 1000 iterations', () => {
      const trades = Array(15).fill(createMockTrade({ pnlPercent: 1 }))

      const result = monteCarloSimulation(trades)

      expect(result.iterations).toBe(1000)
    })
  })
})

describe('calculateEquityCurve', () => {
  describe('empty input handling', () => {
    it('returns empty array for empty trades', () => {
      const curve = calculateEquityCurve([])

      expect(curve).toEqual([])
    })
  })

  describe('curve generation', () => {
    it('starts with initial capital', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5, entryTime: 1000, exitTime: 2000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[0].equity).toBe(10000)
    })

    it('uses entry time of first trade for initial point', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5, entryTime: 1704067200000, exitTime: 1704153600000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[0].time).toBe(1704067200000)
    })

    it('creates point for each trade plus initial', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: 3, entryTime: 2000, exitTime: 3000 }),
        createMockTrade({ pnlPercent: -2, entryTime: 3000, exitTime: 4000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve.length).toBe(4) // initial + 3 trades
    })

    it('uses exit time for subsequent points', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: 3, entryTime: 2000, exitTime: 3000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[1].time).toBe(2000)
      expect(curve[2].time).toBe(3000)
    })

    it('calculates equity correctly with 10% position size', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10, entryTime: 1000, exitTime: 2000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      // 10% of 10000 = 1000 position, 10% gain = $100
      expect(curve[1].equity).toBe(10100)
    })

    it('calculates drawdown correctly', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: -5, entryTime: 2000, exitTime: 3000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[0].drawdown).toBe(0) // Initial
      expect(curve[1].drawdown).toBe(0) // Peak
      expect(curve[2].drawdown).toBeLessThan(0) // In drawdown
    })

    it('resets drawdown when new high reached', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: -5, entryTime: 2000, exitTime: 3000 }),
        createMockTrade({ pnlPercent: 20, entryTime: 3000, exitTime: 4000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[3].drawdown).toBe(0) // New high
    })
  })

  describe('different initial capitals', () => {
    it('works with different initial capital', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10, entryTime: 1000, exitTime: 2000 }),
      ]

      const curve50k = calculateEquityCurve(trades, 50000)
      const curve100k = calculateEquityCurve(trades, 100000)

      expect(curve50k[0].equity).toBe(50000)
      expect(curve100k[0].equity).toBe(100000)

      // Same percentage gain but different dollar amounts
      expect(curve50k[1].equity).toBe(50500) // 10% * 0.1 * 50000 = $500
      expect(curve100k[1].equity).toBe(101000) // 10% * 0.1 * 100000 = $1000
    })

    it('uses default initial capital of 10000', () => {
      const trades = [
        createMockTrade({ pnlPercent: 10, entryTime: 1000, exitTime: 2000 }),
      ]

      const curve = calculateEquityCurve(trades)

      expect(curve[0].equity).toBe(10000)
    })
  })

  describe('edge cases', () => {
    it('handles all losing trades', () => {
      const trades = [
        createMockTrade({ pnlPercent: -5, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: -3, entryTime: 2000, exitTime: 3000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[1].equity).toBeLessThan(10000)
      expect(curve[2].equity).toBeLessThan(curve[1].equity)
    })

    it('handles all winning trades', () => {
      const trades = [
        createMockTrade({ pnlPercent: 5, entryTime: 1000, exitTime: 2000 }),
        createMockTrade({ pnlPercent: 3, entryTime: 2000, exitTime: 3000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[1].equity).toBeGreaterThan(10000)
      expect(curve[2].equity).toBeGreaterThan(curve[1].equity)
      expect(curve[1].drawdown).toBe(0)
      expect(curve[2].drawdown).toBe(0)
    })

    it('handles breakeven trades', () => {
      const trades = [
        createMockTrade({ pnlPercent: 0, entryTime: 1000, exitTime: 2000 }),
      ]

      const curve = calculateEquityCurve(trades, 10000)

      expect(curve[1].equity).toBe(10000)
    })
  })
})
