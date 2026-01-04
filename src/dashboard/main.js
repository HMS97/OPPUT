/**
 * SPY Dashboard - Main Entry Point
 * Uses ES modules and imports from core
 */

import {
  PatternDetector,
  fetchCandleData,
  generateDemoData,
  TIMEFRAME_CONFIG,
  PATTERN_ICONS,
  SENSITIVITY_CONFIGS,
} from '@core'
import { initSidebar } from '../shared/sidebar.js'

const TF_CONFIG = TIMEFRAME_CONFIG

class SPYDashboard {
  constructor() {
    this.timeframes = [5, 15, 60, 240]
    this.currentChartTF = 5
    this.dataMode = 'realtime'
    this.sensitivity = 'medium'
    this.soundEnabled = true
    this.refreshInterval = 10
    this.scanTimer = null
    this.detectors = {}
    this.signals = {}
    this.patterns = {}
    this.alerts = []
    this.lastAlertTime = 0
    this.alertCooldown = 60000
    this.dataCache = {}
    this.cacheExpiry = 30000
    this.usingRealData = false
    this.replayDatetime = null
    this.currentPrice = null
    this.replayChart = null
    this.replayCandleSeries = null

    this.backtestTrades = []
    this.backtestStats = {
      totalSignals: 0,
      putSignals: 0,
      callSignals: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
    }

    this.lastIndicators = null
    this.init()
  }

  async init() {
    // Initialize sidebar navigation
    await initSidebar({ activePage: 'dashboard' })

    this.initDetectors()
    this.initChart()
    this.bindEvents()
    this.startMonitoring()
    this.updateConnectionStatus(true)
    console.log('[SPY Dashboard] Multi-timeframe analysis initialized')
  }

  initDetectors() {
    const baseConfig = SENSITIVITY_CONFIGS[this.sensitivity]

    for (const tf of this.timeframes) {
      const tfMultiplier = tf >= 60 ? 1.5 : 1
      this.detectors[tf] = new PatternDetector({
        ...baseConfig,
        rejectionThreshold: baseConfig.rejectionThreshold * tfMultiplier,
        lowerHighTolerance: baseConfig.lowerHighTolerance * tfMultiplier,
        higherLowTolerance: baseConfig.higherLowTolerance * tfMultiplier,
      })
      this.signals[tf] = { strength: 0, patterns: [], direction: 'NEUTRAL' }
      this.patterns[tf] = []
    }
  }

