/**
 * Live Trading Page - UI for Robinhood automated trading
 */

import { OrderExecutor, RiskManager, SignalRunner } from '../core/trading/index.js';

// State
let executor = null;
let riskManager = null;
let signalRunner = null;
let isMonitoring = false;
let isDryRun = true;

const API_URL = 'http://localhost:8001';

// DOM Elements
const elements = {
  // Status
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),

  // Connection
  connectBtn: document.getElementById('connectBtn'),
  loginBtn: document.getElementById('loginBtn'),
  apiIcon: document.getElementById('apiIcon'),
  apiStatus: document.getElementById('apiStatus'),
  authIcon: document.getElementById('authIcon'),
  authStatus: document.getElementById('authStatus'),
  modeIcon: document.getElementById('modeIcon'),
  modeStatus: document.getElementById('modeStatus'),
  modeToggle: document.getElementById('modeToggle'),

  // Login Modal
  loginModal: document.getElementById('loginModal'),
  closeModal: document.getElementById('closeModal'),
  loginForm: document.getElementById('loginForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  loginMfa: document.getElementById('loginMfa'),
  loginError: document.getElementById('loginError'),
  loginSubmit: document.getElementById('loginSubmit'),

  // Account
  accountPanel: document.getElementById('accountPanel'),
  buyingPower: document.getElementById('buyingPower'),
  portfolioValue: document.getElementById('portfolioValue'),
  dayPnL: document.getElementById('dayPnL'),
  openPositions: document.getElementById('openPositions'),

  // Risk
  riskStatus: document.getElementById('riskStatus'),
  dailyTrades: document.getElementById('dailyTrades'),
  maxDailyTrades: document.getElementById('maxDailyTrades'),
  dailyTradesBar: document.getElementById('dailyTradesBar'),
  maxPosition: document.getElementById('maxPosition'),
  dailyLoss: document.getElementById('dailyLoss'),
  maxDailyLoss: document.getElementById('maxDailyLoss'),
  dailyLossBar: document.getElementById('dailyLossBar'),
  minStrength: document.getElementById('minStrength'),

  // Monitor
  symbolSelect: document.getElementById('symbolSelect'),
  startMonitor: document.getElementById('startMonitor'),
  stopMonitor: document.getElementById('stopMonitor'),
  monitorStatus: document.getElementById('monitorStatus'),
  currentSignal: document.getElementById('currentSignal'),
  signalType: document.getElementById('signalType'),
  signalStrength: document.getElementById('signalStrength'),
  signalStrike: document.getElementById('signalStrike'),
  signalExpiry: document.getElementById('signalExpiry'),

  // Log
  tradeLog: document.getElementById('tradeLog'),
  clearLog: document.getElementById('clearLog')
};

// Initialize
async function init() {
  console.log('Initializing Live Trading page...');

  // Initialize risk manager
  riskManager = new RiskManager({
    limits: {
      maxDailyTrades: 3,
      maxPositionSize: 500,
      maxDailyLoss: 300,
      minStrengthThreshold: 60
    },
    onLimitHit: (event) => {
      addLogEntry(`Risk limit hit: ${event.reason}`, 'warning');
    }
  });

  // Initialize executor
  executor = new OrderExecutor({
    apiUrl: API_URL,
    dryRun: isDryRun,
    riskManager,
    onOrderPlaced: (order) => {
      addLogEntry(`Order placed: ${order.direction} ${order.symbol} $${order.strike}`, order.dryRun ? 'dry-run' : 'buy');
      updateRiskDisplay();
    },
    onOrderFailed: (details) => {
      addLogEntry(`Order rejected: ${details.reason}`, 'error');
    }
  });

  // Set up event listeners
  setupEventListeners();

  // Check API connection
  await checkApiConnection();

  // Update risk display
  updateRiskDisplay();
}

function setupEventListeners() {
  elements.connectBtn.addEventListener('click', handleConnect);
  elements.loginBtn.addEventListener('click', showLoginModal);
  elements.closeModal.addEventListener('click', hideLoginModal);
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.loginModal.addEventListener('click', (e) => {
    if (e.target === elements.loginModal) hideLoginModal();
  });
  elements.modeToggle.addEventListener('click', toggleTradingMode);
  elements.startMonitor.addEventListener('click', startMonitoring);
  elements.stopMonitor.addEventListener('click', stopMonitoring);
  elements.clearLog.addEventListener('click', clearLog);
}

