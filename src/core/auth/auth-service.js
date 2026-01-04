/**
 * Auth Service - API calls to Robinhood FastAPI backend
 */

const API_URL = 'http://localhost:8001';

export async function login(username, password, mfaCode = null, challengeId = null, challengeCode = null) {
  const response = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      mfa_code: mfaCode,
      challenge_id: challengeId,
      challenge_code: challengeCode
    })
  });

  const data = await response.json();

  // Check if challenge is required (not an error, just needs verification)
  if (data.status === 'challenge_required' || data.status === 'app_approval_required') {
    return data;
  }

  if (!response.ok) {
    throw new Error(data.detail || 'Login failed');
  }

  return data;
}

export async function checkAppApproval(challengeId, username, password) {
  const response = await fetch(`${API_URL}/login/check-app-approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: challengeId,
      username,
      password
    })
  });

  return response.json();
}

export async function authenticate() {
  const response = await fetch(`${API_URL}/authenticate`, {
    method: 'POST'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Auto-connect failed');
  }

  return response.json();
}

export async function logout() {
  try {
    await fetch(`${API_URL}/logout`, { method: 'POST' });
  } catch (e) {
    console.warn('Logout API call failed:', e.message);
  }
}

export async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) return { healthy: false, authenticated: false };
    return response.json();
  } catch {
    return { healthy: false, authenticated: false };
  }
}

export async function getAccount() {
  const response = await fetch(`${API_URL}/account`);
  if (!response.ok) throw new Error('Not authenticated');
  return response.json();
}

export async function getBuyingPower() {
  const response = await fetch(`${API_URL}/buying-power`);
  if (!response.ok) throw new Error('Not authenticated');
  const data = await response.json();
  return data.buying_power;
}

export async function getPositions() {
  const response = await fetch(`${API_URL}/positions`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.positions || [];
}

export async function getOptionPositions() {
  const response = await fetch(`${API_URL}/positions/options`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.positions || [];
}