  initChart() {
    if (typeof TradingView === 'undefined') {
      const container = document.getElementById('chartContainer')
      if (container) {
        container.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">
            <p>Loading TradingView chart...</p>
          </div>
        `
      }
      return
    }

    this.widget = new TradingView.widget({
      container_id: 'tradingview_chart',
      symbol: 'AMEX:SPY',
      interval: TF_CONFIG[this.currentChartTF].interval,
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#1a1a2e',
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      height: '100%',
      width: '100%',
      studies: ['Volume@tv-basicstudies'],
    })
  }

  bindEvents() {
    document.getElementById('realtimeBtn')?.addEventListener('click', () => {
      this.setDataMode('realtime')
    })
    document.getElementById('replayBtn')?.addEventListener('click', () => {
      this.setDataMode('replay')
    })

    document.querySelectorAll('.chart-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tf = parseInt(e.target.dataset.tf)
        this.setChartTimeframe(tf)
      })
    })

    document.getElementById('sensitivity')?.addEventListener('change', (e) => {
      this.sensitivity = e.target.value
      this.initDetectors()
      this.performScan()
    })

    document.getElementById('soundToggle')?.addEventListener('change', (e) => {
      this.soundEnabled = e.target.checked
    })

    document
      .getElementById('refreshInterval')
      ?.addEventListener('change', (e) => {
        this.refreshInterval = parseInt(e.target.value)
        this.restartMonitoring()
      })

    document.getElementById('replayGoBtn')?.addEventListener('click', () => {
      this.runReplay()
    })

    const replayDatetime = document.getElementById('replayDatetime')
    if (replayDatetime) {
      replayDatetime.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.runReplay()
      })
      const now = new Date()
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
      replayDatetime.value = now.toISOString().slice(0, 16)
    }
  }

  setDataMode(mode) {
    this.dataMode = mode

    const realtimeBtn = document.getElementById('realtimeBtn')
    const replayBtn = document.getElementById('replayBtn')
    const statusText = document.getElementById('statusText')

    if (realtimeBtn) realtimeBtn.classList.toggle('active', mode === 'realtime')
    if (replayBtn) replayBtn.classList.toggle('active', mode === 'replay')
    if (statusText) {
      statusText.textContent = mode === 'realtime' ? 'Live' : 'Replay Mode'
      statusText.style.color = mode === 'realtime' ? '#4ade80' : '#60a5fa'
    }

    const replayControls = document.getElementById('replayControls')
    if (replayControls) {
      replayControls.style.display = mode === 'replay' ? 'flex' : 'none'
    }

    const tvChart = document.getElementById('tradingview_chart')
    const replayChartEl = document.getElementById('replay_chart')
    if (tvChart && replayChartEl) {
      tvChart.style.display = mode === 'realtime' ? 'block' : 'none'
      replayChartEl.style.display = mode === 'replay' ? 'block' : 'none'
    }

    this.dataCache = {}

    if (mode === 'realtime') {
      this.replayDatetime = null
      this.restartMonitoring()
    } else {
      if (this.scanTimer) clearInterval(this.scanTimer)
      setTimeout(() => this.initReplayChart(), 100)
    }
  }

  initReplayChart() {
    const container = document.getElementById('replay_chart')
    if (!container) return

    if (typeof LightweightCharts === 'undefined') {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;"><p>Loading chart library...</p></div>'
      return
    }

    if (this.replayChart) {
      this.replayChart.remove()
      this.replayChart = null
      this.replayCandleSeries = null
    }

    const width = container.clientWidth || 800
    const height = 350

    this.replayChart = LightweightCharts.createChart(container, {
      width,
      height,
      layout: {
        background: { type: 'solid', color: '#1a1a2e' },
        textColor: '#999',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    this.replayCandleSeries = this.replayChart.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#e94560',
      borderUpColor: '#4ade80',
      borderDownColor: '#e94560',
      wickUpColor: '#4ade80',
      wickDownColor: '#e94560',
    })

    const resizeHandler = () => {
      if (this.replayChart && this.dataMode === 'replay') {
        const newWidth = container.clientWidth || 800
        this.replayChart.applyOptions({ width: newWidth })
      }
    }

    window.removeEventListener('resize', this._replayResizeHandler)
    this._replayResizeHandler = resizeHandler
    window.addEventListener('resize', resizeHandler)
  }

  updateReplayChart(candles) {
    if (!candles || candles.length === 0) return

    if (!this.replayChart || !this.replayCandleSeries) {
      this.initReplayChart()
      if (!this.replayCandleSeries) return
    }

    const chartData = candles
      .filter((c) => c.time && c.open && c.high && c.low && c.close)
      .map((c) => ({
        time: Math.floor(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => a.time - b.time)

    if (chartData.length === 0) return

    try {
      this.replayCandleSeries.setData(chartData)
      this.replayChart.timeScale().fitContent()
    } catch (e) {
      console.error('[SPY Dashboard] Error updating replay chart:', e)
    }
  }

  async runReplay() {
    const datetimeInput = document.getElementById('replayDatetime')
    if (!datetimeInput?.value) {
      alert('Please select a date and time')
      return
    }

    const [datePart, timePart] = datetimeInput.value.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes] = timePart.split(':').map(Number)
    this.replayDatetime = new Date(year, month - 1, day, hours, minutes, 0, 0)

    if (this.replayDatetime > new Date()) {
      alert('Cannot replay future dates')
      return
    }

    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 58)
    if (this.replayDatetime < sixtyDaysAgo) {
      alert(
        'Date too old. Yahoo Finance only provides 5-minute data for the last 60 days.'
      )
      return
    }

    this.dataCache = {}
    this.initReplayChart()

    const statusText = document.getElementById('statusText')
    if (statusText) {
      statusText.textContent = `Replay: ${this.replayDatetime.toLocaleString()}`
      statusText.style.color = '#60a5fa'
    }

    await this.performScan()
  }

  async setChartTimeframe(tf) {
    this.currentChartTF = tf
    document.querySelectorAll('.chart-tab').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.tf) === tf)
    })

    if (this.dataMode === 'realtime') {
      if (this.widget?.chart) {
        this.widget.chart().setResolution(TF_CONFIG[tf].interval)
      }
    } else {
      const cacheKey = `spy_${tf}`
      const cached = this.dataCache[cacheKey]
      if (cached?.data) {
        this.updateReplayChart(cached.data)
      }
    }
  }

  startMonitoring() {
    setTimeout(() => this.performScan(), 1000)
    this.scanTimer = setInterval(
      () => this.performScan(),
      this.refreshInterval * 1000
    )
  }

  restartMonitoring() {
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.startMonitoring()
  }

  async performScan() {
    try {
      let allPatterns = []
      let priceData = null

      for (const tf of this.timeframes) {
        const candles = await this.fetchCandleData(tf)

        if (!candles || candles.length < 10) {
          this.signals[tf] = { strength: 0, patterns: [] }
          this.patterns[tf] = []
          continue
        }

        if (!priceData) priceData = candles

        const detector = this.detectors[tf]
        const patterns = detector.analyze(candles)
        const signal = detector.getSignalSummary()

        patterns.forEach((p) => (p.timeframe = tf))

        this.signals[tf] = signal
        this.patterns[tf] = patterns
        allPatterns = allPatterns.concat(patterns)
      }

      if (priceData) {
        this.updatePriceDisplay(priceData)

        if (this.dataMode === 'replay') {
          const chartCacheKey = `spy_${this.currentChartTF}`
          const chartData = this.dataCache[chartCacheKey]
          if (chartData?.data) {
            this.updateReplayChart(chartData.data)
          } else {
            this.updateReplayChart(priceData)
          }
        }
      }

      for (const tf of this.timeframes) {
        this.updateTimeframeCard(tf, this.signals[tf], this.patterns[tf])
      }

      const combinedSignal = this.calculateCombinedSignal()
      this.updateOverallDisplay(combinedSignal, allPatterns)
      this.updateAllPatternsList(allPatterns)
      this.updateSignalDetails(combinedSignal, allPatterns)

      if (this.dataMode === 'replay' && combinedSignal.strength >= 50) {
        this.trackBacktestSignal(combinedSignal, allPatterns, priceData)
      }

      if (
        this.isGoodStartPoint(combinedSignal, allPatterns) &&
        Date.now() - this.lastAlertTime > this.alertCooldown
      ) {
        this.triggerAlert(combinedSignal, allPatterns)
      }
    } catch (e) {
      console.error('[SPY Dashboard] Scan failed:', e)
    }
  }

  isGoodStartPoint(signal, patterns) {
    if (signal.strength < 60) return false
    if (signal.activeTimeframes.length < 2) return false

    const indicatorTypes = [
      'RSI_OVERBOUGHT',
      'RSI_OVERSOLD',
      'RSI_BEARISH_DIVERGENCE',
      'RSI_BULLISH_DIVERGENCE',
      'BB_UPPER_TOUCH',
      'BB_LOWER_TOUCH',
      'BB_SQUEEZE_BULLISH',
      'BB_SQUEEZE_BEARISH',
      'EMA_BULLISH_CROSS',
      'EMA_BEARISH_CROSS',
      'MACD_BULLISH_CROSS',
      'MACD_BEARISH_CROSS',
      'MACD_HIST_BULLISH',
      'MACD_HIST_BEARISH',
      'VOLUME_SPIKE_BULLISH',
      'VOLUME_SPIKE_BEARISH',
    ]

    const priceActionTypes = [
      'LOWER_HIGH',
      'HIGHER_LOW',
      'REJECTION_AT_RESISTANCE',
      'REJECTION_AT_SUPPORT',
      'FALSE_BREAKOUT',
      'FALSE_BREAKOUT_DOWN',
      'ABSORPTION',
      'ABSORPTION_BUYING',
      'DOUBLE_REJECTION',
      'DOUBLE_REJECTION_BOTTOM',
    ]

    const directionPatterns = patterns.filter(
      (p) => p.signal === signal.direction
    )

    let indicatorCount = 0
    let priceActionCount = 0
    const seenIndicatorCategories = new Set()

    for (const p of directionPatterns) {
      if (indicatorTypes.includes(p.type)) {
        const category = p.type.split('_')[0]
        if (!seenIndicatorCategories.has(category)) {
          seenIndicatorCategories.add(category)
          indicatorCount++
        }
      }
      if (priceActionTypes.includes(p.type)) {
        priceActionCount++
      }
    }

    const hasIndicatorConfluence = indicatorCount >= 2
    const hasMixedConfluence = indicatorCount >= 1 && priceActionCount >= 2
    const hasStrongSignal = signal.strength >= 75 && indicatorCount >= 1

    return hasIndicatorConfluence || hasMixedConfluence || hasStrongSignal
  }

  updateSignalDetails(combinedSignal, allPatterns) {
    const timestampEl = document.getElementById('signalTimestamp')
    if (timestampEl) {
      timestampEl.textContent = new Date().toLocaleString()
    }

    const signal5m = this.signals[5]
    const indicators = signal5m?.indicators || {}
    this.lastIndicators = indicators

    // Update indicator displays
    this.updateIndicatorDisplay('RSI', indicators.rsi)
    this.updateIndicatorDisplay('EMA', indicators.ema)
    this.updateIndicatorDisplay('MACD', indicators.macd)
    this.updateIndicatorDisplay('BB', indicators.bollingerBands)

    // Update signal reasons
    const reasonsEl = document.getElementById('signalReasons')
    if (!reasonsEl) return

    if (
      combinedSignal.direction === 'NEUTRAL' ||
      combinedSignal.strength < 30
    ) {
      reasonsEl.innerHTML = '<p class="no-signal">No significant signal detected</p>'
      return
    }

    const strengthOrder = { VERY_HIGH: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
    const relevantPatterns = allPatterns
      .filter((p) => p.signal === combinedSignal.direction)
      .sort((a, b) => (strengthOrder[b.strength] || 0) - (strengthOrder[a.strength] || 0))
      .slice(0, 6)

    if (relevantPatterns.length === 0) {
      reasonsEl.innerHTML = '<p class="no-signal">No patterns for this direction</p>'
      return
    }

    reasonsEl.innerHTML = relevantPatterns
      .map(
        (p) => `
      <div class="reason-item">
        <span class="reason-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
        <div class="reason-text">
          <strong>${p.name}</strong>
          <span>${p.description}</span>
        </div>
        <span class="reason-weight">${p.strength}</span>
      </div>
    `
      )
      .join('')
  }

  updateIndicatorDisplay(type, data) {
    if (!data) return

    const valueEl = document.getElementById(`ind${type}`)
    const statusEl = document.getElementById(`ind${type}Status`)
    if (!valueEl || !statusEl) return

    switch (type) {
      case 'RSI':
        valueEl.textContent = data.value?.toFixed(1) || '--'
        statusEl.textContent = data.status || '--'
        statusEl.className = `ind-status ${
          data.status === 'OVERBOUGHT'
            ? 'bearish'
            : data.status === 'OVERSOLD'
              ? 'bullish'
              : 'neutral'
        }`
        break
      case 'EMA':
        const diff = ((data.fast - data.slow) / data.slow * 100).toFixed(2)
        valueEl.textContent = `${diff > 0 ? '+' : ''}${diff}%`
        statusEl.textContent = data.trend || '--'
        statusEl.className = `ind-status ${
          data.trend === 'BULLISH' ? 'bullish' : data.trend === 'BEARISH' ? 'bearish' : 'neutral'
        }`
        break
      case 'MACD':
        valueEl.textContent = data.histogram?.toFixed(3) || '--'
        statusEl.textContent = data.momentum || '--'
        statusEl.className = `ind-status ${
          data.momentum === 'BULLISH' ? 'bullish' : data.momentum === 'BEARISH' ? 'bearish' : 'neutral'
        }`
        break
      case 'BB':
        if (this.currentPrice && data.upper && data.lower) {
          const position = ((this.currentPrice - data.lower) / (data.upper - data.lower) * 100).toFixed(0)
          valueEl.textContent = `${position}%`
          let bbStatus = 'MID', bbClass = 'neutral'
          if (this.currentPrice >= data.upper) {
            bbStatus = 'UPPER'; bbClass = 'bearish'
          } else if (this.currentPrice <= data.lower) {
            bbStatus = 'LOWER'; bbClass = 'bullish'
          }
          statusEl.textContent = bbStatus
          statusEl.className = `ind-status ${bbClass}`
        }
        break
    }
  }

  trackBacktestSignal(signal, patterns, candles) {
    if (!candles || candles.length < 2) return

    const entryPrice = candles[candles.length - 1].close
    const entryTime = this.replayDatetime || new Date()
    const nextCandle = candles[candles.length - 1]
    const priceMove = nextCandle.close - nextCandle.open
    const MIN_WIN_POINTS = 2

    let outcome = 'pending'
    let profit = 0

    if (signal.direction === 'PUT') {
      if (priceMove <= -MIN_WIN_POINTS) {
        outcome = 'win'
        profit = Math.abs(priceMove)
      } else if (priceMove >= MIN_WIN_POINTS) {
        outcome = 'loss'
        profit = -Math.abs(priceMove)
      }
      this.backtestStats.putSignals++
    } else if (signal.direction === 'CALL') {
      if (priceMove >= MIN_WIN_POINTS) {
        outcome = 'win'
        profit = Math.abs(priceMove)
      } else if (priceMove <= -MIN_WIN_POINTS) {
        outcome = 'loss'
        profit = -Math.abs(priceMove)
      }
      this.backtestStats.callSignals++
    }

    this.backtestTrades.push({
      time: entryTime,
      direction: signal.direction,
      strength: signal.strength,
      entryPrice,
      outcome,
      profit,
      patterns: patterns.filter((p) => p.signal === signal.direction).map((p) => p.name).slice(0, 3),
    })

    this.backtestStats.totalSignals++
    if (outcome === 'win') this.backtestStats.wins++
    if (outcome === 'loss') this.backtestStats.losses++
    this.backtestStats.totalProfit += profit

    this.updateBacktestDisplay()
  }

  updateBacktestDisplay() {
    const totalEl = document.getElementById('btTotalSignals')
    const winRateEl = document.getElementById('btWinRate')
    const avgProfitEl = document.getElementById('btAvgProfit')
    const putEl = document.getElementById('btPutSignals')
    const callEl = document.getElementById('btCallSignals')

    if (totalEl) totalEl.textContent = this.backtestStats.totalSignals
    if (putEl) putEl.textContent = this.backtestStats.putSignals
    if (callEl) callEl.textContent = this.backtestStats.callSignals

    if (winRateEl) {
      const total = this.backtestStats.wins + this.backtestStats.losses
      if (total > 0) {
        const rate = ((this.backtestStats.wins / total) * 100).toFixed(1)
        winRateEl.textContent = `${rate}%`
        winRateEl.className = parseFloat(rate) >= 50 ? 'positive' : 'negative'
      } else {
        winRateEl.textContent = '--'
      }
    }

    if (avgProfitEl) {
      if (this.backtestStats.totalSignals > 0) {
        const avg = (this.backtestStats.totalProfit / this.backtestStats.totalSignals).toFixed(1)
        avgProfitEl.textContent = `${parseFloat(avg) >= 0 ? '+' : ''}${avg} pts`
        avgProfitEl.className = parseFloat(avg) >= 0 ? 'positive' : 'negative'
      } else {
        avgProfitEl.textContent = '--'
      }
    }
  }

  calculateCombinedSignal() {
    let putWeight = 0
    let callWeight = 0
    let activeTimeframes = []
    let indicatorCategories = new Set()

    for (const tf of this.timeframes) {
      const signal = this.signals[tf]
      if (signal.strength > 0) {
        activeTimeframes.push(tf)
        if (signal.direction === 'PUT') {
          putWeight += signal.putWeight || signal.strength
        } else if (signal.direction === 'CALL') {
          callWeight += signal.callWeight || signal.strength
        }

        if (signal.indicators) {
          if (signal.indicators.rsi) indicatorCategories.add('RSI')
          if (signal.indicators.ema) indicatorCategories.add('EMA')
          if (signal.indicators.macd) indicatorCategories.add('MACD')
          if (signal.indicators.bollingerBands) indicatorCategories.add('BB')
        }
      }
    }

    let direction = 'NEUTRAL'
    let dominantWeight = 0

    if (putWeight > callWeight + 2) {
      direction = 'PUT'
      dominantWeight = putWeight
    } else if (callWeight > putWeight + 2) {
      direction = 'CALL'
      dominantWeight = callWeight
    }

    let confluenceBonus = 0
    if (activeTimeframes.length >= 4) confluenceBonus = 25
    else if (activeTimeframes.length === 3) confluenceBonus = 15
    else if (activeTimeframes.length === 2) confluenceBonus = 10

    if (indicatorCategories.size >= 3) confluenceBonus += 10
    else if (indicatorCategories.size >= 2) confluenceBonus += 5

    const totalWeight = putWeight + callWeight
    const dominanceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0
    const baseStrength = dominantWeight > 0 ? Math.min(75, dominantWeight * 5) : 0
    const combinedStrength = Math.min(100, baseStrength * dominanceRatio + confluenceBonus)

    return {
      strength: direction === 'NEUTRAL' ? 0 : combinedStrength,
      direction,
      activeTimeframes,
      putWeight,
      callWeight,
      confluenceBonus,
      indicatorCategories: Array.from(indicatorCategories),
    }
  }

  updateTimeframeCard(tf, signal, patterns) {
    const tfId = TF_CONFIG[tf].id
    const card = document.getElementById(`card${tfId}`)
    const badge = document.getElementById(`badge${tfId}`)
    const meter = document.getElementById(`meter${tfId}`)
    const patternsList = document.getElementById(`patterns${tfId}`)

    if (!card || !badge || !meter || !patternsList) return

    card.classList.remove('has-signal', 'has-put', 'has-call')
    if (signal.strength >= 50) {
      card.classList.add('has-signal')
      if (signal.direction === 'PUT') card.classList.add('has-put')
      if (signal.direction === 'CALL') card.classList.add('has-call')
    }

    badge.className = 'tf-signal-badge'
    if (signal.strength >= 75) {
      badge.classList.add(signal.direction === 'CALL' ? 'badge-strong-call' : 'badge-strong')
      badge.textContent = `${signal.direction} ${Math.round(signal.strength)}%`
    } else if (signal.strength >= 50) {
      badge.classList.add(signal.direction === 'CALL' ? 'badge-medium-call' : 'badge-medium')
      badge.textContent = `${signal.direction} ${Math.round(signal.strength)}%`
    } else if (signal.strength > 0) {
      badge.classList.add('badge-weak')
      badge.textContent = `${Math.round(signal.strength)}%`
    } else {
      badge.classList.add('badge-none')
      badge.textContent = '--'
    }

    meter.style.width = `${signal.strength}%`
    if (signal.direction === 'CALL') {
      meter.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)'
    } else if (signal.direction === 'PUT') {
      meter.style.background = 'linear-gradient(90deg, #e94560, #ff6b6b)'
    } else {
      meter.style.background = 'linear-gradient(90deg, #666, #888)'
    }

    if (patterns.length > 0) {
      patternsList.innerHTML = patterns
        .slice(0, 3)
        .map(
          (p) => `
        <div class="tf-pattern-item ${p.signal ? p.signal.toLowerCase() : ''}">
          <span class="tf-pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
          <span>${p.name} (${p.signal || 'PUT'})</span>
        </div>
      `
        )
        .join('')
    } else {
      patternsList.innerHTML = '<div class="tf-no-pattern">No patterns</div>'
    }
  }

  updateOverallDisplay(signal, allPatterns) {
    const signalValueEl = document.getElementById('overallSignalValue')
    const meterEl = document.getElementById('overallMeter')

    if (signalValueEl) {
      signalValueEl.textContent =
        signal.direction === 'NEUTRAL'
          ? 'NEUTRAL'
          : `${signal.direction} ${Math.round(signal.strength)}%`
      signalValueEl.className = `signal-value ${signal.direction.toLowerCase()}`
    }

    if (meterEl) {
      meterEl.style.width = `${signal.strength}%`
      if (signal.direction === 'CALL') {
        meterEl.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)'
      } else if (signal.direction === 'PUT') {
        meterEl.style.background = 'linear-gradient(90deg, #e94560, #ff6b6b)'
      } else {
        meterEl.style.background = 'linear-gradient(90deg, #666, #888)'
      }
    }

    for (const tf of this.timeframes) {
      const tfId = TF_CONFIG[tf].id
      const dot = document.getElementById(`conf${tfId}`)
      if (dot) {
        dot.classList.toggle('active', signal.activeTimeframes.includes(tf))
        const tfSignal = this.signals[tf]
        dot.classList.remove('put', 'call')
        if (tfSignal.direction === 'PUT') dot.classList.add('put')
        if (tfSignal.direction === 'CALL') dot.classList.add('call')
      }
    }

    const statusBox = document.getElementById('overallStatus')
    if (!statusBox) return
    statusBox.className = 'status-box'

    if (signal.direction === 'NEUTRAL') {
      statusBox.classList.add('status-none')
      statusBox.textContent = 'Monitoring...'
    } else if (signal.direction === 'PUT') {
      if (signal.strength >= 75) {
        statusBox.classList.add('status-strong')
        statusBox.textContent = 'STRONG PUT!'
      } else if (signal.strength >= 50) {
        statusBox.classList.add('status-medium')
        statusBox.textContent = 'PUT Signal'
      } else {
        statusBox.classList.add('status-weak')
        statusBox.textContent = 'Weak PUT'
      }
    } else if (signal.direction === 'CALL') {
      if (signal.strength >= 75) {
        statusBox.classList.add('status-strong-call')
        statusBox.textContent = 'STRONG CALL!'
      } else if (signal.strength >= 50) {
        statusBox.classList.add('status-medium-call')
        statusBox.textContent = 'CALL Signal'
      } else {
        statusBox.classList.add('status-weak')
        statusBox.textContent = 'Weak CALL'
      }
    }
  }

  updateAllPatternsList(patterns) {
    const container = document.getElementById('allPatternsList')
    if (!container) return

    if (patterns.length === 0) {
      container.innerHTML =
        '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No patterns detected</p>'
      return
    }

    const sorted = [...patterns].sort((a, b) => b.timeframe - a.timeframe)

    container.innerHTML = sorted
      .slice(0, 8)
      .map(
        (p) => `
      <div class="pattern-item ${p.signal ? p.signal.toLowerCase() : ''}">
        <span class="pattern-icon">${PATTERN_ICONS[p.type] || '📊'}</span>
        <div class="pattern-info">
          <div class="pattern-name">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
        </div>
        <span class="pattern-tf">${TF_CONFIG[p.timeframe].name}</span>
        <span class="pattern-signal ${p.signal ? p.signal.toLowerCase() : ''}">${p.signal || 'PUT'}</span>
      </div>
    `
      )
      .join('')
  }

  updatePriceDisplay(candles) {
    if (!candles || candles.length < 2) return

    const current = candles[candles.length - 1]
    const previous = candles[candles.length - 2]

    this.currentPrice = current.close

    const change = current.close - previous.close
    const changePercent = (change / previous.close) * 100
    const isUp = change >= 0

    const priceEl = document.getElementById('currentPrice')
    const changeEl = document.getElementById('priceChange')
    const percentEl = document.getElementById('priceChangePercent')

    if (priceEl) {
      priceEl.textContent = current.close.toFixed(2)
      priceEl.className = `price-value ${isUp ? 'price-up' : 'price-down'}`
    }

    if (changeEl) {
      changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}`
      changeEl.style.color = isUp ? '#4ade80' : '#e94560'
    }

    if (percentEl) {
      percentEl.textContent = `(${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`
      percentEl.style.color = isUp ? '#4ade80' : '#e94560'
    }
  }

  async fetchCandleData(timeframe) {
    const cacheKey = `spy_${timeframe}`
    const cached = this.dataCache[cacheKey]
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data
    }

    try {
      const realData = await fetchCandleData('SPY', timeframe, this.replayDatetime)
      if (realData && realData.length >= 10) {
        this.dataCache[cacheKey] = { data: realData, timestamp: Date.now() }
        if (!this.usingRealData) {
          this.usingRealData = true
          this.updateDataSourceStatus(true)
        }
        return realData
      }
    } catch (e) {
      console.error('[SPY Dashboard] Real data fetch failed:', e.message)
      if (this.usingRealData) {
        this.usingRealData = false
        this.updateDataSourceStatus(false)
      }
    }

    console.warn('[SPY Dashboard] Using fallback demo data')
    return generateDemoData(timeframe)
  }

