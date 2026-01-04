/**
 * Auth State Manager - Handles localStorage persistence
 */

const AUTH_KEY = 'opput_auth';
const ACCOUNT_CACHE_KEY = 'opput_account';
const CACHE_TTL = 30000; // 30 seconds

export function getAuthState() {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setAuthState(state) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    ...state,
    loginTimestamp: Date.now()
  }));
}

export function clearAuthState() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(ACCOUNT_CACHE_KEY);
}

export function isLoggedIn() {
  const state = getAuthState();
  return state?.isAuthenticated === true;
}

export function getUsername() {
  const state = getAuthState();
  return state?.username || null;
}

// Account cache helpers
export function getCachedAccount() {
  try {
    const cached = sessionStorage.getItem(ACCOUNT_CACHE_KEY);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL) {
      sessionStorage.removeItem(ACCOUNT_CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCachedAccount(data) {
  sessionStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
}
