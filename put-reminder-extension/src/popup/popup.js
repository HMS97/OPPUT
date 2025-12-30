/**
 * Popup script for PUT Pattern Reminder
 * Supports multi-timeframe and real-time/replay data
 */

const TIMEFRAME_LABELS = {
  '5': '5分钟',
  '15': '15分钟',
  '60': '1小时',
  '240': '4小时'
};

class PopupController {
  constructor() {
    this.init();
  }

  async init() {
    // Load saved settings
    await this.loadSettings();

    // Bind event listeners
    this.bindEvents();

    // Load current state
    await this.loadCurrentState();

    // Start auto-refresh
    this.startAutoRefresh();
  }

  async loadSettings() {
    const defaults = {
      enabled: true,
      timeframes: [5, 15], // Default: 5m and 15m
      dataSource: 'realtime',
      sensitivity: 'medium',
      soundEnabled: true,
      refreshInterval: 10,
      alertHistory: []
    };

    try {
      const result = await chrome.storage.local.get(defaults);
      this.settings = result;

      // Update UI
      document.getElementById('enableToggle').checked = this.settings.enabled;
      document.getElementById('sensitivity').value = this.settings.sensitivity;
      document.getElementById('soundToggle').checked = this.settings.soundEnabled;
      document.getElementById('refreshInterval').value = this.settings.refreshInterval;

      // Set data source
      if (this.settings.dataSource === 'replay') {
        document.getElementById('dsReplay').checked = true;
      } else {
        document.getElementById('dsRealtime').checked = true;
      }

      // Set timeframes
      document.getElementById('tf5m').checked = this.settings.timeframes.includes(5);
      document.getElementById('tf15m').checked = this.settings.timeframes.includes(15);
      document.getElementById('tf1h').checked = this.settings.timeframes.includes(60);
      document.getElementById('tf4h').checked = this.settings.timeframes.includes(240);

      this.updateStatusUI();
      this.updateActiveTimeframesDisplay();
      this.renderAlertHistory();
    } catch (e) {
      console.error('Failed to load settings:', e);
      this.settings = defaults;
    }
  }