  updateDataSourceStatus(isReal) {
    if (this.dataMode === 'replay') return

    const statusText = document.getElementById('statusText')
    if (statusText) {
      statusText.textContent = isReal ? 'Live Data' : 'Demo Data'
      statusText.style.color = isReal ? '#4ade80' : '#fbbf24'
    }
  }

  triggerAlert(signal, patterns) {
    this.lastAlertTime = Date.now()

    this.alerts.unshift({
      time: new Date(),
      direction: signal.direction,
      strength: signal.strength,
      timeframes: signal.activeTimeframes,
      patterns: patterns.slice(0, 3).map((p) => p.name),
    })
    this.alerts = this.alerts.slice(0, 20)
    this.updateAlertHistory()
    this.showAlertPopup(signal, patterns)
    if (this.soundEnabled) this.playAlertSound()
  }

  updateAlertHistory() {
    const container = document.getElementById('alertList')
    if (!container) return

    if (this.alerts.length === 0) {
      container.innerHTML =
        '<p style="color:#666;text-align:center;padding:20px;font-size:12px;">No alerts yet</p>'
      return
    }

    container.innerHTML = this.alerts
      .slice(0, 10)
      .map(
        (a) => `
      <div class="alert-item ${(a.direction || 'put').toLowerCase()}">
        <div class="alert-header">
          <span class="alert-type ${(a.direction || 'put').toLowerCase()}">${a.direction || 'PUT'} ${Math.round(a.strength)}%</span>
          <span class="alert-time">${a.time.toLocaleTimeString()}</span>
        </div>
        <div class="alert-details">
          ${a.timeframes.map((tf) => TF_CONFIG[tf].name).join(', ')}
        </div>
      </div>
    `
      )
      .join('')
  }

