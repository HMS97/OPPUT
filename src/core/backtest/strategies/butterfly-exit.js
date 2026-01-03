/**
 * Butterfly Spread Exit Strategy with Proper Options Pricing
 *
 * Uses Black-Scholes model for accurate mid-trade P&L calculation
 * Accounts for theta decay, gamma risk, and distance from center strike
 * Auto-scales hold period based on timeframe
 */

/**
 * Calculate bars per trading day for a given timeframe
 */
function getBarsPerDay(timeframe) {
  const tradingMinutesPerDay = 390 // 6.5 hours * 60 minutes
  return Math.floor(tradingMinutesPerDay / timeframe)
}

export class ButterflyExit {
  constructor(config = {}) {
    this.timeframe = config.timeframe ?? 5  // Candle timeframe in minutes
    this.wingWidth = config.wingWidth ?? 5  // Points from center to wing

    // Calculate hold period based on timeframe (target: ~1 trading day)
    const barsPerDay = getBarsPerDay(this.timeframe)
    this.holdPeriodBars = config.holdPeriodBars ?? barsPerDay

    this.riskFreeRate = config.riskFreeRate ?? 0.05
    this.impliedVol = config.impliedVol ?? 0.20  // 20% IV default
    this.barsPerHour = 60 / this.timeframe  // Auto-calculate from timeframe
    this.tradingHoursPerDay = config.tradingHoursPerDay ?? 6.5
    this.name = 'Butterfly (Black-Scholes)'

    console.log(`[Butterfly] Timeframe: ${this.timeframe}m, Hold Period: ${this.holdPeriodBars} bars (~1 day), Bars/Hour: ${this.barsPerHour}`)
  }

  /**
   * Check if trade should exit and calculate proper butterfly P&L
   */
  shouldExit(trade, candle, currentSignal) {
    const timeRatio = trade.barsHeld / this.holdPeriodBars

    // Calculate proper butterfly P&L
    const pnlResult = this.calculateButterflyPnL(trade, candle, timeRatio)

    // Exit conditions
    if (trade.barsHeld >= this.holdPeriodBars) {
      return {
        shouldExit: true,
        reason: 'Expiry',
        butterflyPnL: pnlResult.pnlMultiple,
      }
    }

    // Early profit exit: >50% of max profit captured
    if (pnlResult.pnlMultiple >= 4) {
      return {
        shouldExit: true,
        reason: 'Target hit early',
        butterflyPnL: pnlResult.pnlMultiple,
      }
    }

    // Stop loss: >70% of premium lost
    if (pnlResult.pnlMultiple <= -0.7) {
      return {
        shouldExit: true,
        reason: 'Stop loss',
        butterflyPnL: pnlResult.pnlMultiple,
      }
    }

    return { shouldExit: false, reason: null }
  }

  /**
   * Calculate butterfly P&L using proper options pricing
   */
  calculateButterflyPnL(trade, candle, timeRatio) {
    const entryPrice = trade.entryPrice
    const currentPrice = candle.close
    const direction = trade.signal  // 'CALL' or 'PUT'

    // MEAN REVERSION: Target is BACK to where price came from (WASP)
    // Entry deviation from metadata tells us how far from WASP we entered
    const deviation = parseFloat(trade.metadata?.deviation || '0.2') / 100

    // For CALL: price was BELOW WASP, target is UP to WASP (entry + deviation)
    // For PUT: price was ABOVE WASP, target is DOWN to WASP (entry - deviation)
    const centerStrike = direction === 'CALL'
      ? entryPrice * (1 + deviation)  // Target: revert UP to WASP
      : entryPrice * (1 - deviation)  // Target: revert DOWN to WASP

    const K1 = centerStrike - this.wingWidth
    const K2 = centerStrike
    const K3 = centerStrike + this.wingWidth

    // Net debit = max loss (typically ~$0.55 per spread for $5 wide)
    const netDebit = this.wingWidth * 0.11  // ~11% of wing width

    // Calculate time remaining
    const timeRemaining = Math.max(0.0001, (1 - timeRatio) / 252)  // In years

    // Calculate butterfly value at current price and time
    const currentValue = this.butterflyValue(
      currentPrice, K1, K2, K3, timeRemaining, this.impliedVol, direction.toLowerCase()
    )

    // P&L as multiple of net debit (risk)
    // +8 means 8x profit, -1 means max loss
    const pnlDollars = currentValue - netDebit
    const pnlMultiple = pnlDollars / netDebit

    return {
      currentValue,
      netDebit,
      pnlDollars,
      pnlMultiple,
      distanceFromCenter: Math.abs(currentPrice - centerStrike) / centerStrike * 100,
      timeRemaining: timeRemaining * 252  // In days
    }
  }

  /**
   * Calculate butterfly spread value using Black-Scholes
   */
  butterflyValue(S, K1, K2, K3, T, sigma, optionType) {
    // At expiration, use intrinsic value
    if (T <= 0.0001) {
      return this.expirationPayoff(S, K1, K2, K3)
    }

    // Calculate each leg
    const leg1 = this.blackScholes(S, K1, T, sigma, optionType)
    const leg2 = this.blackScholes(S, K2, T, sigma, optionType)
    const leg3 = this.blackScholes(S, K3, T, sigma, optionType)

    return leg1 - 2 * leg2 + leg3
  }

  /**
   * Butterfly payoff at expiration
   */
  expirationPayoff(S, K1, K2, K3) {
    if (S <= K1) return 0
    if (S >= K3) return 0
    if (S <= K2) return S - K1
    return K3 - S
  }

  /**
   * Black-Scholes option pricing
   */
  blackScholes(S, K, T, sigma, optionType = 'call') {
    if (T <= 0) {
      return optionType === 'call'
        ? Math.max(0, S - K)
        : Math.max(0, K - S)
    }

    const r = this.riskFreeRate
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
    const d2 = d1 - sigma * Math.sqrt(T)

    if (optionType === 'call') {
      return S * this.normCDF(d1) - K * Math.exp(-r * T) * this.normCDF(d2)
    } else {
      return K * Math.exp(-r * T) * this.normCDF(-d2) - S * this.normCDF(-d1)
    }
  }

  /**
   * Standard normal CDF approximation
   */
  normCDF(x) {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x)
    const t = 1.0 / (1.0 + p * x)
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)

    return 0.5 * (1.0 + sign * y)
  }

  getConfig() {
    return {
      type: 'butterfly',
      wingWidth: this.wingWidth,
      holdPeriodBars: this.holdPeriodBars,
      impliedVol: this.impliedVol,
    }
  }
}
