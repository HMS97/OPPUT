/**
 * Follow Trade Page - Twitter-style trade signal monitoring
 * Follows @StockOptions888 and auto-executes trades via Robinhood
 */

import { initSidebar } from '../shared/sidebar.js'
import { fetchUserTweets, fetchHistoricalTweets, formatTweet, clearTweetCache } from '@core/data/twitter.js'
import { parseTweet, validateForExecution, getConfidenceLabel, isClosingTrade } from '@core/trading/tweet-parser.js'
import { OrderExecutor } from '@core/trading/order-executor.js'
import { RiskManager } from '@core/trading/risk-manager.js'

class FollowTradePage {
  constructor() {
    this.username = 'StockOptions888'
    this.pollIntervalMs = 30000 // 30 seconds
    this.isMonitoring = false
    this.autoExecute = true
    this.minConfidence = 70
    this.pollInterval = null
    this.seenTweetIds = new Set()
    this.executedTrades = []
    this.signalCount = 0
    this.currentSignal = null
    this.executor = null
    this.riskManager = null
    this.elements = {}

    this.init()
  }

  async init() {
    await initSidebar({ activePage: 'follow-trade' })
    this.cacheElements()
    this.bindEvents()
    this.loadSavedState()
    await this.checkConnections()

    // Auto-load cached tweets or fetch 3 months history
    await this.loadCachedOrFetchHistory()

    this.log('Follow Trade initialized', 'info')
  }

  /**
   * Load tweets from cache or fetch 3 months history if cache is stale/empty
   */
  async loadCachedOrFetchHistory() {
    const CACHE_KEY = 'followTrade_tweetsCache'
    const CACHE_EXPIRY_HOURS = 1 // Re-fetch after 1 hour

    try {
      // Check cache
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const { tweets, timestamp, username } = JSON.parse(cached)
        const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60)

        // Use cache if fresh and same username
        if (ageHours < CACHE_EXPIRY_HOURS && username === this.username && tweets.length > 0) {
          this.log(`Loaded ${tweets.length} tweets from cache (${Math.round(ageHours * 60)}m old)`, 'info')
          this.renderTweets(tweets)
          this.processHistoricalTweets(tweets)
          return
        }
      }

