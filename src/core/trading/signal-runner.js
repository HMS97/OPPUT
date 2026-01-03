/**
 * Signal Runner - Live monitoring and signal execution
 * Connects OI-WASP signals to order execution in real-time
 */

import { OISignalSource } from '../backtest/sources/oi-adapter.js';
import { OrderExecutor } from './order-executor.js';
import { RiskManager } from './risk-manager.js';

const DEFAULT_CONFIG = {
  symbol: 'SPY',
  timeframe: 5,           // 5-minute candles
  checkInterval: 60000,   // Check every 1 minute
  candleWindow: 100,      // Keep 100 candles in memory
  dryRun: true,           // Default: dry-run mode
  apiUrl: 'http://localhost:8001'
};

export class SignalRunner {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.symbol = this.config.symbol;
    this.timeframe = this.config.timeframe;
    this.checkInterval = this.config.checkInterval;
    this.candleWindow = this.config.candleWindow;

    // Initialize components
    this.riskManager = new RiskManager({
      limits: config.riskLimits || {}
    });

    this.executor = new OrderExecutor({
      apiUrl: this.config.apiUrl,
      dryRun: this.config.dryRun,
      riskManager: this.riskManager,
      onOrderPlaced: (order) => this.onOrderPlaced(order),
      onOrderFailed: (details) => this.onOrderFailed(details)
    });

    this.signalSource = new OISignalSource({
      timeframe: this.timeframe,
      waspPeriod: 15,
      entryDeviation: 0.2,
      strongDeviation: 0.5,
      minStrength: this.config.riskLimits?.minStrengthThreshold || 60
    });

    // State
    this.candles = [];
    this.running = false;
    this.intervalId = null;
    this.lastCandleTime = null;
    this.signalHistory = [];
    this.orderHistory = [];

    // Callbacks
    this.onSignal = config.onSignal || null;
    this.onStatus = config.onStatus || null;
  }

  /**
   * Start the signal runner
   */
  async start() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              OPPUT Signal Runner Started                   ║
