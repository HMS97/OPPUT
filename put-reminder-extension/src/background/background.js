/**
 * Background service worker for PUT Pattern Reminder
 * Handles notifications, alarms, and cross-tab communication
 */

// Initialize on install
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[PUT Pattern Reminder] Extension installed', details.reason);

  // Set default settings
  chrome.storage.local.set({
    enabled: true,
    sensitivity: 'medium',
    soundEnabled: true,
    refreshInterval: 10,
    alertHistory: []
  });

  // Create alarm for periodic checks
  chrome.alarms.create('patternCheck', {
    periodInMinutes: 1
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SHOW_NOTIFICATION':
      showNotification(message);
      break;

    case 'SIGNAL_UPDATE':
      // Forward to popup if open
      broadcastToPopup(message);
      break;

    case 'NEW_ALERT':
      // Save to alert history
      saveAlertHistory(message);
      break;

    case 'GET_CANDLE_DATA':
      // Handle requests for candle data (for future API integration)
      handleCandleDataRequest(message, sendResponse);
      return true; // Keep channel open for async response
  }
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'patternCheck') {
    // Notify active tabs to perform a scan
    notifyActiveTabs({ type: 'TRIGGER_SCAN' });
  }
});

/**
 * Show a notification to the user
 */
async function showNotification(data) {
  const settings = await chrome.storage.local.get({ soundEnabled: true });

  const notificationOptions = {
    type: 'basic',
    iconUrl: '/icons/icon128.png',
    title: data.title || 'PUT Signal Detected!',
    message: data.message || 'A trading pattern has been detected.',
    priority: 2,
    requireInteraction: true,
    silent: !settings.soundEnabled
  };

  try {
    await chrome.notifications.create(`put-alert-${Date.now()}`, notificationOptions);
  } catch (e) {
    console.error('[PUT Pattern Reminder] Notification failed:', e);
  }
}

/**
 * Broadcast message to popup
 */
async function broadcastToPopup(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // Popup might not be open, ignore error
  }
}

/**
 * Save alert to history
 */
async function saveAlertHistory(alertData) {
  try {
    const result = await chrome.storage.local.get({ alertHistory: [] });
    const history = result.alertHistory;

    history.unshift({
      pattern: alertData.pattern,
      strength: alertData.strength,
      time: Date.now()
    });

    // Keep only last 50 alerts
    const trimmedHistory = history.slice(0, 50);

    await chrome.storage.local.set({ alertHistory: trimmedHistory });
  } catch (e) {
    console.error('[PUT Pattern Reminder] Failed to save alert history:', e);
  }
}

/**
 * Notify all active TradingView/Binance tabs
 */
async function notifyActiveTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://*.tradingview.com/*',
        'https://*.binance.com/*'
      ]
    });

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script loaded
      }
    }
  } catch (e) {
    console.error('[PUT Pattern Reminder] Failed to notify tabs:', e);
  }
}

/**
 * Handle candle data requests (for future API integration)
 */
async function handleCandleDataRequest(request, sendResponse) {
  // This could be expanded to fetch data from external APIs
  // For now, just acknowledge the request

  sendResponse({ success: true, message: 'Data request received' });
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('put-alert-')) {
    // Open the most recent TradingView/Binance tab
    chrome.tabs.query({
      url: [
        'https://*.tradingview.com/*',
        'https://*.binance.com/*'
      ]
    }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    });

    // Clear the notification
    chrome.notifications.clear(notificationId);
  }
});

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('put-alert-')) {
    chrome.notifications.clear(notificationId);
  }
});

console.log('[PUT Pattern Reminder] Background service worker loaded');
