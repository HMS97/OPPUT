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
  // Price action patterns
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
  'PRICE_STALLING_LOW': '⏸️',
  // V2 Indicator patterns
  'RSI_OVERBOUGHT': '🔺',
  'RSI_OVERSOLD': '🔻',
  'RSI_BEARISH_DIVERGENCE': '↘️',
  'RSI_BULLISH_DIVERGENCE': '↗️',
  'BB_UPPER_TOUCH': '📊',
  'BB_LOWER_TOUCH': '📊',
  'BB_SQUEEZE_BULLISH': '🎯',
  'BB_SQUEEZE_BEARISH': '🎯',
  'EMA_BULLISH_CROSS': '✖️',
  'EMA_BEARISH_CROSS': '✖️',
  'EMA_OVEREXTENDED_UP': '⬆️',
  'EMA_OVEREXTENDED_DOWN': '⬇️',
  'MACD_BULLISH_CROSS': '〽️',
  'MACD_BEARISH_CROSS': '〽️',
  'MACD_HIST_BULLISH': '📶',
  'MACD_HIST_BEARISH': '📶',
  'VOLUME_SPIKE_BULLISH': '📢',
  'VOLUME_SPIKE_BEARISH': '📢'
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

    // Replay controls (with null checks)
    const replayGoBtn = document.getElementById('replayGoBtn');
    const replayDatetime = document.getElementById('replayDatetime');

    if (replayGoBtn) {
      replayGoBtn.addEventListener('click', () => {
        this.runReplay();
      });
    }

    if (replayDatetime) {
      replayDatetime.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.runReplay();
      });

      // Set default replay datetime to now
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      replayDatetime.value = now.toISOString().slice(0, 16);
    }
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

    // Parse datetime-local input properly (it's in local time)
    // Format: "2024-01-15T14:30"
    const [datePart, timePart] = datetimeInput.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);

    // Create date in local timezone
    this.replayDatetime = new Date(year, month - 1, day, hours, minutes, 0, 0);

    // Validate date is not in the future
    if (this.replayDatetime > new Date()) {
      alert('Cannot replay future dates');
      return;
    }

    // Validate date is not too old (Yahoo Finance 5m data limited to ~60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 58);
    if (this.replayDatetime < sixtyDaysAgo) {
      alert('Date too old. Yahoo Finance only provides 5-minute data for the last 60 days.');
      return;
    }

    this.dataCache = {}; // Clear cache

    document.getElementById('statusText').textContent = `Replay: ${this.replayDatetime.toLocaleString()}`;
    document.getElementById('statusText').style.color = '#60a5fa'; // Blue for replay mode
    console.log(`[SPY Dashboard] Replay datetime: ${this.replayDatetime.toISOString()}, Unix: ${Math.floor(this.replayDatetime.getTime() / 1000)}`);

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

        // Update replay chart if in replay mode with selected timeframe data
        if (this.dataMode === 'replay') {
          const chartCacheKey = `spy_${this.currentChartTF}`;
          const chartData = this.dataCache[chartCacheKey];
          if (chartData && chartData.data) {
            this.updateReplayChart(chartData.data);
          } else {
            this.updateReplayChart(priceData);
          }
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

      // Trigger alert only for GOOD START POINTS
      // Requires: strength >= 60 AND at least 2 indicator confirmations AND 2+ timeframes
      if (this.isGoodStartPoint(combinedSignal, allPatterns) &&
          Date.now() - this.lastAlertTime > this.alertCooldown) {
        this.triggerAlert(combinedSignal, allPatterns);
      }

    } catch (e) {
      console.error('[SPY Dashboard] Scan failed:', e);
    }
  }

  /**
   * Determine if current signal is a GOOD START POINT for entry
   * Based on 2025 best practices: multiple indicator confluence required
   */
  isGoodStartPoint(signal, patterns) {
    // Must have minimum strength
    if (signal.strength < 60) return false;

    // Must have at least 2 timeframes confirming
    if (signal.activeTimeframes.length < 2) return false;

    // Count indicator-based patterns for the dominant direction
    const indicatorTypes = [
      'RSI_OVERBOUGHT', 'RSI_OVERSOLD', 'RSI_BEARISH_DIVERGENCE', 'RSI_BULLISH_DIVERGENCE',
      'BB_UPPER_TOUCH', 'BB_LOWER_TOUCH', 'BB_SQUEEZE_BULLISH', 'BB_SQUEEZE_BEARISH',
      'EMA_BULLISH_CROSS', 'EMA_BEARISH_CROSS',
      'MACD_BULLISH_CROSS', 'MACD_BEARISH_CROSS', 'MACD_HIST_BULLISH', 'MACD_HIST_BEARISH',
      'VOLUME_SPIKE_BULLISH', 'VOLUME_SPIKE_BEARISH'
    ];

    const priceActionTypes = [
      'LOWER_HIGH', 'HIGHER_LOW', 'REJECTION_AT_RESISTANCE', 'REJECTION_AT_SUPPORT',
      'FALSE_BREAKOUT', 'FALSE_BREAKOUT_DOWN', 'ABSORPTION', 'ABSORPTION_BUYING',
      'DOUBLE_REJECTION', 'DOUBLE_REJECTION_BOTTOM'
    ];

    // Filter patterns matching signal direction
    const directionPatterns = patterns.filter(p => p.signal === signal.direction);

    // Count indicator confirmations
    let indicatorCount = 0;
    let priceActionCount = 0;
    const seenIndicatorCategories = new Set();

    for (const p of directionPatterns) {
      if (indicatorTypes.includes(p.type)) {
        // Count unique indicator categories (RSI, BB, EMA, MACD, VOLUME)
        const category = p.type.split('_')[0];
        if (!seenIndicatorCategories.has(category)) {
          seenIndicatorCategories.add(category);
          indicatorCount++;
        }
      }
      if (priceActionTypes.includes(p.type)) {
        priceActionCount++;
      }
    }

    // GOOD START POINT criteria:
    // Option A: At least 2 different indicator categories confirming
    // Option B: 1 indicator + 2 price action patterns
    // Option C: Very high strength (75+) with any indicator confirmation
    const hasIndicatorConfluence = indicatorCount >= 2;
    const hasMixedConfluence = indicatorCount >= 1 && priceActionCount >= 2;
    const hasStrongSignal = signal.strength >= 75 && indicatorCount >= 1;

    const isGoodStart = hasIndicatorConfluence || hasMixedConfluence || hasStrongSignal;

    if (isGoodStart) {
      console.log(`[GOOD START POINT] ${signal.direction} ${signal.strength.toFixed(0)}% - ` +
        `Indicators: ${indicatorCount} (${Array.from(seenIndicatorCategories).join(', ')}), ` +
        `Price Action: ${priceActionCount}, TFs: ${signal.activeTimeframes.length}`);
    }

    return isGoodStart;
  }

  calculateCombinedSignal() {
    let putWeight = 0;
    let callWeight = 0;
    let activeTimeframes = [];
    let totalIndicatorCount = 0;
    let indicatorCategories = new Set();

    for (const tf of this.timeframes) {
      const signal = this.signals[tf];
      if (signal.strength > 0) {
        activeTimeframes.push(tf);
        if (signal.direction === 'PUT') {
          putWeight += signal.putWeight || signal.strength;
        } else if (signal.direction === 'CALL') {
          callWeight += signal.callWeight || signal.strength;
        }

        // Track indicator counts from V2 signals
        if (signal.putIndicatorCount) totalIndicatorCount += signal.putIndicatorCount;
        if (signal.callIndicatorCount) totalIndicatorCount += signal.callIndicatorCount;

        // Track indicator summary
        if (signal.indicators) {
          if (signal.indicators.rsi) indicatorCategories.add('RSI');
          if (signal.indicators.ema) indicatorCategories.add('EMA');
          if (signal.indicators.macd) indicatorCategories.add('MACD');
          if (signal.indicators.bollingerBands) indicatorCategories.add('BB');
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

    // Confluence bonus - enhanced with indicator bonus
    let confluenceBonus = 0;
    if (activeTimeframes.length >= 4) confluenceBonus = 25;
    else if (activeTimeframes.length === 3) confluenceBonus = 15;
    else if (activeTimeframes.length === 2) confluenceBonus = 10;

    // Additional indicator confluence bonus
    if (indicatorCategories.size >= 3) confluenceBonus += 10;
    else if (indicatorCategories.size >= 2) confluenceBonus += 5;

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
      confluenceBonus,
      indicatorCount: totalIndicatorCount,
      indicatorCategories: Array.from(indicatorCategories)
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

    // Update patterns with signal type
    if (patterns.length > 0) {
      patternsList.innerHTML = patterns.slice(0, 3).map(p => `
        <div class="tf-pattern-item ${p.signal ? p.signal.toLowerCase() : ''}">
          <span class="tf-pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
          <span>${p.name} (${p.signal || 'PUT'})</span>
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

    // Update confluence dots with direction color
    for (const tf of this.timeframes) {
      const tfId = TF_CONFIG[tf].id;
      const dot = document.getElementById(`conf${tfId}`);
      if (dot) {
        dot.classList.toggle('active', signal.activeTimeframes.includes(tf));
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
    if (!container) return;

    if (patterns.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No patterns detected</p>';
      return;
    }

    // Sort by timeframe (higher TF first for importance)
    const sorted = [...patterns].sort((a, b) => b.timeframe - a.timeframe);

    container.innerHTML = sorted.slice(0, 8).map(p => `
      <div class="pattern-item ${p.signal ? p.signal.toLowerCase() : ''}">
        <span class="pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
        <div class="pattern-info">
          <div class="pattern-name">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
        </div>
        <span class="pattern-tf">${TF_CONFIG[p.timeframe].name}</span>
        <span class="pattern-signal ${p.signal ? p.signal.toLowerCase() : ''}">${p.signal || 'PUT'}</span>
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
    // Don't update status in replay mode
    if (this.dataMode === 'replay') return;

    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = isReal ? 'Live Data' : 'Demo Data';
      statusText.style.color = isReal ? '#4ade80' : '#fbbf24';
    }
  }

  async fetchRealSPYData(timeframe) {
    // Try TradingView backend API first (if server is running)
    try {
      const candles = await this.fetchFromTradingViewAPI(timeframe);
      if (candles && candles.length >= 10) {
        console.log(`[SPY Dashboard] Using TradingView API data`);
        return candles;
      }
    } catch (e) {
      console.log(`[SPY Dashboard] TradingView API not available: ${e.message}`);
    }

    // Fallback to Yahoo Finance
    return this.fetchFromYahooFinance(timeframe);
  }

  async fetchFromTradingViewAPI(timeframe) {
    // Determine API base URL (same host as the page, or localhost:3000 for dev)
    const baseUrl = window.location.port === ''
      ? `${window.location.origin}`
      : 'http://localhost:3000';

    let url = `${baseUrl}/api/spy/${timeframe}`;

    // Add replay timestamp if in replay mode
    if (this.replayDatetime) {
      url += `?replay=${this.replayDatetime.getTime()}`;
    }

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !data.candles) {
      throw new Error(data.error || 'Invalid response');
    }

    console.log(`[SPY Dashboard] TradingView: ${data.candles.length} candles for ${timeframe}m`);
    return data.candles;
  }

  async fetchFromYahooFinance(timeframe) {
    // Map timeframe to Yahoo Finance parameters
    const tfConfig = {
      5: { interval: '5m', range: '5d', lookback: 5 },
      15: { interval: '15m', range: '1mo', lookback: 15 },
      60: { interval: '60m', range: '3mo', lookback: 60 },
      240: { interval: '1d', range: '1y', lookback: 180 }
    };

    const config = tfConfig[timeframe] || tfConfig[5];
    const symbol = 'SPY';

    let url;

    // Use period1/period2 for replay mode to get historical data
    if (this.replayDatetime) {
      const endTime = Math.floor(this.replayDatetime.getTime() / 1000);
      const startTime = endTime - (config.lookback * 24 * 60 * 60);
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${config.interval}&period1=${startTime}&period2=${endTime}`;
      console.log(`[SPY Dashboard] Yahoo replay: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);
    } else {
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

    // Get the cutoff time for replay mode
    const cutoffTime = this.replayDatetime ? this.replayDatetime.getTime() : null;

    // Convert to candle format
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const candleTime = timestamps[i] * 1000;

      // In replay mode, only include candles up to the selected datetime
      if (cutoffTime && candleTime > cutoffTime) {
        continue;
      }

      if (quote.open[i] != null && quote.close[i] != null) {
        candles.push({
          time: candleTime,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0
        });
      }
    }

    if (candles.length > 0) {
      const firstCandle = candles[0];
      const lastCandle = candles[candles.length - 1];
      console.log(`[SPY Dashboard] Fetched ${candles.length} candles for ${timeframe}m: ${new Date(firstCandle.time).toLocaleString()} to ${new Date(lastCandle.time).toLocaleString()}, last price: ${lastCandle.close.toFixed(2)}`);
      if (cutoffTime) {
        console.log(`[SPY Dashboard] Replay cutoff: ${new Date(cutoffTime).toLocaleString()}`);
      }
    } else {
      console.log(`[SPY Dashboard] No candles returned for ${timeframe}m`);
    }
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
      direction: signal.direction,
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
    if (!container) return;

    if (this.alerts.length === 0) {
      container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No alerts yet</p>';
      return;
    }

    container.innerHTML = this.alerts.slice(0, 10).map(a => `
      <div class="alert-item ${(a.direction || 'put').toLowerCase()}">
        <div class="alert-header">
          <span class="alert-type ${(a.direction || 'put').toLowerCase()}">${a.direction || 'PUT'} ${Math.round(a.strength)}%</span>
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

    // Get indicator patterns for display
    const indicatorPatterns = patterns.filter(p =>
      p.signal === signal.direction && (
        p.type.startsWith('RSI_') || p.type.startsWith('BB_') ||
        p.type.startsWith('EMA_') || p.type.startsWith('MACD_') ||
        p.type.startsWith('VOLUME_')
      )
    );

    const pricePatterns = patterns.filter(p =>
      p.signal === signal.direction && !indicatorPatterns.includes(p)
    );

    contentEl.innerHTML = `
      <p style="color:#4ade80;font-weight:bold;">GOOD START POINT</p>
      <p><strong>Direction:</strong> ${signal.direction}</p>
      <p><strong>Timeframes:</strong> ${signal.activeTimeframes.length}/4 aligned</p>
      ${signal.indicatorCategories && signal.indicatorCategories.length > 0 ?
        `<p><strong>Indicators:</strong> ${signal.indicatorCategories.join(', ')}</p>` : ''}
      <p style="margin-top:8px;"><strong>Key Signals:</strong></p>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;">
        ${indicatorPatterns.slice(0, 3).map(p => `<li>${p.name}</li>`).join('')}
        ${pricePatterns.slice(0, 2).map(p => `<li>${p.name}</li>`).join('')}
      </ul>
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
  document.getElementById('alertPopup').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard();
});
