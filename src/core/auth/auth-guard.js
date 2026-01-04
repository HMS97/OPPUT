/**
 * Auth Guard - Check auth status on page load
 */

import { getAuthState, clearAuthState, isLoggedIn, getUsername } from './auth-state.js';
import { checkAuth, logout } from './auth-service.js';

export async function initAuthGuard(options = {}) {
  const { onSessionExpired, onLoggedIn, onNotLoggedIn } = options;

  // Check localStorage
  const localState = getAuthState();

  if (!localState?.isAuthenticated) {
    onNotLoggedIn?.();
    return { authenticated: false };
  }

  // Verify with backend
  try {
    const health = await checkAuth();

    if (health.authenticated) {
      onLoggedIn?.(localState.username);
      return { authenticated: true, username: localState.username };
    } else {
      // Session expired on backend
      clearAuthState();
      onSessionExpired?.();
      return { authenticated: false, expired: true };
    }
  } catch (e) {
    // API not reachable - keep local state
    console.warn('Auth check failed:', e.message);
    return { authenticated: localState.isAuthenticated, offline: true };
  }
}

export function updateAuthUI(containerId = 'authBadge') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (isLoggedIn()) {
    const username = getUsername();
    container.innerHTML = `
      <div class="auth-badge logged-in">
        <span class="auth-user">${username}</span>
        <button class="auth-logout-btn" id="logoutBtn">Logout</button>
      </div>
    `;
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  } else {
    container.innerHTML = `
      <a href="../login/" class="auth-badge not-logged-in">
        <span>Login</span>
      </a>
    `;
  }
}

async function handleLogout() {
  await logout();
  clearAuthState();
  window.location.href = '../login/';
}
