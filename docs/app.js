/**
 * SPY Alert Dashboard - Multi-Timeframe Combined Analysis with Backtesting
 */

const TF_CONFIG = {
  5: { id: '5m', name: '5 Min', interval: '5' },
  15: { id: '15m', name: '15 Min', interval: '15' },
  60: { id: '1h', name: '1 Hour', interval: '60' },
  240: { id: '4h', name: '4 Hour', interval: '240' }
};

const PATTERN_ICONS = {
  'LOWER_HIGH': '📉',
  'HIGHER_LOW': '📈',
  'REJECTION_AT_RESISTANCE': '🛑',
  'REJECTION_AT_SUPPORT': '🟢',
  'FALSE_BREAKOUT': '💥',
  'FALSE_BREAKOUT_DOWN': '💫',
  'ABSORPTION': '🔄',
  'ABSORPTION_BUYING': '🔃',
  'DOUBLE_REJECTION': '⚡',
  'DOUBLE_REJECTION_BOTTOM': '⚡',
  'PRICE_STALLING': '⏸️',
  'PRICE_STALLING_LOW': '⏸️'
};

class SPYDashboard {
  constructor() {
    this.timeframes = [5, 15, 60, 240];
    this.currentChartTF = 5;
    this.dataMode = 'realtime';
    this.sensitivity = 'medium';
    this.soundEnabled = true;
    this.refreshInterval = 10;
    this.scanTimer = null;
    this.detectors = {};
    this.signals = {};
    this.patterns = {};
    this.alerts = [];
    this.lastAlertTime = 0;
    this.alertCooldown = 60000;

    // Backtesting state
    this.backtestMode = false;
    this.backtestData = {};
    this.backtestIndex = 0;
    this.backtestResults = [];
    this.backtestSpeed = 500; // ms per candle
    this.backtestTimer = null;
    this.marketPhase = 'random'; // random, uptrend, downtrend, choppy

    this.init();
  }

  async init() {
    this.initDetectors();
    this.initChart();
    this.bindEvents();
    this.startMonitoring();
    this.updateConnectionStatus(true);
    console.log('[SPY Dashboard] Multi-timeframe analysis with backtesting initialized');
  }

  initDetectors() {
    const configs = {
      low: { rejectionThreshold: 0.003, consolidationBars: 5, lowerHighTolerance: 0.0015, higherLowTolerance: 0.0015 },
      medium: { rejectionThreshold: 0.002, consolidationBars: 3, lowerHighTolerance: 0.001, higherLowTolerance: 0.001 },
      high: { rejectionThreshold: 0.001, consolidationBars: 2, lowerHighTolerance: 0.0005, higherLowTolerance: 0.0005 }
    };

    const baseConfig = configs[this.sensitivity];

    for (const tf of this.timeframes) {
      const tfMultiplier = tf >= 60 ? 1.5 : 1;
      this.detectors[tf] = new PutPatternDetector({
        ...baseConfig,
        rejectionThreshold: baseConfig.rejectionThreshold * tfMultiplier,
        lowerHighTolerance: baseConfig.lowerHighTolerance * tfMultiplier,
        higherLowTolerance: baseConfig.higherLowTolerance * tfMultiplier
      });
      this.signals[tf] = { strength: 0, patterns: [], direction: 'NEUTRAL' };
      this.patterns[tf] = [];
    }
  }

