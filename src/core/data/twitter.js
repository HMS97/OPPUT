/**
 * Twitter API v2 Client for fetching user tweets
 * Used for following trade signals from @StockOptions888
 */

// Cache for rate limit management
const tweetCache = new Map()
const CACHE_TTL = 30000 // 30 seconds

/**
 * Get Bearer token using API key and secret
 * @returns {Promise<string>} Bearer token
 */
async function getBearerToken(apiKey, apiSecret) {
  const credentials = btoa(`${apiKey}:${apiSecret}`)

  const response = await fetch('https://api.twitter.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })

  if (!response.ok) {
    throw new Error(`Failed to get bearer token: ${response.status}`)
  }

  const data = await response.json()
  return data.access_token
}

/**
 * Get user ID from username
 * @param {string} username - Twitter handle (without @)
 * @param {string} bearerToken - OAuth 2.0 bearer token
 * @returns {Promise<string>} User ID
 */
async function getUserId(username, bearerToken) {
  const response = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to get user ID: ${response.status}`)
  }

  const data = await response.json()
  return data.data.id
}

/**
 * Fetch recent tweets from a user
 * Uses server proxy to hide API credentials
 * @param {string} username - Twitter handle (without @)
 * @param {number} maxResults - Max tweets to fetch (5-100)
 * @returns {Promise<Array>} Array of tweet objects
 */
export async function fetchUserTweets(username, maxResults = 10) {
  // Check cache first
  const cacheKey = `tweets:${username}`
  const cached = tweetCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Twitter] Returning cached tweets')
    return cached.tweets
  }

  try {
    // Use server proxy to hide credentials
    const response = await fetch(`/api/twitter/user/${username}/tweets?max_results=${maxResults}`)

    // Check content type to detect if we got HTML instead of JSON
    const contentType = response.headers.get('content-type') || ''

    if (!contentType.includes('application/json')) {
      // Server returned HTML (likely 404 or server not running)
      console.error('[Twitter] Server returned non-JSON response. Is the API server running?')
      throw new Error('API server not running. Run "npm start" to start the backend server.')
    }

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || `Twitter API error: ${response.status}`)
    }

    const tweets = data.data || []

    // Cache the results
    tweetCache.set(cacheKey, {
      tweets,
      timestamp: Date.now()
    })

    return tweets
  } catch (error) {
    console.error('[Twitter] Failed to fetch tweets:', error)
    throw error
  }
}

/**
 * Fetch tweets directly (for server-side use)
 * @param {string} username - Twitter handle
 * @param {string} apiKey - Twitter API key
 * @param {string} apiSecret - Twitter API secret
 * @param {number} maxResults - Max tweets
 * @returns {Promise<Array>} Tweet objects
 */
export async function fetchUserTweetsDirect(username, apiKey, apiSecret, maxResults = 10) {
  // Get bearer token
  const bearerToken = await getBearerToken(apiKey, apiSecret)

  // Get user ID
  const userId = await getUserId(username, bearerToken)

  // Fetch tweets
  const response = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at,text,author_id`,
    {
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch tweets: ${response.status}`)
  }

  const data = await response.json()
  return data.data || []
}

/**
 * Format tweet for display
 * @param {Object} tweet - Raw tweet object
 * @returns {Object} Formatted tweet
 */
export function formatTweet(tweet) {
  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: new Date(tweet.created_at),
    formattedTime: new Date(tweet.created_at).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }
}

/**
 * Fetch historical tweets (3 months) for backtesting
 * @param {string} username - Twitter handle (without @)
 * @param {number} maxTweets - Max tweets to fetch (default 500)
 * @param {number} months - How many months back to fetch (default 3)
 * @returns {Promise<Array>} Array of tweet objects
 */
export async function fetchHistoricalTweets(username, maxTweets = 500, months = 3) {
  try {
    const response = await fetch(
      `/api/twitter/user/${username}/history?max_tweets=${maxTweets}&months=${months}`
    )

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error('API server not running. Run "npm start" to start the backend server.')
    }

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Twitter API error: ${response.status}`)
    }

    const tweets = data.data || []
    console.log(`[Twitter] Fetched ${tweets.length} historical tweets from @${username}`)

    return tweets
  } catch (error) {
    console.error('[Twitter] Failed to fetch historical tweets:', error)
    throw error
  }
}

/**
 * Clear tweet cache
 */
export function clearTweetCache() {
  tweetCache.clear()
}

/**
 * Get cache status
 * @returns {Object} Cache info
 */
export function getCacheStatus() {
  const entries = Array.from(tweetCache.entries())
  return {
    size: entries.length,
    entries: entries.map(([key, value]) => ({
      key,
      age: Date.now() - value.timestamp,
      count: value.tweets.length
    }))
  }
}
