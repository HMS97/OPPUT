/**
 * Schwab OAuth Token Manager
 * Handles OAuth 2.0 token refresh and persistence
 *
 * Token lifecycle:
 * - Access token: expires in 30 minutes (auto-refreshed)
 * - Refresh token: expires in 7 days (requires manual re-auth)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_FILE = path.join(__dirname, '../../../data/.schwab-tokens.json')
const OAUTH_URL = 'https://api.schwabapi.com/v1/oauth/token'

export class TokenManager {
  constructor() {
    this.accessToken = null
    this.refreshToken = process.env.SCHWAB_REFRESH_TOKEN || null
    this.accessTokenExpiry = null
    this.appKey = process.env.SCHWAB_APP_KEY || null
    this.appSecret = process.env.SCHWAB_SECRET || null

    // Load persisted tokens
    this.loadTokens()
  }

  /**
   * Load tokens from file if exists
   */
  loadTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
        this.refreshToken = data.refreshToken || this.refreshToken
        this.accessToken = data.accessToken || null
        this.accessTokenExpiry = data.accessTokenExpiry || null
        console.log('[TokenManager] Loaded tokens from file')
      }
    } catch (error) {
      console.warn('[TokenManager] Failed to load tokens:', error.message)
    }
  }

  /**
   * Save tokens to file for persistence across restarts
   */
  saveTokens() {
    try {
      const dir = path.dirname(TOKEN_FILE)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const data = {
        refreshToken: this.refreshToken,
        accessToken: this.accessToken,
        accessTokenExpiry: this.accessTokenExpiry,
        updatedAt: new Date().toISOString(),
      }

      fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
      console.log('[TokenManager] Tokens saved to file')
    } catch (error) {
      console.error('[TokenManager] Failed to save tokens:', error.message)
    }
  }

  /**
   * Check if access token is still valid
   * Adds 60 second buffer before expiry
   */
  isAccessTokenValid() {
    if (!this.accessToken || !this.accessTokenExpiry) {
      return false
    }
    // Consider invalid if less than 60 seconds until expiry
    return Date.now() < (this.accessTokenExpiry - 60000)
  }

  /**
   * Check if credentials are configured
   */
  hasCredentials() {
    return !!(this.appKey && this.appSecret && this.refreshToken)
  }

  /**
   * Refresh the access token using refresh token
   * @returns {Promise<string>} New access token
   */
  async refreshAccessToken() {
    if (!this.hasCredentials()) {
      throw new Error(
        'Schwab credentials not configured. Set SCHWAB_APP_KEY, SCHWAB_SECRET, and SCHWAB_REFRESH_TOKEN environment variables.'
      )
    }

    console.log('[TokenManager] Refreshing access token...')

    const credentials = Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64')

    const response = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()

      // Check for refresh token expiry
      if (response.status === 400 || response.status === 401) {
        throw new Error(
          `Token refresh failed (${response.status}): ${errorText}. ` +
          'Your refresh token may have expired (7-day limit). ' +
          'Please re-authenticate at https://developer.schwab.com'
        )
      }

      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    this.accessToken = data.access_token
    this.accessTokenExpiry = Date.now() + (data.expires_in * 1000)

    // Schwab returns a new refresh token with each refresh
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token
    }

    this.saveTokens()

    console.log('[TokenManager] Access token refreshed successfully')
    return this.accessToken
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} Valid access token
   */
  async getAccessToken() {
    if (this.isAccessTokenValid()) {
      return this.accessToken
    }

    return await this.refreshAccessToken()
  }

  /**
   * Get time until access token expires
   * @returns {number} Milliseconds until expiry, or 0 if expired/invalid
   */
  getTimeUntilExpiry() {
    if (!this.accessTokenExpiry) return 0
    const remaining = this.accessTokenExpiry - Date.now()
    return remaining > 0 ? remaining : 0
  }

  /**
   * Manually set refresh token (for initial setup)
   */
  setRefreshToken(token) {
    this.refreshToken = token
    this.saveTokens()
  }

  /**
   * Clear all tokens (for logout/reset)
   */
  clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    this.accessTokenExpiry = null

    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE)
    }
  }
}

// Export singleton
let _tokenManager = null

export function getTokenManager() {
  if (!_tokenManager) {
    _tokenManager = new TokenManager()
  }
  return _tokenManager
}
