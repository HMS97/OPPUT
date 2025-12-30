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
