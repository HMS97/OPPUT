/**
 * Shared Sidebar Component
 * Renders navigation + optional Robinhood auth status
 */

import { checkAuth, getAccount, logout } from '../core/auth/auth-service.js';
import { clearAuthState, getCachedAccount, setCachedAccount, isLoggedIn, setAuthState } from '../core/auth/auth-state.js';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '\u{1F4CA}', href: '../dashboard/' },
  { id: 'spy-options', label: 'Options', icon: '\u{1F4C8}', href: '../spy-options/' },
  { id: 'backtest', label: 'Backtester', icon: '\u{1F52C}', href: '../backtest/' },
  { id: 'strategies', label: 'Strategies', icon: '\u{1F4D6}', href: '../strategies/' },
  { id: 'trading', label: 'Trading', icon: '\u{1F4B9}', href: '../trading/' },
  { id: 'follow-trade', label: 'Follow', icon: '\u{1F426}', href: '../follow-trade/' },
];

/**
 * Initialize the sidebar
 * @param {Object} options
 * @param {string} options.activePage - Current page id (dashboard, spy-options, backtest, trading)
 * @param {string} [options.containerId='sidebar'] - Container element ID
 */
export async function initSidebar(options = {}) {
  const { activePage, containerId = 'sidebar' } = options;

  // Create sidebar container
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('nav');
    container.id = containerId;
    container.className = 'sidebar';
    document.body.insertBefore(container, document.body.firstChild);
  }

  // Render sidebar HTML
  container.innerHTML = renderSidebar(activePage);

  // Initialize auth section (non-blocking)
  initAuthSection();

  // Bind event listeners
  bindSidebarEvents();
}

function renderSidebar(activePage) {
  return `
    <div class="sidebar-brand">
      <span class="brand-icon">\u26A1</span>
      <span class="brand-text">OPPUT</span>
    </div>

    <div class="sidebar-nav">
      ${PAGES.map(page => `
        <a href="${page.href}"
           class="sidebar-link ${page.id === activePage ? 'active' : ''}">
          <span class="sidebar-icon">${page.icon}</span>
          <span class="sidebar-label">${page.label}</span>
        </a>
      `).join('')}
    </div>

    <div class="sidebar-footer">
      <div class="auth-section" id="sidebarAuth">
        <div class="auth-loading">Checking...</div>
      </div>
    </div>
  `;
}

async function initAuthSection() {
  const authContainer = document.getElementById('sidebarAuth');
  if (!authContainer) return;

  try {
    const health = await checkAuth();

    if (health.authenticated) {
      // Sync local state
      setAuthState({ isAuthenticated: true });
      await renderLoggedInState(authContainer);
    } else {
      clearAuthState();
      renderLoggedOutState(authContainer);
    }
  } catch (e) {
    // API not available - check local state
    if (isLoggedIn()) {
      // Show cached state
      renderCachedState(authContainer);
    } else {
      renderLoggedOutState(authContainer);
    }
  }
}

async function renderLoggedInState(container) {
  // Try cached account first
  let accountData = getCachedAccount();

  if (!accountData) {
    try {
      accountData = await getAccount();
      setCachedAccount(accountData);
    } catch (e) {
      accountData = null;
    }
  }

  const buyingPower = accountData?.buying_power
    ? `$${Number(accountData.buying_power).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
    : '--';

  container.innerHTML = `
    <div class="auth-badge logged-in">
      <div class="auth-user-info">
        <span class="auth-status-dot connected"></span>
        <span class="auth-label">Connected</span>
      </div>
      <div class="auth-buying-power">
        <span class="bp-label">Buying Power</span>
        <span class="bp-value">${buyingPower}</span>
      </div>
      <div class="auth-actions">
        <a href="../login/" class="auth-account-btn">Account</a>
        <button class="auth-logout-btn" id="sidebarLogout">Logout</button>
      </div>
    </div>
  `;
}

function renderCachedState(container) {
  // API offline but we have local auth state
  const cachedAccount = getCachedAccount();
  const buyingPower = cachedAccount?.buying_power
    ? `$${Number(cachedAccount.buying_power).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
    : '--';

  container.innerHTML = `
    <div class="auth-badge logged-in offline">
      <div class="auth-user-info">
        <span class="auth-status-dot offline"></span>
        <span class="auth-label">Offline</span>
      </div>
      <div class="auth-buying-power">
        <span class="bp-label">Buying Power</span>
        <span class="bp-value">${buyingPower}</span>
      </div>
      <div class="auth-actions">
        <a href="../login/" class="auth-account-btn">Account</a>
        <button class="auth-logout-btn" id="sidebarLogout">Logout</button>
      </div>
    </div>
  `;
}

function renderLoggedOutState(container) {
  container.innerHTML = `
    <a href="../login/" class="auth-login-btn">
      <span class="login-icon">\u{1F510}</span>
      <span class="login-text">Login to Robinhood</span>
    </a>
  `;
}

function bindSidebarEvents() {
  // Logout handler
  const logoutBtn = document.getElementById('sidebarLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logout();
      clearAuthState();
      renderLoggedOutState(document.getElementById('sidebarAuth'));
    });
  }
}

// Re-export for pages that need to refresh auth state
export async function refreshAuthState() {
  await initAuthSection();
}
