/**
 * Popup script for PUT Pattern Reminder
 */

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

      this.updateStatusUI();
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
      text.textContent = 'Monitoring...';
    } else {
      dot.classList.add('inactive');
      text.textContent = 'Paused';
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
      badge.textContent = 'No Signal';
      badge.className = 'signal-strength none';
      meter.style.width = '0%';
      recommendation.textContent = 'Waiting for patterns...';
      return;
    }

    // Update badge
    if (signal.strength >= 75) {
      badge.textContent = 'STRONG PUT';
      badge.className = 'signal-strength strong';
    } else if (signal.strength >= 50) {
      badge.textContent = 'PUT Signal';
      badge.className = 'signal-strength medium';
    } else {
      badge.textContent = 'Weak Signal';
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
          <p>No patterns detected yet</p>
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
        ${patterns.map(p => `
          <div class="pattern-item">
            <div class="pattern-icon">${patternIcons[p.type] || '📊'}</div>
            <div class="pattern-info">
              <div class="pattern-name">${p.name}</div>
              <div class="pattern-desc">${p.description}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  renderAlertHistory() {
    const container = document.getElementById('alertList');
    const history = this.settings.alertHistory || [];

    if (history.length === 0) {
      container.innerHTML = '<p style="color: #666; font-size: 12px; text-align: center;">No recent alerts</p>';
      return;
    }

    const html = history.slice(0, 5).map(alert => `
      <div class="alert-item">
        <div class="pattern-name">${alert.pattern}</div>
        <div class="alert-time">${new Date(alert.time).toLocaleString()}</div>
      </div>
    `).join('');

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
    btn.textContent = 'Scanning...';
    btn.disabled = true;

    await this.notifyContentScript({ type: 'TRIGGER_SCAN' });

    // Wait a bit then refresh display
    setTimeout(async () => {
      await this.loadCurrentState();
      btn.textContent = 'Scan Now';
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
