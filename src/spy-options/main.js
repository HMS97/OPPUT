/**
 * SPY Options Dashboard - Enhanced Main Entry Point
 * Features: Greeks, Signal Integration, P&L Calculator, Heatmap, Quick Expiry
 */

import {
  fetchSpotPrice,
  fetchOptionExpiries,
  fetchOptionsChain,
  fetchCandleData,
  fetchVIX,
  formatNumber,
  DailySignalAnalyzer,
  SIGNAL_TYPES,
  analyzeOptionsOI,
  checkMonthlyOpEx,
  getVIXRegime,
} from '@core'
import { initSidebar } from '../shared/sidebar.js'

class SPYOptionsAnalyzer {
  constructor() {
    this.symbol = 'SPY'
    this.spotPrice = null
    this.previousClose = null
    this.selectedExpiry = null
    this.expirationDates = []
    this.workerUrl = null
    this.currentSignal = null
    this.signalStrength = 0
    this.signalDetails = null
    this.currentPosition = 'NONE' // Track current position: 'LONG', 'SHORT', or 'NONE'
    this.showGreeks = true
    this.showHeatmap = false
    this.callsData = []
    this.putsData = []
    this.selectedOption = null
    this.oiAnalysis = null
    this.vixData = null // VIX data for filtering

    // Daily signal analyzer - produces 3-4 signals per day
    this.signalAnalyzer = new DailySignalAnalyzer({
      minConfluence: 60,        // Require 60% confluence
      minIndicatorsAgreeing: 3, // At least 3 indicators must agree
      cooldownHours: 4,         // 4 hour cooldown between same signals
    })

    this.init()
  }

  async init() {
    console.log('[SPY Options Dashboard] Initializing...')
    // Initialize sidebar navigation
    await initSidebar({ activePage: 'spy-options' })

    this.bindEvents()
    this.updateOpExBadge()
    await Promise.all([
      this.loadSpotPrice(),
      this.loadExpirations(),
      this.loadSignal(),
      this.loadVIX(),
    ])
  }

  async loadVIX() {
    try {
      this.vixData = await fetchVIX(this.workerUrl)
      console.log('[VIX Data]', this.vixData)
      this.updateVIXDisplay()
    } catch (e) {
      console.error('[SPY Options] Failed to load VIX:', e)
      this.vixData = null
    }
  }

  updateVIXDisplay() {
    const vixEl = document.getElementById('vixValue')
    const vixBadge = document.getElementById('vixBadge')

    if (this.vixData && vixEl) {
      vixEl.textContent = this.vixData.vix.toFixed(2)

      const regime = getVIXRegime(this.vixData.vix)
      if (vixBadge) {
        vixBadge.textContent = regime.regime
        vixBadge.className = `vix-badge ${regime.regime.toLowerCase()}`
        vixBadge.title = regime.description
      }

      // Color based on change
      const changeEl = document.getElementById('vixChange')
      if (changeEl) {
        const isUp = this.vixData.change >= 0
        changeEl.textContent = `${isUp ? '+' : ''}${this.vixData.change.toFixed(2)} (${isUp ? '+' : ''}${this.vixData.changePercent.toFixed(1)}%)`
        changeEl.className = `vix-change ${isUp ? 'up' : 'down'}`
      }
    }
  }

