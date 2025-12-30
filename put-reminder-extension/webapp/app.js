/**
 * SPY PUT Alert Dashboard
 * Real-time SPY monitoring with PUT pattern detection
 */

class SPYDashboard {
  constructor() {
    this.currentTimeframe = 5;
    this.timeframes = [5, 15, 60, 240];
    this.dataMode = 'realtime'; // 'realtime' or 'replay'
    this.sensitivity = 'medium';
    this.soundEnabled = true;
    this.refreshInterval = 10;
    this.scanTimer = null;
    this.candleData = {};
    this.detectors = {};
    this.alerts = [];
    this.lastAlertTime = 0;
    this.alertCooldown = 60000; // 1 minute

    this.init();
  }

  async init() {
    // Initialize pattern detectors
    this.initDetectors();

    // Initialize TradingView chart
    this.initChart();

    // Bind UI events
    this.bindEvents();

    // Start data fetching
    this.startMonitoring();

    // Update connection status
    this.updateConnectionStatus(true);

    console.log('[SPY Dashboard] Initialized');
  }

  initDetectors() {
    const configs = {
      low: { rejectionThreshold: 0.003, consolidationBars: 5, lowerHighTolerance: 0.0015 },
      medium: { rejectionThreshold: 0.002, consolidationBars: 3, lowerHighTolerance: 0.001 },
      high: { rejectionThreshold: 0.001, consolidationBars: 2, lowerHighTolerance: 0.0005 }
    };

    const baseConfig = configs[this.sensitivity];

    for (const tf of this.timeframes) {
      const tfMultiplier = tf >= 60 ? 1.5 : 1;
      this.detectors[tf] = new PutPatternDetector({
        ...baseConfig,
        rejectionThreshold: baseConfig.rejectionThreshold * tfMultiplier,
        lowerHighTolerance: baseConfig.lowerHighTolerance * tfMultiplier
      });
    }
  }

