/**
 * Formatting utilities
 */

/**
 * Format a number with appropriate suffix (K, M)
 */
export function formatNumber(num, decimals = 0) {
  if (num === undefined || num === null) return '--'
  if (Math.abs(num) >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toFixed(decimals)
}

/**
 * Format price change with sign
 */
export function formatPriceChange(change, decimals = 2) {
  const formatted = Math.abs(change).toFixed(decimals)
  return change >= 0 ? `+${formatted}` : `-${formatted}`
}

/**
 * Format percentage change with sign
 */
export function formatPercentChange(percent, decimals = 2) {
  const formatted = Math.abs(percent).toFixed(decimals)
  return percent >= 0 ? `+${formatted}%` : `-${formatted}%`
}

/**
 * Format a timestamp to local time string
 */
export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString()
}

/**
 * Format a timestamp to local date/time string
 */
export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString()
}
