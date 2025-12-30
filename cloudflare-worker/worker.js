/**
 * Cloudflare Worker - Yahoo Finance API Proxy
 *
 * This worker proxies requests to Yahoo Finance API to bypass CORS restrictions.
 * Deploy to Cloudflare Workers (free tier: 100k requests/day)
 *
 * Endpoints:
 *   /quote/SPY         - Get spot price
 *   /options/SPY       - Get available expiries
 *   /options/SPY/12345 - Get options chain for expiry timestamp
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com';

// CORS headers to allow requests from any origin
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let yahooUrl;
    let responseData;

    // Route: /quote/:symbol
    if (path.match(/^\/quote\/([A-Z]+)$/i)) {
      const symbol = path.split('/')[2].toUpperCase();
      yahooUrl = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=2d`;

      const data = await fetchYahoo(yahooUrl);

      if (data.chart?.result?.[0]) {
        const result = data.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0];

        responseData = {
          success: true,
          symbol,
          price: meta.regularMarketPrice,
          previousClose: meta.previousClose || (quotes?.close ? quotes.close[quotes.close.length - 2] : null),
          timestamp: Date.now()
        };
      } else {
        throw new Error('Invalid quote response');
      }
    }

    // Route: /options/:symbol (get expiries)
    else if (path.match(/^\/options\/([A-Z]+)$/i)) {
      const symbol = path.split('/')[2].toUpperCase();
      yahooUrl = `${YAHOO_BASE}/v7/finance/options/${symbol}`;

      const data = await fetchYahoo(yahooUrl);

      if (data.optionChain?.result?.[0]) {
        const result = data.optionChain.result[0];
        responseData = {
          success: true,
          symbol,
          expirationDates: result.expirationDates,
          strikes: result.strikes,
          quote: result.quote,
          timestamp: Date.now()
        };
      } else {
        throw new Error('Invalid options response');
      }
    }

    // Route: /options/:symbol/:expiry (get chain)
    else if (path.match(/^\/options\/([A-Z]+)\/(\d+)$/i)) {
      const parts = path.split('/');
      const symbol = parts[2].toUpperCase();
      const expiry = parts[3];
      yahooUrl = `${YAHOO_BASE}/v7/finance/options/${symbol}?date=${expiry}`;

      const data = await fetchYahoo(yahooUrl);

      if (data.optionChain?.result?.[0]) {
        const result = data.optionChain.result[0];
        responseData = {
          success: true,
          symbol,
          expiry: parseInt(expiry),
          quote: result.quote,
          options: result.options,
          timestamp: Date.now()
        };
      } else {
        throw new Error('Invalid options chain response');
      }
    }

    // Health check
    else if (path === '/' || path === '/health') {
      responseData = {
        success: true,
        service: 'Yahoo Finance Proxy',
        timestamp: Date.now()
      };
    }

    else {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unknown endpoint',
        endpoints: [
          '/quote/:symbol',
          '/options/:symbol',
          '/options/:symbol/:expiry'
        ]
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function fetchYahoo(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}`);
  }

  return response.json();
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