╠════════════════════════════════════════════════════════════╣
║  Symbol: ${this.symbol.padEnd(10)} Timeframe: ${this.timeframe}m                    ║
║  Mode: ${this.config.dryRun ? 'DRY-RUN (no real trades)' : 'LIVE TRADING'}              ║
║  Check Interval: ${(this.checkInterval / 1000)}s                                  ║
╚════════════════════════════════════════════════════════════╝
`);

    // Check API health
    const health = await this.executor.checkHealth();
    if (!health.healthy) {
      console.error('Error: Robinhood API not available. Is the server running?');
      console.log('Start the API with: cd src && uvicorn robinhood_api:app --port 8001');
      return false;
    }

    if (!health.authenticated && !this.config.dryRun) {
      console.log('Authenticating with Robinhood...');
      const authOk = await this.executor.authenticate();
      if (!authOk) {
        console.error('Error: Authentication failed');
        return false;
      }
    }

    // Load initial candles
    await this.loadInitialCandles();

    // Load WASP data
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
    await this.signalSource.loadData(this.symbol, startDate, endDate);

    // Start monitoring
    this.running = true;
    this.intervalId = setInterval(() => this.check(), this.checkInterval);

    console.log('Monitoring started. Press Ctrl+C to stop.');

    // Run first check immediately
    await this.check();

    return true;
  }

  /**
   * Stop the signal runner
   */
  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('\nSignal runner stopped.');
    this.printSummary();
  }

  /**
   * Load initial candle history
   */
  async loadInitialCandles() {
    console.log(`Loading initial ${this.symbol} candles...`);

    try {
      // Use Yahoo Finance for candle data
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=${this.timeframe}m&range=1d`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.chart.result[0];

      if (!result || !result.indicators?.quote?.[0]) {
        throw new Error('No data returned');
      }

      const quote = result.indicators.quote[0];
      const timestamps = result.timestamp || [];

      this.candles = timestamps.map((ts, i) => ({
        time: ts * 1000,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i]
      })).filter(c => c.close !== null);

      // Keep only the window size
      if (this.candles.length > this.candleWindow) {
        this.candles = this.candles.slice(-this.candleWindow);
      }

      this.lastCandleTime = this.candles[this.candles.length - 1]?.time;

      console.log(`Loaded ${this.candles.length} candles. Last: ${new Date(this.lastCandleTime).toLocaleTimeString()}`);

    } catch (error) {
      console.error('Error loading candles:', error.message);
      this.candles = [];
    }
  }

  /**
   * Check for new candles and signals
   */
  async check() {
    if (!this.running) return;

    const timestamp = new Date().toISOString();

    try {
      // Fetch latest candle
      const newCandle = await this.fetchLatestCandle();

      if (newCandle && newCandle.time > (this.lastCandleTime || 0)) {
        // New candle received
        this.candles.push(newCandle);
        this.lastCandleTime = newCandle.time;

        // Trim to window size
        if (this.candles.length > this.candleWindow) {
          this.candles.shift();
        }

        console.log(`[${timestamp}] New candle: ${this.symbol} @ $${newCandle.close.toFixed(2)}`);

        // Analyze for signals
        const signal = this.signalSource.analyze(this.candles, this.candles.length - 1);

        if (signal) {
          await this.handleSignal(signal);
        }
      }

      // Log status periodically
      if (this.onStatus) {
        this.onStatus(this.getStatus());
      }

    } catch (error) {
      console.error(`[${timestamp}] Check error:`, error.message);
    }
  }

  /**
   * Fetch the latest candle
   */
  async fetchLatestCandle() {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=${this.timeframe}m&range=1d`
      );

      if (!response.ok) return null;

      const data = await response.json();
      const result = data.chart.result[0];

      if (!result?.indicators?.quote?.[0]) return null;

      const quote = result.indicators.quote[0];
      const timestamps = result.timestamp || [];
      const lastIndex = timestamps.length - 1;

      if (lastIndex < 0 || quote.close[lastIndex] === null) return null;

      return {
        time: timestamps[lastIndex] * 1000,
        open: quote.open[lastIndex],
        high: quote.high[lastIndex],
        low: quote.low[lastIndex],
        close: quote.close[lastIndex],
        volume: quote.volume[lastIndex]
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Handle a detected signal
   */
  async handleSignal(signal) {
    const timestamp = new Date().toISOString();

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    SIGNAL DETECTED                         ║
╠════════════════════════════════════════════════════════════╣
║  Type: ${signal.type.padEnd(15)} Direction: ${signal.direction.padEnd(10)}          ║
║  Strength: ${String(signal.strength).padEnd(5)}%          Price: $${signal.price?.toFixed(2) || 'N/A'}           ║
║  Strike: $${signal.metadata?.syntheticWASP || 'N/A'}                                     ║
╚════════════════════════════════════════════════════════════╝
`);

    // Store signal
    this.signalHistory.push({ ...signal, timestamp });

    if (this.onSignal) {
      this.onSignal(signal);
    }

    // Calculate strike and expiry for order
    const enrichedSignal = this.enrichSignalForOrder(signal);

    // Execute via order executor
    const result = await this.executor.executeSignal(enrichedSignal);

    if (result.success) {
      this.orderHistory.push({
        signal: enrichedSignal,
        order: result,
        timestamp
      });
    }
  }

  /**
   * Enrich signal with order details
   */
  enrichSignalForOrder(signal) {
    const price = signal.price || this.candles[this.candles.length - 1]?.close || 0;

    // ATM strike (round to nearest dollar for SPY)
    const strike = Math.round(price);

    // Next Friday expiry
    const expiry = this.getNextFriday();

    return {
      ...signal,
      symbol: this.symbol,
      strike,
      expiry,
      contracts: 1,
      entryPrice: price
    };
  }

  /**
   * Get next Friday in YYYY-MM-DD format
   */
  getNextFriday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
    const friday = new Date(today.getTime() + daysUntilFriday * 24 * 60 * 60 * 1000);
    return friday.toISOString().split('T')[0];
  }

  /**
   * Order placed callback
   */
  onOrderPlaced(order) {
    console.log(`Order placed successfully: ${order.order_id || order.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  }

  /**
   * Order failed callback
   */
  onOrderFailed(details) {
    console.log(`Order rejected: ${details.reason}`);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      running: this.running,
      symbol: this.symbol,
      timeframe: this.timeframe,
      dryRun: this.config.dryRun,
      candleCount: this.candles.length,
      lastCandle: this.lastCandleTime ? new Date(this.lastCandleTime).toISOString() : null,
      signalCount: this.signalHistory.length,
      orderCount: this.orderHistory.length,
      riskStatus: this.riskManager.getStatus()
    };
  }

  /**
   * Print summary on stop
   */
  printSummary() {
    const status = this.riskManager.getStatus();

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                     SESSION SUMMARY                        ║
╠════════════════════════════════════════════════════════════╣
║  Signals detected: ${String(this.signalHistory.length).padEnd(10)}                           ║
║  Orders placed: ${String(this.orderHistory.length).padEnd(10)}                              ║
║  Daily trades: ${status.dailyTrades}/${status.maxDailyTrades}                                      ║
║  Daily P&L: $${status.dailyPnL.toFixed(2).padEnd(10)}                                ║
╚════════════════════════════════════════════════════════════╝
`);
  }
}

export default SignalRunner;
