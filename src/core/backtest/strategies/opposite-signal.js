/**
 * Opposite Signal Exit Strategy
 * Exit when an opposite signal appears
 */

export class OppositeSignalExit {
  /**
   * @param {number} minStrength - Minimum signal strength to trigger exit (0-100)
   * @param {number} maxBars - Maximum bars to hold (failsafe)
   */
  constructor(minStrength = 50, maxBars = 50) {
    this.minStrength = minStrength
    this.maxBars = maxBars
    this.name = `Opposite Signal (>${minStrength}%)`
  }

  /**
   * Check if trade should exit
   * @param {Object} trade - Current trade
   * @param {Object} candle - Current candle
   * @param {Object|null} currentSignal - Current signal summary
   * @returns {{ shouldExit: boolean, reason: string }}
   */
  shouldExit(trade, candle, currentSignal) {
    // Failsafe: exit after max bars
    if (trade.barsHeld >= this.maxBars) {
      return {
        shouldExit: true,
        reason: `Max bars (${this.maxBars})`,
      }
    }

    // Check for opposite signal
    if (!currentSignal || currentSignal.strength < this.minStrength) {
      return { shouldExit: false, reason: null }
    }

    const tradeDirection = trade.signal // CALL or PUT
    const signalDirection = currentSignal.direction // CALL, PUT, or NEUTRAL

    // Exit CALL when PUT signal appears (and vice versa)
    if (tradeDirection === 'CALL' && signalDirection === 'PUT') {
      return {
        shouldExit: true,
        reason: `Opposite PUT signal (${currentSignal.strength.toFixed(0)}%)`,
      }
    }

    if (tradeDirection === 'PUT' && signalDirection === 'CALL') {
      return {
        shouldExit: true,
        reason: `Opposite CALL signal (${currentSignal.strength.toFixed(0)}%)`,
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
      type: 'opposite-signal',
      minStrength: this.minStrength,
      maxBars: this.maxBars,
    }
  }
}