  bindEvents() {
    // Enable toggle
    document.getElementById('enableToggle').addEventListener('change', (e) => {
      this.settings.enabled = e.target.checked;
      this.saveSettings();
      this.updateStatusUI();
      this.notifyContentScript({ type: 'TOGGLE_MONITORING', enabled: e.target.checked });
    });

    // Data source radio buttons
    document.querySelectorAll('input[name="dataSource"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.settings.dataSource = e.target.value;
        this.saveSettings();
        this.notifyContentScript({ type: 'UPDATE_DATA_SOURCE', value: e.target.value });
      });
    });

    // Timeframe checkboxes
    ['tf5m', 'tf15m', 'tf1h', 'tf4h'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        this.updateTimeframes();
      });
    });

    // Sensitivity
    document.getElementById('sensitivity').addEventListener('change', (e) => {
      this.settings.sensitivity = e.target.value;
      this.saveSettings();
      this.notifyContentScript({ type: 'UPDATE_SENSITIVITY', value: e.target.value });
    });

    // Sound toggle
    document.getElementById('soundToggle').addEventListener('change', (e) => {
      this.settings.soundEnabled = e.target.checked;
      this.saveSettings();
    });

    // Refresh interval
    document.getElementById('refreshInterval').addEventListener('change', (e) => {
      this.settings.refreshInterval = parseInt(e.target.value);
      this.saveSettings();
      this.restartAutoRefresh();
    });

    // Scan now button
    document.getElementById('scanNow').addEventListener('click', () => {
      this.triggerScan();
    });

    // Clear alerts button
    document.getElementById('clearAlerts').addEventListener('click', () => {
      this.clearAlertHistory();
    });
  }

  updateTimeframes() {
    const timeframes = [];

    if (document.getElementById('tf5m').checked) timeframes.push(5);
    if (document.getElementById('tf15m').checked) timeframes.push(15);
    if (document.getElementById('tf1h').checked) timeframes.push(60);
    if (document.getElementById('tf4h').checked) timeframes.push(240);

    // Ensure at least one timeframe is selected
    if (timeframes.length === 0) {
      document.getElementById('tf15m').checked = true;
      timeframes.push(15);
    }

    this.settings.timeframes = timeframes;
    this.saveSettings();
    this.updateActiveTimeframesDisplay();
    this.notifyContentScript({ type: 'UPDATE_TIMEFRAMES', timeframes: timeframes });
  }

  updateActiveTimeframesDisplay() {
    const container = document.getElementById('activeTimeframes');
    if (!this.settings.timeframes || this.settings.timeframes.length === 0) {
      container.innerHTML = '';
      return;
    }

    const badges = this.settings.timeframes.map(tf => {
      const label = TIMEFRAME_LABELS[tf.toString()] || `${tf}m`;
      return `<span class="active-tf-badge">${label}</span>`;
    }).join('');

    container.innerHTML = badges;
  }

  async saveSettings() {
    try {
      await chrome.storage.local.set(this.settings);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  updateStatusUI() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    if (this.settings.enabled) {
      dot.classList.remove('inactive');
      const source = this.settings.dataSource === 'replay' ? '回放' : '实时';
      text.textContent = `监控中 (${source})...`;
    } else {
      dot.classList.add('inactive');
      text.textContent = '已暂停';
    }
  }

  async loadCurrentState() {
    try {
      const result = await chrome.storage.local.get(['currentSignal', 'detectedPatterns']);

      if (result.currentSignal) {
        this.updateSignalDisplay(result.currentSignal);
      }

      if (result.detectedPatterns) {
        this.updatePatternsDisplay(result.detectedPatterns);
      }
    } catch (e) {
      console.error('Failed to load current state:', e);
    }
  }

  updateSignalDisplay(signal) {
    const badge = document.getElementById('signalBadge');
    const meter = document.getElementById('signalMeter');
    const recommendation = document.getElementById('recommendation');

    if (!signal || signal.strength === 0) {
      badge.textContent = '无信号';
      badge.className = 'signal-strength none';
      meter.style.width = '0%';
      recommendation.textContent = '等待形态出现...';
      return;
    }

    // Update badge
    if (signal.strength >= 75) {
      badge.textContent = '强烈做空!';
      badge.className = 'signal-strength strong';
    } else if (signal.strength >= 50) {
      badge.textContent = '做空信号';
      badge.className = 'signal-strength medium';
    } else {
      badge.textContent = '弱信号';
      badge.className = 'signal-strength weak';
    }

    // Update meter
    meter.style.width = `${signal.strength}%`;

    // Update recommendation
    recommendation.textContent = signal.recommendation || '';
  }

  updatePatternsDisplay(patterns) {
    const container = document.getElementById('patternsContainer');

    if (!patterns || patterns.length === 0) {
      container.innerHTML = `
        <div class="no-signal">
          <div class="no-signal-icon">📊</div>
          <p>暂无检测到的形态</p>
        </div>
      `;
      return;
    }

    const patternIcons = {
      'LOWER_HIGH': '📉',
      'REJECTION_AT_RESISTANCE': '🛑',
      'FALSE_BREAKOUT': '💥',
      'ABSORPTION': '🔄',
      'DOUBLE_REJECTION': '⚡',
      'PRICE_STALLING': '⏸️'
    };

    const html = `
      <div class="patterns-list">
        ${patterns.map(p => {
          const tfLabel = p.timeframe ? TIMEFRAME_LABELS[p.timeframe.toString()] || `${p.timeframe}m` : '';
          return `
            <div class="pattern-item">
              <div class="pattern-icon">${patternIcons[p.type] || '📊'}</div>
              <div class="pattern-info">
                <div class="pattern-name">${p.name}</div>
                <div class="pattern-desc">${p.description}</div>
              </div>
              ${tfLabel ? `<span class="pattern-tf">${tfLabel}</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  renderAlertHistory() {
    const container = document.getElementById('alertList');
    const history = this.settings.alertHistory || [];

    if (history.length === 0) {
      container.innerHTML = '<p style="color: #666; font-size: 12px; text-align: center;">暂无提醒记录</p>';
      return;
    }

    const html = history.slice(0, 5).map(alert => {
      const tfLabel = alert.timeframe ? TIMEFRAME_LABELS[alert.timeframe.toString()] || `${alert.timeframe}m` : '';
      return `
        <div class="alert-item">
          <div class="pattern-name">${alert.pattern}${tfLabel ? `<span class="alert-tf">${tfLabel}</span>` : ''}</div>
          <div class="alert-time">${new Date(alert.time).toLocaleString()}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }

  clearAlertHistory() {
    this.settings.alertHistory = [];
    this.saveSettings();
    this.renderAlertHistory();
  }

  async notifyContentScript(message) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, message);
      }
    } catch (e) {
      console.error('Failed to notify content script:', e);
    }
  }

  async triggerScan() {
    const btn = document.getElementById('scanNow');
    btn.textContent = '扫描中...';
    btn.disabled = true;

    await this.notifyContentScript({ type: 'TRIGGER_SCAN' });

    // Wait a bit then refresh display
    setTimeout(async () => {
      await this.loadCurrentState();
      btn.textContent = '立即扫描 Scan Now';
      btn.disabled = false;
    }, 2000);
  }

  startAutoRefresh() {
    this.refreshTimer = setInterval(() => {
      if (this.settings.enabled) {
        this.loadCurrentState();
      }
    }, this.settings.refreshInterval * 1000);
  }

  restartAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.startAutoRefresh();
  }
}

// Listen for messages from background/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SIGNAL_UPDATE') {
    if (window.popupController) {
      window.popupController.updateSignalDisplay(message.signal);
      window.popupController.updatePatternsDisplay(message.patterns);
    }
  }

  if (message.type === 'NEW_ALERT') {
    if (window.popupController) {
      const alert = {
        pattern: message.pattern,
        timeframe: message.timeframe,
        time: Date.now()
      };
      window.popupController.settings.alertHistory.unshift(alert);
      window.popupController.settings.alertHistory =
        window.popupController.settings.alertHistory.slice(0, 20);
      window.popupController.saveSettings();
      window.popupController.renderAlertHistory();
    }
  }
});

// Initialize
window.popupController = new PopupController();
