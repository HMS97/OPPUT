/**
 * Order Executor - Connects signals to Robinhood API
 * Handles order placement via HTTP bridge to Python FastAPI service
 */

const DEFAULT_API_URL = 'http://localhost:8001';

export class OrderExecutor {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.dryRun = config.dryRun !== false; // Default: dry-run ON
    this.riskManager = config.riskManager || null;
    this.onOrderPlaced = config.onOrderPlaced || null;
    this.onOrderFailed = config.onOrderFailed || null;
  }

  /**
   * Execute a trading signal
   * @param {Object} signal - Signal from OI-WASP or other source
   * @returns {Object} Order result or dry-run simulation
   */
  async executeSignal(signal) {
    const timestamp = new Date().toISOString();

    // Log signal
    console.log(`[${timestamp}] Signal received:`, {
      direction: signal.direction,
      strength: signal.strength,
      strike: signal.strike,
      expiry: signal.expiry
    });

    // Risk validation
    if (this.riskManager) {
      const allowed = await this.riskManager.validateOrder({
        symbol: signal.symbol || 'SPY',
        direction: signal.direction,
        strength: signal.strength,
        estimatedCost: await this.estimateOrderCost(signal)
      });

      if (!allowed.approved) {
        console.log(`[${timestamp}] Order blocked by risk manager: ${allowed.reason}`);
        if (this.onOrderFailed) {
          this.onOrderFailed({ signal, reason: allowed.reason });
        }
        return { success: false, reason: allowed.reason, blocked: true };
      }
    }

    // Dry-run mode
    if (this.dryRun) {
      return this.simulateOrder(signal);
    }

    // Live execution
    return this.placeOrder(signal);
  }

  /**
   * Simulate order for dry-run mode
   */
  simulateOrder(signal) {
    const timestamp = new Date().toISOString();
    const simulatedOrder = {
      success: true,
      dryRun: true,
      order_id: `DRY-${Date.now()}`,
      symbol: signal.symbol || 'SPY',
      direction: signal.direction,
      option_type: signal.direction.toLowerCase(),
      strike: signal.strike,
      expiry: signal.expiry,
      quantity: signal.contracts || 1,
      estimated_price: signal.entryPrice || 1.50,
      timestamp
    };

    console.log(`[${timestamp}] DRY-RUN: Would place order:`, simulatedOrder);

    if (this.onOrderPlaced) {
      this.onOrderPlaced(simulatedOrder);
    }

    return simulatedOrder;
  }

  /**
   * Place live order via Robinhood API
   */
  async placeOrder(signal) {
    const timestamp = new Date().toISOString();
    const symbol = signal.symbol || 'SPY';
    const optionType = signal.direction.toLowerCase(); // 'call' or 'put'

    try {
      // Get current option quote for limit price
      const quote = await this.getOptionQuote(
        symbol,
        signal.strike,
        signal.expiry,
        optionType
      );

      if (!quote) {
        throw new Error('Could not get option quote');
      }

      // Use ask price for buy orders (conservative)
      const limitPrice = quote.ask_price;

      // Place the order
      const response = await fetch(`${this.apiUrl}/order/option`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strike: signal.strike,
          expiry: signal.expiry,
          option_type: optionType,
          quantity: signal.contracts || 1,
          limit_price: limitPrice,
          position_effect: 'open'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Order failed');
      }

      const result = await response.json();

      console.log(`[${timestamp}] Order placed:`, result);

      if (this.onOrderPlaced) {
        this.onOrderPlaced(result);
      }

      // Update risk manager with trade
      if (this.riskManager) {
        await this.riskManager.recordTrade({
          ...result,
          cost: limitPrice * (signal.contracts || 1) * 100
        });
      }

      return { success: true, ...result };

    } catch (error) {
      console.error(`[${timestamp}] Order failed:`, error.message);

      if (this.onOrderFailed) {
        this.onOrderFailed({ signal, reason: error.message });
      }

      return { success: false, reason: error.message };
    }
  }

  /**
   * Close an existing position
   */
  async closePosition(position, limitPrice) {
    const timestamp = new Date().toISOString();

    if (this.dryRun) {
      console.log(`[${timestamp}] DRY-RUN: Would close position:`, position);
      return { success: true, dryRun: true };
    }

    try {
      const response = await fetch(`${this.apiUrl}/order/option/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: position.symbol,
          strike: position.strike,
          expiry: position.expiry,
          option_type: position.option_type,
          quantity: position.quantity,
          limit_price: limitPrice
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Close failed');
      }

      const result = await response.json();
      console.log(`[${timestamp}] Position closed:`, result);

      return { success: true, ...result };

    } catch (error) {
      console.error(`[${timestamp}] Close failed:`, error.message);
      return { success: false, reason: error.message };
    }
  }

  /**
   * Get option quote from API
   */
  async getOptionQuote(symbol, strike, expiry, optionType) {
    try {
      const params = new URLSearchParams({
        strike: strike.toString(),
        expiry,
        option_type: optionType
      });

      const response = await fetch(
        `${this.apiUrl}/option-quote/${symbol}?${params}`
      );

      if (!response.ok) return null;
      return await response.json();

    } catch (error) {
      console.error('Error getting option quote:', error.message);
      return null;
    }
  }

  /**
   * Estimate order cost for risk validation
   */
  async estimateOrderCost(signal) {
    const symbol = signal.symbol || 'SPY';
    const optionType = signal.direction.toLowerCase();

    // Try to get real quote
    const quote = await this.getOptionQuote(
      symbol,
      signal.strike,
      signal.expiry,
      optionType
    );

    if (quote) {
      return quote.ask_price * (signal.contracts || 1) * 100;
    }

    // Fallback estimate
    return (signal.entryPrice || 2.00) * (signal.contracts || 1) * 100;
  }

  /**
   * Check API health
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.apiUrl}/health`);
      if (!response.ok) return { healthy: false, authenticated: false };
      return { healthy: true, ...(await response.json()) };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Authenticate with Robinhood
   */
  async authenticate() {
    try {
      const response = await fetch(`${this.apiUrl}/authenticate`, {
        method: 'POST'
      });
      return response.ok;
    } catch (error) {
      console.error('Authentication failed:', error.message);
      return false;
    }
  }

  /**
   * Get current positions
   */
  async getPositions() {
    try {
      const response = await fetch(`${this.apiUrl}/positions/options`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.positions || [];
    } catch (error) {
      console.error('Error getting positions:', error.message);
      return [];
    }
  }

  /**
   * Get buying power
   */
  async getBuyingPower() {
    try {
      const response = await fetch(`${this.apiUrl}/buying-power`);
      if (!response.ok) return 0;
      const data = await response.json();
      return data.buying_power || 0;
    } catch (error) {
      console.error('Error getting buying power:', error.message);
      return 0;
    }
  }
}

export default OrderExecutor;
