/**
 * SPY PUT Alert Dashboard - Multi-Timeframe Combined Analysis
 */

const TF_CONFIG = {
  5: { id: '5m', name: '5 Min', interval: '5' },
  15: { id: '15m', name: '15 Min', interval: '15' },
  60: { id: '1h', name: '1 Hour', interval: '60' },
  240: { id: '4h', name: '4 Hour', interval: '240' }
};

const PATTERN_ICONS = {
  'LOWER_HIGH': '📉',
  'REJECTION_AT_RESISTANCE': '🛑',
  'FALSE_BREAKOUT': '💥',
  'ABSORPTION': '🔄',
  'DOUBLE_REJECTION': '⚡',
  'PRICE_STALLING': '⏸️'
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
    this.signals = {}; // Store signal per timeframe
    this.patterns = {}; // Store patterns per timeframe
    this.alerts = [];
    this.lastAlertTime = 0;
    this.alertCooldown = 60000;

    this.init();
  }

  async init() {
    this.initDetectors();
    this.initChart();
    this.bindEvents();
    this.startMonitoring();
    this.updateConnectionStatus(true);
    console.log('[SPY Dashboard] Multi-timeframe analysis initialized');
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
      this.signals[tf] = { strength: 0, patterns: [] };
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
    document.getElementById('realtimeBtn').addEventListener('click', () => {
      this.setDataMode('realtime');
    });
    document.getElementById('replayBtn').addEventListener('click', () => {
      this.setDataMode('replay');
    });

    // Chart tabs
    document.querySelectorAll('.chart-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tf = parseInt(e.target.dataset.tf);
        this.setChartTimeframe(tf);
      });
    });

    // Settings
    document.getElementById('sensitivity').addEventListener('change', (e) => {
      this.sensitivity = e.target.value;
      this.initDetectors();
      this.performScan();
    });

    document.getElementById('soundToggle').addEventListener('change', (e) => {
      this.soundEnabled = e.target.checked;
    });

    document.getElementById('refreshInterval').addEventListener('change', (e) => {
      this.refreshInterval = parseInt(e.target.value);
      this.restartMonitoring();
    });
  }

  setDataMode(mode) {
    this.dataMode = mode;
    document.getElementById('realtimeBtn').classList.toggle('active', mode === 'realtime');
    document.getElementById('replayBtn').classList.toggle('active', mode === 'replay');
    document.getElementById('statusText').textContent = mode === 'realtime' ? 'Live' : 'Replay';
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

  async performScan() {
    try {
      let allPatterns = [];
      let priceData = null;

      // Scan ALL timeframes
      for (const tf of this.timeframes) {
        const candles = await this.fetchCandleData(tf);

        if (!candles || candles.length < 10) {
          this.signals[tf] = { strength: 0, patterns: [] };
          this.patterns[tf] = [];
          continue;
        }

        // Get price from first timeframe
        if (!priceData) {
          priceData = candles;
        }

        // Run pattern detection
        const detector = this.detectors[tf];
        const patterns = detector.analyze(candles);
        const signal = detector.getSignalSummary();

        // Add timeframe to patterns
        patterns.forEach(p => p.timeframe = tf);

        this.signals[tf] = signal;
        this.patterns[tf] = patterns;
        allPatterns = allPatterns.concat(patterns);
      }

      // Update price display
      if (priceData) {
        this.updatePriceDisplay(priceData);
      }

      // Update each timeframe card
      for (const tf of this.timeframes) {
        this.updateTimeframeCard(tf, this.signals[tf], this.patterns[tf]);
      }

      // Calculate combined signal
      const combinedSignal = this.calculateCombinedSignal();

      // Update overall display
      this.updateOverallDisplay(combinedSignal, allPatterns);

      // Update all patterns list
      this.updateAllPatternsList(allPatterns);

      // Trigger alert if needed
      if (combinedSignal.strength >= 50 && Date.now() - this.lastAlertTime > this.alertCooldown) {
        this.triggerAlert(combinedSignal, allPatterns);
      }

    } catch (e) {
      console.error('[SPY Dashboard] Scan failed:', e);
    }
  }

  calculateCombinedSignal() {
    let totalStrength = 0;
    let maxStrength = 0;
    let activeTimeframes = [];

    for (const tf of this.timeframes) {
      const signal = this.signals[tf];
      if (signal.strength > 0) {
        totalStrength += signal.strength;
        activeTimeframes.push(tf);
        if (signal.strength > maxStrength) {
          maxStrength = signal.strength;
        }
      }
    }

    // Confluence bonus
    let confluenceBonus = 0;
    if (activeTimeframes.length >= 4) confluenceBonus = 25;
    else if (activeTimeframes.length === 3) confluenceBonus = 15;
    else if (activeTimeframes.length === 2) confluenceBonus = 10;

    // Combined strength: average of active + bonus, capped at 100
    const avgStrength = activeTimeframes.length > 0 ? totalStrength / activeTimeframes.length : 0;
    const combinedStrength = Math.min(100, avgStrength + confluenceBonus);

    return {
      strength: combinedStrength,
      activeTimeframes,
      maxStrength,
      confluenceBonus
    };
  }

  updateTimeframeCard(tf, signal, patterns) {
    const tfId = TF_CONFIG[tf].id;
    const card = document.getElementById(`card${tfId}`);
    const badge = document.getElementById(`badge${tfId}`);
    const meter = document.getElementById(`meter${tfId}`);
    const patternsList = document.getElementById(`patterns${tfId}`);

    // Update card state
    card.classList.toggle('has-signal', signal.strength >= 50);

    // Update badge
    badge.className = 'tf-signal-badge';
    if (signal.strength >= 75) {
      badge.classList.add('badge-strong');
      badge.textContent = `${Math.round(signal.strength)}%`;
    } else if (signal.strength >= 50) {
      badge.classList.add('badge-medium');
      badge.textContent = `${Math.round(signal.strength)}%`;
    } else if (signal.strength > 0) {
      badge.classList.add('badge-weak');
      badge.textContent = `${Math.round(signal.strength)}%`;
    } else {
      badge.classList.add('badge-none');
      badge.textContent = '--';
    }

    // Update meter
    meter.style.width = `${signal.strength}%`;

    // Update patterns
    if (patterns.length > 0) {
      patternsList.innerHTML = patterns.slice(0, 3).map(p => `
        <div class="tf-pattern-item">
          <span class="tf-pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
          <span>${p.name}</span>
        </div>
      `).join('');
    } else {
      patternsList.innerHTML = '<div class="tf-no-pattern">No patterns</div>';
    }
  }

  updateOverallDisplay(signal, allPatterns) {
    // Update signal value
    document.getElementById('overallSignalValue').textContent = `${Math.round(signal.strength)}%`;
    document.getElementById('overallMeter').style.width = `${signal.strength}%`;

    // Update confluence dots
    for (const tf of this.timeframes) {
      const tfId = TF_CONFIG[tf].id;
      const dot = document.getElementById(`conf${tfId}`);
      dot.classList.toggle('active', signal.activeTimeframes.includes(tf));
    }

    // Update status box
    const statusBox = document.getElementById('overallStatus');
    statusBox.className = 'status-box';

    if (signal.strength >= 75) {
      statusBox.classList.add('status-strong');
      statusBox.textContent = '🔻 STRONG PUT!';
    } else if (signal.strength >= 50) {
      statusBox.classList.add('status-medium');
      statusBox.textContent = '⚠️ PUT Signal';
    } else if (signal.strength > 0) {
      statusBox.classList.add('status-weak');
      statusBox.textContent = 'Weak Signal';
    } else {
      statusBox.classList.add('status-none');
      statusBox.textContent = 'Monitoring...';
    }
  }

  updateAllPatternsList(patterns) {
    const container = document.getElementById('allPatternsList');

    if (patterns.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No patterns detected</p>';
      return;
    }

    // Sort by timeframe (higher TF first for importance)
    const sorted = [...patterns].sort((a, b) => b.timeframe - a.timeframe);

    container.innerHTML = sorted.slice(0, 8).map(p => `
      <div class="pattern-item">
        <span class="pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
        <div class="pattern-info">
          <div class="pattern-name">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
        </div>
        <span class="pattern-tf">${TF_CONFIG[p.timeframe].name}</span>
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

    priceEl.textContent = current.close.toFixed(2);
    priceEl.className = `price-value ${isUp ? 'price-up' : 'price-down'}`;

    changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}`;
    changeEl.style.color = isUp ? '#4ade80' : '#e94560';

    percentEl.textContent = `(${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;
    percentEl.style.color = isUp ? '#4ade80' : '#e94560';
  }

  async fetchCandleData(timeframe) {
    // Generate simulated SPY data for demo
    return this.generateSPYData(timeframe);
  }

  generateSPYData(timeframe) {
    const candles = [];
    let price = 590;
    const now = Date.now();
    const intervalMs = timeframe * 60 * 1000;

    // Phase 1: Uptrend (candles 0-60)
    for (let i = 0; i < 60; i++) {
      const open = price;
      const change = price * 0.001 * (0.3 + Math.random() * 0.7);
      const close = open + change;
      const high = close + Math.abs(change) * Math.random() * 0.3;
      const low = open - Math.abs(change) * Math.random() * 0.2;
      candles.push({ time: now - (100 - i) * intervalMs, open, high, low, close, volume: Math.random() * 1000000 });
      price = close;
    }

    // Record the high point
    const peakPrice = price;

    // Phase 2: First rejection at resistance (candles 60-70)
    for (let i = 60; i < 70; i++) {
      const open = price;
      // Create rejection candles with long upper wicks
      const high = peakPrice * 1.003 + Math.random() * 0.5;
      const close = open - price * 0.001 * Math.random();
      const low = Math.min(open, close) - Math.abs(open - close) * 0.2;
      candles.push({ time: now - (100 - i) * intervalMs, open, high, low, close, volume: Math.random() * 1000000 });
      price = close;
    }

    // Phase 3: Small pullback (candles 70-80)
    for (let i = 70; i < 80; i++) {
      const open = price;
      const change = price * 0.0008 * (Math.random() - 0.6);
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(change) * 0.3;
      const low = Math.min(open, close) - Math.abs(change) * 0.3;
      candles.push({ time: now - (100 - i) * intervalMs, open, high, low, close, volume: Math.random() * 1000000 });
      price = close;
    }

    // Phase 4: Lower high attempt with rejection (candles 80-90)
    const lowerHighTarget = peakPrice * 0.998; // Lower than previous high
    for (let i = 80; i < 90; i++) {
      const open = price;
      // Push up towards lower high then reject
      const high = lowerHighTarget + Math.random() * 0.3;
      const close = open - price * 0.0005 * (1 + Math.random());
      const low = close - Math.abs(open - close) * 0.2;
      candles.push({ time: now - (100 - i) * intervalMs, open, high, low, close, volume: Math.random() * 1000000 });
      price = close;
    }

    // Phase 5: Recent candles with strong rejection wicks (candles 90-105)
    for (let i = 90; i < 105; i++) {
      const open = price;
      // Create strong rejection patterns - long upper wicks, close near low
      const wickSize = price * 0.002 * (1 + Math.random());
      const high = open + wickSize;
      const body = price * 0.0003 * (1 + Math.random());
      const close = open - body;
      const low = close - body * 0.3;
      candles.push({ time: now - (100 - i) * intervalMs, open, high, low, close, volume: Math.random() * 1000000 });
      price = close;
    }

    return candles;
  }

  triggerAlert(signal, patterns) {
    this.lastAlertTime = Date.now();

    // Add to history
    this.alerts.unshift({
      time: new Date(),
      strength: signal.strength,
      timeframes: signal.activeTimeframes,
      patterns: patterns.slice(0, 3).map(p => p.name)
    });
    this.alerts = this.alerts.slice(0, 20);
    this.updateAlertHistory();

    // Show popup
    this.showAlertPopup(signal, patterns);

    // Play sound
    if (this.soundEnabled) this.playAlertSound();
  }

  updateAlertHistory() {
    const container = document.getElementById('alertList');

    if (this.alerts.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No alerts yet</p>';
      return;
    }

    container.innerHTML = this.alerts.slice(0, 10).map(a => `
      <div class="alert-item">
        <div class="alert-header">
          <span class="alert-type">PUT ${Math.round(a.strength)}%</span>
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

    tfsEl.innerHTML = signal.activeTimeframes.map(tf =>
      `<span class="alert-popup-tf">${TF_CONFIG[tf].name}</span>`
    ).join('');

    contentEl.innerHTML = `
      <p><strong>Confluence:</strong> ${signal.activeTimeframes.length}/4 timeframes</p>
      <p style="margin-top:8px;"><strong>Patterns:</strong> ${patterns.slice(0, 3).map(p => p.name).join(', ')}</p>
    `;

    strengthEl.textContent = `${Math.round(signal.strength)}%`;

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
    dot.style.background = connected ? '#4ade80' : '#e94560';
  }
}

function closeAlertPopup() {
  document.getElementById('alertPopup').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
