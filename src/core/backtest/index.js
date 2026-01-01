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

// Exit strategies
export { FixedBarsExit } from './strategies/fixed-bars.js'
export { OppositeSignalExit } from './strategies/opposite-signal.js'
export { TargetStopExit } from './strategies/target-stop.js'

// Signal sources
export { PatternDetectorSource } from './sources/pattern-adapter.js'
export { DailySignalSource } from './sources/daily-signal-adapter.js'
export { OISignalSource } from './sources/oi-adapter.js'
