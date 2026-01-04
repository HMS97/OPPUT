/**
 * Backtest Engine
 * Generic backtesting framework for signal testing
 */

import { createTrade, updateTrade, closeTrade, resetTradeIdCounter } from './trade.js'

/**
 * @typedef {Object} BacktestConfig
 * @property {Object} signalSource - Signal source instance
 * @property {Object} exitStrategy - Exit strategy instance
 * @property {Array} candles - Historical candle data
 * @property {number} initialCapital - Starting capital
 * @property {number|string} positionSize - Fixed $ or 'percent'
 * @property {number} positionPercent - % of capital per trade (if positionSize='percent')
 * @property {number} maxConcurrentTrades - Max open trades (1 = no overlapping)
 * @property {boolean} allowReversal - Allow reversing position on opposite signal
 */

export class BacktestEngine {
  constructor(config) {
    this.signalSource = config.signalSource
    this.exitStrategy = config.exitStrategy
    this.candles = config.candles || []
    this.initialCapital = config.initialCapital ?? 10000
    this.positionSize = config.positionSize ?? 'percent'
    this.positionPercent = config.positionPercent ?? 10
    this.maxConcurrentTrades = config.maxConcurrentTrades ?? 1
    this.allowReversal = config.allowReversal ?? false
    this.timeframe = config.timeframe ?? 5  // Candle timeframe in minutes (for option time decay)

    // State
    this.equity = this.initialCapital
    this.openTrades = []
    this.closedTrades = []
    this.equityCurve = []
    this.signals = []

    // Callbacks
    this.onTradeCallback = null
    this.onSignalCallback = null
    this.onProgressCallback = null

    // Reset trade counter
    resetTradeIdCounter()
  }

  /**
   * Run full backtest
   * @returns {Promise<Object>} - Backtest results
   */
  async run() {
    if (this.candles.length < 50) {
      throw new Error('Not enough candle data (minimum 50 required)')
    }

    const startTime = Date.now()

    // Reset state
    this.equity = this.initialCapital
    this.openTrades = []
    this.closedTrades = []
    this.equityCurve = []
    this.signals = []
    this.bankruptAt = null  // Track bankruptcy point
    resetTradeIdCounter()

    // Record initial equity
    this.equityCurve.push({
      time: this.candles[0].time,
      equity: this.equity,
      drawdown: 0,
    })

    // Process each candle
    for (let i = 0; i < this.candles.length; i++) {
      // BANKRUPTCY CHECK: Stop trading if equity drops to 0 or below
      if (this.equity <= 0) {
        this.bankruptAt = i
        console.log(`[Backtest] BANKRUPTCY at candle ${i} - equity depleted`)
        break
      }

      await this.processCandle(i)

      // Report progress
      if (this.onProgressCallback && i % 50 === 0) {
        this.onProgressCallback((i / this.candles.length) * 100)
      }
    }

    // Close any remaining open trades at end
    const lastCandle = this.candles[this.candles.length - 1]
    const lastIndex = this.candles.length - 1
    for (const trade of [...this.openTrades]) {
      const closed = closeTrade(trade, lastCandle, lastIndex, 'End of data', this.timeframe)
      this.closedTrades.push(closed)
      this.equity += this.calculateTradePnL(closed)
      if (this.onTradeCallback) {
        this.onTradeCallback({ type: 'close', trade: closed })
      }
    }
    this.openTrades = []

    // Final equity curve point
    this.recordEquity(lastCandle.time)

    // Final progress
    if (this.onProgressCallback) {
      this.onProgressCallback(100)
    }

    return {
      trades: this.closedTrades,
      signals: this.signals,
      equityCurve: this.equityCurve,
      config: this.getConfig(),
      runtime: Date.now() - startTime,
      candleCount: this.candles.length,
      dateRange: {
        start: new Date(this.candles[0].time),
        end: new Date(this.candles[this.candles.length - 1].time),
      },
    }
  }

  /**
   * Process a single candle
   * @param {number} index - Candle index
   */
  async processCandle(index) {
    const candle = this.candles[index]

    // 1. Update open trades (pass timeframe for option time decay)
    for (const trade of this.openTrades) {
      updateTrade(trade, candle, this.timeframe)
    }

    // 2. Check exits for open trades
    await this.checkExits(index)

    // 3. Check for new signal
    const signal = this.signalSource.analyze(this.candles, index)

    if (signal) {
      this.signals.push({ ...signal, index })
      if (this.onSignalCallback) {
        this.onSignalCallback(signal)
      }

      // 4. Open new trade if conditions met
      await this.checkEntry(signal, index)
    }

    // 5. Record equity
    this.recordEquity(candle.time)
  }

