/**
 * Target/Stop-Loss Exit Strategy
 * Exit when OPTION P&L hits profit target or stop loss
 *
 * NOTE: Uses trade.pnlPercent which is the OPTION P&L (via Black-Scholes),
 * not the underlying stock price movement. This is important because
 * options have inherent leverage (5-20x depending on delta).
 */

export class TargetStopExit {
  /**
   * @param {number} targetPercent - Option profit target as percentage (e.g., 20 = 20%)
   * @param {number} stopPercent - Option stop loss as percentage (e.g., 30 = 30%)
   * @param {number} maxBars - Maximum bars to hold (failsafe)
   * @param {boolean} useOptionPnL - Use option P&L (true) or underlying P&L (false)
   */
  constructor(targetPercent = 20, stopPercent = 30, maxBars = 50, useOptionPnL = true) {
    this.targetPercent = targetPercent
    this.stopPercent = stopPercent
    this.maxBars = maxBars
    this.useOptionPnL = useOptionPnL
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

    let pnlPercent

    if (this.useOptionPnL) {
      // Use the trade's actual OPTION P&L (updated by updateTrade via Black-Scholes)
      pnlPercent = trade.pnlPercent
    } else {
      // Legacy: use underlying price movement
      const direction = trade.signal === 'CALL' ? 1 : -1
      pnlPercent = ((candle.close - trade.entryPrice) / trade.entryPrice) * 100 * direction
    }

    // Check target hit
    if (pnlPercent >= this.targetPercent) {
      return {
        shouldExit: true,
        reason: `Target hit (+${pnlPercent.toFixed(1)}%)`,
      }
    }

    // Check stop loss hit
    if (pnlPercent <= -this.stopPercent) {
      return {
        shouldExit: true,
        reason: `Stop loss hit (${pnlPercent.toFixed(1)}%)`,
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
