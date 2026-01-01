/**
 * SPY Options Dashboard - Enhanced Main Entry Point
 * Features: Greeks, Signal Integration, P&L Calculator, Heatmap, Quick Expiry
 */

import {
  fetchSpotPrice,
  fetchOptionExpiries,
  fetchOptionsChain,
  fetchCandleData,
  formatNumber,
  PutPatternDetector,
} from '@core'

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
    this.showGreeks = true
    this.showHeatmap = false
    this.callsData = []
    this.putsData = []
    this.selectedOption = null

    this.init()
  }

  async init() {
    console.log('[SPY Options Dashboard] Initializing...')
    this.bindEvents()
    await Promise.all([
      this.loadSpotPrice(),
      this.loadExpirations(),
      this.loadSignal(),
    ])
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
      // Fetch 15-minute candles for signal detection
      const candles = await fetchCandleData(this.symbol, 15)

      if (candles && candles.length > 0) {
        const detector = new PutPatternDetector(candles, 'medium')
        const analysis = detector.analyze()

        this.currentSignal = analysis.overallSignal
        this.signalStrength = Math.max(analysis.putStrength, analysis.callStrength)

        this.updateSignalDisplay(analysis)
      }
    } catch (e) {
      console.error('[SPY Options] Failed to load signal:', e)
      this.updateSignalDisplay({ overallSignal: 'NEUTRAL', putStrength: 0, callStrength: 0 })
    }
  }

  updateSignalDisplay(analysis) {
    const signalValue = document.getElementById('signalValue')
    const strengthFill = document.getElementById('strengthFill')
    const strengthText = document.getElementById('strengthText')
    const recommendation = document.getElementById('signalRecommendation')

    if (signalValue) {
      signalValue.textContent = analysis.overallSignal
      signalValue.className = 'signal-value ' + analysis.overallSignal.toLowerCase()
    }

    const strength = Math.max(analysis.putStrength, analysis.callStrength)
    if (strengthFill) {
      strengthFill.style.width = `${strength}%`
      strengthFill.className = strength >= 60 ? 'strength-fill high' : 'strength-fill'
    }

    if (strengthText) {
      strengthText.textContent = `${strength}%`
    }

    if (recommendation) {
      if (analysis.overallSignal === 'PUT') {
        recommendation.textContent = `Bearish signal detected (${strength}% strength). Consider PUT options on pullbacks.`
      } else if (analysis.overallSignal === 'CALL') {
        recommendation.textContent = `Bullish signal detected (${strength}% strength). Consider CALL options on dips.`
      } else {
        recommendation.textContent = 'No clear directional signal. Wait for confirmation before entering.'
      }
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.spyOptions = new SPYOptionsAnalyzer()
})
