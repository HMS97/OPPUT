/**
 * SPY PUT Dashboard - TradingView Data Server
 *
 * Uses TradingView-API to fetch real market data
 * Run with: node server.js
 *
 * For replay/historical data, set environment variables:
 *   SESSION=your_tradingview_session_cookie
 *   SIGNATURE=your_tradingview_signature_cookie
 */

const express = require('express');
const cors = require('cors');
const TradingView = require('@mathieuc/tradingview');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('docs'));

// Store active chart sessions
let chartClient = null;
let activeCharts = {};

// Timeframe mapping
const TF_MAP = {
  5: '5',
  15: '15',
  60: '60',
  240: '240'
};

// Initialize TradingView client
function initClient() {
  if (chartClient) return chartClient;

  const options = {};

  // Add auth if available (needed for historical data)
  if (process.env.SESSION && process.env.SIGNATURE) {
    options.token = process.env.SESSION;
    options.signature = process.env.SIGNATURE;
    console.log('[Server] Using authenticated TradingView session');
  } else {
    console.log('[Server] Running without auth - historical data may be limited');
  }

  chartClient = new TradingView.Client(options);
  return chartClient;
}

// Fetch SPY data for a timeframe
async function fetchSPYData(timeframe, replayTimestamp = null) {
  return new Promise((resolve, reject) => {
    const client = initClient();
    const chart = new client.Session.Chart();
    const tf = TF_MAP[timeframe] || '5';

    const timeout = setTimeout(() => {
      chart.delete();
      reject(new Error('Timeout fetching data'));
    }, 30000);

    chart.onError((...err) => {
      clearTimeout(timeout);
      chart.delete();
      reject(new Error(err.join(' ')));
    });

    // Configure market options
    const options = { timeframe: tf };

    // For replay mode with historical data
    if (replayTimestamp && process.env.SESSION) {
      options.range = 100; // Get 100 candles before timestamp
      options.to = Math.floor(replayTimestamp / 1000);
      console.log(`[Server] Fetching historical data up to ${new Date(replayTimestamp).toISOString()}`);
    }

    chart.setMarket('AMEX:SPY', options);

    chart.onUpdate(() => {
      clearTimeout(timeout);

      if (!chart.periods || chart.periods.length === 0) {
        chart.delete();
        reject(new Error('No data received'));
        return;
      }

      // Convert to candle format
      const candles = chart.periods.map(p => ({
        time: p.time * 1000, // Convert to milliseconds
        open: p.open,
        high: p.max,
        low: p.min,
        close: p.close,
        volume: p.volume || 0
      })).reverse(); // TradingView returns newest first

      // Filter by replay timestamp if set
      let filteredCandles = candles;
      if (replayTimestamp) {
        filteredCandles = candles.filter(c => c.time <= replayTimestamp);
      }

      console.log(`[Server] Fetched ${filteredCandles.length} candles for ${tf}m`);

      chart.delete();
      resolve(filteredCandles);
    });
  });
}

// API endpoint: Get SPY data
app.get('/api/spy/:timeframe', async (req, res) => {
  try {
    const timeframe = parseInt(req.params.timeframe) || 5;
    const replayTimestamp = req.query.replay ? parseInt(req.query.replay) : null;

    console.log(`[Server] Request: ${timeframe}m, replay: ${replayTimestamp ? new Date(replayTimestamp).toISOString() : 'none'}`);

    const candles = await fetchSPYData(timeframe, replayTimestamp);

    res.json({
      success: true,
      symbol: 'SPY',
      timeframe,
      candles,
      timestamp: Date.now(),
      source: 'tradingview'
    });
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint: Check auth status
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!(process.env.SESSION && process.env.SIGNATURE),
    replaySupported: !!(process.env.SESSION && process.env.SIGNATURE)
  });
});

// ============================================
// Yahoo Finance Options API (with crumb auth)
// ============================================

let yahooCrumb = null;
let yahooCookies = null;
let crumbExpiry = 0;

