/**
 * Rate Limiter
 * Enforces Schwab API rate limit of 120 requests per minute
 * Uses sliding window algorithm
 */

export class RateLimiter {
  constructor(maxRequests = 120, windowMs = 60000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.requests = []
  }

  /**
   * Wait for a slot to become available
   * Returns immediately if under limit, otherwise waits
   */
  async waitForSlot() {
    const now = Date.now()

    // Remove expired requests outside the window
    this.requests = this.requests.filter(t => now - t < this.windowMs)

    if (this.requests.length >= this.maxRequests) {
      // Calculate wait time until oldest request expires
      const oldestRequest = this.requests[0]
      const waitTime = this.windowMs - (now - oldestRequest) + 100 // 100ms buffer

      console.log(`[RateLimiter] Rate limit reached, waiting ${waitTime}ms...`)
      await new Promise(resolve => setTimeout(resolve, waitTime))

      // Recursive call to check again
      return this.waitForSlot()
    }

    // Record this request
    this.requests.push(now)
  }

  /**
   * Get current request count in window
   */
  getCurrentCount() {
    const now = Date.now()
    this.requests = this.requests.filter(t => now - t < this.windowMs)
    return this.requests.length
  }

  /**
   * Get remaining requests available
   */
  getRemaining() {
    return this.maxRequests - this.getCurrentCount()
  }

  /**
   * Reset the rate limiter
   */
  reset() {
    this.requests = []
  }
}

// Export singleton
let _rateLimiter = null

export function getRateLimiter() {
  if (!_rateLimiter) {
    _rateLimiter = new RateLimiter()
  }
  return _rateLimiter
}
