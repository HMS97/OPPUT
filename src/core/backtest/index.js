/**
 * Backtest Module Exports
 */

// Core engine
export { BacktestEngine } from './engine.js'

// Trade utilities
export {
  createTrade,
  updateTrade,
  closeTrade,
  getMaxAdverseExcursion,
  getMaxFavorableExcursion,
  resetTradeIdCounter,
} from './trade.js'

// Statistics
export { calculateStatistics, monteCarloSimulation, calculateEquityCurve } from './statistics.js'

// Option Pricing
export {
  blackScholesPrice,
  blackScholesDelta,
  calculateOptionPrice,
  calculateOptionPnL,
  estimateIV,
} from './option-pricing.js'

// Exit strategies
export { FixedBarsExit } from './strategies/fixed-bars.js'
export { OppositeSignalExit } from './strategies/opposite-signal.js'
export { TargetStopExit } from './strategies/target-stop.js'
export { ButterflyExit } from './strategies/butterfly-exit.js'

// Signal sources
export { PatternDetectorSource } from './sources/pattern-adapter.js'
export { DailySignalSource } from './sources/daily-signal-adapter.js'
export { OISignalSource } from './sources/oi-adapter.js'
export { IVSignalSource } from './sources/iv-adapter.js'
export { OITrendSource } from './sources/oi-trend.js'
export { OIMultiTFSource } from './sources/oi-multi-tf.js'
export { OIHybridSource } from './sources/oi-hybrid.js'
export { TwitterFollowSource, SimulatedTwitterFollowSource } from './sources/twitter-follow.js'
export { SettlementDaySource } from './sources/settlement-day.js'