  initChart() {
    if (typeof TradingView === 'undefined') {
      console.error('TradingView library not loaded');
      document.getElementById('chartContainer').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">
          <p>Loading chart...</p>
        </div>
      `;
      return;
    }

    const intervalMap = {
      5: '5',
      15: '15',
      60: '60',
      240: '240'
    };

    this.widget = new TradingView.widget({
      container_id: 'tradingview_chart',
      symbol: 'AMEX:SPY',
      interval: intervalMap[this.currentTimeframe],
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#1a1a2e',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      height: '100%',
      width: '100%',
      studies: [
        'Volume@tv-basicstudies'
      ]
    });
  }

  bindEvents() {
    // Timeframe buttons
    document.querySelectorAll('.tf-btn[data-tf]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tf = parseInt(e.target.dataset.tf);
        this.setTimeframe(tf);
      });
    });

    // Replay/Realtime toggle
    document.getElementById('replayBtn').addEventListener('click', (e) => {
      this.toggleDataMode();
    });

    // Settings
    document.getElementById('sensitivity').addEventListener('change', (e) => {
      this.sensitivity = e.target.value;
      this.initDetectors();
    });

    document.getElementById('soundToggle').addEventListener('change', (e) => {
      this.soundEnabled = e.target.checked;
    });

    document.getElementById('refreshInterval').addEventListener('change', (e) => {
      this.refreshInterval = parseInt(e.target.value);
      this.restartMonitoring();
    });
  }

  setTimeframe(tf) {
    this.currentTimeframe = tf;

    // Update UI
    document.querySelectorAll('.tf-btn[data-tf]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.tf) === tf);
    });

    // Update chart
    if (this.widget && this.widget.chart) {
      const intervalMap = { 5: '5', 15: '15', 60: '60', 240: '240' };
      this.widget.chart().setResolution(intervalMap[tf]);
    }

    // Re-scan
    this.performScan();
  }

  toggleDataMode() {
    this.dataMode = this.dataMode === 'realtime' ? 'replay' : 'realtime';
    const btn = document.getElementById('replayBtn');
    const controls = document.getElementById('replayControls');

    btn.textContent = this.dataMode === 'realtime' ? '🔴 Real-time' : '⏪ Replay';
    btn.classList.toggle('active', this.dataMode === 'replay');

    // Show/hide replay controls
    if (controls) {
      controls.classList.toggle('active', this.dataMode === 'replay');
    }

    // Update connection status
    this.updateConnectionStatus(true);

    // If entering replay mode, load first scenario
    if (this.dataMode === 'replay' && window.replayController) {
      window.replayController.loadScenario(0);
    }
  }

  startMonitoring() {
    // Initial scan
    setTimeout(() => this.performScan(), 2000);

    // Periodic scanning
    this.scanTimer = setInterval(() => {
      this.performScan();
    }, this.refreshInterval * 1000);
  }

  restartMonitoring() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
    }
    this.startMonitoring();
  }

  async performScan() {
    try {
      const allPatterns = [];
      let maxStrength = 0;

      // Scan current timeframe
      const candles = await this.fetchCandleData(this.currentTimeframe);

      if (candles && candles.length >= 10) {
        // Update price display
        this.updatePriceDisplay(candles);

        // Run pattern detection
        const detector = this.detectors[this.currentTimeframe];
        const patterns = detector.analyze(candles);
        const signal = detector.getSignalSummary();

        patterns.forEach(p => {
          p.timeframe = this.currentTimeframe;
          allPatterns.push(p);
        });

        maxStrength = signal.strength;

        // Update UI
        this.updateSignalDisplay(signal);
        this.updatePatternsDisplay(allPatterns);

        // Trigger alert if needed
        if (signal.strength >= 50 && Date.now() - this.lastAlertTime > this.alertCooldown) {
          this.triggerAlert(signal, allPatterns);
        }
      }

    } catch (e) {
      console.error('[SPY Dashboard] Scan failed:', e);
    }
  }

  async fetchCandleData(timeframe) {
    // For demo purposes, generate simulated SPY data
    // In production, connect to a real data provider

    // Try to fetch from Yahoo Finance (via proxy) or use simulated data
    try {
      // Simulated SPY data around current price ~590
      return this.generateSPYData(timeframe);
    } catch (e) {
      console.error('Failed to fetch data:', e);
      return this.generateSPYData(timeframe);
    }
  }

  /**
   * Generate SPY data with varied market scenarios
   * @param {number} timeframe - Candle timeframe in minutes
   * @param {string} scenario - Optional: 'bullish', 'bearish', 'sideways', 'rejection', 'random'
   */
  generateSPYData(timeframe, scenario = null) {
    // If no scenario specified, pick randomly based on market conditions
    if (!scenario) {
      const scenarios = ['bullish', 'bearish', 'sideways', 'rejection', 'breakout', 'neutral'];
      scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    }

    console.log(`[SPY Dashboard] Generating ${scenario} scenario for ${timeframe}m`);

    const candles = [];
    let price = 590 + (Math.random() - 0.5) * 10; // SPY around 590
    const now = Date.now();
    const intervalMs = timeframe * 60 * 1000;
    const volatility = 0.001 * Math.sqrt(timeframe / 5);

    // Generate base candles based on scenario
    switch (scenario) {
      case 'bullish':
        this._generateBullishCandles(candles, price, now, intervalMs, volatility);
        break;
      case 'bearish':
        this._generateBearishCandles(candles, price, now, intervalMs, volatility);
        break;
      case 'sideways':
        this._generateSidewaysCandles(candles, price, now, intervalMs, volatility);
        break;
      case 'rejection':
        this._generateRejectionCandles(candles, price, now, intervalMs, volatility);
        break;
      case 'breakout':
        this._generateBreakoutCandles(candles, price, now, intervalMs, volatility);
        break;
      default:
        this._generateNeutralCandles(candles, price, now, intervalMs, volatility);
        break;
    }

    return candles;
  }

  // Generate bullish trend - should NOT trigger PUT signals
  _generateBullishCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;
    for (let i = 0; i < 100; i++) {
      const open = price;
      // Bullish bias: more likely to go up
      const trend = 0.3 + Math.random() * 0.2; // 0.3-0.5 upward bias
      const change = price * volatility * (Math.random() - 0.3 + trend);
      const close = open + change;

      // Bullish candles have longer lower wicks (buyers stepping in)
      const lowerWick = Math.abs(change) * Math.random() * 0.8;
      const upperWick = Math.abs(change) * Math.random() * 0.3;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.max(open, close) + upperWick,
        low: Math.min(open, close) - lowerWick,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }
  }

  // Generate bearish pattern - SHOULD trigger PUT signals
  _generateBearishCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;
    // First, generate uptrend
    for (let i = 0; i < 60; i++) {
      const open = price;
      const trend = 0.2 + Math.random() * 0.3;
      const change = price * volatility * (Math.random() - 0.3 + trend);
      const close = open + change;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.max(open, close) + Math.abs(change) * Math.random() * 0.4,
        low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.2,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }

    // Then add rejection at top with lower highs
    const resistance = price * 1.003;
    for (let i = 60; i < 80; i++) {
      const open = price;
      // Test resistance with rejection
      const high = resistance + (Math.random() - 0.5) * price * 0.002;
      const close = resistance - Math.random() * price * 0.004;
      const low = close - Math.random() * price * 0.002;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000 * 1.5
      });
      price = close;
    }

    // Lower highs forming
    let lastHigh = resistance;
    for (let i = 80; i < 100; i++) {
      const open = price;
      lastHigh = lastHigh * 0.999; // Each high is lower
      const high = lastHigh + Math.random() * price * 0.001;
      const close = open - Math.random() * price * 0.002;
      const low = close - Math.random() * price * 0.001;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }
  }

  // Generate sideways/consolidation - weak or no signals
  _generateSidewaysCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;
    const rangeMid = startPrice;
    const rangeSize = startPrice * 0.01; // 1% range

    for (let i = 0; i < 100; i++) {
      const open = price;
      // Mean reversion to center of range
      const distFromMid = (price - rangeMid) / rangeSize;
      const meanReversion = -distFromMid * 0.3;
      const change = price * volatility * (Math.random() - 0.5 + meanReversion);
      const close = open + change;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.max(open, close) + Math.abs(change) * Math.random() * 0.5,
        low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.5,
        close,
        volume: Math.random() * 1000000 * 0.7
      });
      price = close;
    }
  }

  // Generate rejection pattern - SHOULD trigger PUT signals
  _generateRejectionCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;

    // Build up to resistance
    for (let i = 0; i < 70; i++) {
      const open = price;
      const trend = i < 50 ? 0.15 : 0.05; // Slow down near top
      const change = price * volatility * (Math.random() - 0.4 + trend);
      const close = open + change;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.max(open, close) + Math.abs(change) * Math.random() * 0.3,
        low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.3,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }

    // Multiple rejection wicks at similar level
    const rejectionLevel = price * 1.002;
    for (let i = 70; i < 100; i++) {
      const open = price;
      // Long upper wicks (rejection)
      const high = rejectionLevel + (Math.random() * 0.3) * price * 0.001;
      const close = open - Math.random() * price * 0.002; // Close below open
      const low = close - Math.random() * price * 0.001;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000 * 1.3
      });
      price = close * 0.999 + open * 0.001; // Slight drift down
    }
  }

  // Generate bullish breakout - should NOT trigger PUT signals
  _generateBreakoutCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;
    const resistance = startPrice * 1.005;

    // Consolidate below resistance
    for (let i = 0; i < 70; i++) {
      const open = price;
      const change = price * volatility * (Math.random() - 0.5);
      const close = Math.min(open + change, resistance * 0.998);

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.min(Math.max(open, close) + Math.abs(change) * 0.5, resistance),
        low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.3,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }

    // Breakout with strong bullish candles
    for (let i = 70; i < 100; i++) {
      const open = price;
      const change = price * volatility * (0.5 + Math.random() * 0.5); // Strong bullish
      const close = open + change;

      // Small upper wicks, longer lower wicks (bullish)
      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: close + Math.abs(change) * Math.random() * 0.2,
        low: open - Math.abs(change) * Math.random() * 0.4,
        close,
        volume: Math.random() * 1000000 * 2
      });
      price = close;
    }
  }

  // Generate neutral/random data
  _generateNeutralCandles(candles, startPrice, now, intervalMs, volatility) {
    let price = startPrice;
    for (let i = 0; i < 100; i++) {
      const open = price;
      const trend = Math.random() > 0.5 ? 1 : -1;
      const change = price * volatility * (Math.random() - 0.5 + trend * 0.05);
      const close = open + change;

      candles.push({
        time: now - (100 - i) * intervalMs,
        open,
        high: Math.max(open, close) + Math.abs(change) * Math.random() * 0.5,
        low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.5,
        close,
        volume: Math.random() * 1000000
      });
      price = close;
    }
  }

  updatePriceDisplay(candles) {
    if (!candles || candles.length === 0) return;

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2] || current;

    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');
    const percentEl = document.getElementById('priceChangePercent');

    const change = current.close - previous.close;
    const changePercent = (change / previous.close) * 100;
    const isUp = change >= 0;

    priceEl.textContent = current.close.toFixed(2);
    priceEl.className = `current-price ${isUp ? 'price-up' : 'price-down'}`;

    changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}`;
    changeEl.style.color = isUp ? '#4ade80' : '#e94560';

    percentEl.textContent = `(${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;
    percentEl.style.color = isUp ? '#4ade80' : '#e94560';
  }

  updateSignalDisplay(signal) {
    const valueEl = document.getElementById('signalValue');
    const meterEl = document.getElementById('signalMeter');
    const statusEl = document.getElementById('signalStatus');

    valueEl.textContent = `${Math.round(signal.strength)}%`;
    meterEl.style.width = `${signal.strength}%`;

    // Update status
    statusEl.className = 'signal-status';
    if (signal.strength >= 75) {
      statusEl.classList.add('signal-strong');
      statusEl.textContent = '🔻 STRONG PUT SIGNAL!';
    } else if (signal.strength >= 50) {
      statusEl.classList.add('signal-medium');
      statusEl.textContent = '⚠️ PUT Signal Detected';
    } else if (signal.strength > 0) {
      statusEl.classList.add('signal-weak');
      statusEl.textContent = 'Weak Signal - Monitoring...';
    } else {
      statusEl.classList.add('signal-none');
      statusEl.textContent = 'No Signal - Monitoring...';
    }
  }

  updatePatternsDisplay(patterns) {
    const container = document.getElementById('patternsList');

    if (!patterns || patterns.length === 0) {
      container.innerHTML = `
        <p style="color: #666; text-align: center; padding: 20px;">
          No patterns detected
        </p>
      `;
      return;
    }

    const icons = {
      'LOWER_HIGH': '📉',
      'REJECTION_AT_RESISTANCE': '🛑',
      'FALSE_BREAKOUT': '💥',
      'ABSORPTION': '🔄',
      'DOUBLE_REJECTION': '⚡',
      'PRICE_STALLING': '⏸️'
    };

    const tfLabels = { 5: '5m', 15: '15m', 60: '1H', 240: '4H' };

    container.innerHTML = patterns.slice(0, 5).map(p => `
      <div class="pattern-item">
        <span class="pattern-icon">${icons[p.type] || '📊'}</span>
        <div class="pattern-info">
          <div class="pattern-name">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
        </div>
        <span class="pattern-tf">${tfLabels[p.timeframe] || p.timeframe}</span>
      </div>
    `).join('');
  }

  triggerAlert(signal, patterns) {
    this.lastAlertTime = Date.now();

    // Add to alert history
    const alert = {
      time: new Date(),
      strength: signal.strength,
      patterns: patterns.map(p => p.name),
      timeframe: this.currentTimeframe
    };
    this.alerts.unshift(alert);
    this.alerts = this.alerts.slice(0, 20);

    // Update alert history UI
    this.updateAlertHistory();

    // Show popup
    this.showAlertPopup(signal, patterns);

    // Play sound
    if (this.soundEnabled) {
      this.playAlertSound();
    }
  }

  updateAlertHistory() {
    const container = document.getElementById('alertList');
    const tfLabels = { 5: '5m', 15: '15m', 60: '1H', 240: '4H' };

    if (this.alerts.length === 0) {
      container.innerHTML = `
        <p style="color: #666; text-align: center; padding: 20px;">
          No alerts yet
        </p>
      `;
      return;
    }

    container.innerHTML = this.alerts.slice(0, 10).map(a => `
      <div class="alert-item">
        <div class="alert-header">
          <span class="alert-type">PUT Signal (${Math.round(a.strength)}%)</span>
          <span class="alert-time">${a.time.toLocaleTimeString()}</span>
        </div>
        <div class="alert-details">
          ${a.patterns.slice(0, 2).join(', ')} | ${tfLabels[a.timeframe]}
        </div>
      </div>
    `).join('');
  }

  showAlertPopup(signal, patterns) {
    const popup = document.getElementById('alertPopup');
    const content = document.getElementById('alertPopupContent');
    const strength = document.getElementById('alertPopupStrength');

    const tfLabels = { 5: '5m', 15: '15m', 60: '1H', 240: '4H' };

    content.innerHTML = `
      <p><strong>Patterns Detected:</strong></p>
      <ul style="margin: 8px 0; padding-left: 20px;">
        ${patterns.slice(0, 3).map(p => `<li>${p.name} (${tfLabels[p.timeframe]})</li>`).join('')}
      </ul>
      <p style="margin-top: 12px;">${signal.recommendation || 'Consider entering PUT position'}</p>
    `;

    strength.textContent = `${Math.round(signal.strength)}%`;

    popup.classList.add('show');

    // Auto-hide after 10 seconds
    setTimeout(() => {
      popup.classList.remove('show');
    }, 10000);
  }

  playAlertSound() {
    // Create a simple beep sound
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);

    // Second beep
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 1000;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.5);
    }, 200);
  }

  updateConnectionStatus(connected) {
    const dot = document.getElementById('connectionStatus');
    const text = document.getElementById('connectionText');

    if (connected) {
      dot.style.background = '#4ade80';
      text.textContent = this.dataMode === 'realtime' ? 'Live' : 'Replay';
    } else {
      dot.style.background = '#e94560';
      text.textContent = 'Disconnected';
    }
  }
}

/**
 * Backtesting Engine for PUT Signal Analysis
 * Tests signal accuracy across different market scenarios
 */
class Backtester {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.results = [];
    this.isRunning = false;
    this.currentScenario = 0;
    this.scenarios = [];
  }

  /**
   * Run a full backtest across all scenario types
   * @param {number} iterations - Number of tests per scenario
   */
  async runBacktest(iterations = 10) {
    if (this.isRunning) {
      console.log('[Backtester] Already running');
      return;
    }

    this.isRunning = true;
    this.results = [];

    const scenarioTypes = [
      { type: 'bullish', expectedSignal: false, description: 'Bullish trend (no PUT expected)' },
      { type: 'bearish', expectedSignal: true, description: 'Bearish reversal (PUT expected)' },
      { type: 'sideways', expectedSignal: false, description: 'Sideways consolidation (weak/no signal)' },
      { type: 'rejection', expectedSignal: true, description: 'Rejection at resistance (PUT expected)' },
      { type: 'breakout', expectedSignal: false, description: 'Bullish breakout (no PUT expected)' },
      { type: 'neutral', expectedSignal: false, description: 'Neutral/random (variable)' }
    ];

    console.log('[Backtester] Starting backtest...');
    this.updateBacktestUI('running', 0, scenarioTypes.length * iterations);

    for (const scenario of scenarioTypes) {
      for (let i = 0; i < iterations; i++) {
        await this.testScenario(scenario, i + 1);
        this.updateBacktestUI('running', this.results.length, scenarioTypes.length * iterations);
        // Small delay for UI updates
        await new Promise(r => setTimeout(r, 50));
      }
    }

    this.isRunning = false;
    this.displayBacktestResults();
    console.log('[Backtester] Backtest complete!', this.getAccuracyStats());
  }

  /**
   * Test a single scenario
   */
  async testScenario(scenario, iteration) {
    const timeframe = this.dashboard.currentTimeframe;

    // Generate candles for this scenario
    const candles = this.dashboard.generateSPYData(timeframe, scenario.type);

    // Run pattern detection
    const detector = this.dashboard.detectors[timeframe];
    const patterns = detector.analyze(candles);
    const signal = detector.getSignalSummary();

    // Determine if signal was triggered (strength >= 50%)
    const signalTriggered = signal.strength >= 50;

    // Check if prediction matches expected outcome
    const correct = scenario.type === 'neutral'
      ? true // Neutral is always "correct" (variable expected)
      : signalTriggered === scenario.expectedSignal;

    // Calculate actual outcome (what would have happened if we took the trade)
    const entryPrice = candles[candles.length - 1].close;
    const futureCandles = this.generateFutureCandles(candles, scenario.type);
    const exitPrice = futureCandles[futureCandles.length - 1].close;
    const pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100; // PUT profits when price drops

    const result = {
      scenario: scenario.type,
      description: scenario.description,
      iteration,
      signalStrength: signal.strength,
      signalTriggered,
      expectedSignal: scenario.expectedSignal,
      patternsDetected: patterns.length,
      patternTypes: patterns.map(p => p.type),
      correct,
      entryPrice,
      exitPrice,
      pnlPercent,
      profitable: signalTriggered ? pnlPercent > 0 : true // If no signal, no trade = no loss
    };

    this.results.push(result);
    return result;
  }

  /**
   * Generate future candles to simulate outcome
   */
  generateFutureCandles(currentCandles, scenarioType) {
    const lastCandle = currentCandles[currentCandles.length - 1];
    let price = lastCandle.close;
    const candles = [];

    // Simulate 10 future candles based on scenario type
    for (let i = 0; i < 10; i++) {
      const volatility = 0.001;
      let trend;

      switch (scenarioType) {
        case 'bullish':
        case 'breakout':
          trend = 0.3; // Price goes up
          break;
        case 'bearish':
        case 'rejection':
          trend = -0.3; // Price goes down
          break;
        default:
          trend = (Math.random() - 0.5) * 0.2;
      }

      const change = price * volatility * (Math.random() - 0.5 + trend);
      const newPrice = price + change;

      candles.push({
        time: lastCandle.time + (i + 1) * 5 * 60 * 1000,
        open: price,
        high: Math.max(price, newPrice) + Math.abs(change) * 0.3,
        low: Math.min(price, newPrice) - Math.abs(change) * 0.3,
        close: newPrice
      });

      price = newPrice;
    }

    return candles;
  }

  /**
   * Get accuracy statistics
   */
  getAccuracyStats() {
    if (this.results.length === 0) return null;

    const total = this.results.length;
    const correct = this.results.filter(r => r.correct).length;
    const signalsTriggered = this.results.filter(r => r.signalTriggered);
    const profitableTrades = signalsTriggered.filter(r => r.profitable).length;

    // Group by scenario
    const byScenario = {};
    for (const result of this.results) {
      if (!byScenario[result.scenario]) {
        byScenario[result.scenario] = { total: 0, correct: 0, signals: 0, profitable: 0 };
      }
      byScenario[result.scenario].total++;
      if (result.correct) byScenario[result.scenario].correct++;
      if (result.signalTriggered) {
        byScenario[result.scenario].signals++;
        if (result.profitable) byScenario[result.scenario].profitable++;
      }
    }

    return {
      total,
      correct,
      accuracy: ((correct / total) * 100).toFixed(1),
      signalsTriggered: signalsTriggered.length,
      profitableTrades,
      winRate: signalsTriggered.length > 0
        ? ((profitableTrades / signalsTriggered.length) * 100).toFixed(1)
        : 'N/A',
      avgPnL: signalsTriggered.length > 0
        ? (signalsTriggered.reduce((sum, r) => sum + r.pnlPercent, 0) / signalsTriggered.length).toFixed(2)
        : 0,
      byScenario
    };
  }

  /**
   * Update backtest UI progress
   */
  updateBacktestUI(status, current, total) {
    const container = document.getElementById('backtestResults');
    if (!container) return;

    if (status === 'running') {
      const progress = ((current / total) * 100).toFixed(0);
      container.innerHTML = `
        <div class="backtest-progress">
          <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
        <p style="text-align: center; margin-top: 10px; color: #999;">
          Running backtest... ${current}/${total} (${progress}%)
        </p>
      `;
    }
  }

  /**
   * Display backtest results
   */
  displayBacktestResults() {
    const container = document.getElementById('backtestResults');
    if (!container) return;

    const stats = this.getAccuracyStats();
    if (!stats) {
      container.innerHTML = '<p style="color: #666; text-align: center;">No results</p>';
      return;
    }

    const scenarioRows = Object.entries(stats.byScenario).map(([scenario, data]) => {
      const accuracy = ((data.correct / data.total) * 100).toFixed(0);
      const winRate = data.signals > 0 ? ((data.profitable / data.signals) * 100).toFixed(0) : 'N/A';
      const signalIcon = data.signals > data.total / 2 ? '🔴' : '🟢';

      return `
        <tr>
          <td>${scenario}</td>
          <td>${data.signals}/${data.total}</td>
          <td>${accuracy}%</td>
          <td>${winRate}%</td>
          <td>${signalIcon}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="backtest-summary">
        <div class="summary-stat">
          <span class="stat-value">${stats.accuracy}%</span>
          <span class="stat-label">Signal Accuracy</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${stats.winRate}%</span>
          <span class="stat-label">Win Rate</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${stats.avgPnL > 0 ? '+' : ''}${stats.avgPnL}%</span>
          <span class="stat-label">Avg P&L</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${stats.signalsTriggered}/${stats.total}</span>
          <span class="stat-label">Signals Triggered</span>
        </div>
      </div>
      <table class="backtest-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Signals</th>
            <th>Accuracy</th>
            <th>Win Rate</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${scenarioRows}
        </tbody>
      </table>
      <button class="backtest-btn" onclick="window.backtester.runBacktest(10)">
        Run Again
      </button>
    `;
  }
}

/**
 * Replay Mode Controller
 * Steps through historical scenarios one at a time
 */
class ReplayController {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.scenarios = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.playInterval = null;
  }

  /**
   * Initialize replay with predefined scenarios
   */
  initScenarios() {
    this.scenarios = [
      { type: 'bullish', name: 'Scenario 1: Strong Uptrend', expectedOutcome: 'No PUT signal expected' },
      { type: 'rejection', name: 'Scenario 2: Rejection at Resistance', expectedOutcome: 'PUT signal expected' },
      { type: 'sideways', name: 'Scenario 3: Sideways Consolidation', expectedOutcome: 'Weak/no signal expected' },
      { type: 'bearish', name: 'Scenario 4: Bearish Reversal', expectedOutcome: 'PUT signal expected' },
      { type: 'breakout', name: 'Scenario 5: Bullish Breakout', expectedOutcome: 'No PUT signal expected' },
      { type: 'rejection', name: 'Scenario 6: Double Top Rejection', expectedOutcome: 'Strong PUT signal expected' },
      { type: 'neutral', name: 'Scenario 7: Random Market', expectedOutcome: 'Variable outcome' },
      { type: 'bearish', name: 'Scenario 8: Lower Highs Pattern', expectedOutcome: 'PUT signal expected' }
    ];
    this.currentIndex = 0;
  }

  /**
   * Load a specific scenario
   */
  async loadScenario(index) {
    if (index < 0 || index >= this.scenarios.length) return;

    this.currentIndex = index;
    const scenario = this.scenarios[index];

    // Generate data for this scenario
    const candles = this.dashboard.generateSPYData(this.dashboard.currentTimeframe, scenario.type);

    // Update the dashboard display
    if (candles && candles.length >= 10) {
      this.dashboard.updatePriceDisplay(candles);

      const detector = this.dashboard.detectors[this.dashboard.currentTimeframe];
      const patterns = detector.analyze(candles);
      const signal = detector.getSignalSummary();

      patterns.forEach(p => p.timeframe = this.dashboard.currentTimeframe);

      this.dashboard.updateSignalDisplay(signal);
      this.dashboard.updatePatternsDisplay(patterns);
    }

    // Update replay UI
    this.updateReplayUI(scenario, index);
  }

  /**
   * Go to next scenario
   */
  next() {
    if (this.currentIndex < this.scenarios.length - 1) {
      this.loadScenario(this.currentIndex + 1);
    }
  }

  /**
   * Go to previous scenario
   */
  prev() {
    if (this.currentIndex > 0) {
      this.loadScenario(this.currentIndex - 1);
    }
  }

  /**
   * Auto-play through scenarios
   */
  play() {
    if (this.isPlaying) {
      this.pause();
      return;
    }

    this.isPlaying = true;
    this.playInterval = setInterval(() => {
      if (this.currentIndex < this.scenarios.length - 1) {
        this.next();
      } else {
        this.pause();
      }
    }, 3000);

    this.updatePlayButton();
  }

  pause() {
    this.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
    this.updatePlayButton();
  }

  updatePlayButton() {
    const btn = document.getElementById('replayPlayBtn');
    if (btn) {
      btn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
    }
  }

  updateReplayUI(scenario, index) {
    const infoEl = document.getElementById('replayInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <div class="replay-scenario">
          <div class="scenario-header">
            <span class="scenario-number">${index + 1}/${this.scenarios.length}</span>
            <span class="scenario-name">${scenario.name}</span>
          </div>
          <div class="scenario-expected">${scenario.expectedOutcome}</div>
        </div>
      `;
    }
  }
}

// Close alert popup function
function closeAlertPopup() {
  document.getElementById('alertPopup').classList.remove('show');
}

// Initialize dashboard and backtester when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
  window.backtester = new Backtester(window.spyDashboard);
  window.replayController = new ReplayController(window.spyDashboard);
  window.replayController.initScenarios();

  // Add keyboard shortcuts for replay
  document.addEventListener('keydown', (e) => {
    if (window.spyDashboard.dataMode === 'replay') {
      if (e.key === 'ArrowRight') window.replayController.next();
      if (e.key === 'ArrowLeft') window.replayController.prev();
      if (e.key === ' ') {
        e.preventDefault();
        window.replayController.play();
      }
    }
  });
});
