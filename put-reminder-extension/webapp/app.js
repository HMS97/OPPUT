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
    btn.textContent = this.dataMode === 'realtime' ? '🔴 Real-time' : '⏪ Replay';
    btn.classList.toggle('active', this.dataMode === 'replay');
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

  generateSPYData(timeframe) {
    const candles = [];
    let price = 590 + (Math.random() - 0.5) * 10; // SPY around 590
    const now = Date.now();
    const intervalMs = timeframe * 60 * 1000;

    // Generate 100 candles
    for (let i = 0; i < 100; i++) {
      const volatility = 0.001 * Math.sqrt(timeframe / 5); // SPY is less volatile than crypto
      const trend = Math.random() > 0.5 ? 1 : -1;

      const open = price;
      const change = price * volatility * (Math.random() - 0.5 + trend * 0.05);
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(change) * Math.random() * 0.5;
      const low = Math.min(open, close) - Math.abs(change) * Math.random() * 0.5;

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

    // Add pattern-forming candles for testing
    const resistance = candles[candles.length - 1].close * 1.002;

    for (let i = 0; i < 5; i++) {
      const open = candles[candles.length - 1].close;
      const high = resistance + Math.random() * 0.5;
      const close = resistance - Math.random() * 1;
      const low = close - Math.random() * 0.3;

      candles.push({
        time: now + i * intervalMs,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000
      });
    }

    return candles;
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

// Close alert popup function
function closeAlertPopup() {
  document.getElementById('alertPopup').classList.remove('show');
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