      // Cache is stale or empty - fetch fresh data
      this.log('Loading 3 months of tweets...', 'info')
      await this.loadHistoricalTweets(true) // true = silent mode

    } catch (e) {
      console.error('[FollowTrade] Cache load error:', e)
      // Try to fetch fresh data on error
      await this.loadHistoricalTweets(true)
    }
  }

  /**
   * Process historical tweets without auto-executing
   */
  processHistoricalTweets(tweets) {
    let signalCount = 0
    for (const tweet of tweets) {
      if (!this.seenTweetIds.has(tweet.id)) {
        this.seenTweetIds.add(tweet.id)
        const parsed = parseTweet(tweet.text)
        if (parsed) {
          signalCount++
          this.saveSignalToHistory({ tweet, parsed, isClosing: isClosingTrade(tweet.text) })
        }
      }
    }
    this.log(`Processed ${signalCount} signals from ${tweets.length} tweets`, 'info')
  }

  cacheElements() {
    // Header elements
    this.elements.usernameInput = document.getElementById('usernameInput')
    this.elements.followerCount = document.getElementById('followerCount')
    this.elements.statusIndicator = document.getElementById('statusIndicator')
    this.elements.monitorBtn = document.getElementById('monitorBtn')

    // Signal display elements
    this.elements.latestSignalCard = document.getElementById('latestSignalCard')
    this.elements.signalWaiting = document.getElementById('signalWaiting')
    this.elements.signalDisplay = document.getElementById('signalDisplay')
    this.elements.waitingUsername = document.getElementById('waitingUsername')
    this.elements.signalTime = document.getElementById('signalTime')
    this.elements.signalUsername = document.getElementById('signalUsername')
    this.elements.signalDirection = document.getElementById('signalDirection')
    this.elements.signalSymbol = document.getElementById('signalSymbol')
    this.elements.signalStrike = document.getElementById('signalStrike')
    this.elements.signalExpiry = document.getElementById('signalExpiry')
    this.elements.signalPrice = document.getElementById('signalPrice')
    this.elements.confidenceFill = document.getElementById('confidenceFill')
    this.elements.confidenceLabel = document.getElementById('confidenceLabel')
    this.elements.executeBtn = document.getElementById('executeBtn')
    this.elements.skipBtn = document.getElementById('skipBtn')

    // Tweet feed elements
    this.elements.tweetList = document.getElementById('tweetList')
    this.elements.refreshBtn = document.getElementById('refreshBtn')

    // Stats elements
    this.elements.statSignals = document.getElementById('statSignals')
    this.elements.statExecuted = document.getElementById('statExecuted')
    this.elements.statWinRate = document.getElementById('statWinRate')
    this.elements.statPnL = document.getElementById('statPnL')

    // Settings elements
    this.elements.autoExecuteToggle = document.getElementById('autoExecuteToggle')
    this.elements.minConfidence = document.getElementById('minConfidence')
    this.elements.rhStatus = document.getElementById('rhStatus')

    // Trades list
    this.elements.tradesList = document.getElementById('tradesList')
    this.elements.clearTradesBtn = document.getElementById('clearTradesBtn')

    // Log elements
    this.elements.logHeader = document.getElementById('logHeader')
    this.elements.logContent = document.getElementById('logContent')
    this.elements.logList = document.getElementById('logList')
  }

  bindEvents() {
    // Username input change
    this.elements.usernameInput?.addEventListener('change', (e) => {
      this.username = e.target.value.replace('@', '')
      this.elements.waitingUsername.textContent = this.username
      this.elements.signalUsername.textContent = this.username
      clearTweetCache()
      this.seenTweetIds.clear()
      this.saveState()
      this.log(`Now following @${this.username}`, 'info')
    })

    // Monitor button toggle
    this.elements.monitorBtn?.addEventListener('click', () => {
      if (this.isMonitoring) {
        this.stopMonitoring()
      } else {
        this.startMonitoring()
      }
    })

    // Refresh button
    this.elements.refreshBtn?.addEventListener('click', () => {
      this.refreshTweets()
    })

    // Load history button
    document.getElementById('loadHistoryBtn')?.addEventListener('click', () => {
      this.loadHistoricalTweets()
    })

    // Auto-execute toggle
    this.elements.autoExecuteToggle?.addEventListener('click', () => {
      this.autoExecute = !this.autoExecute
      this.updateAutoExecuteUI()
      this.saveState()
      this.log(`Auto-execute ${this.autoExecute ? 'enabled' : 'disabled'}`, 'info')
    })

    // Min confidence select
    this.elements.minConfidence?.addEventListener('change', (e) => {
      this.minConfidence = parseInt(e.target.value)
      this.saveState()
      this.log(`Min confidence set to ${this.minConfidence}%`, 'info')
    })

    // Execute current signal
    this.elements.executeBtn?.addEventListener('click', () => {
      if (this.currentSignal) {
        this.executeSignal(this.currentSignal)
      }
    })

    // Skip current signal
    this.elements.skipBtn?.addEventListener('click', () => {
      if (this.currentSignal) {
        this.log(`Skipped signal: ${this.currentSignal.parsed.symbol} ${this.currentSignal.parsed.direction}`, 'info')
        this.currentSignal = null
        this.showWaitingState()
      }
    })

    // Clear trades
    this.elements.clearTradesBtn?.addEventListener('click', () => {
      this.clearTradeHistory()
    })

    // Collapsible log
    this.elements.logHeader?.addEventListener('click', () => {
      this.elements.logContent?.classList.toggle('collapsed')
      const icon = this.elements.logHeader.querySelector('.collapse-icon')
      if (icon) {
        icon.textContent = this.elements.logContent?.classList.contains('collapsed') ? '▶' : '▼'
      }
    })
  }

  async checkConnections() {
    // Check Twitter API status
    try {
      const response = await fetch('/api/twitter/status')
      const data = await response.json()
      if (data.configured) {
        this.log('Twitter API connected', 'success')
      } else {
        this.log('Twitter API not configured', 'warning')
      }
    } catch (e) {
      this.log('Twitter API unavailable', 'error')
    }

    // Check Robinhood API
    try {
      const response = await fetch('http://localhost:8001/health')
      const data = await response.json()
      if (data.status === 'healthy') {
        this.elements.rhStatus.textContent = 'Connected'
        this.elements.rhStatus.classList.add('connected')

        // Initialize executor and risk manager
        this.riskManager = new RiskManager({
          maxDailyTrades: 10,
          maxPositionSize: 1000,
          maxDailyLoss: 500,
          minStrengthThreshold: this.minConfidence
        })

        this.executor = new OrderExecutor({
          dryRun: true,
          riskManager: this.riskManager,
          onOrderPlaced: (order) => this.handleOrderPlaced(order),
          onOrderFailed: (reason) => this.handleOrderFailed(reason)
        })

        this.log('Robinhood API connected', 'success')
      }
    } catch (e) {
      this.elements.rhStatus.textContent = 'Offline'
      this.log('Robinhood API not running', 'warning')
    }
  }

  updateAutoExecuteUI() {
    const toggle = this.elements.autoExecuteToggle
    if (toggle) {
      toggle.classList.toggle('active', this.autoExecute)
      const statusSpan = toggle.querySelector('.toggle-status')
      if (statusSpan) {
        statusSpan.textContent = this.autoExecute ? 'ON' : 'OFF'
      }
    }
  }

  async startMonitoring() {
    if (this.isMonitoring) return

    this.isMonitoring = true
    this.updateMonitoringUI()
    this.log(`Started monitoring @${this.username}`, 'success')

    // Fetch initial tweets
    await this.fetchAndProcessTweets()

    // Start polling
    this.pollInterval = setInterval(() => {
      this.fetchAndProcessTweets()
    }, this.pollIntervalMs)
  }

  stopMonitoring() {
    if (!this.isMonitoring) return

    this.isMonitoring = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    this.updateMonitoringUI()
    this.log('Stopped monitoring', 'info')
  }

  updateMonitoringUI() {
    const indicator = this.elements.statusIndicator
    const btn = this.elements.monitorBtn

    if (indicator) {
      const dot = indicator.querySelector('.status-dot')
      const text = indicator.querySelector('.status-text')
      if (dot) dot.classList.toggle('active', this.isMonitoring)
      if (text) text.textContent = this.isMonitoring ? 'Live' : 'Offline'
    }

    if (btn) {
      const icon = btn.querySelector('.btn-icon')
      const text = btn.querySelector('.btn-text')
      if (icon) icon.textContent = this.isMonitoring ? '⏹' : '▶'
      if (text) text.textContent = this.isMonitoring ? 'Stop' : 'Start'
      btn.classList.toggle('active', this.isMonitoring)
    }
  }

  async refreshTweets() {
    clearTweetCache()
    await this.fetchAndProcessTweets()
    this.log('Refreshed tweet feed', 'info')
  }

  async fetchAndProcessTweets() {
    try {
      const tweets = await fetchUserTweets(this.username, 50)
      this.renderTweets(tweets)

      // Process new tweets for signals
      for (const tweet of tweets) {
        if (!this.seenTweetIds.has(tweet.id)) {
          this.seenTweetIds.add(tweet.id)
          await this.processTweet(tweet)
        }
      }
    } catch (error) {
      this.log(`Failed to fetch tweets: ${error.message}`, 'error')
    }
  }

  async loadHistoricalTweets(silent = false) {
    const CACHE_KEY = 'followTrade_tweetsCache'
    const loadBtn = document.getElementById('loadHistoryBtn')

    if (!silent && loadBtn) {
      loadBtn.disabled = true
      loadBtn.textContent = '⏳ Loading 3 months...'
    }

    try {
      if (!silent) {
        this.log('Loading 3 months of historical tweets...', 'info')
      }

      const tweets = await fetchHistoricalTweets(this.username, 500, 3)

      if (tweets.length === 0) {
        this.log('No historical tweets found', 'warning')
        return
      }

      // Cache the tweets
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        tweets,
        timestamp: Date.now(),
        username: this.username
      }))

      // Render all tweets
      this.renderTweets(tweets)

      // Process all tweets for signals (but don't auto-execute old ones)
      this.processHistoricalTweets(tweets)

      this.log(`Loaded ${tweets.length} tweets from API and cached`, 'success')

      if (!silent && loadBtn) {
        loadBtn.textContent = `✅ ${tweets.length} tweets cached`
        setTimeout(() => {
          loadBtn.textContent = '🔄 Refresh Cache'
          loadBtn.disabled = false
        }, 2000)
      } else if (loadBtn) {
        loadBtn.textContent = '🔄 Refresh Cache'
      }
    } catch (error) {
      this.log(`Failed to load history: ${error.message}`, 'error')
      if (!silent && loadBtn) {
        loadBtn.textContent = '❌ Error'
        setTimeout(() => {
          loadBtn.textContent = '📥 Load 3 Months'
          loadBtn.disabled = false
        }, 2000)
      }
    }
  }

  async processTweet(tweet) {
    const parsed = parseTweet(tweet.text)

    if (!parsed) return // Not a trade signal

    const validation = validateForExecution(parsed)
    const isClosing = isClosingTrade(tweet.text)
    const confidencePercent = Math.round(parsed.confidence * 100)

    this.signalCount++
    this.updateStats()

    this.log(`Signal: ${parsed.symbol} ${parsed.direction} $${parsed.strike} (${confidencePercent}%)`, 'info')

    // Store as current signal and display
    const signal = { tweet, parsed, isClosing }
    this.displaySignal(signal)

    // Save to signal history for backtesting
    this.saveSignalToHistory(signal)

    // Auto-execute if enabled and meets criteria
    if (this.autoExecute &&
        validation.valid &&
        !isClosing &&
        confidencePercent >= this.minConfidence &&
        this.executor) {
      await this.executeSignal(signal)
    }
  }

  displaySignal(signal) {
    this.currentSignal = signal
    const { parsed, tweet } = signal
    const confidencePercent = Math.round(parsed.confidence * 100)

    // Hide waiting, show signal
    if (this.elements.signalWaiting) {
      this.elements.signalWaiting.style.display = 'none'
    }
    if (this.elements.signalDisplay) {
      this.elements.signalDisplay.style.display = 'block'
    }

    // Update signal details
    if (this.elements.signalTime) {
      const time = new Date(tweet.created_at || Date.now())
      this.elements.signalTime.textContent = time.toLocaleTimeString()
    }

    if (this.elements.signalDirection) {
      this.elements.signalDirection.textContent = parsed.direction
      this.elements.signalDirection.className = `signal-direction ${parsed.direction.toLowerCase()}`
    }

    if (this.elements.signalSymbol) {
      this.elements.signalSymbol.textContent = parsed.symbol
    }

    if (this.elements.signalStrike) {
      this.elements.signalStrike.textContent = parsed.strike
    }

    if (this.elements.signalExpiry) {
      this.elements.signalExpiry.textContent = parsed.expiry || '--'
    }

    if (this.elements.signalPrice) {
      this.elements.signalPrice.textContent = parsed.price ? `@ $${parsed.price}` : '@ Market'
    }

    // Update confidence bar
    if (this.elements.confidenceFill) {
      this.elements.confidenceFill.style.width = `${confidencePercent}%`
      this.elements.confidenceFill.className = `confidence-fill ${getConfidenceLabel(parsed.confidence).toLowerCase()}`
    }

    if (this.elements.confidenceLabel) {
      this.elements.confidenceLabel.textContent = `${confidencePercent}% confidence`
    }

    // Update card styling based on direction
    if (this.elements.latestSignalCard) {
      this.elements.latestSignalCard.className = `latest-signal-card ${parsed.direction.toLowerCase()}`
    }
  }

  showWaitingState() {
    if (this.elements.signalWaiting) {
      this.elements.signalWaiting.style.display = 'flex'
    }
    if (this.elements.signalDisplay) {
      this.elements.signalDisplay.style.display = 'none'
    }
    if (this.elements.latestSignalCard) {
      this.elements.latestSignalCard.className = 'latest-signal-card'
    }
  }

  async executeSignal(signal) {
    const { tweet, parsed } = signal

    try {
      const tradeSignal = {
        direction: parsed.direction,
        strength: parsed.confidence * 100,
        symbol: parsed.symbol,
        strike: parsed.strike,
        expiry: parsed.expiry,
        contracts: 1,
        type: 'twitter-follow',
        source: `@${this.username}`
      }

      this.log(`Executing: ${parsed.symbol} ${parsed.direction} $${parsed.strike}`, 'info')

      const result = await this.executor.executeSignal(tradeSignal)

      if (result.success) {
        const trade = {
          id: result.orderId || `TRADE-${Date.now()}`,
          tweet,
          parsed,
          entryPrice: parsed.price || result.estimatedPrice || 0,
          currentPrice: parsed.price || result.estimatedPrice || 0,
          status: 'executed',
          timestamp: new Date()
        }

        this.executedTrades.unshift(trade)
        this.updateTradesList()
        this.updateStats()
        this.saveState()
        this.log(`Executed: ${result.orderId || 'DRY-RUN'}`, 'success')

        // Show waiting for next signal
        this.currentSignal = null
        this.showWaitingState()
      }
    } catch (error) {
      this.log(`Execution failed: ${error.message}`, 'error')
    }
  }

  renderTweets(tweets) {
    if (!this.elements.tweetList) return

    if (tweets.length === 0) {
      this.elements.tweetList.innerHTML = `
        <div class="tweet-empty">
          <p>No tweets yet</p>
          <p class="hint">Start monitoring to fetch tweets</p>
        </div>
      `
      return
    }

    this.elements.tweetList.innerHTML = tweets.map(tweet => {
      const formatted = formatTweet(tweet)
      const parsed = parseTweet(tweet.text)
      const isClosing = isClosingTrade(tweet.text)
      const hasSignal = !!parsed

      let signalBadge = ''
      if (parsed) {
        const conf = Math.round(parsed.confidence * 100)
        signalBadge = `
          <div class="tweet-signal">
            <span class="signal-badge ${parsed.direction.toLowerCase()}">${parsed.direction}</span>
            <span class="signal-detail">${parsed.symbol} $${parsed.strike}</span>
            ${parsed.expiry ? `<span class="signal-expiry">${parsed.expiry}</span>` : ''}
            ${parsed.price ? `<span class="signal-price">$${parsed.price}</span>` : ''}
            <span class="signal-conf ${getConfidenceLabel(parsed.confidence).toLowerCase()}">${conf}%</span>
            ${isClosing ? '<span class="signal-close">CLOSE</span>' : ''}
          </div>
        `
      }

      return `
        <div class="tweet-item ${hasSignal ? parsed.direction.toLowerCase() : ''}">
          <div class="tweet-header">
            <span class="tweet-author">@${this.username}</span>
            <span class="tweet-time">${formatted.formattedTime}</span>
          </div>
          <div class="tweet-text">${tweet.text}</div>
          ${signalBadge}
        </div>
      `
    }).join('')
  }

  updateTradesList() {
    if (!this.elements.tradesList) return

    if (this.executedTrades.length === 0) {
      this.elements.tradesList.innerHTML = '<div class="trades-empty">No trades executed yet</div>'
      return
    }

    this.elements.tradesList.innerHTML = this.executedTrades.slice(0, 10).map(trade => {
      const pnl = trade.currentPrice - trade.entryPrice
      const pnlPercent = trade.entryPrice > 0 ? ((pnl / trade.entryPrice) * 100).toFixed(1) : 0
      const pnlClass = pnl >= 0 ? 'profit' : 'loss'

      return `
        <div class="trade-item">
          <div class="trade-info">
            <span class="trade-signal ${trade.parsed.direction.toLowerCase()}">${trade.parsed.symbol} ${trade.parsed.direction} $${trade.parsed.strike}</span>
            <span class="trade-time">${trade.timestamp.toLocaleTimeString()}</span>
          </div>
          <div class="trade-pnl ${pnlClass}">
            ${pnl >= 0 ? '+' : ''}$${(pnl * 100).toFixed(0)}
            <span class="trade-percent">(${pnlPercent}%)</span>
          </div>
        </div>
      `
    }).join('')
  }

  updateStats() {
    const executed = this.executedTrades.length
    const wins = this.executedTrades.filter(t => (t.currentPrice - t.entryPrice) > 0).length
    const totalPnl = this.executedTrades.reduce((sum, t) => sum + (t.currentPrice - t.entryPrice) * 100, 0)

    if (this.elements.statSignals) {
      this.elements.statSignals.textContent = this.signalCount
    }

    if (this.elements.statExecuted) {
      this.elements.statExecuted.textContent = executed
    }

    if (this.elements.statWinRate) {
      this.elements.statWinRate.textContent = executed > 0 ? `${Math.round((wins / executed) * 100)}%` : '--%'
    }

    if (this.elements.statPnL) {
      this.elements.statPnL.textContent = `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`
      this.elements.statPnL.className = `stat-number ${totalPnl >= 0 ? 'profit' : 'loss'}`
    }
  }

  handleOrderPlaced(order) {
    this.log(`Order: ${order.orderId} ${order.dryRun ? '(DRY RUN)' : ''}`, 'success')
  }

  handleOrderFailed(reason) {
    this.log(`Order failed: ${reason}`, 'error')
  }

  log(message, type = 'info') {
    if (!this.elements.logList) return

    const isEmpty = this.elements.logList.querySelector('.log-empty')
    if (isEmpty) isEmpty.remove()

    const entry = document.createElement('div')
    entry.className = `log-entry ${type}`
    entry.innerHTML = `
      <span class="log-time">${new Date().toLocaleTimeString()}</span>
      <span class="log-message">${message}</span>
    `
    this.elements.logList.insertBefore(entry, this.elements.logList.firstChild)

    // Keep only last 50 entries
    while (this.elements.logList.children.length > 50) {
      this.elements.logList.removeChild(this.elements.logList.lastChild)
    }
  }

  clearTradeHistory() {
    this.executedTrades = []
    this.signalCount = 0
    this.updateTradesList()
    this.updateStats()
    this.saveState()
    this.log('Trade history cleared', 'info')
  }

  saveState() {
    const state = {
      username: this.username,
      autoExecute: this.autoExecute,
      minConfidence: this.minConfidence,
      signalCount: this.signalCount,
      executedTrades: this.executedTrades.slice(0, 100),
      seenTweetIds: Array.from(this.seenTweetIds).slice(-500)
    }
    localStorage.setItem('followTrade_state', JSON.stringify(state))
  }

  // Save signal to history for backtesting
  saveSignalToHistory(signal) {
    const { tweet, parsed, isClosing } = signal

    // Get existing history
    let history = []
    try {
      const saved = localStorage.getItem('followTrade_signalHistory')
      if (saved) {
        history = JSON.parse(saved)
      }
    } catch (e) {
      console.error('Failed to load signal history:', e)
    }

    // Add new signal
    const record = {
      id: tweet.id,
      timestamp: tweet.created_at || new Date().toISOString(),
      text: tweet.text,
      username: this.username,
      parsed: {
        symbol: parsed.symbol,
        direction: parsed.direction,
        strike: parsed.strike,
        expiry: parsed.expiry,
        price: parsed.price,
        confidence: parsed.confidence
      },
      isClosing: isClosing || false,
      source: 'twitter-follow'
    }

    // Avoid duplicates
    if (!history.find(h => h.id === record.id)) {
      history.unshift(record)
    }

    // Keep last 500 signals
    history = history.slice(0, 500)

    // Save back
    localStorage.setItem('followTrade_signalHistory', JSON.stringify(history))
    localStorage.setItem('followTrade_lastUpdate', new Date().toISOString())
  }

  // Get signal history for backtesting
  static getSignalHistory() {
    try {
      const saved = localStorage.getItem('followTrade_signalHistory')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      console.error('Failed to load signal history:', e)
    }
    return []
  }

  // Clear signal history
  clearSignalHistory() {
    localStorage.removeItem('followTrade_signalHistory')
    localStorage.removeItem('followTrade_lastUpdate')
    this.log('Signal history cleared', 'info')
  }

  loadSavedState() {
    try {
      const saved = localStorage.getItem('followTrade_state')
      if (saved) {
        const state = JSON.parse(saved)

        this.username = state.username || 'StockOptions888'
        this.autoExecute = state.autoExecute !== false
        this.minConfidence = state.minConfidence || 70
        this.signalCount = state.signalCount || 0
        this.executedTrades = (state.executedTrades || []).map(t => ({
          ...t,
          timestamp: new Date(t.timestamp)
        }))
        this.seenTweetIds = new Set(state.seenTweetIds || [])

        // Update UI
        if (this.elements.usernameInput) {
          this.elements.usernameInput.value = this.username
        }
        if (this.elements.waitingUsername) {
          this.elements.waitingUsername.textContent = this.username
        }
        if (this.elements.signalUsername) {
          this.elements.signalUsername.textContent = this.username
        }
        if (this.elements.minConfidence) {
          this.elements.minConfidence.value = this.minConfidence
        }

        this.updateAutoExecuteUI()
        this.updateTradesList()
        this.updateStats()
      }
    } catch (e) {
      console.error('Failed to load saved state:', e)
    }
  }
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  window.followTradePage = new FollowTradePage()
})
