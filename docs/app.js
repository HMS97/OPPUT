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
    this.dataCache = {}; // Cache for API responses
    this.cacheExpiry = 30000; // Cache expires after 30 seconds
    this.usingRealData = false; // Track if we're using real data
    this.replayDatetime = null; // Selected datetime for replay mode
    this.currentPrice = null; // Current/entry price for target calculation
    this.replayChart = null; // Lightweight chart for replay mode
    this.replayCandleSeries = null; // Candle series for replay chart

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

    // Replay controls
    document.getElementById('replayGoBtn').addEventListener('click', () => {
      this.runReplay();
    });

    document.getElementById('replayDatetime').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.runReplay();
    });

    // Set default replay datetime to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('replayDatetime').value = now.toISOString().slice(0, 16);
  }

  setDataMode(mode) {
    this.dataMode = mode;
    document.getElementById('realtimeBtn').classList.toggle('active', mode === 'realtime');
    document.getElementById('replayBtn').classList.toggle('active', mode === 'replay');
    document.getElementById('statusText').textContent = mode === 'realtime' ? 'Live' : 'Replay';

    // Show/hide replay controls
    const replayControls = document.getElementById('replayControls');
    if (replayControls) {
      replayControls.style.display = mode === 'replay' ? 'flex' : 'none';
    }

    // Switch between TradingView and Replay chart
    const tvChart = document.getElementById('tradingview_chart');
    const replayChartEl = document.getElementById('replay_chart');
    if (tvChart && replayChartEl) {
      tvChart.style.display = mode === 'realtime' ? 'block' : 'none';
      replayChartEl.style.display = mode === 'replay' ? 'block' : 'none';
    }

    // Clear cache when switching modes
    this.dataCache = {};

    if (mode === 'realtime') {
      this.replayDatetime = null;
      this.restartMonitoring();
    } else {
      // Stop auto-refresh in replay mode
      if (this.scanTimer) clearInterval(this.scanTimer);
      // Initialize replay chart if needed
      this.initReplayChart();
    }
  }

  initReplayChart() {
    if (this.replayChart) return; // Already initialized

    const container = document.getElementById('replay_chart');
    if (!container || typeof LightweightCharts === 'undefined') {
      console.warn('[SPY Dashboard] Lightweight Charts not available');
      return;
    }

    this.replayChart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#1a1a2e' },
        textColor: '#999'
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)'
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false
      }
    });

    this.replayCandleSeries = this.replayChart.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#e94560',
      borderUpColor: '#4ade80',
      borderDownColor: '#e94560',
      wickUpColor: '#4ade80',
      wickDownColor: '#e94560'
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (this.replayChart && this.dataMode === 'replay') {
        this.replayChart.applyOptions({ width: container.clientWidth });
      }
    });
  }

  updateReplayChart(candles) {
    if (!this.replayCandleSeries || !candles || candles.length === 0) return;

    // Convert candles to Lightweight Charts format
    const chartData = candles.map(c => ({
      time: Math.floor(c.time / 1000), // Convert ms to seconds
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    this.replayCandleSeries.setData(chartData);
    this.replayChart.timeScale().fitContent();
  }

  async runReplay() {
    const datetimeInput = document.getElementById('replayDatetime').value;
    if (!datetimeInput) {
      alert('Please select a date and time');
      return;
    }

    this.replayDatetime = new Date(datetimeInput);
    this.dataCache = {}; // Clear cache

    document.getElementById('statusText').textContent = `Replay: ${this.replayDatetime.toLocaleString()}`;

    // Run single scan for the selected datetime
    await this.performScan();
  }

  async setChartTimeframe(tf) {
    this.currentChartTF = tf;
    document.querySelectorAll('.chart-tab').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.tf) === tf);
    });

    if (this.dataMode === 'realtime') {
      // Update TradingView chart
      if (this.widget && this.widget.chart) {
        this.widget.chart().setResolution(TF_CONFIG[tf].interval);
      }
    } else {
      // Update replay chart with selected timeframe data
      const cacheKey = `spy_${tf}`;
      const cached = this.dataCache[cacheKey];
      if (cached && cached.data) {
        this.updateReplayChart(cached.data);
      }
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

        // Update replay chart if in replay mode
        if (this.dataMode === 'replay') {
          this.updateReplayChart(priceData);
        }
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

    // Verify elements exist
    if (!card || !badge || !meter || !patternsList) {
      console.warn(`[SPY Dashboard] Missing elements for timeframe ${tfId}`);
      return;
    }

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
    const signalValueEl = document.getElementById('overallSignalValue');
    const meterEl = document.getElementById('overallMeter');

    if (signalValueEl) signalValueEl.textContent = `${Math.round(signal.strength)}%`;
    if (meterEl) meterEl.style.width = `${signal.strength}%`;

    // Update confluence dots
    for (const tf of this.timeframes) {
      const tfId = TF_CONFIG[tf].id;
      const dot = document.getElementById(`conf${tfId}`);
      if (dot) dot.classList.toggle('active', signal.activeTimeframes.includes(tf));
    }

    // Update status box
    const statusBox = document.getElementById('overallStatus');
    if (!statusBox) return;
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

    // Update target price if signal is strong enough
    this.updateTargetPrice(signal.strength);
  }

  calculateTargetPrice(candles, signalStrength) {
    if (!candles || candles.length < 20 || !this.currentPrice) {
      return null;
    }

    // Calculate ATR (Average True Range) for volatility-based target
    let atrSum = 0;
    for (let i = 1; i < Math.min(14, candles.length); i++) {
      const high = candles[candles.length - i].high;
      const low = candles[candles.length - i].low;
      const prevClose = candles[candles.length - i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSum += tr;
    }
    const atr = atrSum / 14;

    // Find recent support levels (swing lows)
    const recentCandles = candles.slice(-50);
    const lows = recentCandles.map(c => c.low);
    const sortedLows = [...lows].sort((a, b) => a - b);
    const supportLevel = sortedLows[Math.floor(sortedLows.length * 0.1)]; // 10th percentile

    // Calculate target based on signal strength
    // Stronger signal = larger target move
    const strengthMultiplier = signalStrength >= 75 ? 2.0 : signalStrength >= 50 ? 1.5 : 1.0;
    const atrTarget = this.currentPrice - (atr * strengthMultiplier);

    // Use the more conservative of ATR target or support level
    const targetPrice = Math.max(atrTarget, supportLevel);

    return {
      target: targetPrice,
      atr: atr,
      support: supportLevel,
      distance: ((this.currentPrice - targetPrice) / this.currentPrice) * 100
    };
  }

  updateTargetPrice(signalStrength) {
    const targetSection = document.getElementById('targetPriceSection');
    const targetPriceEl = document.getElementById('targetPrice');
    const targetDistanceEl = document.getElementById('targetDistance');

    if (!targetSection) return;

    // Only show target when signal is meaningful
    if (signalStrength < 30 || !this.currentPrice) {
      targetSection.style.display = 'none';
      return;
    }

    // Get candles from cache for calculation
    const cacheKey = 'spy_5';
    const cached = this.dataCache[cacheKey];
    if (!cached) {
      targetSection.style.display = 'none';
      return;
    }

    const result = this.calculateTargetPrice(cached.data, signalStrength);
    if (!result) {
      targetSection.style.display = 'none';
      return;
    }

    targetSection.style.display = 'block';
    targetPriceEl.textContent = result.target.toFixed(2);
    targetDistanceEl.textContent = `-${result.distance.toFixed(2)}%`;
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

    // Store current price for target calculation
    this.currentPrice = current.close;

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

  async fetchCandleData(timeframe) {
    // Always try to fetch real SPY data (Yahoo Finance works even when market is closed)
    const cacheKey = `spy_${timeframe}`;
    const cached = this.dataCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const realData = await this.fetchRealSPYData(timeframe);
      if (realData && realData.length >= 10) {
        // Cache the result
        this.dataCache[cacheKey] = { data: realData, timestamp: Date.now() };
        if (!this.usingRealData) {
          this.usingRealData = true;
          this.updateDataSourceStatus(true);
        }
        return realData;
      }
    } catch (e) {
      console.error('[SPY Dashboard] Real data fetch failed:', e.message);
      if (this.usingRealData) {
        this.usingRealData = false;
        this.updateDataSourceStatus(false);
      }
    }

    // Only use simulated data if ALL API attempts fail
    console.warn('[SPY Dashboard] All data sources failed, using fallback data');
    return this.generateSPYData(timeframe);
  }

  updateDataSourceStatus(isReal) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = isReal ? 'Live Data' : 'Demo Data';
      statusText.style.color = isReal ? '#4ade80' : '#fbbf24';
    }
  }

  async fetchRealSPYData(timeframe) {
    // Map timeframe to Yahoo Finance parameters
    const tfConfig = {
      5: { interval: '5m', range: '1d', lookback: 1 },
      15: { interval: '15m', range: '5d', lookback: 5 },
      60: { interval: '60m', range: '1mo', lookback: 30 },
      240: { interval: '1d', range: '3mo', lookback: 90 }  // 4h not available, use daily
    };

    const config = tfConfig[timeframe] || tfConfig[5];
    const symbol = 'SPY';

    let url;

    // Use period1/period2 for replay mode to get historical data
    if (this.replayDatetime) {
      const endTime = Math.floor(this.replayDatetime.getTime() / 1000);
      const startTime = endTime - (config.lookback * 24 * 60 * 60);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`;
    } else {
      // Real-time: use range parameter
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&range=${config.range}`;
    }

    // Multiple CORS proxies for reliability
    const corsProxies = [
      (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://cors-anywhere.herokuapp.com/${u}`
    ];

    let response;
    let lastError;

    // Try direct fetch first
    try {
      response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        return this.parseYahooData(data, timeframe);
      }
    } catch (e) {
      lastError = e;
    }

    // Try each CORS proxy
    for (const proxyFn of corsProxies) {
      try {
        const proxyUrl = proxyFn(url);
        response = await fetch(proxyUrl);
        if (response.ok) {
          const data = await response.json();
          return this.parseYahooData(data, timeframe);
        }
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    throw lastError || new Error('All fetch attempts failed');
  }

  parseYahooData(data, timeframe) {
    if (!data.chart?.result?.[0]) {
      throw new Error('Invalid response format');
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    if (!timestamps || !quote) {
      throw new Error('Missing price data');
    }

    // Convert to candle format
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] != null && quote.close[i] != null) {
        candles.push({
          time: timestamps[i] * 1000,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0
        });
      }
    }

    console.log(`[SPY Dashboard] Fetched ${candles.length} real candles for ${timeframe}m`);
    return candles;
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
    if (dot) {
      dot.style.background = connected ? '#4ade80' : '#e94560';
    }
  }
}

function closeAlertPopup() {
  document.getElementById('alertPopup').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
