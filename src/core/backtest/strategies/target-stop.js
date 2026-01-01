/**
 * Target/Stop-Loss Exit Strategy
 * Exit when price hits profit target or stop loss
 */

export class TargetStopExit {
  /**
   * @param {number} targetPercent - Profit target as percentage (e.g., 1 = 1%)
   * @param {number} stopPercent - Stop loss as percentage (e.g., 0.5 = 0.5%)
   * @param {number} maxBars - Maximum bars to hold (failsafe)
   */
  constructor(targetPercent = 1.0, stopPercent = 0.5, maxBars = 50) {
    this.targetPercent = targetPercent
    this.stopPercent = stopPercent
    this.maxBars = maxBars
    this.name = `Target ${targetPercent}% / Stop ${stopPercent}%`
  }

  /**
   * Check if trade should exit
   * @param {Object} trade - Current trade
   * @param {Object} candle - Current candle
   * @param {Array} signals - Current signals (unused)
   * @returns {{ shouldExit: boolean, reason: string }}
   */
  shouldExit(trade, candle, signals) {
    // Failsafe: exit after max bars
    if (trade.barsHeld >= this.maxBars) {
      return {
        shouldExit: true,
        reason: `Max bars (${this.maxBars})`,
      }
    }

    // Calculate current P&L percentage
    const direction = trade.signal === 'CALL' ? 1 : -1
    const pnlPercent = ((candle.close - trade.entryPrice) / trade.entryPrice) * 100 * direction

    // Check target hit
    if (pnlPercent >= this.targetPercent) {
      return {
        shouldExit: true,
        reason: `Target hit (+${pnlPercent.toFixed(2)}%)`,
      }
    }

    // Check stop loss hit
    if (pnlPercent <= -this.stopPercent) {
      return {
        shouldExit: true,
        reason: `Stop loss hit (${pnlPercent.toFixed(2)}%)`,
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
      type: 'target-stop',
      targetPercent: this.targetPercent,
      stopPercent: this.stopPercent,
      maxBars: this.maxBars,
    }
  }
}