// Get Yahoo Finance crumb for authentication
async function getYahooCrumb() {
  // Return cached crumb if still valid (cache for 30 min)
  if (yahooCrumb && Date.now() < crumbExpiry) {
    return { crumb: yahooCrumb, cookies: yahooCookies };
  }

  const https = require('https');

  return new Promise((resolve, reject) => {
    // First, get cookies from the consent page
    const consentReq = https.get('https://fc.yahoo.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    }, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

      // Now get crumb
      const crumbReq = https.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': cookieStr,
        }
      }, (crumbRes) => {
        let crumbData = '';
        crumbRes.on('data', chunk => crumbData += chunk);
        crumbRes.on('end', () => {
          if (crumbData && crumbData.length < 50) {
            yahooCrumb = crumbData;
            yahooCookies = cookieStr;
            crumbExpiry = Date.now() + 30 * 60 * 1000; // 30 min
            console.log('[Server] Got Yahoo crumb:', crumbData.substring(0, 10) + '...');
            resolve({ crumb: crumbData, cookies: cookieStr });
          } else {
            reject(new Error('Failed to get Yahoo crumb'));
          }
        });
      });

      crumbReq.on('error', reject);
    });

    consentReq.on('error', reject);
  });
}

// Helper to fetch from Yahoo Finance with crumb
async function fetchYahooFinance(url) {
  const https = require('https');

  // Try with crumb first for options endpoints
  let finalUrl = url;
  let cookies = '';

  if (url.includes('/v7/finance/options')) {
    try {
      const auth = await getYahooCrumb();
      const separator = url.includes('?') ? '&' : '?';
      finalUrl = `${url}${separator}crumb=${encodeURIComponent(auth.crumb)}`;
      cookies = auth.cookies;
    } catch (e) {
      console.log('[Server] Could not get crumb, trying without:', e.message);
    }
  }

  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    };

    if (cookies) {
      options.headers['Cookie'] = cookies;
    }

    https.get(finalUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// API endpoint: Get spot price for symbol
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;

    console.log(`[Server] Fetching quote for ${symbol}`);
    const data = await fetchYahooFinance(url);

    if (data.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const meta = result.meta;
      const quotes = result.indicators.quote[0];

      res.json({
        success: true,
        symbol,
        price: meta.regularMarketPrice,
        previousClose: meta.previousClose || quotes.close[quotes.close.length - 2],
        timestamp: Date.now()
      });
    } else {
      throw new Error('Invalid response from Yahoo Finance');
    }
  } catch (error) {
    console.error('[Server] Quote error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint: Get available expiries for options
app.get('/api/options/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;

    console.log(`[Server] Fetching options expiries for ${symbol}`);
    const data = await fetchYahooFinance(url);

    if (data.optionChain?.result?.[0]) {
      const result = data.optionChain.result[0];
      res.json({
        success: true,
        symbol,
        expirationDates: result.expirationDates,
        strikes: result.strikes,
        quote: result.quote,
        timestamp: Date.now()
      });
    } else {
      throw new Error('Invalid options response from Yahoo Finance');
    }
  } catch (error) {
    console.error('[Server] Options error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint: Get options chain for specific expiry
app.get('/api/options/:symbol/:expiry', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const expiry = req.params.expiry;
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}?date=${expiry}`;

    console.log(`[Server] Fetching options chain for ${symbol} expiry ${expiry}`);
    const data = await fetchYahooFinance(url);

    if (data.optionChain?.result?.[0]) {
      const result = data.optionChain.result[0];
      res.json({
        success: true,
        symbol,
        expiry: parseInt(expiry),
        quote: result.quote,
        options: result.options,
        timestamp: Date.now()
      });
    } else {
      throw new Error('Invalid options chain response from Yahoo Finance');
    }
  } catch (error) {
    console.error('[Server] Options chain error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 SPY PUT Dashboard Server running at http://localhost:${PORT}`);
  console.log('\nTo enable historical/replay data, set environment variables:');
  console.log('  SESSION=your_tradingview_session_cookie');
  console.log('  SIGNATURE=your_tradingview_signature_cookie\n');
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (chartClient) {
    chartClient.end();
  }
  process.exit(0);
});
