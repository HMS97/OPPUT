/**
 * Content script for PUT Pattern Reminder
 * Runs on TradingView and Binance pages
 */

class PutPatternMonitor {
  constructor() {
    this.detector = new PutPatternDetector();
    this.enabled = true;
    this.sensitivity = 'medium';
    this.scanInterval = null;
    this.lastAlert = 0;
    this.alertCooldown = 60000; // 1 minute cooldown between alerts

    this.init();
  }

  async init() {
    // Load settings
    await this.loadSettings();

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

    console.log('[PUT Pattern Reminder] Initialized');
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get({
        enabled: true,
        sensitivity: 'medium',
        refreshInterval: 10
      });

      this.enabled = result.enabled;
      this.sensitivity = result.sensitivity;
      this.refreshInterval = result.refreshInterval;

      // Adjust detector config based on sensitivity
      this.updateSensitivity(this.sensitivity);
    } catch (e) {
      console.error('[PUT Pattern Reminder] Failed to load settings:', e);
    }
  }

  updateSensitivity(level) {
    const configs = {
      low: {
        rejectionThreshold: 0.005,
        consolidationBars: 5,
        lowerHighTolerance: 0.002
      },
      medium: {
        rejectionThreshold: 0.003,
        consolidationBars: 3,
        lowerHighTolerance: 0.001
      },
      high: {
        rejectionThreshold: 0.001,
        consolidationBars: 2,
        lowerHighTolerance: 0.0005
      }
    };

    this.detector.config = { ...this.detector.config, ...configs[level] };
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
        this.updateSensitivity(message.value);
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
      <div class="ppr-signal">
        <span class="ppr-signal-text">Monitoring...</span>
      </div>
      <div class="ppr-patterns"></div>
      <div class="ppr-actions">
        <button class="ppr-btn ppr-scan">Scan</button>
        <button class="ppr-btn ppr-close">×</button>
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
      text.textContent = 'Monitoring...';
    } else {
      status.style.color = '#666';
      text.textContent = 'Paused';
    }
  }

  async performScan() {
    if (!this.enabled) return;

    try {
      // Extract candle data from the page
      const candles = await this.extractCandleData();

      if (!candles || candles.length < 10) {
        console.log('[PUT Pattern Reminder] Insufficient candle data');
        return;
      }

      // Run pattern detection
      const patterns = this.detector.analyze(candles);
      const signal = this.detector.getSignalSummary();

      // Update indicator
      this.updateIndicator(signal, patterns);

      // Save to storage for popup
      await chrome.storage.local.set({
        currentSignal: signal,
        detectedPatterns: patterns
      });

      // Send update to popup
      chrome.runtime.sendMessage({
        type: 'SIGNAL_UPDATE',
        signal: signal,
        patterns: patterns
      });

      // Trigger alert if strong signal
      if (signal.strength >= 50 && Date.now() - this.lastAlert > this.alertCooldown) {
        this.triggerAlert(signal, patterns);
      }

    } catch (e) {
      console.error('[PUT Pattern Reminder] Scan failed:', e);
    }
  }

  async extractCandleData() {
    // Try different methods based on the site

    // Method 1: TradingView chart data
    if (window.location.hostname.includes('tradingview.com')) {
      return this.extractFromTradingView();
    }

    // Method 2: Binance chart data
    if (window.location.hostname.includes('binance.com')) {
      return this.extractFromBinance();
    }

    // Method 3: Try generic chart data extraction
    return this.extractGeneric();
  }

  extractFromTradingView() {
    // TradingView stores chart data in various places
    // Try to access the chart widget's data

    try {
      // Method 1: Access TVChartContainer's data
      const chartFrames = document.querySelectorAll('iframe');
      for (const frame of chartFrames) {
        try {
          const frameWindow = frame.contentWindow;
          if (frameWindow && frameWindow.TradingView) {
            // Access chart data through TradingView API
            const widget = frameWindow.TradingView.chart;
            if (widget && widget.getAllStudies) {
              // Get OHLCV data
              return this.parseWidgetData(widget);
            }
          }
        } catch (e) {
          // Cross-origin restriction, try another method
        }
      }

      // Method 2: Parse visible candles from DOM
      return this.parseVisibleCandles();

    } catch (e) {
      console.error('[PUT Pattern Reminder] TradingView extraction failed:', e);
      return null;
    }
  }

  extractFromBinance() {
    try {
      // Binance uses different chart implementations
      // Try to access global chart data

      if (window.__BINANCE_CHART_DATA__) {
        return this.parseBinanceData(window.__BINANCE_CHART_DATA__);
      }

      // Try parsing from visible elements
      return this.parseVisibleCandles();

    } catch (e) {
      console.error('[PUT Pattern Reminder] Binance extraction failed:', e);
      return null;
    }
  }

  parseVisibleCandles() {
    // Parse candle data from visible chart elements
    // This is a fallback method that analyzes DOM elements

    const candles = [];

    // Look for SVG/Canvas chart elements
    const svgCandles = document.querySelectorAll('[class*="candle"], [class*="bar"]');

    // Also try parsing from data attributes
    const chartElements = document.querySelectorAll('[data-price], [data-ohlc]');

    // If we found elements, parse them
    if (svgCandles.length > 0 || chartElements.length > 0) {
      // Attempt to extract OHLCV from element positions/attributes
      // This is complex and site-specific

      // For now, generate sample data for testing
      return this.generateTestData();
    }

    return this.generateTestData();
  }

  extractGeneric() {
    // Generic extraction using page analysis
    return this.generateTestData();
  }

  generateTestData() {
    // Generate realistic test candle data for demonstration
    // In production, this would be replaced with actual chart data

    const candles = [];
    let price = 87000; // Starting price (BTC-like)
    const now = Date.now();

    for (let i = 0; i < 100; i++) {
      const volatility = 0.002; // 0.2% volatility
      const trend = Math.random() > 0.5 ? 1 : -1;

      const open = price;
      const change = price * volatility * (Math.random() - 0.5 + trend * 0.1);
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(change) * Math.random();
      const low = Math.min(open, close) - Math.abs(change) * Math.random();

      candles.push({
        time: now - (100 - i) * 60000, // 1 minute candles
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000
      });

      price = close;
    }

    // Add some pattern-forming candles at the end
    // Simulate resistance rejection
    const lastPrice = candles[candles.length - 1].close;
    const resistance = lastPrice * 1.005;

    for (let i = 0; i < 5; i++) {
      const open = candles[candles.length - 1].close;
      const high = resistance + Math.random() * 50;
      const close = resistance - Math.random() * 100;
      const low = close - Math.random() * 30;

      candles.push({
        time: now + i * 60000,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000
      });
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
      signalText.textContent = `STRONG PUT! (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#e94560';
      status.style.color = '#e94560';
      this.indicator.classList.add('ppr-alert');
    } else if (signal.strength >= 50) {
      signalText.textContent = `PUT Signal (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#f59e0b';
      status.style.color = '#f59e0b';
      this.indicator.classList.remove('ppr-alert');
    } else if (signal.strength > 0) {
      signalText.textContent = `Weak (${Math.round(signal.strength)}%)`;
      signalText.style.color = '#4ade80';
      status.style.color = '#4ade80';
      this.indicator.classList.remove('ppr-alert');
    } else {
      signalText.textContent = 'No signals';
      signalText.style.color = '#999';
      status.style.color = '#4ade80';
      this.indicator.classList.remove('ppr-alert');
    }

    // Update patterns list
    if (patterns && patterns.length > 0) {
      const patternHtml = patterns.slice(0, 3).map(p => `
        <div class="ppr-pattern-item">${p.name}</div>
      `).join('');
      patternsDiv.innerHTML = patternHtml;
    } else {
      patternsDiv.innerHTML = '';
    }
  }

  async triggerAlert(signal, patterns) {
    this.lastAlert = Date.now();

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
      title: 'PUT Signal Detected!',
      message: `${signal.recommendation}\nStrength: ${Math.round(signal.strength)}%`,
      patterns: patterns
    });

    // Send to popup for alert history
    chrome.runtime.sendMessage({
      type: 'NEW_ALERT',
      pattern: patterns[0]?.name || 'PUT Signal',
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