  bindEvents() {
    // Expiry select
    document.getElementById('expirySelect')?.addEventListener('change', (e) => {
      this.selectedExpiry = parseInt(e.target.value)
      this.updateQuickExpiryButtons()
      this.loadOptionsChain()
    })

    // Quick expiry buttons
    document.querySelectorAll('.expiry-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.expiry
        this.selectQuickExpiry(type)
      })
    })

    // View toggles
    document.getElementById('showGreeks')?.addEventListener('change', (e) => {
      this.showGreeks = e.target.checked
      this.renderTables()
    })

    document.getElementById('showHeatmap')?.addEventListener('change', (e) => {
      this.showHeatmap = e.target.checked
      this.renderTables()
    })

    // P&L Modal
    document.getElementById('closePlModal')?.addEventListener('click', () => {
      this.closePlModal()
    })

    document.getElementById('plModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'plModal') this.closePlModal()
    })

    // P&L inputs
    document.getElementById('plEntry')?.addEventListener('input', () => this.updatePlCalculations())
    document.getElementById('plContracts')?.addEventListener('input', () => this.updatePlCalculations())
  }

  async loadSpotPrice() {
    try {
      const { price, previousClose } = await fetchSpotPrice(this.symbol, this.workerUrl)
      this.spotPrice = price
      this.previousClose = previousClose

      this.updatePriceDisplay()
      this.updateStatus('Live Data', '#4ade80')
    } catch (e) {
      console.error('[SPY Options] Failed to load spot price:', e)
      this.updateStatus('Error', '#e94560')
    }
  }

  async loadSignal() {
    try {
      // Fetch daily candles for primary signal (reduces noise)
      const candles = await fetchCandleData(this.symbol, 60) // 1-hour candles for better daily context

      if (candles && candles.length > 0) {
        // Use DailySignalAnalyzer for 3-4 signals per day
        const signal = this.signalAnalyzer.analyze(candles, this.currentPosition)
        const summary = this.signalAnalyzer.getSummary(signal)

        this.currentSignal = summary.signal
        this.signalStrength = summary.strength
        this.signalDetails = signal

        this.updateSignalDisplay(summary, signal)
        console.log('[Daily Signal]', summary.action, '-', summary.details)
      }
    } catch (e) {
      console.error('[SPY Options] Failed to load signal:', e)
      this.updateSignalDisplay(
        { signal: 'NEUTRAL', action: 'Wait', strength: 0, details: 'Error loading signal' },
        null
      )
    }
  }

  updateSignalDisplay(summary, signal = null) {
    const signalValue = document.getElementById('signalValue')
    const strengthFill = document.getElementById('strengthFill')
    const strengthText = document.getElementById('strengthText')
    const recommendation = document.getElementById('signalRecommendation')

    // Display the action (OPEN_CALL, OPEN_PUT, CLOSE_CALL, CLOSE_PUT, or HOLD)
    if (signalValue) {
      const displayText = summary.action || summary.signal
      signalValue.textContent = displayText

      // Add appropriate class for styling
      if (summary.signal === 'CALL') {
        signalValue.className = 'signal-value call'
      } else if (summary.signal === 'PUT') {
        signalValue.className = 'signal-value put'
      } else {
        signalValue.className = 'signal-value neutral'
      }
    }

    const strength = summary.strength || 0
    if (strengthFill) {
      strengthFill.style.width = `${strength}%`
      // High strength threshold is now 60% (confluence threshold)
      strengthFill.className = strength >= 60 ? 'strength-fill high' : 'strength-fill'
    }

    if (strengthText) {
      strengthText.textContent = `${strength}%`
    }

    if (recommendation) {
      let recText = summary.details || 'Analyzing market conditions...'

      // Add indicator details if available
      if (summary.indicators && summary.indicators.length > 0) {
        const indicatorNames = summary.indicators
          .map(i => `${i.indicator}: ${i.reason || i.direction}`)
          .slice(0, 3)
          .join(', ')
        recText += ` [${indicatorNames}]`
      }

      // Add session context
      if (signal && signal.session && signal.session !== 'CLOSED') {
        recText += ` (${signal.session} session)`
      }

      recommendation.textContent = recText
    }
  }

  async loadExpirations() {
    try {
      const expiries = await fetchOptionExpiries(this.symbol, this.workerUrl)
      this.expirationDates = expiries

      this.updateExpirySelect()

      if (expiries.length > 0) {
        this.selectedExpiry = expiries[0]
        this.updateQuickExpiryButtons()
        await this.loadOptionsChain()
      }
    } catch (e) {
      console.error('[SPY Options] Failed to load expirations:', e)
    }
  }

  selectQuickExpiry(type) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    let targetExpiry = null

    switch (type) {
      case '0dte':
        // Find expiry that's today (or next available)
        targetExpiry = this.expirationDates.find((ts) => {
          const d = new Date(ts * 1000)
          return d >= today
        })
        break
      case '1dte':
        // Find expiry for tomorrow
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        targetExpiry = this.expirationDates.find((ts) => {
          const d = new Date(ts * 1000)
          return d >= tomorrow
        })
        break
      case 'weekly':
        // Find expiry within 7 days
        const weekFromNow = new Date(today)
        weekFromNow.setDate(weekFromNow.getDate() + 7)
        targetExpiry = this.expirationDates.find((ts) => {
          const d = new Date(ts * 1000)
          return d >= today && d <= weekFromNow
        }) || this.expirationDates[0]
        break
      case 'monthly':
        // Find expiry 20-45 days out (typical monthly)
        const monthOut = new Date(today)
        monthOut.setDate(monthOut.getDate() + 20)
        targetExpiry = this.expirationDates.find((ts) => {
          const d = new Date(ts * 1000)
          return d >= monthOut
        })
        break
    }

    if (targetExpiry) {
      this.selectedExpiry = targetExpiry
      document.getElementById('expirySelect').value = targetExpiry
      this.updateQuickExpiryButtons()
      this.loadOptionsChain()
    }
  }

  updateQuickExpiryButtons() {
    document.querySelectorAll('.expiry-btn').forEach((btn) => {
      btn.classList.remove('active')
    })

    // Determine which button matches current expiry
    if (!this.selectedExpiry) return

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const expiryDate = new Date(this.selectedExpiry * 1000)
    const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24))

    let activeType = null
    if (diffDays <= 0) activeType = '0dte'
    else if (diffDays === 1) activeType = '1dte'
    else if (diffDays <= 7) activeType = 'weekly'
    else if (diffDays >= 20) activeType = 'monthly'

    if (activeType) {
      document.querySelector(`.expiry-btn[data-expiry="${activeType}"]`)?.classList.add('active')
    }
  }

  async loadOptionsChain() {
    if (!this.selectedExpiry) return

    const callsTable = document.getElementById('callsTable')
    const putsTable = document.getElementById('putsTable')

    if (callsTable) callsTable.innerHTML = '<p class="loading">Loading...</p>'
    if (putsTable) putsTable.innerHTML = '<p class="loading">Loading...</p>'

    try {
      const data = await fetchOptionsChain(this.symbol, this.selectedExpiry, this.workerUrl)

      if (data.options) {
        this.callsData = data.options.calls || []
        this.putsData = data.options.puts || []
      } else if (data.calls || data.puts) {
        this.callsData = data.calls || []
        this.putsData = data.puts || []
      }

      this.renderTables()
      this.runOIAnalysis()
    } catch (e) {
      console.error('[SPY Options] Failed to load options chain:', e)
      if (callsTable) callsTable.innerHTML = '<p class="error">Failed to load</p>'
      if (putsTable) putsTable.innerHTML = '<p class="error">Failed to load</p>'
    }
  }

  renderTables() {
    this.renderCallsTable(this.callsData)
    this.renderPutsTable(this.putsData)
  }

  updatePriceDisplay() {
    const spotPriceEl = document.getElementById('spotPrice')
    const changeEl = document.getElementById('priceChange')

    if (spotPriceEl && this.spotPrice) {
      spotPriceEl.textContent = this.spotPrice.toFixed(2)
    }

    if (changeEl && this.spotPrice && this.previousClose) {
      const change = this.spotPrice - this.previousClose
      const changePercent = (change / this.previousClose) * 100
      const isUp = change >= 0

      changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`
      changeEl.style.color = isUp ? '#4ade80' : '#e94560'
    }
  }

  updateExpirySelect() {
    const select = document.getElementById('expirySelect')
    if (!select) return

    select.innerHTML = this.expirationDates
      .map((ts) => {
        const date = new Date(ts * 1000)
        const label = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
        return `<option value="${ts}">${label}</option>`
      })
      .join('')
  }

  updateStatus(text, color) {
    const statusText = document.getElementById('statusText')
    const statusDot = document.getElementById('statusDot')

    if (statusText) {
      statusText.textContent = text
      statusText.style.color = color
    }

    if (statusDot) {
      statusDot.style.background = color
    }
  }

  getHeatmapClass(option) {
    if (!this.showHeatmap) return ''

    const volume = option.volume || 0
    const oi = option.openInterest || 1
    const ratio = volume / oi

    // Unusual volume detection
    if (ratio > 3) return 'unusual-volume heatmap-5'
    if (ratio > 2) return 'heatmap-5'
    if (ratio > 1) return 'heatmap-4'
    if (ratio > 0.5) return 'heatmap-3'
    if (ratio > 0.2) return 'heatmap-2'
    return 'heatmap-1'
  }

  renderCallsTable(calls) {
    const container = document.getElementById('callsTable')
    if (!container) return

    if (calls.length === 0) {
      container.innerHTML = '<p class="no-data">No calls available</p>'
      return
    }

    const filteredCalls = this.filterNearMoney(calls)
    const greekHeaders = this.showGreeks
      ? '<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>'
      : ''

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Last</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>Vol</th>
            <th>OI</th>
            <th>IV</th>
            ${greekHeaders}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredCalls.map((c) => this.renderOptionRow(c, 'call')).join('')}
        </tbody>
      </table>
    `

    // Bind P&L button clicks
    container.querySelectorAll('.pl-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const strike = parseFloat(e.target.dataset.strike)
        const option = filteredCalls.find((c) => c.strike === strike)
        if (option) this.openPlModal(option, 'call')
      })
    })
  }

  renderPutsTable(puts) {
    const container = document.getElementById('putsTable')
    if (!container) return

    if (puts.length === 0) {
      container.innerHTML = '<p class="no-data">No puts available</p>'
      return
    }

    const filteredPuts = this.filterNearMoney(puts)
    const greekHeaders = this.showGreeks
      ? '<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>'
      : ''

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Last</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>Vol</th>
            <th>OI</th>
            <th>IV</th>
            ${greekHeaders}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredPuts.map((p) => this.renderOptionRow(p, 'put')).join('')}
        </tbody>
      </table>
    `

    // Bind P&L button clicks
    container.querySelectorAll('.pl-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const strike = parseFloat(e.target.dataset.strike)
        const option = filteredPuts.find((p) => p.strike === strike)
        if (option) this.openPlModal(option, 'put')
      })
    })
  }

  filterNearMoney(options) {
    if (!this.spotPrice) return options.slice(0, 20)

    return options
      .filter((o) => {
        const strike = o.strike
        const distance = Math.abs(strike - this.spotPrice)
        return distance <= this.spotPrice * 0.05 // Within 5% of spot
      })
      .sort((a, b) => Math.abs(a.strike - this.spotPrice) - Math.abs(b.strike - this.spotPrice))
      .slice(0, 15)
  }

  renderOptionRow(option, type) {
    const strike = option.strike
    const isITM =
      (type === 'call' && strike < this.spotPrice) ||
      (type === 'put' && strike > this.spotPrice)
    const isATM = Math.abs(strike - this.spotPrice) <= 1

    let rowClass = isATM ? 'atm' : isITM ? 'itm' : 'otm'

    // Add heatmap class
    rowClass += ' ' + this.getHeatmapClass(option)

    // Signal match highlighting
    const signalMatch =
      (this.currentSignal === 'PUT' && type === 'put') ||
      (this.currentSignal === 'CALL' && type === 'call')

    if (signalMatch && isATM) {
      rowClass += ' signal-match' + (this.currentSignal === 'PUT' ? ' put-signal' : '')
    }

    const greekCells = this.showGreeks
      ? `
        <td class="greek ${option.delta > 0 ? 'positive' : 'negative'}">${this.formatGreek(option.delta, 2)}</td>
        <td class="greek">${this.formatGreek(option.gamma, 4)}</td>
        <td class="greek negative">${this.formatGreek(option.theta, 2)}</td>
        <td class="greek">${this.formatGreek(option.vega, 2)}</td>
      `
      : ''

    return `
      <tr class="${rowClass}">
        <td class="strike">${strike.toFixed(0)}</td>
        <td>${option.lastPrice?.toFixed(2) || '--'}</td>
        <td>${option.bid?.toFixed(2) || '--'}</td>
        <td>${option.ask?.toFixed(2) || '--'}</td>
        <td>${formatNumber(option.volume)}</td>
        <td>${formatNumber(option.openInterest)}</td>
        <td>${option.impliedVolatility ? (option.impliedVolatility * 100).toFixed(1) + '%' : '--'}</td>
        ${greekCells}
        <td><button class="pl-btn" data-strike="${strike}">P/L</button></td>
      </tr>
    `
  }

  formatGreek(value, decimals) {
    if (value === undefined || value === null) return '--'
    return value.toFixed(decimals)
  }

  openPlModal(option, type) {
    this.selectedOption = { ...option, type }

    const modal = document.getElementById('plModal')
    const plType = document.getElementById('plType')
    const plStrike = document.getElementById('plStrike')
    const plExpiry = document.getElementById('plExpiry')
    const plEntry = document.getElementById('plEntry')

    if (plType) {
      plType.textContent = type.toUpperCase()
      plType.className = 'pl-type ' + type
    }

    if (plStrike) {
      plStrike.textContent = '$' + option.strike.toFixed(0)
    }

    if (plExpiry && this.selectedExpiry) {
      const date = new Date(this.selectedExpiry * 1000)
      plExpiry.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    if (plEntry) {
      plEntry.value = option.ask?.toFixed(2) || option.lastPrice?.toFixed(2) || '1.00'
    }

    this.updatePlCalculations()
    modal?.classList.add('active')
  }

  closePlModal() {
    document.getElementById('plModal')?.classList.remove('active')
    this.selectedOption = null
  }

  updatePlCalculations() {
    if (!this.selectedOption) return

    const entryPrice = parseFloat(document.getElementById('plEntry')?.value) || 0
    const contracts = parseInt(document.getElementById('plContracts')?.value) || 1
    const strike = this.selectedOption.strike
    const type = this.selectedOption.type

    // Max risk (buying options)
    const maxRisk = entryPrice * 100 * contracts
    document.getElementById('plMaxRisk').textContent = `-$${maxRisk.toFixed(0)}`

    // Breakeven
    const breakeven = type === 'call'
      ? strike + entryPrice
      : strike - entryPrice
    document.getElementById('plBreakeven').textContent = `$${breakeven.toFixed(2)}`

    // Scenarios
    const scenarios = [
      { label: '-3% move', pct: -0.03 },
      { label: '-1% move', pct: -0.01 },
      { label: '+1% move', pct: 0.01 },
      { label: '+3% move', pct: 0.03 },
      { label: '+5% move', pct: 0.05 },
    ]

    const scenarioHtml = scenarios.map((s) => {
      const targetPrice = this.spotPrice * (1 + s.pct)
      let profit = 0

      if (type === 'call') {
        profit = Math.max(0, targetPrice - strike) - entryPrice
      } else {
        profit = Math.max(0, strike - targetPrice) - entryPrice
      }

      profit = profit * 100 * contracts
      const profitClass = profit >= 0 ? 'profit' : 'loss'

      return `
        <div class="scenario-row">
          <span class="scenario-label">${s.label}</span>
          <span class="scenario-price">$${targetPrice.toFixed(2)}</span>
          <span class="scenario-pl ${profitClass}">${profit >= 0 ? '+' : ''}$${profit.toFixed(0)}</span>
        </div>
      `
    }).join('')

    document.getElementById('plScenarios').innerHTML = scenarioHtml
  }

  // OI Analysis Methods
  updateOpExBadge() {
    const opEx = checkMonthlyOpEx()
    const badge = document.getElementById('opexBadge')

    if (badge) {
      if (opEx.isOpExWeek) {
        badge.textContent = 'OPEX WEEK'
        badge.className = 'opex-badge opex-week'
      } else if (opEx.daysToOpEx <= 7) {
        badge.textContent = `${opEx.daysToOpEx}d to OpEx`
        badge.className = 'opex-badge'
      } else {
        badge.textContent = `OpEx ${opEx.opExDate.slice(5)}`
        badge.className = 'opex-badge'
      }
    }
  }

  runOIAnalysis() {
    if (!this.spotPrice || this.callsData.length === 0 || this.putsData.length === 0) {
      console.log('[OI Analysis] Insufficient data')
      return
    }

    try {
      // Pass VIX data for filtering
      this.oiAnalysis = analyzeOptionsOI(this.callsData, this.putsData, this.spotPrice, this.vixData)
      console.log('[OI Analysis]', this.oiAnalysis.summary)
      console.log('[Trade Conditions]', this.oiAnalysis.tradeConditions)
      console.log('[Trade Suggestions]', this.oiAnalysis.suggestions)
      this.updateOIPanel()
      this.renderOIChart()
      this.renderTradeSuggestions()
      this.renderTradeConditions()
    } catch (e) {
      console.error('[OI Analysis] Error:', e)
    }
  }

  renderTradeConditions() {
    const container = document.getElementById('tradeConditions')
    if (!container || !this.oiAnalysis?.tradeConditions) return

    const { conditions, score, maxScore, tradeable, confidence } = this.oiAnalysis.tradeConditions

    const conditionsHtml = conditions.map(c => {
      const statusClass = c.met ? 'met' : (c.required ? 'not-met' : 'optional')
      const icon = c.met ? 'check' : (c.required ? 'x' : 'minus')
      return `
        <div class="condition-item ${statusClass}">
          <span class="condition-icon">${c.met ? '+' : (c.required ? '!' : '-')}</span>
          <div class="condition-details">
            <div class="condition-header">
              <span class="condition-name">${c.name}</span>
              <span class="condition-badge ${statusClass}">${c.current}</span>
              <span class="condition-target">(target: ${c.target})</span>
            </div>
            <div class="condition-explanation">${c.explanation}</div>
          </div>
        </div>
      `
    }).join('')

    const overallClass = tradeable ? 'tradeable' : 'not-tradeable'

    container.innerHTML = `
      <div class="conditions-header">
        <h3>Trade Conditions</h3>
        <div class="conditions-score">
          <div class="score-bar">
            <div class="score-fill" style="width: ${confidence}%"></div>
          </div>
          <span class="score-text">${score}/${maxScore} (${confidence}%)</span>
        </div>
        <span class="tradeable-badge ${overallClass}">${tradeable ? 'TRADEABLE' : 'WAIT'}</span>
      </div>
      <div class="conditions-list">
        ${conditionsHtml}
      </div>
    `
  }

  updateOIPanel() {
    if (!this.oiAnalysis) return

    const { wasp, maxPain, gex, deviation, summary } = this.oiAnalysis

    // Update metrics
    const predicted = document.getElementById('oiPredicted')
    const deviationEl = document.getElementById('oiDeviation')
    const resistance = document.getElementById('oiResistance')
    const support = document.getElementById('oiSupport')
    const maxPainEl = document.getElementById('oiMaxPain')
    const gexEl = document.getElementById('oiGEX')
    const pcrEl = document.getElementById('oiPCR')

    if (predicted) predicted.textContent = `$${summary.predictedClose.toFixed(2)}`

    if (deviationEl) {
      const dev = deviation.deviation.fromWASP
      deviationEl.textContent = `${dev >= 0 ? '+' : ''}${dev.toFixed(2)}%`
      deviationEl.className = `oi-metric-deviation ${dev >= 0 ? 'positive' : 'negative'}`
    }

    if (resistance) resistance.textContent = `$${summary.resistance.toFixed(2)}`
    if (support) support.textContent = `$${summary.support.toFixed(2)}`
    if (maxPainEl) maxPainEl.textContent = `$${summary.maxPain}`

    if (gexEl) {
      const gexValue = gex.netGEX
      const gexFormatted = Math.abs(gexValue) >= 1e9
        ? `${(gexValue / 1e9).toFixed(1)}B`
        : Math.abs(gexValue) >= 1e6
        ? `${(gexValue / 1e6).toFixed(1)}M`
        : formatNumber(gexValue)
      gexEl.textContent = gexFormatted
    }

    if (pcrEl) {
      pcrEl.textContent = wasp.putCallRatio.toFixed(2)
    }

    // Update vol regime badge
    const volBadge = document.getElementById('volRegimeBadge')
    if (volBadge) {
      volBadge.textContent = gex.volRegime === 'low_vol' ? 'LOW VOL' : 'HIGH VOL'
      volBadge.className = `vol-regime-badge ${gex.volRegime.replace('_', '-')}`
    }

    // Update signal
    const signalEl = document.getElementById('oiSignal')
    const strategyEl = document.getElementById('oiStrategy')

    if (signalEl) {
      const signal = summary.signal
      signalEl.textContent = signal.replace(/_/g, ' ')

      if (signal.includes('BULLISH')) {
        signalEl.className = 'oi-signal-value bullish'
      } else if (signal.includes('BEARISH')) {
        signalEl.className = 'oi-signal-value bearish'
      } else {
        signalEl.className = 'oi-signal-value'
      }
    }

    if (strategyEl && summary.strategy) {
      const s = summary.strategy
      if (s.type === 'WAIT') {
        strategyEl.innerHTML = s.reason
      } else {
        strategyEl.innerHTML = `
          <strong>${s.type.replace(/_/g, ' ')}</strong> centered at <strong>$${s.center}</strong><br>
          ${s.reason}
        `
      }
    } else if (strategyEl) {
      strategyEl.textContent = 'No significant deviation detected. Monitor for entry opportunities.'
    }
  }

  renderOIChart() {
    if (!this.oiAnalysis) return

    const { distribution, wasp } = this.oiAnalysis
    const chartContainer = document.getElementById('oiChart')

    if (!chartContainer || distribution.length === 0) return

    // Find max OI for scaling
    const maxOI = Math.max(
      ...distribution.map(d => Math.max(d.callOI, d.putOI))
    )

    if (maxOI === 0) {
      chartContainer.innerHTML = '<p class="no-data">No OI data available</p>'
      return
    }

    const chartHeight = 160

    const barsHtml = distribution.map(d => {
      const callHeight = (d.callOI / maxOI) * chartHeight
      const putHeight = (d.putOI / maxOI) * chartHeight

      const isSpot = Math.abs(d.strike - this.spotPrice) < 1
      const isWasp = Math.abs(d.strike - wasp.allWASP) < 1

      let groupClass = 'oi-bar-group'
      if (isSpot) groupClass += ' spot'
      if (isWasp) groupClass += ' wasp'

      return `
        <div class="${groupClass}" title="Strike: $${d.strike}\nCalls: ${formatNumber(d.callOI)}\nPuts: ${formatNumber(d.putOI)}">
          <div class="oi-bars">
            <div class="oi-bar call" style="height: ${callHeight}px;"></div>
            <div class="oi-bar put" style="height: ${putHeight}px;"></div>
          </div>
          <span class="oi-bar-strike">${d.strike}</span>
        </div>
      `
    }).join('')

    chartContainer.innerHTML = barsHtml
  }

  renderTradeSuggestions() {
    const container = document.getElementById('suggestionsGrid')
    if (!container) return

    const { suggestions, noSuggestionReasons } = this.oiAnalysis

    if (!suggestions || suggestions.length === 0) {
      // Show detailed reasons why no suggestions
      const reasonsHtml = (noSuggestionReasons || []).map(r => {
        const statusClass = r.status === 'NOT MET' ? 'not-met' : r.status === 'CAUTION' ? 'caution' : 'info'
        return `
          <div class="no-suggestion-reason ${statusClass}">
            <div class="reason-header">
              <span class="reason-condition">${r.condition}</span>
              <span class="reason-status ${statusClass}">${r.status}</span>
            </div>
            <div class="reason-values">
              <span>Current: <strong>${r.current}</strong></span>
              ${r.required !== 'N/A' ? `<span>Required: <strong>${r.required}</strong></span>` : ''}
            </div>
            <div class="reason-explanation">${r.explanation}</div>
          </div>
        `
      }).join('')

      container.innerHTML = `
        <div class="no-suggestions-detail">
          <div class="no-suggestions-header">
            <span class="waiting-icon">~</span>
            <span>No Trade Signals - Here's Why:</span>
          </div>
          <div class="no-suggestions-reasons">
            ${reasonsHtml || '<p>Analyzing market conditions...</p>'}
          </div>
          <div class="no-suggestions-tip">
            <strong>Tip:</strong> The strategy works best when spot price deviates >1.5% from WASP in a LOW VOL (positive GEX) regime.
            Monitor for price moves away from the predicted close.
          </div>
        </div>
      `
      return
    }

    const cardsHtml = suggestions.map(s => {
      const typeClass = s.type.includes('CALL') ? 'call' : s.type.includes('PUT') ? 'put' : 'butterfly'
      const typeDisplay = s.type.replace(/_/g, ' ')

      // Format strikes display
      let strikesDisplay
      if (s.legs) {
        // Multi-leg strategy
        strikesDisplay = s.legs.map(leg =>
          `<span class="${leg.action.toLowerCase()}">${leg.action} ${leg.strike} ${leg.type}</span>`
        ).join('<span class="arrow">/</span>')
      } else {
        strikesDisplay = `$${s.strikes[0]}`
      }

      // Format entry price
      const entryDisplay = typeof s.entry === 'number'
        ? `$${s.entry.toFixed(2)}`
        : s.entry

      // Format max profit
      const maxProfitDisplay = typeof s.maxProfit === 'number'
        ? `+$${s.maxProfit.toFixed(0)}`
        : s.maxProfit

      // Format max loss
      const maxLossDisplay = typeof s.maxLoss === 'number'
        ? `-$${s.maxLoss.toFixed(0)}`
        : s.maxLoss

      // Format breakeven
      const breakevenDisplay = typeof s.breakeven === 'number'
        ? `$${s.breakeven.toFixed(2)}`
        : s.breakeven

      return `
        <div class="suggestion-card ${typeClass}">
          <div class="suggestion-header">
            <span class="suggestion-type ${typeClass}">${typeDisplay}</span>
            <span class="suggestion-confidence">Confidence: <span>${s.confidence}%</span></span>
          </div>

          ${s.legs ? `
            <div class="suggestion-legs">
              ${s.legs.map(leg => `
                <div class="leg-item ${leg.action.toLowerCase()}">
                  <span class="leg-action">${leg.action}</span>
                  <span class="leg-qty">${leg.qty}x</span>
                  <span class="leg-strike">$${leg.strike}</span>
                  <span class="leg-type">${leg.type}</span>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="suggestion-strikes">
              <span>$${s.strikes[0]}</span>
              <span class="strike-label">${s.type}</span>
            </div>
          `}

          <div class="suggestion-details">
            <div class="detail-item">
              <span class="detail-label">Entry</span>
              <span class="detail-value">${entryDisplay}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">R:R</span>
              <span class="detail-value">${s.riskReward}:1</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Max Profit</span>
              <span class="detail-value profit">${maxProfitDisplay}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Max Loss</span>
              <span class="detail-value loss">${maxLossDisplay}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Breakeven</span>
              <span class="detail-value">${breakevenDisplay}</span>
            </div>
            ${s.delta ? `
              <div class="detail-item">
                <span class="detail-label">Delta</span>
                <span class="detail-value">${s.delta.toFixed(2)}</span>
              </div>
            ` : ''}
          </div>

          <div class="suggestion-rationale">
            ${s.rationale}
          </div>

          ${s.detailedReason ? `
            <div class="suggestion-detailed">
              <div class="detailed-toggle" onclick="this.parentElement.classList.toggle('expanded')">
                <span>View Detailed Analysis</span>
                <span class="toggle-icon">+</span>
              </div>
              <div class="detailed-content">
                <div class="detailed-signal">${s.detailedReason.signal}</div>
                <ul class="detailed-analysis">
                  ${s.detailedReason.analysis.map(a => `<li>${a}</li>`).join('')}
                </ul>
                <div class="detailed-theory">
                  <strong>Theory:</strong> ${s.detailedReason.theory}
                </div>
                <div class="detailed-risk">
                  <strong>${s.detailedReason.risk}</strong>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      `
    }).join('')

    container.innerHTML = cardsHtml
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyOptions = new SPYOptionsAnalyzer()
})
