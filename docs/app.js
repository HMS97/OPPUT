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

    // Replay state
    this.replayData = null;           // Full historical dataset
    this.replayIndex = 0;             // Current position in replay
    this.replayPlaying = false;       // Is replay playing
    this.replayTimer = null;          // Timer for auto-play
    this.replaySpeed = 2;             // Playback speed multiplier
    this.replaySignals = [];          // Signals detected during replay
    this.replayResults = {            // Verification results
      wins: 0,
      losses: 0,
      pending: 0
    };

    this.init();
  }

  async init() {
    // Initialize pattern detectors
    this.initDetectors();

    // Initialize TradingView chart
    this.initChart();

    // Bind UI events
    this.bindEvents();

    // Initialize replay UI
    this.initReplayUI();

    // Bind replay events
    this.bindReplayEvents();

    // Start data fetching
    this.startMonitoring();

    // Update connection status
    this.updateConnectionStatus(true);

    console.log('[SPY Dashboard] Initialized');
  }

  initReplayUI() {
    // Set default date to today
    const today = new Date();
    const dateInput = document.getElementById('replayStartDate');
    if (dateInput) {
      dateInput.value = today.toISOString().split('T')[0];
      // Set max date to today
      dateInput.max = today.toISOString().split('T')[0];
    }
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

    // Show/hide replay panel
    const replayPanel = document.getElementById('replayPanel');
    if (replayPanel) {
      replayPanel.classList.toggle('show', this.dataMode === 'replay');
    }

    // Update connection status text
    this.updateConnectionStatus(true);

    // If switching to realtime, stop any ongoing replay
    if (this.dataMode === 'realtime') {
      this.stopReplay();
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

  // ==========================================
  // REPLAY FUNCTIONALITY
  // ==========================================

  loadReplayData() {
    const dateInput = document.getElementById('replayStartDate');
    const timeInput = document.getElementById('replayStartTime');
    const durationInput = document.getElementById('replayDuration');

    if (!dateInput.value) {
      alert('Please select a date');
      return;
    }

    const startDate = new Date(`${dateInput.value}T${timeInput.value || '09:30'}`);
    const durationHours = parseFloat(durationInput.value);

    console.log(`[Replay] Loading data for ${startDate.toISOString()}, duration: ${durationHours}h`);

    // Generate historical data for the selected period
    this.replayData = this.generateHistoricalData(startDate, durationHours, this.currentTimeframe);
    this.replayIndex = 10; // Start with minimum candles needed for detection
    this.replaySignals = [];
    this.replayResults = { wins: 0, losses: 0, pending: 0 };

    // Show controls and results panel
    document.getElementById('replayControls').style.display = 'flex';
    document.getElementById('resultsPanel').style.display = 'block';

    // Update progress display
    this.updateReplayProgress();
    this.updateResultsDisplay();

    // Run initial scan
    this.performReplayScan();

    console.log(`[Replay] Loaded ${this.replayData.length} candles`);
  }

  generateHistoricalData(startDate, durationHours, timeframe) {
    const candles = [];
    const intervalMs = timeframe * 60 * 1000;
    const totalCandles = Math.floor((durationHours * 60) / timeframe);

    // Use the date to seed a somewhat deterministic price pattern
    const dateSeed = startDate.getTime();
    const seededRandom = (offset) => {
      const x = Math.sin(dateSeed / 1000000 + offset) * 10000;
      return x - Math.floor(x);
    };

    // Determine starting price based on date (simulating SPY around $580-$600)
    let basePrice = 585 + seededRandom(0) * 20;

    // Determine overall trend for this day (-1 to 1)
    const dayTrend = (seededRandom(1) - 0.5) * 2;

    // Create realistic intraday patterns
    // Typical SPY pattern: volatility at open, midday lull, activity toward close
    for (let i = 0; i < totalCandles; i++) {
      const time = new Date(startDate.getTime() + i * intervalMs);
      const hourOfDay = time.getHours() + time.getMinutes() / 60;

      // Calculate intraday volatility curve (higher at open/close)
      let volatilityMultiplier = 1;
      if (hourOfDay < 10) {
        volatilityMultiplier = 2.0; // High at open
      } else if (hourOfDay < 11.5) {
        volatilityMultiplier = 1.5;
      } else if (hourOfDay < 14) {
        volatilityMultiplier = 0.7; // Low midday
      } else if (hourOfDay > 15) {
        volatilityMultiplier = 1.8; // High toward close
      }

      const volatility = 0.0015 * volatilityMultiplier * Math.sqrt(timeframe / 5);

      // Random walk with trend
      const trendComponent = dayTrend * 0.0001 * i;
      const randomComponent = (seededRandom(i * 7) - 0.5) * 2;

      const change = basePrice * volatility * randomComponent + basePrice * trendComponent;

      const open = basePrice;
      const close = open + change;

      // Generate wicks - occasionally create rejection patterns
      const wickMultiplier = seededRandom(i * 11) < 0.2 ? 2 : 1; // 20% chance of longer wicks
      const upperWick = Math.abs(change) * seededRandom(i * 13) * wickMultiplier;
      const lowerWick = Math.abs(change) * seededRandom(i * 17) * wickMultiplier;

      const high = Math.max(open, close) + upperWick;
      const low = Math.min(open, close) - lowerWick;

      candles.push({
        time: time.getTime(),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(500000 + seededRandom(i * 19) * 1500000 * volatilityMultiplier)
      });

      basePrice = close;
    }

    // Add some realistic patterns for testing
    this.injectPatterns(candles);

    return candles;
  }

  injectPatterns(candles) {
    if (candles.length < 30) return;

    // Inject a double rejection pattern somewhere
    const drIndex = Math.floor(candles.length * 0.3);
    if (drIndex + 5 < candles.length) {
      const resistanceLevel = candles[drIndex].high * 1.002;

      // First rejection
      candles[drIndex].high = resistanceLevel;
      candles[drIndex].close = candles[drIndex].open - (resistanceLevel - candles[drIndex].open) * 0.6;
      candles[drIndex].low = Math.min(candles[drIndex].low, candles[drIndex].close - 0.3);

      // Second rejection 3 candles later
      candles[drIndex + 3].high = resistanceLevel * 0.998;
      candles[drIndex + 3].close = candles[drIndex + 3].open - 0.4;
      candles[drIndex + 3].low = Math.min(candles[drIndex + 3].low, candles[drIndex + 3].close - 0.2);
    }

    // Inject a false breakout pattern
    const fbIndex = Math.floor(candles.length * 0.6);
    if (fbIndex + 2 < candles.length) {
      const prevHigh = Math.max(...candles.slice(fbIndex - 10, fbIndex).map(c => c.high));
      candles[fbIndex].high = prevHigh * 1.003;
      candles[fbIndex].close = prevHigh * 0.998;
      candles[fbIndex + 1].open = candles[fbIndex].close;
      candles[fbIndex + 1].close = candles[fbIndex + 1].open - 0.5;
      candles[fbIndex + 1].low = candles[fbIndex + 1].close - 0.2;
    }
  }

  performReplayScan() {
    if (!this.replayData || this.replayIndex >= this.replayData.length) return;

    // Get candles up to current index
    const candles = this.replayData.slice(0, this.replayIndex + 1);

    if (candles.length < 10) return;

    // Update price display
    this.updatePriceDisplay(candles);

    // Run pattern detection
    const detector = this.detectors[this.currentTimeframe];
    const patterns = detector.analyze(candles);
    const signal = detector.getSignalSummary();

    patterns.forEach(p => {
      p.timeframe = this.currentTimeframe;
    });

    // Update UI
    this.updateSignalDisplay(signal);
    this.updatePatternsDisplay(patterns);

    // Track new signals if strength >= 50%
    if (signal.strength >= 50) {
      this.trackReplaySignal(signal, patterns, candles);
    }

    // Verify pending signals (check if price went down after signal)
    this.verifyPendingSignals();
  }

  trackReplaySignal(signal, patterns, candles) {
    const currentCandle = candles[candles.length - 1];
    const signalTime = new Date(currentCandle.time);

    // Check if we already have a signal at this time
    const existingSignal = this.replaySignals.find(s =>
      Math.abs(s.time - currentCandle.time) < this.currentTimeframe * 60 * 1000
    );

    if (existingSignal) return;

    const newSignal = {
      id: this.replaySignals.length + 1,
      time: currentCandle.time,
      timeStr: signalTime.toLocaleTimeString(),
      price: currentCandle.close,
      strength: signal.strength,
      patterns: patterns.map(p => p.name).slice(0, 2),
      candleIndex: this.replayIndex,
      status: 'pending', // pending, win, loss
      exitPrice: null,
      result: null
    };

    this.replaySignals.push(newSignal);
    this.replayResults.pending++;
    this.updateResultsDisplay();
  }

  verifyPendingSignals() {
    if (!this.replayData) return;

    const lookForwardCandles = Math.ceil(10 / (this.currentTimeframe / 5)); // Verify over ~10 5min candles equivalent

    for (const signal of this.replaySignals) {
      if (signal.status !== 'pending') continue;

      // Check if enough candles have passed
      const candlesSinceSignal = this.replayIndex - signal.candleIndex;

      if (candlesSinceSignal >= lookForwardCandles) {
        // Get the closing price after the lookforward period
        const exitCandle = this.replayData[Math.min(signal.candleIndex + lookForwardCandles, this.replayData.length - 1)];
        signal.exitPrice = exitCandle.close;

        // Calculate result
        const priceChange = signal.exitPrice - signal.price;
        const priceChangePercent = (priceChange / signal.price) * 100;

        // PUT is successful if price went DOWN
        if (priceChange < 0) {
          signal.status = 'win';
          signal.result = `+${Math.abs(priceChangePercent).toFixed(2)}%`;
          this.replayResults.wins++;
          this.replayResults.pending--;
        } else {
          signal.status = 'loss';
          signal.result = `-${priceChangePercent.toFixed(2)}%`;
          this.replayResults.losses++;
          this.replayResults.pending--;
        }

        this.updateResultsDisplay();
      }
    }
  }

  updateResultsDisplay() {
    const totalSignals = this.replaySignals.length;
    const completedSignals = this.replayResults.wins + this.replayResults.losses;
    const winRate = completedSignals > 0 ? (this.replayResults.wins / completedSignals * 100) : 0;

    document.getElementById('totalSignals').textContent = totalSignals;
    document.getElementById('winsCount').textContent = this.replayResults.wins;
    document.getElementById('lossesCount').textContent = this.replayResults.losses;

    const winRateEl = document.getElementById('winRate');
    winRateEl.textContent = `${winRate.toFixed(0)}%`;
    winRateEl.className = `result-value ${winRate >= 50 ? 'positive' : 'negative'}`;

    // Update signal history
    this.updateSignalHistory();
  }

  updateSignalHistory() {
    const container = document.getElementById('signalHistory');
    if (!container) return;

    if (this.replaySignals.length === 0) {
      container.innerHTML = '<p style="color: #666; text-align: center; padding: 10px;">No signals detected yet</p>';
      return;
    }

    container.innerHTML = this.replaySignals.slice().reverse().slice(0, 10).map(s => {
      const statusClass = s.status === 'win' ? 'signal-win' : s.status === 'loss' ? 'signal-loss' : 'signal-pending';
      const statusIcon = s.status === 'win' ? '✅' : s.status === 'loss' ? '❌' : '⏳';
      const resultText = s.result || 'Pending...';

      return `
        <div class="signal-history-item ${statusClass}">
          <div>
            <span style="margin-right: 6px;">${statusIcon}</span>
            <span style="color: #e94560; font-weight: 600;">${s.strength.toFixed(0)}%</span>
            <span style="color: #666; margin-left: 6px;">@ $${s.price.toFixed(2)}</span>
          </div>
          <div>
            <span style="color: ${s.status === 'win' ? '#4ade80' : s.status === 'loss' ? '#e94560' : '#f59e0b'};">
              ${resultText}
            </span>
            <span style="color: #666; margin-left: 6px;">${s.timeStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  updateReplayProgress() {
    if (!this.replayData) return;

    const total = this.replayData.length;
    const current = this.replayIndex;
    const progress = (current / total) * 100;

    document.getElementById('replayProgressFill').style.width = `${progress}%`;
    document.getElementById('replayCandleCount').textContent = `${current} / ${total} candles`;

    if (this.replayData[0] && this.replayData[total - 1]) {
      const startTime = new Date(this.replayData[0].time);
      const endTime = new Date(this.replayData[total - 1].time);
      const currentTime = new Date(this.replayData[Math.min(current, total - 1)].time);

      document.getElementById('replayCurrentTime').textContent = currentTime.toLocaleTimeString();
      document.getElementById('replayEndTime').textContent = endTime.toLocaleTimeString();
    }
  }

  stepReplayForward() {
    if (!this.replayData || this.replayIndex >= this.replayData.length - 1) return;

    this.replayIndex++;
    this.updateReplayProgress();
    this.performReplayScan();
  }

  stepReplayBack() {
    if (!this.replayData || this.replayIndex <= 10) return;

    this.replayIndex--;
    this.updateReplayProgress();
    this.performReplayScan();
  }

  playReplay() {
    if (this.replayPlaying) {
      this.pauseReplay();
      return;
    }

    this.replayPlaying = true;
    document.getElementById('replayPlayPause').textContent = '⏸';
    document.getElementById('replayPlayPause').classList.add('active');

    const baseInterval = 1000; // 1 second per candle at 1x
    const interval = baseInterval / this.replaySpeed;

    this.replayTimer = setInterval(() => {
      if (this.replayIndex >= this.replayData.length - 1) {
        this.pauseReplay();
        return;
      }
      this.stepReplayForward();
    }, interval);
  }

  pauseReplay() {
    this.replayPlaying = false;
    document.getElementById('replayPlayPause').textContent = '▶';
    document.getElementById('replayPlayPause').classList.remove('active');

    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  stopReplay() {
    this.pauseReplay();
    this.replayData = null;
    this.replayIndex = 0;
    this.replaySignals = [];
    this.replayResults = { wins: 0, losses: 0, pending: 0 };
  }

  resetReplay() {
    this.pauseReplay();
    this.replayIndex = 10;
    this.replaySignals = [];
    this.replayResults = { wins: 0, losses: 0, pending: 0 };
    this.updateReplayProgress();
    this.updateResultsDisplay();
    this.performReplayScan();
  }

  bindReplayEvents() {
    // Play/Pause button
    const playPauseBtn = document.getElementById('replayPlayPause');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => this.playReplay());
    }

    // Step buttons
    const stepBackBtn = document.getElementById('replayStepBack');
    if (stepBackBtn) {
      stepBackBtn.addEventListener('click', () => this.stepReplayBack());
    }

    const stepForwardBtn = document.getElementById('replayStepForward');
    if (stepForwardBtn) {
      stepForwardBtn.addEventListener('click', () => this.stepReplayForward());
    }

    // Speed selector
    const speedSelect = document.getElementById('replaySpeed');
    if (speedSelect) {
      speedSelect.addEventListener('change', (e) => {
        this.replaySpeed = parseFloat(e.target.value);
        // Restart if playing to apply new speed
        if (this.replayPlaying) {
          this.pauseReplay();
          this.playReplay();
        }
      });
    }

    // Progress bar click to seek
    const progressBar = document.getElementById('replayProgressBar');
    if (progressBar) {
      progressBar.addEventListener('click', (e) => {
        if (!this.replayData) return;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this.replayIndex = Math.floor(percent * this.replayData.length);
        this.replayIndex = Math.max(10, Math.min(this.replayIndex, this.replayData.length - 1));
        this.updateReplayProgress();
        this.performReplayScan();
      });
    }
  }
}

// Close alert popup function
function closeAlertPopup() {
  document.getElementById('alertPopup').classList.remove('show');
}

// Replay panel functions (global for onclick handlers)
function closeReplayPanel() {
  const panel = document.getElementById('replayPanel');
  if (panel) {
    panel.classList.remove('show');
  }
  // Switch back to realtime mode
  if (window.spyDashboard) {
    window.spyDashboard.dataMode = 'realtime';
    const btn = document.getElementById('replayBtn');
    btn.textContent = '🔴 Real-time';
    btn.classList.remove('active');
    window.spyDashboard.stopReplay();
    window.spyDashboard.updateConnectionStatus(true);
  }
}

function loadReplayData() {
  if (window.spyDashboard) {
    window.spyDashboard.loadReplayData();
  }
}

function resetReplay() {
  if (window.spyDashboard) {
    window.spyDashboard.resetReplay();
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
