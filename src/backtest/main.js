/**
 * SPY Options Backtester - Main Application
 */

import { fetchCandleData } from '../core/data/yahoo.js'
import {
  BacktestEngine,
  PatternDetectorSource,
  DailySignalSource,
  OISignalSource,
  IVSignalSource,
  FixedBarsExit,
  OppositeSignalExit,
  TargetStopExit,
  calculateStatistics,
  monteCarloSimulation,
} from '../core/backtest/index.js'

const DATA_LIMITS = {
  5: { label: '5 days', days: 5 },
  15: { label: '1 month', days: 30 },
  60: { label: '3 months', days: 90 },
  240: { label: '1 year', days: 365 },
}

class BacktestApp {
  constructor() {
    this.config = {
      source: 'pattern',
      timeframe: 60,
      exitStrategy: 'fixed-bars',
      signalTypes: ['CALL', 'PUT'],
      minStrength: 30,
      // Source-specific
      lookback: 50,
      // Exit-specific
      bars: 10,
      targetPercent: 1.0,
      stopPercent: 0.5,
      oppositeMinStrength: 50,
      // Date range (null = use default range based on timeframe)
      startDate: null,
      endDate: null,
      // IV-specific config
      ivStrategy: 'percentile',
      ivLookback: 20,
      // Options leverage
      leverageMultiplier: 1,
    }

    this.results = null
    this.charts = {}

    this.init()
  }

  init() {
    this.bindEvents()
    this.renderSourceConfig()
    this.renderExitConfig()
    this.updateDataLimitInfo()
    this.initDateInputs()
  }

  applyOIWASPDefaults() {
    // Optimized defaults for OI-WASP strategy (200%+ monthly target)
    // 1. Timeframe: 15m
    this.config.timeframe = 15
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'))
    document.querySelector('.tf-btn[data-tf="15"]').classList.add('active')

    // 2. Exit Strategy: Target/Stop Loss
    this.config.exitStrategy = 'target-stop'
    this.config.targetPercent = 1.5
    this.config.stopPercent = 0.5
    document.getElementById('exitStrategy').value = 'target-stop'
    this.renderExitConfig()

    // 3. Options Leverage: 8x (Butterfly)
    this.config.leverageMultiplier = 8
    document.getElementById('leverageMultiplier').value = 8
    document.getElementById('leverageValue').textContent = '8x (Butterfly)'

    // 4. Min Signal Strength: 20%
    this.config.minStrength = 20
    document.getElementById('minStrength').value = 20
    document.getElementById('minStrengthValue').textContent = '20%'

    // 5. OI-WASP specific settings
    this.config.waspPeriod = 15
    this.config.entryDeviation = 0.2

    // Update date range for 15m timeframe
    this.initDateInputs()
    this.updateDataLimitInfo()
  }

  initDateInputs() {
    const startInput = document.getElementById('startDate')
    const endInput = document.getElementById('endDate')

    // Set default range based on current timeframe
    const limit = DATA_LIMITS[this.config.timeframe]
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - limit.days)

    // Format as YYYY-MM-DD for date inputs
    endInput.value = this.formatDateForInput(endDate)
    startInput.value = this.formatDateForInput(startDate)

