/**
 * SPY Options Analysis Dashboard
 * Supports 0DTE, 1DTE, and Weekly options analysis
 */

class SPYOptionsAnalyzer {
  constructor() {
    this.symbol = 'SPY';
    this.spotPrice = null;
    this.prevClose = null;
    this.expiryType = '0dte'; // '0dte', '1dte', 'weekly'
    this.optionsData = null;
    this.selectedExpiry = null;
    this.availableExpiries = [];
    this.chainFilter = 'all'; // 'all', 'itm', 'atm', 'otm'
    this.refreshInterval = 60000; // 1 minute
    this.refreshTimer = null;
    this.oiChart = null;

    // CORS proxies for client-side fetching (ordered by reliability)
    this.corsProxies = [
      // Most reliable first
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u) => `https://proxy.cors.sh/${u}`,
      (u) => `https://cors-anywhere.herokuapp.com/${u}`,
      (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
      (u) => `https://crossorigin.me/${u}`,
      (u) => `https://yacdn.org/proxy/${u}`
    ];

    this.init();
  }

  /**
   * Fetch URL through CORS proxies with retries
   */
  async fetchWithProxy(url, options = {}) {
    // Try backend API first if path starts with /api
    if (url.startsWith('/api')) {
      try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          return await response.json();
        }
      } catch (e) {
        console.log('[SPY Options] Backend unavailable');
      }
      return null;
    }

    // Try each CORS proxy
    for (let i = 0; i < this.corsProxies.length; i++) {
      const proxyFn = this.corsProxies[i];
      try {
        const proxyUrl = proxyFn(url);
        console.log(`[SPY Options] Trying proxy ${i + 1}/${this.corsProxies.length}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(proxyUrl, {
          ...options,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            ...options.headers
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            console.log(`[SPY Options] Proxy ${i + 1} succeeded`);
            return data;
          } catch (e) {
            console.log(`[SPY Options] Proxy ${i + 1} returned invalid JSON`);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          console.log(`[SPY Options] Proxy ${i + 1} timed out`);
        } else {
          console.log(`[SPY Options] Proxy ${i + 1} failed:`, e.message);
        }
      }
    }

    throw new Error('All CORS proxies failed');
  }

  async init() {
    console.log('[SPY Options] Initializing...');
    this.bindEvents();

    // Small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    await this.loadData();
    this.startAutoRefresh();
  }

  bindEvents() {
    // Expiry toggle buttons
    document.querySelectorAll('.expiry-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.expiry-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.expiryType = e.target.dataset.expiry;
        this.loadData();
      });
    });

    // Chain filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.chainFilter = e.target.dataset.range;
        this.renderOptionsChain();
      });
    });
  }

  async loadData() {
    this.updateStatus('Loading...');
    console.log('[SPY Options] Loading data...');

    try {
      // Fetch spot price first
      await this.fetchSpotPrice();
      console.log('[SPY Options] Spot price loaded:', this.spotPrice);

      // Fetch available expiries
      await this.fetchExpiries();
      console.log('[SPY Options] Expiries loaded:', this.availableExpiries.length);

      // Select appropriate expiry based on type
      this.selectExpiry();

      // Fetch options chain for selected expiry
      await this.fetchOptionsChain();
      console.log('[SPY Options] Options chain loaded');

      // Calculate and display all metrics
      this.calculateMetrics();
      this.renderOIChart();
      this.renderOptionsChain();

      this.updateStatus('Live Data');
      console.log('[SPY Options] Data loaded successfully');
    } catch (error) {
      console.error('[SPY Options] Error loading data:', error);
      this.updateStatus('Demo Data');

      // Try with demo data
      console.log('[SPY Options] Loading demo data as fallback...');
      this.loadDemoData();
    }
  }

  async fetchSpotPrice() {
    console.log('[SPY Options] Fetching spot price...');

    // Try backend API first
    const backendData = await this.fetchWithProxy(`/api/quote/${this.symbol}`);
    if (backendData?.success) {
      this.spotPrice = backendData.price;
      this.prevClose = backendData.previousClose;
      this.updatePriceDisplay();
      console.log('[SPY Options] Spot price from backend:', this.spotPrice);
      return;
    }

    // Fallback to Yahoo Finance via CORS proxies
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=1d&range=2d`;
    const data = await this.fetchWithProxy(url);

    if (data?.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const meta = result.meta;
      const quotes = result.indicators?.quote?.[0];

      this.spotPrice = meta.regularMarketPrice;
      this.prevClose = meta.previousClose || (quotes?.close ? quotes.close[quotes.close.length - 2] : null);

      this.updatePriceDisplay();
      console.log('[SPY Options] Spot price fetched:', this.spotPrice);
      return;
    }

    throw new Error('Failed to fetch spot price');
  }

  async fetchExpiries() {
    console.log('[SPY Options] Fetching expiries...');

    // Try backend API first
    const backendData = await this.fetchWithProxy(`/api/options/${this.symbol}`);
    if (backendData?.success && backendData.expirationDates) {
      this.availableExpiries = backendData.expirationDates;
      console.log(`[SPY Options] Expiries from backend: ${this.availableExpiries.length}`);
      return;
    }

    // Fallback to Yahoo Finance via CORS proxies
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${this.symbol}`;
    const data = await this.fetchWithProxy(url);

    if (data?.optionChain?.result?.[0]?.expirationDates) {
      this.availableExpiries = data.optionChain.result[0].expirationDates;
      console.log(`[SPY Options] Expiries fetched: ${this.availableExpiries.length}`);
      return;
    }

    throw new Error('Failed to fetch expiries');
  }

  selectExpiry() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTimestamp = Math.floor(today.getTime() / 1000);

    // Convert timestamps to dates and find appropriate expiry
    const expiriesWithDates = this.availableExpiries.map(ts => ({
      timestamp: ts,
      date: new Date(ts * 1000),
      daysToExpiry: Math.ceil((ts - todayTimestamp) / 86400)
    }));

    // Sort by days to expiry
    expiriesWithDates.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    switch (this.expiryType) {
      case '0dte':
        // Find today's expiry or next available
        this.selectedExpiry = expiriesWithDates.find(e => e.daysToExpiry >= 0)?.timestamp;
        break;
      case '1dte':
        // Find tomorrow's expiry or next after today
        this.selectedExpiry = expiriesWithDates.find(e => e.daysToExpiry >= 1)?.timestamp;
        break;
      case 'weekly':
        // Find expiry 5-8 days out (next week)
        this.selectedExpiry = expiriesWithDates.find(e => e.daysToExpiry >= 5 && e.daysToExpiry <= 10)?.timestamp;
        if (!this.selectedExpiry) {
          this.selectedExpiry = expiriesWithDates.find(e => e.daysToExpiry >= 5)?.timestamp;
        }
        break;
    }

    // Fallback to first available
    if (!this.selectedExpiry && expiriesWithDates.length > 0) {
      this.selectedExpiry = expiriesWithDates[0].timestamp;
    }

    const selectedDate = new Date(this.selectedExpiry * 1000);
    console.log(`[SPY Options] Selected expiry: ${selectedDate.toLocaleDateString()} (${this.expiryType})`);
  }

  async fetchOptionsChain() {
    if (!this.selectedExpiry) {
      throw new Error('No expiry selected');
    }

    console.log('[SPY Options] Fetching options chain...');

    // Try backend API first
    const backendData = await this.fetchWithProxy(`/api/options/${this.symbol}/${this.selectedExpiry}`);
    if (backendData?.success && backendData.options) {
      this.optionsData = { options: backendData.options };
      console.log(`[SPY Options] Chain from backend: ${this.optionsData.options[0]?.calls?.length || 0} calls, ${this.optionsData.options[0]?.puts?.length || 0} puts`);
      return;
    }

    // Fallback to Yahoo Finance via CORS proxies
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${this.symbol}?date=${this.selectedExpiry}`;
    const data = await this.fetchWithProxy(url);

    if (data?.optionChain?.result?.[0]) {
      this.optionsData = data.optionChain.result[0];
      console.log(`[SPY Options] Chain fetched: ${this.optionsData.options[0]?.calls?.length || 0} calls, ${this.optionsData.options[0]?.puts?.length || 0} puts`);
      return;
    }

    throw new Error('Failed to fetch options chain');
  }

  calculateMetrics() {
    if (!this.optionsData?.options?.[0]) return;

    const calls = this.optionsData.options[0].calls || [];
    const puts = this.optionsData.options[0].puts || [];

    // Calculate totals
    let totalCallOI = 0;
    let totalPutOI = 0;
    let totalCallVol = 0;
    let totalPutVol = 0;

    // For weighted averages
    let callOIWeightedSum = 0;
    let putOIWeightedSum = 0;

    // Track walls (highest OI)
    let maxCallOI = 0;
    let maxPutOI = 0;
    let callWallStrike = 0;
    let putWallStrike = 0;

    // For max pain calculation
    const strikes = new Set();
    const callOIByStrike = {};
    const putOIByStrike = {};

    // Process calls
    calls.forEach(call => {
      const strike = call.strike;
      const oi = call.openInterest || 0;
      const vol = call.volume || 0;

      strikes.add(strike);
      callOIByStrike[strike] = oi;
      totalCallOI += oi;
      totalCallVol += vol;
      callOIWeightedSum += strike * oi;

      if (oi > maxCallOI) {
        maxCallOI = oi;
        callWallStrike = strike;
      }
    });

    // Process puts
    puts.forEach(put => {
      const strike = put.strike;
      const oi = put.openInterest || 0;
      const vol = put.volume || 0;

      strikes.add(strike);
      putOIByStrike[strike] = oi;
      totalPutOI += oi;
      totalPutVol += vol;
      putOIWeightedSum += strike * oi;

      if (oi > maxPutOI) {
        maxPutOI = oi;
        putWallStrike = strike;
      }
    });

    // Calculate weighted averages
    const callWeightedAvg = totalCallOI > 0 ? callOIWeightedSum / totalCallOI : 0;
    const putWeightedAvg = totalPutOI > 0 ? putOIWeightedSum / totalPutOI : 0;
    const allWeightedAvg = (totalCallOI + totalPutOI) > 0
      ? (callOIWeightedSum + putOIWeightedSum) / (totalCallOI + totalPutOI)
      : 0;

    // Calculate max pain (price where total option losses are minimized)
    const sortedStrikes = Array.from(strikes).sort((a, b) => a - b);
    let minPain = Infinity;
    let maxPainStrike = this.spotPrice;

    sortedStrikes.forEach(testStrike => {
      let totalPain = 0;

      // Pain from calls (ITM calls at this price)
      Object.entries(callOIByStrike).forEach(([strike, oi]) => {
        if (testStrike > parseFloat(strike)) {
          totalPain += (testStrike - parseFloat(strike)) * oi * 100;
        }
      });

      // Pain from puts (ITM puts at this price)
      Object.entries(putOIByStrike).forEach(([strike, oi]) => {
        if (testStrike < parseFloat(strike)) {
          totalPain += (parseFloat(strike) - testStrike) * oi * 100;
        }
      });

      if (totalPain < minPain) {
        minPain = totalPain;
        maxPainStrike = testStrike;
      }
    });

    // Put/Call ratio
    const pcRatio = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : 0;

    // Calculate IV (average of ATM options)
    const atmCalls = calls.filter(c => Math.abs(c.strike - this.spotPrice) < 5);
    const atmPuts = puts.filter(p => Math.abs(p.strike - this.spotPrice) < 5);
    const avgIV = [...atmCalls, ...atmPuts]
      .filter(o => o.impliedVolatility)
      .reduce((sum, o, _, arr) => sum + (o.impliedVolatility / arr.length), 0);

    // Determine signal based on OI analysis
    let signal = 'NEUTRAL';
    let signalClass = 'neutral';

    // Bullish signals: Put wall above spot (support), Call weighted avg above spot
    // Bearish signals: Call wall below spot (resistance), Put weighted avg below spot
    const spotDiffFromPutWall = ((this.spotPrice - putWallStrike) / this.spotPrice) * 100;
    const spotDiffFromCallWall = ((callWallStrike - this.spotPrice) / this.spotPrice) * 100;

    if (pcRatio > 1.2 && putWeightedAvg < this.spotPrice) {
      signal = 'BEARISH';
      signalClass = 'bearish';
    } else if (pcRatio < 0.8 && callWeightedAvg > this.spotPrice) {
      signal = 'BULLISH';
      signalClass = 'bullish';
    } else if (maxPainStrike > this.spotPrice * 1.005) {
      signal = 'BULLISH';
      signalClass = 'bullish';
    } else if (maxPainStrike < this.spotPrice * 0.995) {
      signal = 'BEARISH';
      signalClass = 'bearish';
    }

    // Update UI
    this.updateElement('totalCallOI', this.formatNumber(totalCallOI));
    this.updateElement('totalPutOI', this.formatNumber(totalPutOI));
    this.updateElement('pcRatio', pcRatio);
    this.updateElement('ivRank', `${(avgIV * 100).toFixed(0)}%`);

    this.updateElement('callWeightedAvg', callWeightedAvg.toFixed(2));
    this.updateElement('putWeightedAvg', putWeightedAvg.toFixed(2));
    this.updateElement('allWeightedAvg', allWeightedAvg.toFixed(2));

    this.updateElement('maxPain', maxPainStrike.toFixed(2));
    const maxPainDiff = ((maxPainStrike - this.spotPrice) / this.spotPrice * 100).toFixed(2);
    const maxPainDiffEl = document.getElementById('maxPainDiff');
    if (maxPainDiffEl) {
      maxPainDiffEl.textContent = `${maxPainDiff > 0 ? '+' : ''}${maxPainDiff}% from spot`;
      maxPainDiffEl.className = `max-pain-diff ${maxPainDiff >= 0 ? 'above' : 'below'}`;
    }

    this.updateElement('putWall', putWallStrike.toFixed(2));
    this.updateElement('putWallOI', `OI: ${this.formatNumber(maxPutOI)}`);
    this.updateElement('callWall', callWallStrike.toFixed(2));
    this.updateElement('callWallOI', `OI: ${this.formatNumber(maxCallOI)}`);

    // Expected close (using max pain as primary predictor)
    this.updateElement('expectedClose', maxPainStrike.toFixed(2));
    const expectedRange = document.getElementById('expectedRange');
    if (expectedRange) {
      const rangeLow = Math.min(putWeightedAvg, maxPainStrike * 0.99).toFixed(2);
      const rangeHigh = Math.max(callWeightedAvg, maxPainStrike * 1.01).toFixed(2);
      expectedRange.textContent = `Range: ${rangeLow} to ${rangeHigh}`;
    }

    // Signal
    const signalBox = document.getElementById('signalBox');
    const signalValue = document.getElementById('signalValue');
    if (signalBox && signalValue) {
      signalBox.className = `signal-box ${signalClass}`;
      signalValue.className = `signal-value ${signalClass}`;
      signalValue.textContent = signal;
    }

    // Calculate aggregate Greeks
    this.calculateGreeks(calls, puts);

    // Store for chart
    this.metrics = {
      calls, puts, callOIByStrike, putOIByStrike, sortedStrikes,
      totalCallOI, totalPutOI, maxPainStrike, callWallStrike, putWallStrike
    };
  }

  calculateGreeks(calls, puts) {
    // Get ATM options (within $5 of spot)
    const atmCalls = calls.filter(c => Math.abs(c.strike - this.spotPrice) <= 10);
    const atmPuts = puts.filter(p => Math.abs(p.strike - this.spotPrice) <= 10);

    let netDelta = 0;
    let netGamma = 0;
    let totalTheta = 0;
    let totalVega = 0;

    atmCalls.forEach(c => {
      const oi = c.openInterest || 0;
      // Approximate delta for calls: closer to 1 for ITM, 0.5 for ATM, 0 for OTM
      const moneyness = (this.spotPrice - c.strike) / this.spotPrice;
      const delta = Math.max(0, Math.min(1, 0.5 + moneyness * 5));
      netDelta += delta * oi;
      netGamma += (c.gamma || 0.01) * oi;
      totalTheta += (c.theta || -0.05) * oi;
      totalVega += (c.vega || 0.1) * oi;
    });

    atmPuts.forEach(p => {
      const oi = p.openInterest || 0;
      const moneyness = (p.strike - this.spotPrice) / this.spotPrice;
      const delta = -Math.max(0, Math.min(1, 0.5 + moneyness * 5));
      netDelta += delta * oi;
      netGamma += (p.gamma || 0.01) * oi;
      totalTheta += (p.theta || -0.05) * oi;
      totalVega += (p.vega || 0.1) * oi;
    });

    this.updateElement('netDelta', this.formatNumber(netDelta, 0));
    this.updateElement('netGamma', this.formatNumber(netGamma, 0));
    this.updateElement('totalTheta', this.formatNumber(totalTheta, 0));
    this.updateElement('totalVega', this.formatNumber(totalVega, 0));
  }

  renderOIChart() {
    if (!this.metrics) {
      console.warn('[SPY Options] No metrics available for chart');
      return;
    }

    const container = document.getElementById('oiDistChart');
    if (!container) {
      console.warn('[SPY Options] Chart container not found');
      return;
    }

    container.innerHTML = '';

    const { sortedStrikes, callOIByStrike, putOIByStrike, maxPainStrike } = this.metrics;

    // Filter strikes to show meaningful range around spot
    const minStrike = this.spotPrice * 0.92;
    const maxStrike = this.spotPrice * 1.08;
    const filteredStrikes = sortedStrikes.filter(s => s >= minStrike && s <= maxStrike);

    if (filteredStrikes.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">No strike data available</div>';
      return;
    }

    // Create canvas for chart - use explicit dimensions if container size is 0
    const canvas = document.createElement('canvas');
    const containerWidth = container.clientWidth || container.offsetWidth || 800;
    const containerHeight = container.clientHeight || container.offsetHeight || 280;
    canvas.width = containerWidth;
    canvas.height = containerHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    console.log(`[SPY Options] Rendering chart: ${canvas.width}x${canvas.height}, ${filteredStrikes.length} strikes`);

    const ctx = canvas.getContext('2d');
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    // Find max OI for scaling
    let maxOI = 0;
    filteredStrikes.forEach(strike => {
      maxOI = Math.max(maxOI, callOIByStrike[strike] || 0, putOIByStrike[strike] || 0);
    });

    const barWidth = Math.max(2, (chartWidth / filteredStrikes.length) * 0.4);
    const barGap = (chartWidth / filteredStrikes.length) - barWidth * 2;

    // Draw bars
    filteredStrikes.forEach((strike, i) => {
      const x = padding.left + i * (chartWidth / filteredStrikes.length);
      const callOI = callOIByStrike[strike] || 0;
      const putOI = putOIByStrike[strike] || 0;

      const callHeight = maxOI > 0 ? (callOI / maxOI) * chartHeight : 0;
      const putHeight = maxOI > 0 ? (putOI / maxOI) * chartHeight : 0;

      // Call bar (blue)
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(x, padding.top + chartHeight - callHeight, barWidth, callHeight);

      // Put bar (orange)
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x + barWidth + 2, padding.top + chartHeight - putHeight, barWidth, putHeight);

      // Strike label (every 5th or at important points)
      if (i % Math.ceil(filteredStrikes.length / 15) === 0 ||
          strike === maxPainStrike ||
          Math.abs(strike - this.spotPrice) < 1) {
        ctx.fillStyle = strike === Math.round(this.spotPrice) ? '#60a5fa' : '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(strike.toString(), x + barWidth, canvas.height - 10);
      }
    });

    // Draw spot price line
    const spotIndex = filteredStrikes.findIndex(s => Math.abs(s - this.spotPrice) < 1);
    if (spotIndex >= 0) {
      const spotX = padding.left + spotIndex * (chartWidth / filteredStrikes.length) + barWidth;
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(spotX, padding.top);
      ctx.lineTo(spotX, padding.top + chartHeight);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#60a5fa';
      ctx.font = '11px sans-serif';
      ctx.fillText('SPOT', spotX, padding.top - 5);
    }

    // Draw max pain line
    const maxPainIndex = filteredStrikes.findIndex(s => Math.abs(s - maxPainStrike) < 1);
    if (maxPainIndex >= 0) {
      const mpX = padding.left + maxPainIndex * (chartWidth / filteredStrikes.length) + barWidth;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mpX, padding.top);
      ctx.lineTo(mpX, padding.top + chartHeight);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = '11px sans-serif';
      ctx.fillText('MAX PAIN', mpX, padding.top - 5);
    }

    // Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + chartHeight - (i / 4) * chartHeight;
      const value = Math.round((i / 4) * maxOI);
      ctx.fillText(this.formatNumber(value), padding.left - 5, y + 3);
    }
  }

  renderOptionsChain() {
    if (!this.optionsData?.options?.[0]) return;

    const calls = this.optionsData.options[0].calls || [];
    const puts = this.optionsData.options[0].puts || [];
    const tbody = document.getElementById('chainBody');

    // Create strike -> options map
    const strikeMap = {};

    calls.forEach(c => {
      if (!strikeMap[c.strike]) strikeMap[c.strike] = {};
      strikeMap[c.strike].call = c;
    });

    puts.forEach(p => {
      if (!strikeMap[p.strike]) strikeMap[p.strike] = {};
      strikeMap[p.strike].put = p;
    });

    // Filter strikes based on selection
    let strikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);

    switch (this.chainFilter) {
      case 'itm':
        strikes = strikes.filter(s => s < this.spotPrice * 0.995 || s > this.spotPrice * 1.005);
        break;
      case 'atm':
        strikes = strikes.filter(s => Math.abs(s - this.spotPrice) <= this.spotPrice * 0.03);
        break;
      case 'otm':
        // OTM calls above spot, OTM puts below spot
        strikes = strikes.filter(s => s > this.spotPrice * 1.005 || s < this.spotPrice * 0.995);
        break;
    }

    // Limit to reasonable range
    const minStrike = this.spotPrice * 0.9;
    const maxStrike = this.spotPrice * 1.1;
    strikes = strikes.filter(s => s >= minStrike && s <= maxStrike);

    if (strikes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 40px; color: #666;">No options in selected range</td></tr>`;
      return;
    }

    tbody.innerHTML = strikes.map(strike => {
      const call = strikeMap[strike]?.call || {};
      const put = strikeMap[strike]?.put || {};
      const isATM = Math.abs(strike - this.spotPrice) < 1;

      return `
        <tr class="${isATM ? 'atm' : ''}">
          <td class="call-oi">${this.formatNumber(call.openInterest || 0)}</td>
          <td>${this.formatNumber(call.volume || 0)}</td>
          <td>${call.impliedVolatility ? (call.impliedVolatility * 100).toFixed(0) + '%' : '-'}</td>
          <td>${call.bid?.toFixed(2) || '-'}</td>
          <td>${call.ask?.toFixed(2) || '-'}</td>
          <td class="strike">${strike.toFixed(2)}</td>
          <td>${put.bid?.toFixed(2) || '-'}</td>
          <td>${put.ask?.toFixed(2) || '-'}</td>
          <td>${put.impliedVolatility ? (put.impliedVolatility * 100).toFixed(0) + '%' : '-'}</td>
          <td>${this.formatNumber(put.volume || 0)}</td>
          <td class="put-oi">${this.formatNumber(put.openInterest || 0)}</td>
        </tr>
      `;
    }).join('');
  }

  loadDemoData() {
    // Generate realistic demo data for SPY options
    this.spotPrice = 590.50;
    this.prevClose = 588.25;
    this.updatePriceDisplay();

    // Generate demo options chain
    const strikes = [];
    for (let s = 560; s <= 620; s += 1) {
      strikes.push(s);
    }

    const calls = strikes.map(strike => {
      const moneyness = (this.spotPrice - strike) / this.spotPrice;
      const baseOI = Math.max(100, 50000 * Math.exp(-Math.pow(moneyness * 10, 2)));
      return {
        strike,
        openInterest: Math.round(baseOI * (0.7 + Math.random() * 0.6)),
        volume: Math.round(baseOI * 0.1 * (0.5 + Math.random())),
        bid: Math.max(0.01, (this.spotPrice - strike) + Math.random() * 2).toFixed(2),
        ask: Math.max(0.02, (this.spotPrice - strike) + Math.random() * 2 + 0.05).toFixed(2),
        impliedVolatility: 0.15 + Math.random() * 0.1
      };
    });

    const puts = strikes.map(strike => {
      const moneyness = (strike - this.spotPrice) / this.spotPrice;
      const baseOI = Math.max(100, 45000 * Math.exp(-Math.pow(moneyness * 10, 2)));
      return {
        strike,
        openInterest: Math.round(baseOI * (0.7 + Math.random() * 0.6)),
        volume: Math.round(baseOI * 0.1 * (0.5 + Math.random())),
        bid: Math.max(0.01, (strike - this.spotPrice) + Math.random() * 2).toFixed(2),
        ask: Math.max(0.02, (strike - this.spotPrice) + Math.random() * 2 + 0.05).toFixed(2),
        impliedVolatility: 0.16 + Math.random() * 0.1
      };
    });

    this.optionsData = {
      options: [{ calls, puts }]
    };

    this.calculateMetrics();
    this.renderOIChart();
    this.renderOptionsChain();
    this.updateStatus('Demo Data');
  }

  updatePriceDisplay() {
    if (!this.spotPrice) return;

    const priceEl = document.getElementById('spotPrice');
    const changeEl = document.getElementById('priceChange');
    const percentEl = document.getElementById('priceChangePercent');

    if (priceEl) {
      priceEl.textContent = this.spotPrice.toFixed(2);
    }

    if (this.prevClose && changeEl && percentEl) {
      const change = this.spotPrice - this.prevClose;
      const changePercent = (change / this.prevClose) * 100;
      const isUp = change >= 0;

      priceEl.className = `price-value ${isUp ? 'price-up' : 'price-down'}`;
      changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)}`;
      changeEl.style.color = isUp ? '#4ade80' : '#e94560';
      percentEl.textContent = `(${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;
      percentEl.style.color = isUp ? '#4ade80' : '#e94560';
    }
  }

  updateStatus(text) {
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    if (statusText) {
      statusText.textContent = text;
    }

    if (statusDot) {
      if (text === 'Live Data') {
        statusDot.style.background = '#4ade80';
      } else if (text === 'Demo Data') {
        statusDot.style.background = '#f59e0b';
      } else {
        statusDot.style.background = '#3b82f6';
      }
    }
  }

  updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  formatNumber(num, decimals = 0) {
    if (num === undefined || num === null) return '--';
    if (Math.abs(num) >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (Math.abs(num) >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(decimals);
  }

  startAutoRefresh() {
    this.refreshTimer = setInterval(() => {
      this.loadData();
    }, this.refreshInterval);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.spyOptions = new SPYOptionsAnalyzer();
});
