/**
 * Core module - shared business logic
 * Import from '@core' in Vite applications
 */

// Pattern detection
export { PatternDetector, PutPatternDetector } from './patterns/index.js'
export {
  calculateRSI,
  calculateBollingerBands,
  calculateEMA,
  calculateSMA,
  calculateMACD,
  calculateATR,
} from './patterns/index.js'

// Data fetching
export {
  fetchWithProxy,
  fetchSpotPrice,
  fetchOptionExpiries,
  fetchOptionsChain,
  fetchCandleData,
  generateDemoData,
} from './data/index.js'

// Utilities
export {
  TIMEFRAME_CONFIG,
  PATTERN_ICONS,
  SENSITIVITY_CONFIGS,
  CORS_PROXIES,
} from './utils/index.js'

export {
  formatNumber,
  formatPriceChange,
  formatPercentChange,
  formatTime,
  formatDateTime,
} from './utils/index.js'
