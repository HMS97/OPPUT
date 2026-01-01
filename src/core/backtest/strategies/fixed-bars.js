/**
 * Fixed Bars Exit Strategy
 * Exit after holding for a fixed number of bars
 */

export class FixedBarsExit {
  /**
   * @param {number} bars - Number of bars to hold before exit
   */
  constructor(bars = 10) {
    this.bars = bars
    this.name = `Fixed ${bars} Bars`
  }

  /**
   * Check if trade should exit
   * @param {Object} trade - Current trade
   * @param {Object} candle - Current candle
   * @param {Array} signals - Current signals (unused)
   * @returns {{ shouldExit: boolean, reason: string }}
   */
  shouldExit(trade, candle, signals) {
    if (trade.barsHeld >= this.bars) {
      return {
        shouldExit: true,
        reason: `Fixed ${this.bars} bars`,
      }
    }
    return { shouldExit: false, reason: null }
  }

  /**
   * Get strategy configuration
   * @returns {Object}
   */
  getConfig() {
    return {
      type: 'fixed-bars',
      bars: this.bars,
    }
  }
}