function showLoginModal() {
  elements.loginModal.style.display = 'flex';
  elements.loginError.style.display = 'none';
  elements.loginUsername.focus();
}

function hideLoginModal() {
  elements.loginModal.style.display = 'none';
  elements.loginForm.reset();
}

async function handleLogin(e) {
  e.preventDefault();

  const username = elements.loginUsername.value;
  const password = elements.loginPassword.value;
  const mfaCode = elements.loginMfa.value || null;

  elements.loginSubmit.textContent = 'Logging in...';
  elements.loginSubmit.disabled = true;
  elements.loginError.style.display = 'none';

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        mfa_code: mfaCode
      })
    });

    if (response.ok) {
      const data = await response.json();
      hideLoginModal();
      elements.authIcon.textContent = '?';
      elements.authIcon.className = 'connection-icon success';
      elements.authStatus.textContent = 'Authenticated';
      elements.statusDot.classList.add('connected');
      elements.statusText.textContent = 'Connected';
      elements.accountPanel.style.display = 'block';
      await updateAccountInfo();
      addLogEntry(`Logged in as ${data.username}`, 'success');
    } else {
      const error = await response.json();
      elements.loginError.textContent = error.detail || 'Login failed';
      elements.loginError.style.display = 'block';
    }
  } catch (error) {
    elements.loginError.textContent = `Connection error: ${error.message}. Is the API server running?`;
    elements.loginError.style.display = 'block';
  }

  elements.loginSubmit.textContent = 'Login';
  elements.loginSubmit.disabled = false;
}

async function checkApiConnection() {
  try {
    const health = await executor.checkHealth();

    if (health.healthy) {
      elements.apiIcon.textContent = '?';
      elements.apiIcon.className = 'connection-icon success';
      elements.apiStatus.textContent = 'Connected';
      elements.connectBtn.textContent = 'Reconnect';

      if (health.authenticated) {
        elements.authIcon.textContent = '?';
        elements.authIcon.className = 'connection-icon success';
        elements.authStatus.textContent = 'Authenticated';
        elements.statusDot.classList.add('connected');
        elements.statusText.textContent = 'Connected';
        elements.accountPanel.style.display = 'block';
        await updateAccountInfo();
      }
    } else {
      elements.apiIcon.textContent = '?';
      elements.apiIcon.className = 'connection-icon error';
      elements.apiStatus.textContent = 'Not Running';
    }
  } catch (error) {
    elements.apiIcon.textContent = '?';
    elements.apiIcon.className = 'connection-icon error';
    elements.apiStatus.textContent = 'Connection Failed';
    addLogEntry('API connection failed. Start the server with: uvicorn robinhood_api:app --port 8001', 'error');
  }
}

async function handleConnect() {
  elements.connectBtn.textContent = 'Connecting...';
  elements.connectBtn.disabled = true;

  try {
    const authenticated = await executor.authenticate();

    if (authenticated) {
      elements.authIcon.textContent = '?';
      elements.authIcon.className = 'connection-icon success';
      elements.authStatus.textContent = 'Authenticated';
      elements.statusDot.classList.add('connected');
      elements.statusText.textContent = 'Connected';
      elements.accountPanel.style.display = 'block';
      await updateAccountInfo();
      addLogEntry('Successfully authenticated with Robinhood', 'success');
    } else {
      elements.authIcon.textContent = '?';
      elements.authIcon.className = 'connection-icon error';
      elements.authStatus.textContent = 'Auth Failed';
      addLogEntry('Authentication failed. Check your credentials in .env', 'error');
    }
  } catch (error) {
    addLogEntry(`Connection error: ${error.message}`, 'error');
  }

  elements.connectBtn.textContent = 'Reconnect';
  elements.connectBtn.disabled = false;
}

async function updateAccountInfo() {
  try {
    const buyingPower = await executor.getBuyingPower();
    elements.buyingPower.textContent = `$${buyingPower.toLocaleString()}`;

    const positions = await executor.getPositions();
    elements.openPositions.textContent = positions.length;
  } catch (error) {
    console.error('Error updating account info:', error);
  }
}

