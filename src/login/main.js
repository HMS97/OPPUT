/**
 * Login Page - Robinhood authentication
 */

import {
  login,
  logout,
  authenticate,
  checkAuth,
  checkAppApproval,
  getBuyingPower,
  getPositions,
  getOptionPositions
} from '../core/auth/auth-service.js';

import {
  setAuthState,
  clearAuthState,
  getAuthState,
  setCachedAccount
} from '../core/auth/auth-state.js';

// DOM Elements
const elements = {
  loginForm: document.getElementById('loginForm'),
  loginCard: document.getElementById('loginCard'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  mfaCode: document.getElementById('mfaCode'),
  loginBtn: document.getElementById('loginBtn'),
  formError: document.getElementById('formError'),
  autoConnectBtn: document.getElementById('autoConnectBtn'),
  apiDot: document.getElementById('apiDot'),
  apiText: document.getElementById('apiText'),
  accountCard: document.getElementById('accountCard'),
  accountUser: document.getElementById('accountUser'),
  buyingPower: document.getElementById('buyingPower'),
  stockPositions: document.getElementById('stockPositions'),
  optionPositions: document.getElementById('optionPositions'),
  logoutBtn: document.getElementById('logoutBtn'),
  // Verification elements
  verificationCard: document.getElementById('verificationCard'),
  verificationForm: document.getElementById('verificationForm'),
  verificationMessage: document.getElementById('verificationMessage'),
  verificationCode: document.getElementById('verificationCode'),
  verificationError: document.getElementById('verificationError'),
  verifyBtn: document.getElementById('verifyBtn'),
  cancelVerifyBtn: document.getElementById('cancelVerifyBtn'),
  codeInputGroup: document.getElementById('codeInputGroup'),
  appApprovalGroup: document.getElementById('appApprovalGroup')
};

// Verification state
let pendingChallenge = null;
let appApprovalInterval = null;

// Initialize
async function init() {
  console.log('Login page initialized');

  // Check API health
  await checkApiStatus();

  // Check if already logged in
  const authState = getAuthState();
  if (authState?.isAuthenticated) {
    const health = await checkAuth();
    if (health.authenticated) {
      showAccountInfo(authState.username);
      return;
    } else {
      // Session expired
      clearAuthState();
    }
  }

  // Bind events
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.autoConnectBtn.addEventListener('click', handleAutoConnect);
  elements.logoutBtn?.addEventListener('click', handleLogout);
  elements.verificationForm?.addEventListener('submit', handleVerification);
  elements.cancelVerifyBtn?.addEventListener('click', cancelVerification);
}

async function checkApiStatus() {
  try {
    const health = await checkAuth();
    if (health.healthy !== false) {
      elements.apiDot.className = 'api-dot connected';
      elements.apiText.textContent = 'API Server Connected';
    } else {
      elements.apiDot.className = 'api-dot disconnected';
      elements.apiText.textContent = 'API Server Not Running';
    }
  } catch (e) {
    elements.apiDot.className = 'api-dot disconnected';
    elements.apiText.textContent = 'Cannot connect to API server';
  }
}

async function handleLogin(e) {
  e.preventDefault();

  const username = elements.username.value.trim();
  const password = elements.password.value;
  const mfaCode = elements.mfaCode.value.trim() || null;

  elements.loginBtn.textContent = 'Logging in...';
  elements.loginBtn.disabled = true;
  elements.formError.style.display = 'none';

  try {
    const result = await login(username, password, mfaCode);

    // Check if challenge is required
    if (result.status === 'challenge_required' || result.status === 'app_approval_required') {
      showVerificationScreen(result, username, password);
      return;
    }

    // Save auth state
    setAuthState({
      isAuthenticated: true,
      username: result.username || username
    });

    // Show account info
    await showAccountInfo(result.username || username);

  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.style.display = 'block';
  } finally {
    elements.loginBtn.textContent = 'Login to Robinhood';
    elements.loginBtn.disabled = false;
  }
}

function showVerificationScreen(challenge, username, password) {
  // Store challenge info
  pendingChallenge = {
    challengeId: challenge.challenge_id,
    challengeType: challenge.challenge_type,
    username,
    password
  };

  // Update UI
  elements.loginCard.style.display = 'none';
  elements.verificationCard.style.display = 'block';
  elements.verificationMessage.textContent = challenge.message;

  // Show appropriate input based on challenge type
  if (challenge.status === 'app_approval_required') {
    elements.codeInputGroup.style.display = 'none';
    elements.appApprovalGroup.style.display = 'block';
    elements.verifyBtn.textContent = 'Check Approval Status';

    // Start polling for app approval
    startAppApprovalPolling();
  } else {
    elements.codeInputGroup.style.display = 'block';
    elements.appApprovalGroup.style.display = 'none';
    elements.verifyBtn.textContent = 'Verify';
    elements.verificationCode.focus();
  }
}

function startAppApprovalPolling() {
  // Poll every 3 seconds for app approval
  appApprovalInterval = setInterval(async () => {
    try {
      const result = await checkAppApproval(
        pendingChallenge.challengeId,
        pendingChallenge.username,
        pendingChallenge.password
      );

      if (result.status === 'authenticated') {
        clearInterval(appApprovalInterval);
        appApprovalInterval = null;

        setAuthState({
          isAuthenticated: true,
          username: result.username
        });

        elements.verificationCard.style.display = 'none';
        await showAccountInfo(result.username);
      }
    } catch (e) {
      console.log('Still waiting for app approval...');
    }
  }, 3000);
}

async function handleVerification(e) {
  e.preventDefault();

  if (!pendingChallenge) {
    cancelVerification();
    return;
  }

  elements.verifyBtn.disabled = true;
  elements.verifyBtn.textContent = 'Verifying...';
  elements.verificationError.style.display = 'none';

  try {
    // For app approval, just check the status
    if (pendingChallenge.challengeType === 'app') {
      const result = await checkAppApproval(
        pendingChallenge.challengeId,
        pendingChallenge.username,
        pendingChallenge.password
      );

      if (result.status === 'authenticated') {
        if (appApprovalInterval) {
          clearInterval(appApprovalInterval);
          appApprovalInterval = null;
        }

        setAuthState({
          isAuthenticated: true,
          username: result.username
        });

        elements.verificationCard.style.display = 'none';
        await showAccountInfo(result.username);
        return;
      } else {
        elements.verificationError.textContent = 'Still waiting for approval. Please approve in the Robinhood app.';
        elements.verificationError.style.display = 'block';
      }
    } else {
      // Submit verification code
      const code = elements.verificationCode.value.trim();
      if (!code) {
        elements.verificationError.textContent = 'Please enter the verification code';
        elements.verificationError.style.display = 'block';
        return;
      }

      const result = await login(
        pendingChallenge.username,
        pendingChallenge.password,
        null,
        pendingChallenge.challengeId,
        code
      );

      if (result.status === 'authenticated') {
        setAuthState({
          isAuthenticated: true,
          username: result.username
        });

        elements.verificationCard.style.display = 'none';
        pendingChallenge = null;
        await showAccountInfo(result.username);
      } else if (result.status === 'challenge_required') {
        elements.verificationError.textContent = 'Invalid code. Please try again.';
        elements.verificationError.style.display = 'block';
      }
    }
  } catch (error) {
    elements.verificationError.textContent = error.message;
    elements.verificationError.style.display = 'block';
  } finally {
    elements.verifyBtn.disabled = false;
    elements.verifyBtn.textContent = pendingChallenge?.challengeType === 'app' ? 'Check Approval Status' : 'Verify';
  }
}

function cancelVerification() {
  if (appApprovalInterval) {
    clearInterval(appApprovalInterval);
    appApprovalInterval = null;
  }
  pendingChallenge = null;
  elements.verificationCard.style.display = 'none';
  elements.loginCard.style.display = 'block';
  elements.verificationCode.value = '';
  elements.verificationError.style.display = 'none';
}

async function handleAutoConnect() {
  elements.autoConnectBtn.textContent = 'Connecting...';
  elements.autoConnectBtn.disabled = true;
  elements.formError.style.display = 'none';

  try {
    const result = await authenticate();
    const username = result.username || 'Auto-connected';

    setAuthState({
      isAuthenticated: true,
      username
    });

    await showAccountInfo(username);
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.style.display = 'block';
  } finally {
    elements.autoConnectBtn.textContent = 'Connect with .env Credentials';
    elements.autoConnectBtn.disabled = false;
  }
}

async function showAccountInfo(username) {
  // Hide form, show account card
  elements.loginCard.style.display = 'none';
  elements.accountCard.style.display = 'block';
  elements.accountUser.textContent = username;

  // Fetch account data
  try {
    const [buyingPower, positions, optionPos] = await Promise.all([
      getBuyingPower(),
      getPositions(),
      getOptionPositions()
    ]);

    elements.buyingPower.textContent = `$${Number(buyingPower).toLocaleString()}`;
    elements.stockPositions.textContent = positions.length;
    elements.optionPositions.textContent = optionPos.length;

    // Cache for other pages
    setCachedAccount({
      buyingPower,
      positions,
      optionPositions: optionPos
    });

  } catch (e) {
    console.error('Error fetching account info:', e);
    elements.buyingPower.textContent = '--';
  }
}

async function handleLogout() {
  await logout();
  clearAuthState();

  // Show form again
  elements.loginCard.style.display = 'block';
  elements.accountCard.style.display = 'none';

  // Clear form
  elements.loginForm.reset();
}

// Initialize on load
init();
