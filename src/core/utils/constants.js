/**
 * Shared constants for the OPPUT dashboard
 */

export const TIMEFRAME_CONFIG = {
  5: { id: '5m', name: '5 Min', interval: '5' },
  15: { id: '15m', name: '15 Min', interval: '15' },
  60: { id: '1h', name: '1 Hour', interval: '60' },
  240: { id: '4h', name: '4 Hour', interval: '240' },
}

export const PATTERN_ICONS = {
  // Price action patterns
  LOWER_HIGH: '📉',
  HIGHER_LOW: '📈',
  REJECTION_AT_RESISTANCE: '🛑',
  REJECTION_AT_SUPPORT: '🟢',
  FALSE_BREAKOUT: '💥',
  FALSE_BREAKOUT_DOWN: '💫',
  ABSORPTION: '🔄',
  ABSORPTION_BUYING: '🔃',
  DOUBLE_REJECTION: '⚡',
  DOUBLE_REJECTION_BOTTOM: '⚡',
  PRICE_STALLING: '⏸️',
  PRICE_STALLING_LOW: '⏸️',
  // Indicator patterns
  RSI_OVERBOUGHT: '🔺',
  RSI_OVERSOLD: '🔻',
  RSI_BEARISH_DIVERGENCE: '↘️',
  RSI_BULLISH_DIVERGENCE: '↗️',
  BB_UPPER_TOUCH: '📊',
  BB_LOWER_TOUCH: '📊',
  BB_SQUEEZE_BULLISH: '🎯',
  BB_SQUEEZE_BEARISH: '🎯',
  EMA_BULLISH_CROSS: '✖️',
  EMA_BEARISH_CROSS: '✖️',
  EMA_OVEREXTENDED_UP: '⬆️',
  EMA_OVEREXTENDED_DOWN: '⬇️',
  MACD_BULLISH_CROSS: '〽️',
  MACD_BEARISH_CROSS: '〽️',
  MACD_HIST_BULLISH: '📶',
  MACD_HIST_BEARISH: '📶',
  VOLUME_SPIKE_BULLISH: '📢',
  VOLUME_SPIKE_BEARISH: '📢',
}

export const SENSITIVITY_CONFIGS = {
  low: {
    rejectionThreshold: 0.003,
    consolidationBars: 5,
    lowerHighTolerance: 0.0015,
    higherLowTolerance: 0.0015,
  },
  medium: {
    rejectionThreshold: 0.002,
    consolidationBars: 3,
    lowerHighTolerance: 0.001,
    higherLowTolerance: 0.001,
  },
  high: {
    rejectionThreshold: 0.001,
    consolidationBars: 2,
    lowerHighTolerance: 0.0005,
    higherLowTolerance: 0.0005,
  },
}

export const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://proxy.cors.sh/${u}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
]
