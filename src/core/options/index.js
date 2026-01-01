/**
 * Options Analysis Module Exports
 */

export {
  calculateOIWASP,
  calculateMaxPain,
  calculateGEX,
  calculateDeviation,
  getOIDistribution,
  checkMonthlyOpEx,
  generateTradeSuggestions,
  analyzeOptionsOI,
  VIX_THRESHOLDS,
  STRATEGY_PARAMS,
  getVIXRegime,
  checkTradeConditions,
} from './oi-analysis.js'

// Daily Signal Analyzer - produces 3-4 signals/day
export {
  DailySignalAnalyzer,
  SIGNAL_TYPES,
} from './dailySignal.js'

// Backtesting
export {
  runBacktest,
  formatBacktestReport,
  quickBacktest,
} from './backtest.js'

// Paper Trading
export {
  TRADE_STATUS,
  getPaperTrades,
  createPaperTrade,
  closePaperTrade,
  expirePaperTrade,
  getOpenPaperTrades,
  getClosedPaperTrades,
  deletePaperTrade,
  clearPaperTrades,
  getPaperTradeStats,
  exportPaperTradesToCSV,
} from './paper-trade.js'