  showAlertPopup(signal, patterns) {
    const popup = document.getElementById('alertPopup')
    const tfsEl = document.getElementById('alertPopupTFs')
    const contentEl = document.getElementById('alertPopupContent')
    const strengthEl = document.getElementById('alertPopupStrength')

    if (!popup || !tfsEl || !contentEl || !strengthEl) return

    tfsEl.innerHTML = signal.activeTimeframes
      .map((tf) => `<span class="alert-popup-tf">${TF_CONFIG[tf].name}</span>`)
      .join('')

    const indicatorPatterns = patterns.filter(
      (p) =>
        p.signal === signal.direction &&
        (p.type.startsWith('RSI_') ||
          p.type.startsWith('BB_') ||
          p.type.startsWith('EMA_') ||
          p.type.startsWith('MACD_') ||
          p.type.startsWith('VOLUME_'))
    )

    const pricePatterns = patterns.filter(
      (p) => p.signal === signal.direction && !indicatorPatterns.includes(p)
    )

    contentEl.innerHTML = `
      <p style="color:#4ade80;font-weight:bold;">GOOD START POINT</p>
      <p><strong>Direction:</strong> ${signal.direction}</p>
      <p><strong>Timeframes:</strong> ${signal.activeTimeframes.length}/4 aligned</p>
      ${
        signal.indicatorCategories?.length > 0
          ? `<p><strong>Indicators:</strong> ${signal.indicatorCategories.join(', ')}</p>`
          : ''
      }
      <p style="margin-top:8px;"><strong>Key Signals:</strong></p>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;">
        ${indicatorPatterns.slice(0, 3).map((p) => `<li>${p.name}</li>`).join('')}
        ${pricePatterns.slice(0, 2).map((p) => `<li>${p.name}</li>`).join('')}
      </ul>
    `

    strengthEl.textContent = `${signal.direction} ${Math.round(signal.strength)}%`
    strengthEl.className = signal.direction.toLowerCase()

    popup.classList.add('show')
    setTimeout(() => popup.classList.remove('show'), 10000)
  }

  playAlertSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 800
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)

    setTimeout(() => {
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = 1000
      gain2.gain.setValueAtTime(0.3, ctx.currentTime)
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc2.start(ctx.currentTime)
      osc2.stop(ctx.currentTime + 0.5)
    }, 200)
  }

  updateConnectionStatus(connected) {
    const dot = document.getElementById('statusDot')
    if (dot) {
      dot.style.background = connected ? '#4ade80' : '#e94560'
    }
  }
}

// Close alert popup function (global for onclick handler)
window.closeAlertPopup = function () {
  document.getElementById('alertPopup')?.classList.remove('show')
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyDashboard = new SPYDashboard()
})
