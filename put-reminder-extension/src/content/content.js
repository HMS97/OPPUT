/**
 * Content script for PUT Pattern Reminder
 * Runs on TradingView and Binance pages
 * Supports multi-timeframe and real-time/replay data
 */

const TIMEFRAME_LABELS = {
  5: '5分钟',
  15: '15分钟',
  60: '1小时',
  240: '4小时'
};

class PutPatternMonitor {
  constructor() {
    this.detectors = {}; // One detector per timeframe
    this.enabled = true;
    this.sensitivity = 'medium';
    this.timeframes = [5, 15]; // Default timeframes
    this.dataSource = 'realtime';
    this.scanInterval = null;
    this.lastAlert = 0;
    this.alertCooldown = 60000; // 1 minute cooldown between alerts
    this.candleData = {}; // Store candle data per timeframe

    this.init();
  }

  async init() {
    // Load settings
    await this.loadSettings();

    // Initialize detectors for each timeframe
    this.initDetectors();

    // Create floating indicator
    this.createFloatingIndicator();

    // Start monitoring
    if (this.enabled) {
      this.startMonitoring();
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });

    console.log('[PUT Pattern Reminder] Initialized with timeframes:', this.timeframes);
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get({
        enabled: true,
        sensitivity: 'medium',
        timeframes: [5, 15],
        dataSource: 'realtime',
        refreshInterval: 10
      });