  initChart() {
    if (typeof TradingView === 'undefined') {
      document.getElementById('chartContainer').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">
          <p>Loading TradingView chart...</p>
        </div>
      `;
      return;
    }

    this.widget = new TradingView.widget({
      container_id: 'tradingview_chart',
      symbol: 'AMEX:SPY',
      interval: TF_CONFIG[this.currentChartTF].interval,
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
      studies: ['Volume@tv-basicstudies']
    });
  }

  bindEvents() {
    // Data mode toggle
    const realtimeBtn = document.getElementById('realtimeBtn');
    const replayBtn = document.getElementById('replayBtn');

    if (realtimeBtn) {
      realtimeBtn.addEventListener('click', () => {
        this.setDataMode('realtime');
      });
    }
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        this.setDataMode('replay');
      });
    }

    // Chart tabs
    document.querySelectorAll('.chart-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tf = parseInt(e.target.dataset.tf);
        this.setChartTimeframe(tf);
      });
    });

    // Settings
    const sensitivityEl = document.getElementById('sensitivity');
    if (sensitivityEl) {
      sensitivityEl.addEventListener('change', (e) => {
        this.sensitivity = e.target.value;
        this.initDetectors();
        this.performScan();
      });
    }

    const soundToggleEl = document.getElementById('soundToggle');
    if (soundToggleEl) {
      soundToggleEl.addEventListener('change', (e) => {
        this.soundEnabled = e.target.checked;
      });
    }

    const refreshIntervalEl = document.getElementById('refreshInterval');
    if (refreshIntervalEl) {
      refreshIntervalEl.addEventListener('change', (e) => {
        this.refreshInterval = parseInt(e.target.value);
        this.restartMonitoring();
      });
    }

    // Backtest controls
    const backtestStartBtn = document.getElementById('backtestStart');
    const backtestStopBtn = document.getElementById('backtestStop');
    const backtestStepBtn = document.getElementById('backtestStep');
    const marketPhaseEl = document.getElementById('marketPhase');

    if (backtestStartBtn) {
      backtestStartBtn.addEventListener('click', () => this.startBacktest());
    }
    if (backtestStopBtn) {
      backtestStopBtn.addEventListener('click', () => this.stopBacktest());
    }
    if (backtestStepBtn) {
      backtestStepBtn.addEventListener('click', () => this.stepBacktest());
    }
    if (marketPhaseEl) {
      marketPhaseEl.addEventListener('change', (e) => {
        this.marketPhase = e.target.value;
        if (this.dataMode === 'replay') {
          this.generateBacktestData();
          this.backtestIndex = 50; // Reset to middle
          this.performScan();
        }
      });
    }
  }

  setDataMode(mode) {
    this.dataMode = mode;
    const realtimeBtn = document.getElementById('realtimeBtn');
    const replayBtn = document.getElementById('replayBtn');
    const statusText = document.getElementById('statusText');
    const backtestControls = document.getElementById('backtestControls');

    if (realtimeBtn) realtimeBtn.classList.toggle('active', mode === 'realtime');
    if (replayBtn) replayBtn.classList.toggle('active', mode === 'replay');
    if (statusText) statusText.textContent = mode === 'realtime' ? 'Live' : 'Replay';

    if (backtestControls) {
      backtestControls.style.display = mode === 'replay' ? 'block' : 'none';
    }

    if (mode === 'replay') {
      this.generateBacktestData();
      this.backtestIndex = 50;
      this.backtestResults = [];
      this.updateBacktestStats();
    } else {
      this.stopBacktest();
    }

    this.performScan();
  }

  setChartTimeframe(tf) {
    this.currentChartTF = tf;
    document.querySelectorAll('.chart-tab').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.tf) === tf);
    });

    if (this.widget && this.widget.chart) {
      this.widget.chart().setResolution(TF_CONFIG[tf].interval);
    }
  }

  startMonitoring() {
    setTimeout(() => this.performScan(), 1000);
    this.scanTimer = setInterval(() => this.performScan(), this.refreshInterval * 1000);
  }

  restartMonitoring() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.startMonitoring();
  }

  // ==================== BALANCED DATA GENERATION ====================

  generateBacktestData() {
    // Generate 200 candles of balanced data for backtesting
    for (const tf of this.timeframes) {
      this.backtestData[tf] = this.generateBalancedData(tf, 200);
    }
  }

  generateBalancedData(timeframe, count = 200) {
    const candles = [];
    let price = 590;
    const now = Date.now();
    const intervalMs = timeframe * 60 * 1000;

    // Determine market behavior based on phase setting
    const phase = this.marketPhase;

    for (let i = 0; i < count; i++) {
      let candle;

      if (phase === 'random') {
        candle = this.generateRandomCandle(price, i, count);
      } else if (phase === 'uptrend') {
        candle = this.generateUptrendCandle(price, i, count);
      } else if (phase === 'downtrend') {
        candle = this.generateDowntrendCandle(price, i, count);
      } else if (phase === 'choppy') {
        candle = this.generateChoppyCandle(price, i, count);
      } else {
        candle = this.generateRandomCandle(price, i, count);
      }

      candle.time = now - (count - i) * intervalMs;
      candles.push(candle);
      price = candle.close;
    }

    return candles;
  }

  generateRandomCandle(price, index, total) {
    // Truly random price action - can go either way
    const volatility = 0.002; // 0.2% base volatility
    const direction = Math.random() > 0.5 ? 1 : -1;
    const change = price * volatility * (0.5 + Math.random()) * direction;

    const open = price;
    const close = price + change;

    // Random wick sizes - can create either bullish or bearish patterns
    const upperWickRatio = Math.random();
    const lowerWickRatio = Math.random();

    const range = Math.abs(change) * (1 + Math.random());
    const high = Math.max(open, close) + range * upperWickRatio;
    const low = Math.min(open, close) - range * lowerWickRatio;

    return {
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000 + 500000
    };
  }

  generateUptrendCandle(price, index, total) {
    // Uptrend with occasional pullbacks - should trigger CALL signals
    const isBullish = Math.random() > 0.3; // 70% bullish candles
    const volatility = 0.002;

    const open = price;
    let close, high, low;

    if (isBullish) {
      const change = price * volatility * (0.5 + Math.random());
      close = open + change;
      // Small upper wick, larger lower wick (support)
      high = close + Math.abs(change) * Math.random() * 0.3;
      low = open - Math.abs(change) * (0.5 + Math.random() * 0.5);
    } else {
      // Pullback candle with lower wick rejection (bullish signal)
      const change = price * volatility * Math.random() * 0.5;
      close = open - change;
      high = open + Math.abs(change) * 0.3;
      // Long lower wick = buying pressure
      low = close - Math.abs(change) * (1 + Math.random());
    }

    return {
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000 + 500000
    };
  }

  generateDowntrendCandle(price, index, total) {
    // Downtrend with occasional bounces - should trigger PUT signals
    const isBearish = Math.random() > 0.3; // 70% bearish candles
    const volatility = 0.002;

    const open = price;
    let close, high, low;

    if (isBearish) {
      const change = price * volatility * (0.5 + Math.random());
      close = open - change;
      // Small lower wick, larger upper wick (resistance)
      low = close - Math.abs(change) * Math.random() * 0.3;
      high = open + Math.abs(change) * (0.5 + Math.random() * 0.5);
    } else {
      // Bounce candle with upper wick rejection (bearish signal)
      const change = price * volatility * Math.random() * 0.5;
      close = open + change;
      low = open - Math.abs(change) * 0.3;
      // Long upper wick = selling pressure
      high = close + Math.abs(change) * (1 + Math.random());
    }

    return {
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000 + 500000
    };
  }

  generateChoppyCandle(price, index, total) {
    // Choppy market - alternating directions, mixed signals
    const direction = index % 2 === 0 ? 1 : -1;
    const volatility = 0.003; // Higher volatility

    const open = price;
    const change = price * volatility * (0.3 + Math.random() * 0.7) * direction;
    const close = open + change;

    // Large wicks on both sides
    const wickSize = Math.abs(change) * (0.5 + Math.random());
    const high = Math.max(open, close) + wickSize;
    const low = Math.min(open, close) - wickSize;

    return {
      open,
      high,
      low,
      close,
      volume: Math.random() * 1000000 + 500000
    };
  }

  // ==================== BACKTESTING ====================

  startBacktest() {
    if (this.backtestMode) return;

    this.backtestMode = true;
    this.backtestIndex = 50; // Start with 50 candles visible
    this.backtestResults = [];

    console.log('[Backtest] Starting backtest...');

    this.backtestTimer = setInterval(() => {
      this.stepBacktest();
    }, this.backtestSpeed);

    this.updateBacktestUI();
  }

  stopBacktest() {
    this.backtestMode = false;
    if (this.backtestTimer) {
      clearInterval(this.backtestTimer);
      this.backtestTimer = null;
    }
    this.updateBacktestUI();
    console.log('[Backtest] Stopped. Results:', this.backtestResults.length, 'signals');
  }

  stepBacktest() {
    if (!this.backtestData[5] || this.backtestIndex >= this.backtestData[5].length - 1) {
      this.stopBacktest();
      this.showBacktestSummary();
      return;
    }

    this.backtestIndex++;
    this.performScan();

    // Record signal for backtesting
    const combinedSignal = this.calculateCombinedSignal();
    if (combinedSignal.strength >= 50) {
      const currentPrice = this.backtestData[5][this.backtestIndex].close;
      const futureIndex = Math.min(this.backtestIndex + 10, this.backtestData[5].length - 1);
      const futurePrice = this.backtestData[5][futureIndex].close;

      this.backtestResults.push({
        index: this.backtestIndex,
        direction: combinedSignal.direction,
        strength: combinedSignal.strength,
        entryPrice: currentPrice,
        exitPrice: futurePrice,
        priceDiff: futurePrice - currentPrice,
        correct: (combinedSignal.direction === 'PUT' && futurePrice < currentPrice) ||
                 (combinedSignal.direction === 'CALL' && futurePrice > currentPrice)
      });
    }

    this.updateBacktestStats();
    this.updateBacktestProgress();
  }

  updateBacktestUI() {
    const startBtn = document.getElementById('backtestStart');
    const stopBtn = document.getElementById('backtestStop');

    if (startBtn) startBtn.disabled = this.backtestMode;
    if (stopBtn) stopBtn.disabled = !this.backtestMode;
  }

  updateBacktestProgress() {
    const progressEl = document.getElementById('backtestProgress');
    if (progressEl && this.backtestData[5]) {
      const progress = Math.round((this.backtestIndex / this.backtestData[5].length) * 100);
      progressEl.textContent = `Progress: ${progress}% (${this.backtestIndex}/${this.backtestData[5].length})`;
    }
  }

  updateBacktestStats() {
    const statsEl = document.getElementById('backtestStats');
    if (!statsEl) return;

    if (this.backtestResults.length === 0) {
      statsEl.innerHTML = '<p>No signals recorded yet</p>';
      return;
    }

    const total = this.backtestResults.length;
    const correct = this.backtestResults.filter(r => r.correct).length;
    const winRate = ((correct / total) * 100).toFixed(1);

    const putSignals = this.backtestResults.filter(r => r.direction === 'PUT');
    const callSignals = this.backtestResults.filter(r => r.direction === 'CALL');
    const putCorrect = putSignals.filter(r => r.correct).length;
    const callCorrect = callSignals.filter(r => r.correct).length;

    statsEl.innerHTML = `
      <div class="backtest-stat">
        <span>Total Signals:</span>
        <strong>${total}</strong>
      </div>
      <div class="backtest-stat">
        <span>Win Rate:</span>
        <strong style="color: ${winRate >= 50 ? '#4ade80' : '#e94560'}">${winRate}%</strong>
      </div>
      <div class="backtest-stat">
        <span>PUT Signals:</span>
        <strong>${putSignals.length} (${putSignals.length > 0 ? ((putCorrect/putSignals.length)*100).toFixed(0) : 0}% win)</strong>
      </div>
      <div class="backtest-stat">
        <span>CALL Signals:</span>
        <strong>${callSignals.length} (${callSignals.length > 0 ? ((callCorrect/callSignals.length)*100).toFixed(0) : 0}% win)</strong>
      </div>
    `;
  }

  showBacktestSummary() {
    console.log('=== BACKTEST SUMMARY ===');
    console.log('Total Signals:', this.backtestResults.length);
    const correct = this.backtestResults.filter(r => r.correct).length;
    console.log('Correct:', correct);
    console.log('Win Rate:', ((correct / this.backtestResults.length) * 100).toFixed(1) + '%');
    console.log('Results:', this.backtestResults);
  }

  // ==================== SCANNING ====================

  async performScan() {
    try {
      let allPatterns = [];
      let priceData = null;

      for (const tf of this.timeframes) {
        const candles = await this.fetchCandleData(tf);

        if (!candles || candles.length < 10) {
          this.signals[tf] = { strength: 0, patterns: [], direction: 'NEUTRAL' };
          this.patterns[tf] = [];
          continue;
        }

        if (!priceData) {
          priceData = candles;
        }

        const detector = this.detectors[tf];
        const patterns = detector.analyze(candles);
        const signal = detector.getSignalSummary();

        patterns.forEach(p => p.timeframe = tf);

        this.signals[tf] = signal;
        this.patterns[tf] = patterns;
        allPatterns = allPatterns.concat(patterns);
      }

      if (priceData) {
        this.updatePriceDisplay(priceData);
      }

      for (const tf of this.timeframes) {
        this.updateTimeframeCard(tf, this.signals[tf], this.patterns[tf]);
      }

      const combinedSignal = this.calculateCombinedSignal();
      this.updateOverallDisplay(combinedSignal, allPatterns);
      this.updateAllPatternsList(allPatterns);

      if (!this.backtestMode && combinedSignal.strength >= 50 && Date.now() - this.lastAlertTime > this.alertCooldown) {
        this.triggerAlert(combinedSignal, allPatterns);
      }

    } catch (e) {
      console.error('[SPY Dashboard] Scan failed:', e);
    }
  }

  async fetchCandleData(timeframe) {
    if (this.dataMode === 'replay' && this.backtestData[timeframe]) {
      // Return slice up to current backtest index
      const ratio = timeframe / 5; // Ratio to 5min timeframe
      const adjustedIndex = Math.floor(this.backtestIndex / ratio);
      return this.backtestData[timeframe].slice(0, Math.max(50, adjustedIndex));
    }
    return this.generateBalancedData(timeframe, 105);
  }

  calculateCombinedSignal() {
    let putWeight = 0;
    let callWeight = 0;
    let activeTimeframes = [];

    for (const tf of this.timeframes) {
      const signal = this.signals[tf];
      if (signal.strength > 0) {
        activeTimeframes.push(tf);
        if (signal.direction === 'PUT') {
          putWeight += signal.putWeight || signal.strength;
        } else if (signal.direction === 'CALL') {
          callWeight += signal.callWeight || signal.strength;
        }
      }
    }

    // Determine overall direction
    let direction = 'NEUTRAL';
    let dominantWeight = 0;

    if (putWeight > callWeight + 2) {
      direction = 'PUT';
      dominantWeight = putWeight;
    } else if (callWeight > putWeight + 2) {
      direction = 'CALL';
      dominantWeight = callWeight;
    }

    // Confluence bonus
    let confluenceBonus = 0;
    if (activeTimeframes.length >= 4) confluenceBonus = 25;
    else if (activeTimeframes.length === 3) confluenceBonus = 15;
    else if (activeTimeframes.length === 2) confluenceBonus = 10;

    // Calculate combined strength based on dominance
    const totalWeight = putWeight + callWeight;
    const dominanceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0;
    const baseStrength = dominantWeight > 0 ? Math.min(75, dominantWeight * 5) : 0;
    const combinedStrength = Math.min(100, baseStrength * dominanceRatio + confluenceBonus);

    return {
      strength: direction === 'NEUTRAL' ? 0 : combinedStrength,
      direction,
      activeTimeframes,
      putWeight,
      callWeight,
      confluenceBonus
    };
  }

  updateTimeframeCard(tf, signal, patterns) {
    const tfId = TF_CONFIG[tf].id;
    const card = document.getElementById(`card${tfId}`);
    const badge = document.getElementById(`badge${tfId}`);
    const meter = document.getElementById(`meter${tfId}`);
    const patternsList = document.getElementById(`patterns${tfId}`);

    if (!card || !badge || !meter || !patternsList) {
      console.warn(`[SPY Dashboard] Missing elements for timeframe ${tfId}`);
      return;
    }

    // Update card state with direction-aware classes
    card.classList.remove('has-signal', 'has-put', 'has-call');
    if (signal.strength >= 50) {
      card.classList.add('has-signal');
      if (signal.direction === 'PUT') card.classList.add('has-put');
      if (signal.direction === 'CALL') card.classList.add('has-call');
    }

    // Update badge with direction
    badge.className = 'tf-signal-badge';
    if (signal.strength >= 75) {
      badge.classList.add(signal.direction === 'CALL' ? 'badge-strong-call' : 'badge-strong');
      badge.textContent = `${signal.direction} ${Math.round(signal.strength)}%`;
    } else if (signal.strength >= 50) {
      badge.classList.add(signal.direction === 'CALL' ? 'badge-medium-call' : 'badge-medium');
      badge.textContent = `${signal.direction} ${Math.round(signal.strength)}%`;
    } else if (signal.strength > 0) {
      badge.classList.add('badge-weak');
      badge.textContent = `${Math.round(signal.strength)}%`;
    } else {
      badge.classList.add('badge-none');
      badge.textContent = '--';
    }

    // Update meter color based on direction
    meter.style.width = `${signal.strength}%`;
    if (signal.direction === 'CALL') {
      meter.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)';
    } else if (signal.direction === 'PUT') {
      meter.style.background = 'linear-gradient(90deg, #e94560, #ff6b6b)';
    } else {
      meter.style.background = 'linear-gradient(90deg, #666, #888)';
    }

    // Update patterns
    if (patterns.length > 0) {
      patternsList.innerHTML = patterns.slice(0, 3).map(p => `
        <div class="tf-pattern-item ${p.signal.toLowerCase()}">
          <span class="tf-pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
          <span>${p.name} (${p.signal})</span>
        </div>
      `).join('');
    } else {
      patternsList.innerHTML = '<div class="tf-no-pattern">No patterns</div>';
    }
  }

  updateOverallDisplay(signal, allPatterns) {
    const signalValueEl = document.getElementById('overallSignalValue');
    const meterEl = document.getElementById('overallMeter');

    if (signalValueEl) {
      signalValueEl.textContent = signal.direction === 'NEUTRAL' ?
        'NEUTRAL' : `${signal.direction} ${Math.round(signal.strength)}%`;
      signalValueEl.className = `signal-value ${signal.direction.toLowerCase()}`;
    }

    if (meterEl) {
      meterEl.style.width = `${signal.strength}%`;
      if (signal.direction === 'CALL') {
        meterEl.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)';
      } else if (signal.direction === 'PUT') {
        meterEl.style.background = 'linear-gradient(90deg, #e94560, #ff6b6b)';
      } else {
        meterEl.style.background = 'linear-gradient(90deg, #666, #888)';
      }
    }

    // Update confluence dots
    for (const tf of this.timeframes) {
      const tfId = TF_CONFIG[tf].id;
      const dot = document.getElementById(`conf${tfId}`);
      if (dot) {
        dot.classList.toggle('active', signal.activeTimeframes.includes(tf));
        // Color code by direction
        const tfSignal = this.signals[tf];
        dot.classList.remove('put', 'call');
        if (tfSignal.direction === 'PUT') dot.classList.add('put');
        if (tfSignal.direction === 'CALL') dot.classList.add('call');
      }
    }

    // Update status box
    const statusBox = document.getElementById('overallStatus');
    if (!statusBox) return;
    statusBox.className = 'status-box';

    if (signal.direction === 'NEUTRAL') {
      statusBox.classList.add('status-none');
      statusBox.textContent = 'Monitoring...';
    } else if (signal.direction === 'PUT') {
      if (signal.strength >= 75) {
        statusBox.classList.add('status-strong');
        statusBox.textContent = '🔻 STRONG PUT!';
      } else if (signal.strength >= 50) {
        statusBox.classList.add('status-medium');
        statusBox.textContent = '⚠️ PUT Signal';
      } else {
        statusBox.classList.add('status-weak');
        statusBox.textContent = 'Weak PUT';
      }
    } else if (signal.direction === 'CALL') {
      if (signal.strength >= 75) {
        statusBox.classList.add('status-strong-call');
        statusBox.textContent = '🔺 STRONG CALL!';
      } else if (signal.strength >= 50) {
        statusBox.classList.add('status-medium-call');
        statusBox.textContent = '✅ CALL Signal';
      } else {
        statusBox.classList.add('status-weak');
        statusBox.textContent = 'Weak CALL';
      }
    }
  }

  updateAllPatternsList(patterns) {
    const container = document.getElementById('allPatternsList');
    if (!container) return;

    if (patterns.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No patterns detected</p>';
      return;
    }

    const sorted = [...patterns].sort((a, b) => b.timeframe - a.timeframe);

    container.innerHTML = sorted.slice(0, 8).map(p => `
      <div class="pattern-item ${p.signal.toLowerCase()}">
        <span class="pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
        <div class="pattern-info">
          <div class="pattern-name">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
        </div>
        <span class="pattern-tf">${TF_CONFIG[p.timeframe].name}</span>
        <span class="pattern-signal ${p.signal.toLowerCase()}">${p.signal}</span>
      </div>
    `).join('');
  }

  updatePriceDisplay(candles) {
    if (!candles || candles.length < 2) return;

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2];

    const change = current.close - previous.close;
    const changePercent = (change / previous.close) * 100;
    const isUp = change >= 0;

    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');
    const percentEl = document.getElementById('priceChangePercent');

    if (priceEl) {
      priceEl.textContent = current.close.toFixed(2);
      priceEl.className = `price-value ${isUp ? 'price-up' : 'price-down'}`;
    }

    if (changeEl) {
      changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}`;
      changeEl.style.color = isUp ? '#4ade80' : '#e94560';
    }

    if (percentEl) {
      percentEl.textContent = `(${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;
      percentEl.style.color = isUp ? '#4ade80' : '#e94560';
    }
  }

  triggerAlert(signal, patterns) {
    this.lastAlertTime = Date.now();

    this.alerts.unshift({
      time: new Date(),
      direction: signal.direction,
      strength: signal.strength,
      timeframes: signal.activeTimeframes,
      patterns: patterns.slice(0, 3).map(p => p.name)
    });
    this.alerts = this.alerts.slice(0, 20);
    this.updateAlertHistory();

    this.showAlertPopup(signal, patterns);

    if (this.soundEnabled) this.playAlertSound();
  }

  updateAlertHistory() {
    const container = document.getElementById('alertList');
    if (!container) return;

    if (this.alerts.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No alerts yet</p>';
      return;
    }

    container.innerHTML = this.alerts.slice(0, 10).map(a => `
      <div class="alert-item ${a.direction.toLowerCase()}">
        <div class="alert-header">
          <span class="alert-type ${a.direction.toLowerCase()}">${a.direction} ${Math.round(a.strength)}%</span>
          <span class="alert-time">${a.time.toLocaleTimeString()}</span>
        </div>
        <div class="alert-details">
          ${a.timeframes.map(tf => TF_CONFIG[tf].name).join(', ')}
        </div>
      </div>
    `).join('');
  }

  showAlertPopup(signal, patterns) {
    const popup = document.getElementById('alertPopup');
    const tfsEl = document.getElementById('alertPopupTFs');
    const contentEl = document.getElementById('alertPopupContent');
    const strengthEl = document.getElementById('alertPopupStrength');

    if (!popup || !tfsEl || !contentEl || !strengthEl) return;

    tfsEl.innerHTML = signal.activeTimeframes.map(tf =>
      `<span class="alert-popup-tf">${TF_CONFIG[tf].name}</span>`
    ).join('');

    contentEl.innerHTML = `
      <p><strong>Direction:</strong> ${signal.direction}</p>
      <p><strong>Confluence:</strong> ${signal.activeTimeframes.length}/4 timeframes</p>
      <p style="margin-top:8px;"><strong>Patterns:</strong> ${patterns.slice(0, 3).map(p => `${p.name} (${p.signal})`).join(', ')}</p>
    `;

    strengthEl.textContent = `${signal.direction} ${Math.round(signal.strength)}%`;
    strengthEl.className = signal.direction.toLowerCase();

    popup.classList.add('show');
    setTimeout(() => popup.classList.remove('show'), 10000);
  }

  playAlertSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1000;
      gain2.gain.setValueAtTime(0.3, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc2.start(ctx.currentTime);
      osc2.stop(ctx.currentTime + 0.5);
    }, 200);
  }

  updateConnectionStatus(connected) {
    const dot = document.getElementById('statusDot');
    if (dot) {
      dot.style.background = connected ? '#4ade80' : '#e94560';
    }
  }
}

function closeAlertPopup() {
  const popup = document.getElementById('alertPopup');
  if (popup) popup.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
