/**
 * Risk Manager - Enforces trading limits and circuit breakers
 * Conservative defaults for automated trading safety
 */

// Conservative limits (user-selected)
const DEFAULT_LIMITS = {
  maxDailyTrades: 3,          // Max trades per day
  maxPositionSize: 500,       // Max $ per trade
  maxDailyLoss: 300,          // Stop trading after this loss
  maxConcurrentPositions: 1,  // One position at a time
  minStrengthThreshold: 60,   // Only trade signals >= 60% strength
  tradingHours: {
    start: '09:30',           // Market open ET
    end: '16:00'              // Market close ET
  },
  timezone: 'America/New_York'
};

export class RiskManager {
  constructor(config = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...config.limits };
    this.state = {
      dailyTrades: 0,
      dailyPnL: 0,
      currentPositions: 0,
      lastTradeDate: null,
      trades: [],
      circuitBreakerTripped: false
    };
    this.onLimitHit = config.onLimitHit || null;
  }

  /**
   * Validate if an order is allowed
   * @returns {{ approved: boolean, reason?: string }}
   */
  async validateOrder({ symbol, direction, strength, estimatedCost }) {
    // Reset daily counters if new day
    this.checkDayRollover();

    // Check circuit breaker
    if (this.state.circuitBreakerTripped) {
      return this.reject('Circuit breaker tripped - trading halted for today');
    }

    // Check trading hours
    if (!this.isWithinTradingHours()) {
      return this.reject('Outside trading hours (9:30 AM - 4:00 PM ET)');
    }

    // Check daily trade limit
    if (this.state.dailyTrades >= this.limits.maxDailyTrades) {
      return this.reject(`Daily trade limit reached (${this.limits.maxDailyTrades})`);
    }

    // Check concurrent positions
    if (this.state.currentPositions >= this.limits.maxConcurrentPositions) {
      return this.reject(`Max concurrent positions reached (${this.limits.maxConcurrentPositions})`);
    }

    // Check position size
    if (estimatedCost > this.limits.maxPositionSize) {
      return this.reject(
        `Position size $${estimatedCost.toFixed(2)} exceeds limit $${this.limits.maxPositionSize}`
      );
    }

    // Check signal strength
    if (strength < this.limits.minStrengthThreshold) {
      return this.reject(
        `Signal strength ${strength}% below threshold ${this.limits.minStrengthThreshold}%`
      );
    }

    // Check daily loss limit
    if (this.state.dailyPnL <= -this.limits.maxDailyLoss) {
      this.tripCircuitBreaker('Daily loss limit reached');
      return this.reject(`Daily loss limit reached ($${this.limits.maxDailyLoss})`);
    }

    return { approved: true };
  }

  /**
   * Record a trade for tracking
   */
  async recordTrade(trade) {
    this.checkDayRollover();

    this.state.dailyTrades++;
    this.state.currentPositions++;
    this.state.lastTradeDate = this.getTodayET();
    this.state.trades.push({
      ...trade,
      timestamp: new Date().toISOString(),
      pnl: null // Will be updated when position closes
    });

    console.log(`[RiskManager] Trade recorded: ${this.state.dailyTrades}/${this.limits.maxDailyTrades} daily trades`);
  }

  /**
   * Record position close and P&L
   */
  async recordClose(tradeId, pnl) {
    this.state.currentPositions = Math.max(0, this.state.currentPositions - 1);
    this.state.dailyPnL += pnl;

    // Update trade record
    const trade = this.state.trades.find(t => t.order_id === tradeId);
    if (trade) {
      trade.pnl = pnl;
      trade.closedAt = new Date().toISOString();
    }

    console.log(`[RiskManager] Position closed. Daily P&L: $${this.state.dailyPnL.toFixed(2)}`);

    // Check if we should trip circuit breaker
    if (this.state.dailyPnL <= -this.limits.maxDailyLoss) {
      this.tripCircuitBreaker('Daily loss limit reached');
    }
  }

  /**
   * Trip the circuit breaker
   */
  tripCircuitBreaker(reason) {
    this.state.circuitBreakerTripped = true;
    console.log(`[RiskManager] CIRCUIT BREAKER TRIPPED: ${reason}`);

    if (this.onLimitHit) {
      this.onLimitHit({ type: 'circuit_breaker', reason });
    }
  }

  /**
   * Reset circuit breaker (manual override)
   */
  resetCircuitBreaker() {
    this.state.circuitBreakerTripped = false;
    console.log('[RiskManager] Circuit breaker reset');
  }

  /**
   * Check if we should reset daily counters
   */
  checkDayRollover() {
    const today = this.getTodayET();

    if (this.state.lastTradeDate !== today) {
      console.log('[RiskManager] New trading day - resetting counters');
      this.state.dailyTrades = 0;
      this.state.dailyPnL = 0;
      this.state.circuitBreakerTripped = false;
      this.state.lastTradeDate = today;
    }
  }

  /**
   * Check if current time is within trading hours
   */
  isWithinTradingHours() {
    const now = new Date();
    const etTime = new Intl.DateTimeFormat('en-US', {
      timeZone: this.limits.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    const [hours, minutes] = etTime.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;

    const [startH, startM] = this.limits.tradingHours.start.split(':').map(Number);
    const [endH, endM] = this.limits.tradingHours.end.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  /**
   * Get today's date in ET timezone
   */
  getTodayET() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.limits.timezone
    }).format(new Date());
  }

  /**
   * Reject with reason
   */
  reject(reason) {
    console.log(`[RiskManager] Order rejected: ${reason}`);

    if (this.onLimitHit) {
      this.onLimitHit({ type: 'rejection', reason });
    }

    return { approved: false, reason };
  }

  /**
   * Get current state summary
   */
  getStatus() {
    return {
      dailyTrades: this.state.dailyTrades,
      maxDailyTrades: this.limits.maxDailyTrades,
      dailyPnL: this.state.dailyPnL,
      maxDailyLoss: this.limits.maxDailyLoss,
      currentPositions: this.state.currentPositions,
      maxConcurrentPositions: this.limits.maxConcurrentPositions,
      circuitBreakerTripped: this.state.circuitBreakerTripped,
      isWithinTradingHours: this.isWithinTradingHours(),
      canTrade: !this.state.circuitBreakerTripped &&
                this.isWithinTradingHours() &&
                this.state.dailyTrades < this.limits.maxDailyTrades &&
                this.state.currentPositions < this.limits.maxConcurrentPositions
    };
  }

  /**
   * Get trade history for today
   */
  getTodayTrades() {
    const today = this.getTodayET();
    return this.state.trades.filter(t =>
      t.timestamp && t.timestamp.startsWith(today)
    );
  }

  /**
   * Update limits (for runtime adjustment)
   */
  updateLimits(newLimits) {
    this.limits = { ...this.limits, ...newLimits };
    console.log('[RiskManager] Limits updated:', this.limits);
  }
}

export default RiskManager;