    // Set max date to today
    endInput.max = this.formatDateForInput(endDate)
    startInput.max = this.formatDateForInput(endDate)
  }

  formatDateForInput(date) {
    return date.toISOString().split('T')[0]
  }

  parseDateFromInput(value, endOfDay = false) {
    if (!value) return null
    // Create date in UTC to avoid timezone issues
    const [year, month, day] = value.split('-').map(Number)
    if (endOfDay) {
      // Set to 23:59:59 UTC to include the full day
      return new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
    }
    return new Date(Date.UTC(year, month - 1, day))
  }

  validateDateRange() {
    const startInput = document.getElementById('startDate')
    const endInput = document.getElementById('endDate')
    const infoEl = document.getElementById('dataLimitInfo')

    const startDate = this.parseDateFromInput(startInput.value)
    const endDate = this.parseDateFromInput(endInput.value)
    const today = new Date()
    today.setHours(23, 59, 59, 999)

    // Minimum days required per timeframe to get ~50 candles
    const MIN_DAYS = {
      5: 2,    // 5m: ~78 candles per trading day
      15: 4,   // 15m: ~26 candles per trading day
      60: 8,   // 1H: ~6.5 candles per trading day
      240: 30, // 4H (daily): ~1 candle per day
    }

    if (startDate && endDate) {
      // Check for future dates
      if (endDate > today) {
        infoEl.textContent = 'End date cannot be in the future'
        infoEl.style.color = '#ef4444'
        return false
      }

      if (startDate > today) {
        infoEl.textContent = 'Start date cannot be in the future'
        infoEl.style.color = '#ef4444'
        return false
      }

      // Check start < end
      if (startDate >= endDate) {
        infoEl.textContent = 'Start date must be before end date'
        infoEl.style.color = '#ef4444'
        return false
      }

      const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
      const minDays = MIN_DAYS[this.config.timeframe] || 8

      // Check minimum range
      if (daysDiff < minDays) {
        infoEl.textContent = `Range too short: need at least ${minDays} days for ${this.getTimeframeLabel(this.config.timeframe)} timeframe`
        infoEl.style.color = '#f59e0b' // warning color
        return false
      }

      infoEl.textContent = `Custom range: ${daysDiff} days selected`
      infoEl.style.color = '#22c55e' // success color
      return true
    }

    this.updateDataLimitInfo()
    return true
  }

  bindEvents() {
    // Signal source tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
        e.target.classList.add('active')
        this.config.source = e.target.dataset.source
        this.renderSourceConfig()

        // Apply optimized defaults for OI-WASP
        if (this.config.source === 'oi') {
          this.applyOIWASPDefaults()
        }
      })
    })

    // Timeframe buttons
    document.querySelectorAll('.tf-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'))
        e.target.classList.add('active')
        this.config.timeframe = parseInt(e.target.dataset.tf)
        this.updateDataLimitInfo()
        this.initDateInputs() // Reset dates to match new timeframe's default range
      })
    })

    // Date range inputs
    document.getElementById('startDate').addEventListener('change', (e) => {
      this.config.startDate = this.parseDateFromInput(e.target.value)
      this.validateDateRange()
    })

    document.getElementById('endDate').addEventListener('change', (e) => {
      this.config.endDate = this.parseDateFromInput(e.target.value)
      this.validateDateRange()
    })

    // Exit strategy select
    document.getElementById('exitStrategy').addEventListener('change', (e) => {
      this.config.exitStrategy = e.target.value
      this.renderExitConfig()
    })

    // Signal type checkboxes
    document.getElementById('filterCALL').addEventListener('change', (e) => {
      this.updateSignalTypes()
    })
    document.getElementById('filterPUT').addEventListener('change', (e) => {
      this.updateSignalTypes()
    })

    // Min strength slider
    const minStrengthSlider = document.getElementById('minStrength')
    const minStrengthValue = document.getElementById('minStrengthValue')
    minStrengthSlider.addEventListener('input', (e) => {
      this.config.minStrength = parseInt(e.target.value)
      minStrengthValue.textContent = `${e.target.value}%`
    })

    // Leverage multiplier slider
    const leverageSlider = document.getElementById('leverageMultiplier')
    const leverageValue = document.getElementById('leverageValue')
    leverageSlider.addEventListener('input', (e) => {
      this.config.leverageMultiplier = parseInt(e.target.value)
      const label = e.target.value === '1' ? '1x (Stock)' :
                    e.target.value === '8' ? '8x (Butterfly)' :
                    `${e.target.value}x (Options)`
      leverageValue.textContent = label
    })

    // Run backtest button
    document.getElementById('runBacktest').addEventListener('click', () => {
      this.runBacktest()
    })

    // Reset button
    document.getElementById('resetConfig').addEventListener('click', () => {
      location.reload()
    })

    // Monte Carlo button
    document.getElementById('runMonteCarlo').addEventListener('click', () => {
      this.runMonteCarlo()
    })

    // Trade filter
    document.getElementById('tradeFilter').addEventListener('change', (e) => {
      this.filterTrades(e.target.value)
    })

    // Export CSV
    document.getElementById('exportCsv').addEventListener('click', () => {
      this.exportToCSV()
    })
  }

  updateSignalTypes() {
    const types = []
    if (document.getElementById('filterCALL').checked) types.push('CALL')
    if (document.getElementById('filterPUT').checked) types.push('PUT')
    this.config.signalTypes = types
  }

  updateDataLimitInfo() {
    const limit = DATA_LIMITS[this.config.timeframe]
    const infoEl = document.getElementById('dataLimitInfo')
    infoEl.textContent = `${this.getTimeframeLabel(this.config.timeframe)} candles: up to ${limit.label} history`
    infoEl.style.color = '' // Reset color to default
  }

  getTimeframeLabel(tf) {
    const labels = { 5: '5m', 15: '15m', 60: '1H', 240: '4H' }
    return labels[tf] || tf
  }

  renderSourceConfig() {
    const container = document.getElementById('sourceConfig')
    let html = ''

    switch (this.config.source) {
      case 'pattern':
        html = `
          <div class="input-group">
            <label>Lookback Candles</label>
            <input type="number" class="config-input" id="configLookback" value="${this.config.lookback}" min="20" max="100">
          </div>
        `
        break
      case 'daily':
        html = `
          <div class="input-group">
            <label>Min Confluence Score</label>
            <input type="number" class="config-input" id="configMinScore" value="60" min="40" max="100">
          </div>
        `
        break
      case 'oi':
        html = `
          <div class="input-group">
            <label>WASP Period (SMA)</label>
            <input type="number" class="config-input" id="configWaspPeriod" value="${this.config.waspPeriod || 15}" min="5" max="50">
          </div>
          <div class="input-group">
            <label>Entry Deviation %</label>
            <input type="number" class="config-input" id="configDeviation" value="${this.config.entryDeviation || 0.2}" min="0.1" max="3" step="0.05">
          </div>
          <p class="hint-text">Optimized: WASP=15, Dev=0.2%, 8x leverage for 200%+ monthly</p>
        `
        break
      case 'iv':
        html = `
          <div class="input-group">
            <label>Strategy</label>
            <select class="select-input config-input" id="configIVStrategy">
              <option value="percentile" selected>IV Percentile</option>
              <option value="skew">IV Skew</option>
              <option value="ivhv">IV vs HV</option>
            </select>
          </div>
          <div class="input-group">
            <label>Lookback Days</label>
            <input type="number" class="config-input" id="configIVLookback" value="20" min="5" max="60">
          </div>
          <p class="data-source-info">Data: DoltHub (2019-present)</p>
        `
        break
    }

    container.innerHTML = html

    // Bind config inputs
    container.querySelectorAll('.config-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const id = e.target.id
        const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value
        if (id === 'configLookback') this.config.lookback = value
        if (id === 'configMinScore') this.config.minScore = value
        if (id === 'configWaspPeriod') this.config.waspPeriod = value
        if (id === 'configDeviation') this.config.entryDeviation = value
        if (id === 'configIVStrategy') this.config.ivStrategy = value
        if (id === 'configIVLookback') this.config.ivLookback = value
      })
    })
  }

  renderExitConfig() {
    const container = document.getElementById('exitConfig')
    let html = ''

    switch (this.config.exitStrategy) {
      case 'fixed-bars':
        html = `
          <div class="input-group">
            <label>Hold for N bars</label>
            <input type="number" class="config-input" id="configBars" value="${this.config.bars}" min="1" max="100">
          </div>
        `
        break
      case 'opposite-signal':
        html = `
          <div class="input-group">
            <label>Min Opposite Strength</label>
            <input type="number" class="config-input" id="configOppositeStrength" value="${this.config.oppositeMinStrength}" min="20" max="100">
          </div>
        `
        break
      case 'target-stop':
        html = `
          <div class="input-group">
            <label>Target %</label>
            <input type="number" class="config-input" id="configTarget" value="${this.config.targetPercent}" min="0.1" max="10" step="0.1">
          </div>
          <div class="input-group">
            <label>Stop Loss %</label>
            <input type="number" class="config-input" id="configStop" value="${this.config.stopPercent}" min="0.1" max="10" step="0.1">
          </div>
        `
        break
    }

    container.innerHTML = html

    // Bind config inputs
    container.querySelectorAll('.config-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const id = e.target.id
        const value = parseFloat(e.target.value)
        if (id === 'configBars') this.config.bars = value
        if (id === 'configOppositeStrength') this.config.oppositeMinStrength = value
        if (id === 'configTarget') this.config.targetPercent = value
        if (id === 'configStop') this.config.stopPercent = value
      })
    })
  }

  async runBacktest() {
    const runBtn = document.getElementById('runBacktest')
    const progressContainer = document.getElementById('progressContainer')
    const progressFill = document.getElementById('progressFill')
    const progressText = document.getElementById('progressText')

    // Validate date range
    if (!this.validateDateRange()) {
      return
    }

    // Disable button and show progress
    runBtn.disabled = true
    progressContainer.style.display = 'flex'
    document.getElementById('emptyState').style.display = 'none'

    try {
      // Update progress
      progressFill.style.width = '10%'
      progressText.textContent = 'Fetching data...'

      // Get date range from inputs
      const startInput = document.getElementById('startDate')
      const endInput = document.getElementById('endDate')
      const startDate = this.parseDateFromInput(startInput.value)
      const endDate = this.parseDateFromInput(endInput.value, true) // endOfDay=true to include full last day

      // Fetch candle data with custom date range
      const candles = await fetchCandleData('SPY', this.config.timeframe, {
        startDate,
        endDate,
      })

      const minCandles = 50
      if (!candles || candles.length < minCandles) {
        const received = candles ? candles.length : 0
        throw new Error(`Insufficient data: received ${received} candles, need at least ${minCandles}. Try expanding your date range.`)
      }

      progressFill.style.width = '30%'
      progressText.textContent = 'Creating signal source...'

      // Create signal source
      const signalSource = this.createSignalSource()

      // Create exit strategy
      const exitStrategy = this.createExitStrategy()

      // Load DoltHub data for IV or OI signal sources
      if (this.config.source === 'iv') {
        progressFill.style.width = '35%'
        progressText.textContent = 'Loading IV data from DoltHub...'
        await signalSource.loadData('SPY', startDate, endDate)
      } else if (this.config.source === 'oi') {
        progressFill.style.width = '35%'
        progressText.textContent = 'Loading OI WASP data from DoltHub...'
        await signalSource.loadData('SPY', startDate, endDate)
      }

      progressFill.style.width = '40%'
      progressText.textContent = 'Running backtest...'

      // Create and run engine
      const engine = new BacktestEngine({
        signalSource,
        exitStrategy,
        candles,
        initialCapital: 10000,
        positionSize: 'percent',
        positionPercent: 10,
        maxConcurrentTrades: 1,
      })

      // Progress callback
      engine.onProgress((percent) => {
        progressFill.style.width = `${40 + percent * 0.5}%`
        progressText.textContent = `Processing... ${Math.round(percent)}%`
      })

      // Run backtest
      const results = await engine.run()
      this.results = results

      progressFill.style.width = '95%'
      progressText.textContent = 'Calculating statistics...'

      // Check if any trades were generated
      if (results.trades.length === 0) {
        const signalCount = results.signals ? results.signals.length : 0
        let message = `No trades generated. `
        if (signalCount === 0) {
          message += `No signals found in ${results.candleCount} candles. `
          if (this.config.source === 'oi') {
            message += `Try lowering the Entry Deviation % or adjusting the timeframe.`
          } else if (this.config.source === 'pattern') {
            message += `Try lowering the Min Signal Strength filter.`
          } else if (this.config.source === 'iv') {
            message += `Try a different IV strategy or adjusting lookback days. Note: IV data requires dates from 2019+.`
          } else {
            message += `Try adjusting the signal filters or date range.`
          }
        } else {
          message += `${signalCount} signals found but all filtered out. Try lowering the Min Signal Strength.`
        }
        throw new Error(message)
      }

      // Apply leverage multiplier to trades
      const leveragedTrades = results.trades.map(trade => ({
        ...trade,
        pnlPercent: trade.pnlPercent * this.config.leverageMultiplier,
        pnl: trade.pnl * this.config.leverageMultiplier,
      }))
      results.trades = leveragedTrades

      // Calculate statistics
      const stats = calculateStatistics(leveragedTrades, 10000)

      progressFill.style.width = '100%'
      progressText.textContent = 'Complete!'

      // Render results
      this.renderResults(stats, results)

      // Hide progress after delay
      setTimeout(() => {
        progressContainer.style.display = 'none'
        runBtn.disabled = false
      }, 500)
    } catch (error) {
      console.error('Backtest error:', error)
      progressText.textContent = `Error: ${error.message}`
      progressFill.style.width = '0%'
      runBtn.disabled = false
    }
  }

  createSignalSource() {
    const commonConfig = {
      minStrength: this.config.minStrength,
      signalTypes: this.config.signalTypes,
      lookback: this.config.lookback,
    }

    switch (this.config.source) {
      case 'pattern':
        return new PatternDetectorSource(commonConfig)
      case 'daily':
        return new DailySignalSource({
          ...commonConfig,
          minScore: this.config.minScore || 60,
        })
      case 'oi':
        return new OISignalSource({
          ...commonConfig,
          waspPeriod: this.config.waspPeriod || 20,
          entryDeviation: this.config.entryDeviation || 0.5,
        })
      case 'iv':
        return new IVSignalSource({
          ...commonConfig,
          strategy: this.config.ivStrategy || 'percentile',
          lookbackDays: this.config.ivLookback || 20,
        })
      default:
        return new PatternDetectorSource(commonConfig)
    }
  }

  createExitStrategy() {
    switch (this.config.exitStrategy) {
      case 'fixed-bars':
        return new FixedBarsExit(this.config.bars)
      case 'opposite-signal':
        return new OppositeSignalExit(this.config.oppositeMinStrength)
      case 'target-stop':
        return new TargetStopExit(this.config.targetPercent, this.config.stopPercent)
      default:
        return new FixedBarsExit(10)
    }
  }

  renderResults(stats, results) {
    const resultsPanel = document.getElementById('resultsPanel')
    resultsPanel.style.display = 'block'

    // Meta info
    document.getElementById('resultsPeriod').textContent =
      `${new Date(results.dateRange.start).toLocaleDateString()} - ${new Date(results.dateRange.end).toLocaleDateString()}`
    document.getElementById('resultsConfig').textContent =
      `${this.config.source} / ${this.config.exitStrategy}`

    // Stats grid
    this.renderStatsGrid(stats)

    // Charts
    this.renderEquityChart(results.equityCurve)
    this.renderPnLChart(results.trades)
    this.renderSignalChart(stats)

    // Trade log
    this.renderTradeLog(results.trades)

    // Scroll to results
    resultsPanel.scrollIntoView({ behavior: 'smooth' })
  }

  renderStatsGrid(stats) {
    const grid = document.getElementById('statsGrid')

    const cards = [
      { label: 'Total Trades', value: stats.totalTrades, class: 'neutral' },
      { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%`, class: stats.winRate >= 50 ? 'positive' : 'negative' },
      { label: 'Profit Factor', value: stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2), class: stats.profitFactor >= 1 ? 'positive' : 'negative' },
      { label: 'Expectancy', value: `${stats.expectancy.toFixed(2)}%`, class: stats.expectancy >= 0 ? 'positive' : 'negative' },
      { label: 'Sharpe Ratio', value: stats.sharpeRatio.toFixed(2), class: stats.sharpeRatio >= 1 ? 'positive' : 'neutral' },
      { label: 'Max Drawdown', value: `${stats.maxDrawdown.toFixed(1)}%`, class: 'negative' },
      { label: 'Avg Win', value: `${stats.avgWin.toFixed(2)}%`, class: 'positive' },
      { label: 'Avg Loss', value: `${stats.avgLoss.toFixed(2)}%`, class: 'negative' },
      { label: 'Avg Hold', value: `${stats.avgHoldingPeriod.toFixed(1)} bars`, class: 'neutral' },
      { label: 'Win Streak', value: stats.consecutiveWins, class: 'positive' },
    ]

    grid.innerHTML = cards
      .map(
        (card) => `
      <div class="stat-card">
        <div class="stat-value ${card.class}">${card.value}</div>
        <div class="stat-label">${card.label}</div>
      </div>
    `
      )
      .join('')
  }

  renderEquityChart(equityCurve) {
    const ctx = document.getElementById('equityChart').getContext('2d')

    if (this.charts.equity) {
      this.charts.equity.destroy()
    }

    const labels = equityCurve.map((e) => new Date(e.time).toLocaleDateString())
    const data = equityCurve.map((e) => e.equity)

    this.charts.equity = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Equity',
            data,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            display: false,
          },
          y: {
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            ticks: { color: '#94a3b8' },
          },
        },
      },
    })
  }

  renderPnLChart(trades) {
    const ctx = document.getElementById('pnlChart').getContext('2d')

    if (this.charts.pnl) {
      this.charts.pnl.destroy()
    }

    // Create histogram bins
    const pnlValues = trades.map((t) => t.pnlPercent)
    const min = Math.floor(Math.min(...pnlValues))
    const max = Math.ceil(Math.max(...pnlValues))
    const binSize = (max - min) / 15 || 0.5

    const bins = {}
    for (let i = min; i <= max; i += binSize) {
      bins[i.toFixed(1)] = 0
    }

    pnlValues.forEach((pnl) => {
      const binKey = (Math.floor(pnl / binSize) * binSize).toFixed(1)
      if (bins[binKey] !== undefined) bins[binKey]++
    })

    const labels = Object.keys(bins)
    const data = Object.values(bins)
    const colors = labels.map((l) => (parseFloat(l) >= 0 ? '#22c55e' : '#ef4444'))

    this.charts.pnl = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Trades',
            data,
            backgroundColor: colors,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' },
          },
          y: {
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            ticks: { color: '#94a3b8' },
          },
        },
      },
    })
  }

  renderSignalChart(stats) {
    const ctx = document.getElementById('signalChart').getContext('2d')

    if (this.charts.signal) {
      this.charts.signal.destroy()
    }

    const { CALL, PUT } = stats.statsByDirection
    const labels = ['CALL', 'PUT']
    const winRates = [CALL.winRate, PUT.winRate]
    const counts = [CALL.count, PUT.count]

    this.charts.signal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Win Rate %',
            data: winRates,
            backgroundColor: ['rgba(16, 185, 129, 0.7)', 'rgba(239, 68, 68, 0.7)'],
            yAxisID: 'y',
          },
          {
            label: 'Trade Count',
            data: counts,
            backgroundColor: ['rgba(16, 185, 129, 0.3)', 'rgba(239, 68, 68, 0.3)'],
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8' },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' },
          },
          y: {
            type: 'linear',
            position: 'left',
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            ticks: { color: '#94a3b8' },
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { display: false },
            ticks: { color: '#94a3b8' },
          },
        },
      },
    })
  }

  renderTradeLog(trades) {
    const tbody = document.getElementById('tradesTableBody')

    tbody.innerHTML = trades
      .map(
        (trade, i) => `
      <tr data-pnl="${trade.pnl}">
        <td>${i + 1}</td>
        <td>${new Date(trade.entryTime).toLocaleString()}</td>
        <td><span class="trade-signal ${trade.signal.toLowerCase()}">${trade.signalType}</span></td>
        <td>${trade.strength.toFixed(0)}%</td>
        <td>${trade.entryPrice.toFixed(2)}</td>
        <td>${trade.exitPrice ? trade.exitPrice.toFixed(2) : '-'}</td>
        <td class="trade-pnl ${trade.pnl >= 0 ? 'positive' : 'negative'}">${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%</td>
        <td>${trade.barsHeld}</td>
        <td>${trade.exitReason || '-'}</td>
      </tr>
    `
      )
      .join('')

    this.allTrades = trades
  }

  filterTrades(filter) {
    const rows = document.querySelectorAll('#tradesTableBody tr')

    rows.forEach((row) => {
      const pnl = parseFloat(row.dataset.pnl)
      let show = true

      if (filter === 'wins') show = pnl > 0
      if (filter === 'losses') show = pnl < 0

      row.style.display = show ? '' : 'none'
    })
  }

  runMonteCarlo() {
    if (!this.results || !this.results.trades.length) return

    const btn = document.getElementById('runMonteCarlo')
    btn.disabled = true
    btn.textContent = 'Running...'

    setTimeout(() => {
      const mc = monteCarloSimulation(this.results.trades, 1000)

      const container = document.getElementById('monteCarloResults')
      container.innerHTML = `
        <div class="mc-stat">
          <div class="mc-stat-value" style="color: ${mc.medianReturn >= 0 ? '#22c55e' : '#ef4444'}">
            ${mc.medianReturn >= 0 ? '+' : ''}${mc.medianReturn.toFixed(1)}%
          </div>
          <div class="mc-stat-label">Median Return</div>
        </div>
        <div class="mc-stat">
          <div class="mc-stat-value">${(mc.probabilityOfProfit * 100).toFixed(0)}%</div>
          <div class="mc-stat-label">Win Probability</div>
        </div>
        <div class="mc-stat">
          <div class="mc-stat-value" style="color: #ef4444">${mc.maxDrawdownDistribution.p50.toFixed(1)}%</div>
          <div class="mc-stat-label">Median Max DD</div>
        </div>
        <div class="mc-stat">
          <div class="mc-stat-value">${mc.returnDistribution.p5.toFixed(1)}% to ${mc.returnDistribution.p95.toFixed(1)}%</div>
          <div class="mc-stat-label">90% Confidence Range</div>
        </div>
      `

      btn.disabled = false
      btn.textContent = 'Run 1000 Simulations'
    }, 100)
  }

  exportToCSV() {
    if (!this.results || !this.results.trades.length) return

    const headers = ['#', 'Entry Time', 'Signal', 'Strength', 'Entry', 'Exit', 'P&L %', 'Bars', 'Exit Reason']
    const rows = this.results.trades.map((t, i) => [
      i + 1,
      new Date(t.entryTime).toISOString(),
      t.signalType,
      t.strength.toFixed(0),
      t.entryPrice.toFixed(2),
      t.exitPrice ? t.exitPrice.toFixed(2) : '',
      t.pnlPercent.toFixed(2),
      t.barsHeld,
      t.exitReason || '',
    ])

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest_${this.config.source}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.backtestApp = new BacktestApp()
})