  /**
   * Check exit conditions for open trades
   * @param {number} index - Current candle index
   */
  async checkExits(index) {
    const candle = this.candles[index]

    // Get current signal for opposite-signal strategy
    let currentSignal = null
    if (this.exitStrategy.constructor.name === 'OppositeSignalExit') {
      currentSignal = this.signalSource.analyze(this.candles, index)
    }

    const tradesToClose = []

    for (const trade of this.openTrades) {
      const exitResult = this.exitStrategy.shouldExit(trade, candle, currentSignal)

      if (exitResult.shouldExit) {
        const closed = closeTrade(trade, candle, index, exitResult.reason, this.timeframe)

        // If exit strategy provides custom P&L (e.g., butterfly payoff), use it directly
        if (exitResult.butterflyPnL !== undefined) {
          // butterflyPnL is a multiplier of risk (e.g., 6.4 = 6.4x profit, -1 = max loss)
          // Convert to percentage based on position size
          const riskPercent = this.positionPercent || 10
          closed.pnlPercent = exitResult.butterflyPnL * riskPercent
          closed.pnl = (closed.pnlPercent / 100) * this.initialCapital
          closed.exitReason = `${exitResult.reason} (${exitResult.butterflyPnL >= 0 ? '+' : ''}${exitResult.butterflyPnL.toFixed(1)}x)`
          // Use the pre-calculated pnl directly (don't recalculate)
          this.equity += closed.pnl
        } else {
          // Standard P&L calculation for other exit strategies
          this.equity += this.calculateTradePnL(closed)
        }

        tradesToClose.push(closed)

        if (this.onTradeCallback) {
          this.onTradeCallback({ type: 'close', trade: closed })
        }
      }
    }

    // Remove closed trades from open list
    this.openTrades = this.openTrades.filter((t) => !tradesToClose.includes(t))
    this.closedTrades.push(...tradesToClose)
  }

  /**
   * Check if we should enter a new trade
   * @param {Object} signal - Signal to evaluate
   * @param {number} index - Candle index
   */
  async checkEntry(signal, index) {
    // Check if we have room for new trades
    if (this.openTrades.length >= this.maxConcurrentTrades) {
      // Check for reversal
      if (this.allowReversal && this.openTrades.length === 1) {
        const currentTrade = this.openTrades[0]
        if (currentTrade.signal !== signal.direction) {
          // Close current and reverse
          const candle = this.candles[index]
          const closed = closeTrade(currentTrade, candle, index, 'Reversal', this.timeframe)
          this.closedTrades.push(closed)
          this.equity += this.calculateTradePnL(closed)
          this.openTrades = []

          if (this.onTradeCallback) {
            this.onTradeCallback({ type: 'close', trade: closed })
          }
        } else {
          return // Same direction, skip
        }
      } else {
        return // Max trades reached
      }
    }

    // Create new trade with calculated contracts based on position sizing
    const candle = this.candles[index]

    // Calculate position value
    let positionValue
    if (this.positionSize === 'percent') {
      positionValue = (this.equity * this.positionPercent) / 100
    } else {
      positionValue = this.positionSize
    }

    // Add contracts calculation to signal (will be used by createTrade)
    // Contracts will be calculated after we know the option price
    signal.positionValue = positionValue

    const trade = createTrade(signal, candle, index)

    // Calculate contracts based on option price
    // Each contract = 100 shares, so cost = optionPrice * 100
    const contractCost = trade.optionEntryPrice * 100
    const calculatedContracts = Math.floor(positionValue / contractCost)
    trade.contracts = Math.max(1, calculatedContracts)  // Minimum 1 contract
    trade.positionValue = positionValue

    this.openTrades.push(trade)

    if (this.onTradeCallback) {
      this.onTradeCallback({ type: 'open', trade })
    }
  }

  /**
   * Calculate P&L for a closed trade in dollar terms
   * Uses actual contracts if available, otherwise falls back to percentage-based
   * @param {Object} trade - Closed trade
   * @returns {number} - Dollar P&L
   */
  calculateTradePnL(trade) {
    // If trade has contracts and option prices, use actual dollar P&L
    if (trade.contracts && trade.optionEntryPrice && trade.optionExitPrice !== null) {
      // P&L = (exit price - entry price) * 100 shares * contracts
      return (trade.optionExitPrice - trade.optionEntryPrice) * 100 * trade.contracts
    }

    // Fallback to percentage-based calculation
    let tradeSize
    if (this.positionSize === 'percent') {
      tradeSize = (this.initialCapital * this.positionPercent) / 100
    } else {
      tradeSize = this.positionSize
    }

    // P&L = (price move %) * position size
    return (trade.pnlPercent / 100) * tradeSize
  }

  /**
   * Record current equity to curve
   * @param {number} time - Timestamp
   */
  recordEquity(time) {
    // Calculate unrealized P&L
    let unrealizedPnL = 0
    for (const trade of this.openTrades) {
      unrealizedPnL += this.calculateTradePnL(trade)
    }

    const currentEquity = this.equity + unrealizedPnL

    // Calculate drawdown from peak
    const peakEquity = Math.max(...this.equityCurve.map((e) => e.equity), currentEquity)
    const drawdown = ((currentEquity - peakEquity) / peakEquity) * 100

    this.equityCurve.push({
      time,
      equity: currentEquity,
      drawdown,
    })
  }

  /**
   * Get configuration summary
   * @returns {Object}
   */
  getConfig() {
    return {
      signalSource: this.signalSource.getConfig(),
      exitStrategy: this.exitStrategy.getConfig(),
      initialCapital: this.initialCapital,
      positionSize: this.positionSize,
      positionPercent: this.positionPercent,
      maxConcurrentTrades: this.maxConcurrentTrades,
      allowReversal: this.allowReversal,
    }
  }

  // Event handlers
  onTrade(callback) {
    this.onTradeCallback = callback
  }

  onSignal(callback) {
    this.onSignalCallback = callback
  }

  onProgress(callback) {
    this.onProgressCallback = callback
  }
}