function toggleTradingMode() {
  isDryRun = !isDryRun;
  executor.dryRun = isDryRun;

  if (isDryRun) {
    elements.modeIcon.textContent = 'DRY';
    elements.modeIcon.className = 'connection-icon warning';
    elements.modeStatus.textContent = 'Dry-Run (Safe)';
    elements.modeToggle.textContent = 'Switch to Live';
    elements.modeToggle.className = 'btn btn-warning';
    addLogEntry('Switched to DRY-RUN mode - no real trades', 'info');
  } else {
    elements.modeIcon.textContent = 'LIVE';
    elements.modeIcon.className = 'connection-icon error';
    elements.modeStatus.textContent = 'LIVE TRADING';
    elements.modeToggle.textContent = 'Switch to Dry-Run';
    elements.modeToggle.className = 'btn btn-danger';
    addLogEntry('WARNING: Switched to LIVE mode - real trades will execute!', 'warning');
  }
}

async function startMonitoring() {
  if (isMonitoring) return;

  const symbol = elements.symbolSelect.value;

  signalRunner = new SignalRunner({
    symbol,
    timeframe: 5,
    dryRun: isDryRun,
    apiUrl: API_URL,
    riskLimits: {
      maxDailyTrades: parseInt(elements.maxDailyTrades.textContent),
      maxPositionSize: parseInt(elements.maxPosition.textContent),
      maxDailyLoss: parseInt(elements.maxDailyLoss.textContent),
      minStrengthThreshold: parseInt(elements.minStrength.textContent)
    },
    onSignal: (signal) => {
      showSignal(signal);
    },
    onStatus: (status) => {
      updateRiskDisplay();
    }
  });

  const started = await signalRunner.start();

  if (started) {
    isMonitoring = true;
    elements.startMonitor.style.display = 'none';
    elements.stopMonitor.style.display = 'inline-block';
    elements.symbolSelect.disabled = true;

    const icon = elements.monitorStatus.querySelector('.monitor-icon');
    const text = elements.monitorStatus.querySelector('.monitor-text');
    icon.textContent = '?';
    icon.classList.add('active');
    text.textContent = `Monitoring ${symbol} for OI-WASP signals...`;

    addLogEntry(`Started monitoring ${symbol}`, 'info');
  } else {
    addLogEntry('Failed to start monitoring - check API connection', 'error');
  }
}

function stopMonitoring() {
  if (!isMonitoring || !signalRunner) return;

  signalRunner.stop();
  isMonitoring = false;
  signalRunner = null;

  elements.startMonitor.style.display = 'inline-block';
  elements.stopMonitor.style.display = 'none';
  elements.symbolSelect.disabled = false;
  elements.currentSignal.style.display = 'none';

  const icon = elements.monitorStatus.querySelector('.monitor-icon');
  const text = elements.monitorStatus.querySelector('.monitor-text');
  icon.textContent = '?';
  icon.classList.remove('active');
  text.textContent = 'Monitoring stopped';

  addLogEntry('Stopped monitoring', 'info');
}

function showSignal(signal) {
  elements.currentSignal.style.display = 'block';
  elements.signalType.textContent = signal.type;
  elements.signalType.className = `signal-type ${signal.direction.toLowerCase()}`;
  elements.signalStrength.textContent = `${signal.strength}%`;
  elements.signalStrike.textContent = `$${signal.strike || '--'}`;
  elements.signalExpiry.textContent = signal.expiry || '--';
}

function updateRiskDisplay() {
  const status = riskManager.getStatus();

  elements.dailyTrades.textContent = status.dailyTrades;
  elements.dailyTradesBar.style.width = `${(status.dailyTrades / status.maxDailyTrades) * 100}%`;

  elements.dailyLoss.textContent = Math.abs(status.dailyPnL).toFixed(0);
  elements.dailyLossBar.style.width = `${(Math.abs(status.dailyPnL) / status.maxDailyLoss) * 100}%`;

  if (status.circuitBreakerTripped) {
    elements.riskStatus.textContent = 'HALTED';
    elements.riskStatus.className = 'risk-status danger';
  } else if (!status.canTrade) {
    elements.riskStatus.textContent = 'Limited';
    elements.riskStatus.className = 'risk-status warning';
  } else {
    elements.riskStatus.textContent = 'Active';
    elements.riskStatus.className = 'risk-status';
  }
}

function addLogEntry(message, type = 'info') {
  const log = elements.tradeLog;
  const empty = log.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `
    <span class="log-time">${new Date().toLocaleTimeString()}</span>
    <span class="log-action">${message}</span>
  `;

  log.insertBefore(entry, log.firstChild);

  // Keep only last 50 entries
  while (log.children.length > 50) {
    log.removeChild(log.lastChild);
  }
}

function clearLog() {
  elements.tradeLog.innerHTML = '<div class="log-empty">Log cleared</div>';
}

// Initialize on load
init();
