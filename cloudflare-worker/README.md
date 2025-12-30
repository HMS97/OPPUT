# Cloudflare Worker - Yahoo Finance Proxy

Free proxy for Yahoo Finance API that bypasses CORS restrictions.

## Quick Deploy (5 minutes)

### Option 1: Cloudflare Dashboard (Easiest)

1. Go to [Cloudflare Workers](https://workers.cloudflare.com/) and sign up (free)
2. Click **Create a Worker**
3. Delete the example code and paste the contents of `worker.js`
4. Click **Save and Deploy**
5. Copy your worker URL (e.g., `https://your-worker.username.workers.dev`)

### Option 2: Wrangler CLI

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
cd cloudflare-worker
wrangler publish
```

## Usage

After deploying, update your worker URL in `docs/spy-options.js`:

```javascript
// Find this line in spy-options.js constructor:
this.workerUrl = 'https://your-worker.username.workers.dev';
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /quote/SPY` | Get spot price for SPY |
| `GET /options/SPY` | Get available expiry dates |
| `GET /options/SPY/1735344000` | Get options chain for specific expiry |
| `GET /health` | Health check |

## Example Response

```json
{
  "success": true,
  "symbol": "SPY",
  "price": 590.50,
  "previousClose": 588.25,
  "timestamp": 1703894400000
}
```

## Free Tier Limits

- 100,000 requests per day
- 10ms CPU time per request
- More than enough for personal use!

## Troubleshooting

1. **CORS errors**: Make sure you're using the full worker URL with https://
2. **Rate limiting**: Yahoo Finance may rate limit during market hours
3. **Empty data**: Markets may be closed, try during trading hours