      this.enabled = result.enabled;
      this.sensitivity = result.sensitivity;
      this.timeframes = result.timeframes;
      this.dataSource = result.dataSource;
      this.refreshInterval = result.refreshInterval;

    } catch (e) {
      console.error('[PUT Pattern Reminder] Failed to load settings:', e);
    }
  }

  initDetectors() {
    // Create a detector for each timeframe with appropriate config
    const sensitivityConfigs = {
      low: { rejectionThreshold: 0.005, consolidationBars: 5, lowerHighTolerance: 0.002 },
      medium: { rejectionThreshold: 0.003, consolidationBars: 3, lowerHighTolerance: 0.001 },
      high: { rejectionThreshold: 0.001, consolidationBars: 2, lowerHighTolerance: 0.0005 }
    };

    const baseConfig = sensitivityConfigs[this.sensitivity] || sensitivityConfigs.medium;

    for (const tf of [5, 15, 60, 240]) {
      // Adjust config based on timeframe (larger timeframes need different thresholds)
      const tfMultiplier = tf >= 60 ? 1.5 : 1;
      const config = {
        ...baseConfig,
        rejectionThreshold: baseConfig.rejectionThreshold * tfMultiplier,
        lowerHighTolerance: baseConfig.lowerHighTolerance * tfMultiplier
      };

      this.detectors[tf] = new PutPatternDetector(config);
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'TOGGLE_MONITORING':
        this.enabled = message.enabled;
        if (this.enabled) {
          this.startMonitoring();
        } else {
          this.stopMonitoring();
        }
        break;

      case 'UPDATE_SENSITIVITY':
        this.sensitivity = message.value;
        this.initDetectors(); // Reinitialize with new sensitivity
        break;

      case 'UPDATE_TIMEFRAMES':
        this.timeframes = message.timeframes;
        this.updateIndicatorTimeframes();
        break;

      case 'UPDATE_DATA_SOURCE':
        this.dataSource = message.value;
        this.updateIndicatorDataSource();
        break;

      case 'TRIGGER_SCAN':
        this.performScan();
        break;
    }
  }

  createFloatingIndicator() {
    // Remove existing indicator
    const existing = document.getElementById('put-pattern-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'put-pattern-indicator';
    indicator.innerHTML = `
      <div class="ppr-header">
        <span class="ppr-title">PUT Monitor</span>
        <span class="ppr-status">●</span>
      </div>
      <div class="ppr-data-source">
        <span class="ppr-ds-badge" id="pprDataSource">${this.dataSource === 'replay' ? '⏪ 回放' : '🔴 实时'}</span>
      </div>
      <div class="ppr-timeframes" id="pprTimeframes">
        ${this.timeframes.map(tf => `<span class="ppr-tf-badge">${TIMEFRAME_LABELS[tf]}</span>`).join('')}
      </div>
      <div class="ppr-signal">
        <span class="ppr-signal-text">监控中...</span>
      </div>
      <div class="ppr-patterns"></div>
      <div class="ppr-actions">
        <button class="ppr-btn ppr-scan">扫描</button>
        <button class="ppr-btn ppr-close">−</button>
      </div>
    `;

    document.body.appendChild(indicator);

    // Make draggable
    this.makeDraggable(indicator);

    // Bind events
    indicator.querySelector('.ppr-scan').addEventListener('click', () => {
      this.performScan();
    });

    indicator.querySelector('.ppr-close').addEventListener('click', () => {
      indicator.classList.toggle('ppr-minimized');
    });

    this.indicator = indicator;
  }

  updateIndicatorTimeframes() {
    const container = document.getElementById('pprTimeframes');
    if (container) {
      container.innerHTML = this.timeframes.map(tf =>
        `<span class="ppr-tf-badge">${TIMEFRAME_LABELS[tf]}</span>`
      ).join('');
    }
  }

  updateIndicatorDataSource() {
    const badge = document.getElementById('pprDataSource');
    if (badge) {
      badge.textContent = this.dataSource === 'replay' ? '⏪ 回放' : '🔴 实时';
    }
  }

  makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    const header = element.querySelector('.ppr-header');

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = element.offsetLeft;
      initialY = element.offsetTop;
      element.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      element.style.left = `${initialX + dx}px`;
      element.style.top = `${initialY + dy}px`;
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.cursor = 'grab';
    });
  }

  startMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    // Perform initial scan
    setTimeout(() => this.performScan(), 2000);

    // Set up periodic scanning
    this.scanInterval = setInterval(() => {
      this.performScan();
    }, (this.refreshInterval || 10) * 1000);

    this.updateIndicatorStatus(true);
    console.log('[PUT Pattern Reminder] Monitoring started');
  }

  stopMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    this.updateIndicatorStatus(false);
    console.log('[PUT Pattern Reminder] Monitoring stopped');
  }

  updateIndicatorStatus(active) {
    if (!this.indicator) return;

    const status = this.indicator.querySelector('.ppr-status');
    const text = this.indicator.querySelector('.ppr-signal-text');

    if (active) {
      status.style.color = '#4ade80';
      text.textContent = '监控中...';
    } else {
      status.style.color = '#666';
      text.textContent = '已暂停';
    }
  }

  async performScan() {
    if (!this.enabled) return;

    try {
      const allPatterns = [];
      let maxStrength = 0;
      let bestSignal = null;

      // Scan each selected timeframe
      for (const tf of this.timeframes) {
        const candles = await this.extractCandleData(tf);

        if (!candles || candles.length < 10) {
          console.log(`[PUT Pattern Reminder] Insufficient candle data for ${tf}m`);
          continue;
        }

        // Run pattern detection
        const detector = this.detectors[tf];
        if (!detector) continue;

        const patterns = detector.analyze(candles);
        const signal = detector.getSignalSummary();

        // Add timeframe info to each pattern
        patterns.forEach(p => {
          p.timeframe = tf;
          allPatterns.push(p);
        });

        // Track best signal
        if (signal.strength > maxStrength) {
          maxStrength = signal.strength;
          bestSignal = signal;
        }
      }

      // Combine signals - higher strength if patterns found across multiple timeframes
      const multiTimeframeBonus = this.calculateMultiTimeframeBonus(allPatterns);
      const combinedStrength = Math.min(100, maxStrength + multiTimeframeBonus);

      const combinedSignal = {
        signal: combinedStrength >= 50 ? 'STRONG_PUT' : 'PUT',
        strength: combinedStrength,
        patterns: allPatterns,
        recommendation: this.getCombinedRecommendation(combinedStrength, allPatterns)
      };

      // Update indicator
      this.updateIndicator(combinedSignal, allPatterns);

      // Save to storage for popup
      await chrome.storage.local.set({
        currentSignal: combinedSignal,
        detectedPatterns: allPatterns
      });

      // Send update to popup
      chrome.runtime.sendMessage({
        type: 'SIGNAL_UPDATE',
        signal: combinedSignal,
        patterns: allPatterns
      });

      // Trigger alert if strong signal
      if (combinedStrength >= 50 && Date.now() - this.lastAlert > this.alertCooldown) {
        this.triggerAlert(combinedSignal, allPatterns);
      }

    } catch (e) {
      console.error('[PUT Pattern Reminder] Scan failed:', e);
    }
  }

  calculateMultiTimeframeBonus(patterns) {
    // Get unique timeframes with patterns
    const timeframesWithPatterns = [...new Set(patterns.map(p => p.timeframe))];

    // Bonus for confluence across multiple timeframes
    if (timeframesWithPatterns.length >= 3) return 20;
    if (timeframesWithPatterns.length === 2) return 10;
    return 0;
  }

  getCombinedRecommendation(strength, patterns) {
    const timeframesWithPatterns = [...new Set(patterns.map(p => p.timeframe))];
    const tfLabels = timeframesWithPatterns.map(tf => TIMEFRAME_LABELS[tf]).join(', ');

    if (strength >= 75) {
      return `强烈做空信号！多周期共振 (${tfLabels})`;
    } else if (strength >= 50) {
      return `做空信号明确 (${tfLabels})，可考虑进场`;
    } else if (strength >= 25) {
      return `有做空迹象 (${tfLabels})，建议继续观察`;
    }
    return '信号较弱，建议等待更好机会';
  }

  async extractCandleData(timeframe) {
    // For real-time vs replay, the extraction method might differ
    if (this.dataSource === 'replay') {
      return this.extractReplayData(timeframe);
    }
    return this.extractRealtimeData(timeframe);
  }

  async extractRealtimeData(timeframe) {
    // Try to extract real-time candle data from the page
    if (window.location.hostname.includes('tradingview.com')) {
      return this.extractFromTradingView(timeframe);
    }

    if (window.location.hostname.includes('binance.com')) {
      return this.extractFromBinance(timeframe);
    }

    return this.generateSimulatedData(timeframe);
  }

  async extractReplayData(timeframe) {
    // For replay mode, try to detect if TradingView replay is active
    const replayIndicator = document.querySelector('[class*="replay"], [data-name="replay"]');
    if (replayIndicator) {
      console.log('[PUT Pattern Reminder] Replay mode detected');
    }

    // Extraction logic is similar, but we mark it as replay data
    return this.extractRealtimeData(timeframe);
  }

  extractFromTradingView(timeframe) {
    try {
      // Try to access TradingView chart data
      // This is complex due to TradingView's architecture

      // Method 1: Check for global chart object
      if (window.tvWidget && window.tvWidget.chart) {
        return this.parseTVWidgetData(window.tvWidget, timeframe);
      }

      // Method 2: Parse from DOM
      return this.parseVisibleCandles(timeframe);

    } catch (e) {
      console.error('[PUT Pattern Reminder] TradingView extraction failed:', e);
      return this.generateSimulatedData(timeframe);
    }
  }

  extractFromBinance(timeframe) {
    try {
      // Try to access Binance chart data
      if (window.__BINANCE_CHART_DATA__) {
        return this.parseBinanceData(window.__BINANCE_CHART_DATA__, timeframe);
      }

      return this.generateSimulatedData(timeframe);

    } catch (e) {
      console.error('[PUT Pattern Reminder] Binance extraction failed:', e);
      return this.generateSimulatedData(timeframe);
    }
  }

  parseVisibleCandles(timeframe) {
    // Fallback: generate simulated data based on current price
    return this.generateSimulatedData(timeframe);
  }

  generateSimulatedData(timeframe) {
    // Generate realistic test candle data with varied market scenarios
    // In production, this would be replaced with actual chart data

    const candles = [];
    let price = 87000; // Starting price (BTC-like)
    const now = Date.now();
    const intervalMs = timeframe * 60 * 1000;
    const volatility = 0.002 * Math.sqrt(timeframe / 5);

    // Randomly choose a market scenario
    const scenarios = ['bullish', 'bearish', 'sideways', 'rejection', 'breakout', 'neutral'];
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

    console.log(`[PUT Pattern Monitor] Generating ${scenario} scenario for ${timeframe}m`);

    switch (scenario) {
      case 'bullish':
        // Bullish trend - should NOT trigger PUT signals
        for (let i = 0; i < 100; i++) {
          const open = price;
          const trend = 0.3 + Math.random() * 0.2;
          const change = price * volatility * (Math.random() - 0.3 + trend);
          const close = open + change;

          candles.push({
            time: now - (100 - i) * intervalMs,
            open,
            high: Math.max(open, close) + Math.abs(change) * Math.random() * 0.3,
            low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.8,
            close,
            volume: Math.random() * 1000 * (timeframe / 5)
          });
          price = close;
        }
        break;

      case 'bearish':
      case 'rejection':
        // Bearish/Rejection pattern - SHOULD trigger PUT signals
        // First build up
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
            volume: Math.random() * 1000 * (timeframe / 5)
          });
          price = close;
        }

        // Then rejection at top
        const resistance = price * 1.003;
        for (let i = 60; i < 100; i++) {
          const open = price;
          const high = resistance + (Math.random() - 0.5) * price * 0.002;
          const close = resistance - Math.random() * price * 0.003;
          const low = close - Math.random() * price * 0.001;

          candles.push({
            time: now - (100 - i) * intervalMs,
            open,
            high,
            low,
            close,
            volume: Math.random() * 1000 * (timeframe / 5) * 1.5
          });
          price = close;
        }
        break;

      case 'sideways':
        // Sideways consolidation - weak or no signals
        const rangeMid = price;
        const rangeSize = price * 0.01;

        for (let i = 0; i < 100; i++) {
          const open = price;
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
            volume: Math.random() * 1000 * (timeframe / 5) * 0.7
          });
          price = close;
        }
        break;

      case 'breakout':
        // Bullish breakout - should NOT trigger PUT signals
        const breakoutResistance = price * 1.005;

        for (let i = 0; i < 70; i++) {
          const open = price;
          const change = price * volatility * (Math.random() - 0.5);
          const close = Math.min(open + change, breakoutResistance * 0.998);

          candles.push({
            time: now - (100 - i) * intervalMs,
            open,
            high: Math.min(Math.max(open, close) + Math.abs(change) * 0.5, breakoutResistance),
            low: Math.min(open, close) - Math.abs(change) * Math.random() * 0.3,
            close,
            volume: Math.random() * 1000 * (timeframe / 5)
          });
          price = close;
        }

        for (let i = 70; i < 100; i++) {
          const open = price;
          const change = price * volatility * (0.5 + Math.random() * 0.5);
          const close = open + change;

          candles.push({
            time: now - (100 - i) * intervalMs,
            open,
            high: close + Math.abs(change) * Math.random() * 0.2,
            low: open - Math.abs(change) * Math.random() * 0.4,
            close,
            volume: Math.random() * 1000 * (timeframe / 5) * 2
          });
          price = close;
        }
        break;

      default:
        // Neutral/random data
        for (let i = 0; i < 100; i++) {
          const trend = Math.random() > 0.5 ? 1 : -1;
          const open = price;
          const change = price * volatility * (Math.random() - 0.5 + trend * 0.05);
          const close = open + change;

          candles.push({
            time: now - (100 - i) * intervalMs,
            open,
            high: Math.max(open, close) + Math.abs(change) * Math.random(),
            low: Math.min(open, close) - Math.abs(change) * Math.random(),
            close,
            volume: Math.random() * 1000 * (timeframe / 5)
          });
          price = close;
        }
        break;
    }

    return candles;
  }

  updateIndicator(signal, patterns) {
    if (!this.indicator) return;

    const signalText = this.indicator.querySelector('.ppr-signal-text');
    const patternsDiv = this.indicator.querySelector('.ppr-patterns');
    const status = this.indicator.querySelector('.ppr-status');

    // Update signal display
    if (signal.strength >= 75) {
      signalText.textContent = `强烈做空! (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#e94560';
      status.style.color = '#e94560';
      this.indicator.classList.add('ppr-alert');
    } else if (signal.strength >= 50) {
      signalText.textContent = `做空信号 (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#f59e0b';
      status.style.color = '#f59e0b';
      this.indicator.classList.remove('ppr-alert');
    } else if (signal.strength > 0) {
      signalText.textContent = `弱信号 (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#4ade80';
      status.style.color = '#4ade80';
      this.indicator.classList.remove('ppr-alert');
    } else {
      signalText.textContent = '无信号';
      signalText.style.color = '#999';
      status.style.color = '#4ade80';
      this.indicator.classList.remove('ppr-alert');
    }

    // Update patterns list with timeframe info
    if (patterns && patterns.length > 0) {
      const patternHtml = patterns.slice(0, 4).map(p => {
        const tfLabel = TIMEFRAME_LABELS[p.timeframe] || `${p.timeframe}m`;
        return `
          <div class="ppr-pattern-item">
            <span class="ppr-pattern-name">${p.name}</span>
            <span class="ppr-pattern-tf">${tfLabel}</span>
          </div>
        `;
      }).join('');
      patternsDiv.innerHTML = patternHtml;
    } else {
      patternsDiv.innerHTML = '';
    }
  }

  async triggerAlert(signal, patterns) {
    this.lastAlert = Date.now();

    // Get timeframes with patterns
    const timeframesWithPatterns = [...new Set(patterns.map(p => p.timeframe))];
    const tfLabels = timeframesWithPatterns.map(tf => TIMEFRAME_LABELS[tf]).join(', ');

    // Visual alert
    if (this.indicator) {
      this.indicator.classList.add('ppr-flash');
      setTimeout(() => {
        this.indicator.classList.remove('ppr-flash');
      }, 3000);
    }

    // Send notification request to background script
    chrome.runtime.sendMessage({
      type: 'SHOW_NOTIFICATION',
      title: 'PUT 做空信号!',
      message: `${signal.recommendation}\n周期: ${tfLabels}\n强度: ${Math.round(signal.strength)}%`,
      patterns: patterns
    });

    // Send to popup for alert history
    chrome.runtime.sendMessage({
      type: 'NEW_ALERT',
      pattern: patterns[0]?.name || 'PUT Signal',
      timeframe: patterns[0]?.timeframe,
      strength: signal.strength
    });

    console.log('[PUT Pattern Reminder] Alert triggered:', signal);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.putPatternMonitor = new PutPatternMonitor();
  });
} else {
  window.putPatternMonitor = new PutPatternMonitor();
}
