# OPPUT - SPY Options Trading Analysis Platform

## Quick Start

```bash
# Install dependencies
npm install

# Development server (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run verification
npm run verify

# Backend server (port 3001) - for Yahoo Finance proxy
npm start

# Robinhood API bridge (port 8001)
npm run api
```

## Project Overview

OPPUT is a multi-page SPY options trading analysis platform featuring:
- **Real-time pattern detection** across multiple timeframes (5m/15m/60m/240m)
- **Options analysis** with Greeks, OI heatmaps, and trade suggestions
- **Comprehensive backtesting** with 6+ signal sources and 4 exit strategies
- **Automated trading** via Robinhood API integration

## Architecture

```
src/
├── core/                    # Shared business logic (reusable modules)
│   ├── patterns/           # Pattern detection (RSI, BB, EMA, MACD)
│   ├── data/               # Data fetching (Yahoo, DoltHub, Unicorn)
│   ├── backtest/           # Backtesting engine + strategies
│   ├── options/            # Options analysis (Greeks, OI, WASP)
│   ├── trading/            # Live trading execution
│   ├── auth/               # Robinhood authentication
│   └── utils/              # Shared utilities
├── dashboard/              # Main dashboard page (multi-TF analysis)
├── spy-options/            # Options chain analysis page
├── backtest/               # Backtesting UI page
├── trading/                # Live trading page
├── login/                  # Authentication page
└── shared/                 # Shared UI components (sidebar)
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | Vite 7.x + Vanilla JS | Fast dev server, ES modules |
| Patterns | PutPatternDetector | RSI, BB, EMA, MACD analysis |
| Data | Yahoo Finance, DoltHub | Real-time market data |
| Backtest | Custom engine | Historical strategy validation |
| Options | Greeks calculator | Delta, Gamma, Theta, Vega |
| Proxy | Cloudflare Workers | CORS bypass for Yahoo Finance |
| Backend | Express.js | API server on port 3001 |
| Trading | Robinhood + FastAPI | Live order execution |

## Core Modules

### Pattern Detection (`src/core/patterns/`)
- `PatternDetector` - Detects 10+ price action patterns
- `PutPatternDetector` - Specialized for PUT signals
- Technical indicators: RSI(14), BB(20,2), EMA(8,21), MACD(12,26,9)

### Data Layer (`src/core/data/`)
- `yahoo.js` - Primary data source (candles, options, VIX)
- `dolthub.js` - WASP (Weighted Average Strike Price) data
- `cache.js` - SQLite-based persistent caching
- `pipeline.js` - Data processing and windowing

### Backtesting (`src/core/backtest/`)
**Signal Sources:**
- `OISignalSource` - WASP-based mean reversion (primary)
- `PatternDetectorSource` - Technical pattern signals
- `DailySignalSource` - Multi-indicator confluence
- `OITrendSource` - Trend following with WASP
- `IVSignalSource` - IV percentile signals
- `SettlementDaySource` - 大结算日作战卡 (Settlement Day Playbook)

**Exit Strategies:**
- `TargetStopExit` - % target / % stop loss
- `FixedBarsExit` - Exit after N bars
- `OppositeSignalExit` - Exit on opposite signal
- `ButterflyExit` - 8:1 payoff profile

### Trading (`src/core/trading/`)
- `OrderExecutor` - Maps signals to Robinhood orders
- `RiskManager` - Position limits, daily loss limits
- `SignalRunner` - Monitors and executes signals

## Key Commands

```bash
# Development
npm run dev              # Start Vite dev server
npm start                # Start Express backend
npm run api              # Start Robinhood API bridge

# Building
npm run build            # Build for production
npm run verify           # Run verification checks
npm run verify:full      # Full verification with smoke tests

# Trading
node scripts/live-trader.js --symbol SPY --dry-run  # Paper trading
node scripts/live-trader.js --symbol SPY --live     # Live trading
```

## Data Flow

```
Yahoo Finance API → Express Proxy (port 3001) → Data Layer
                                              ↓
                                        Pattern Detection
                                              ↓
                              ┌─── Dashboard (multi-TF display)
                              ├─── SPY Options (Greeks + OI)
                              ├─── Backtester (historical validation)
                              └─── Trading (Robinhood execution)
```

## Important Patterns

### Class-based Pages
Each page follows this pattern:
```javascript
class PageName {
  constructor() { /* init state */ }
  async init() { /* load data */ }
  bindEvents() { /* UI listeners */ }
}
document.addEventListener('DOMContentLoaded', () => {
  window.pageInstance = new PageName()
})
```

### Signal Interface
All signals follow this structure:
```javascript
{
  direction: 'PUT' | 'CALL',
  strength: 0-100,
  patterns: [...],
  timestamp: Date
}
```

### Module Imports
Use the `@core` alias for imports:
```javascript
import { fetchCandleData } from '@core/data/yahoo.js'
import { PatternDetector } from '@core/patterns/detector.js'
import { BacktestEngine } from '@core/backtest/engine.js'
```

## Configuration

### Vite (`vite.config.js`)
- Multi-page app with 6 entry points
- Build output to `dist/`
- Alias `@core` → `src/core/`
- Dev proxy `/api` → `localhost:3001`

### Environment Variables
```bash
# .env (optional)
EODHD_API_KEY=your_key       # For daily data fallback
SCHWAB_APP_KEY=your_key      # For Schwab integration
```

### Backtesting (UI Only)

All backtesting is done via the web UI at `/backtest`. No CLI scripts.

**Data Source:** Twelve Data (6+ months history for 5m candles)
**Requires:** Backend server running (`npm start`) for Twelve Data proxy

#### Presets

| Preset | Timeframe | Strategy | Best For |
|--------|-----------|----------|----------|
| **5m Scalp** | 5 min | OI-WASP | High-frequency scalping |
| **15m Swing** | 15 min | OI-WASP | Swing trading |
| **60m Position** | 60 min | Pattern | Position trading |
| **Ultra ★★** | 5 min | OI-WASP | Aggressive returns |
| **Settlement** | 5 min | Settlement Day | OpEx/Month-end |

#### How to Use

1. Start backend: `npm start`
2. Start dev server: `npm run dev`
3. Open http://localhost:5173/backtest/
4. Select a preset or configure manually
5. Set date range (Twelve Data supports 6+ months)
6. Click "Run Backtest"

#### Key Parameters

| Parameter | Description | Range |
|-----------|-------------|-------|
| WASP Period | SMA period for synthetic WASP | 5-50 |
| Entry Deviation | % deviation to trigger signal | 0.05-3% |
| Target % | Take profit threshold | 0.1-5% |
| Stop % | Stop loss threshold | 0.1-5% |
| Leverage | Options leverage multiplier | 1-50x |

#### Optimized Config (Validated 2026-01-04)

Tested 840 parameter combinations over 6 months of Twelve Data.

**RECOMMENDED CONFIG:**
```javascript
{
  waspPeriod: 8,
  entryDeviation: 0.05,  // 0.05% deviation threshold
  targetPercent: 1.0,    // 1% target
  stopPercent: 0.5,      // 0.5% stop (2:1 R:R)
  leverage: 10,          // 10x for conservative, 20x balanced, 35x aggressive
}
```

**Results (6 months, 10x leverage):**
- Total Return: **480%** (~80%/month)
- Win Rate: **59.3%**
- Profit Factor: **1.92**
- Max Drawdown: **-2.5%**
- Trades: 145

**Leverage Scaling (same base config):**

| Leverage | Return | Win Rate | Profit Factor | Max DD |
|----------|--------|----------|---------------|--------|
| 10x | 480% | 59.3% | 1.92 | -2.5% |
| 20x | 2,124% | 59.3% | 1.92 | -4.9% |
| 35x | 7,995% | 59.3% | 1.92 | -8.2% |

**Key Insight:** The edge (59% WR, 1.92 PF) is constant - leverage only scales returns and drawdown.

**Alternative Configs:**

| Style | WASP | Dev | Target | Stop | Lev | Return | WR | PF |
|-------|------|-----|--------|------|-----|--------|-----|-----|
| Conservative | 8 | 0.05 | 1.0% | 0.5% | 10x | 480% | 59% | 1.92 |
| Balanced | 12 | 0.08 | 1.0% | 0.5% | 20x | 705% | 57% | 1.62 |
| Aggressive | 8 | 0.05 | 1.0% | 0.5% | 35x | 7,995% | 59% | 1.92 |
| High Trades | 15 | 0.10 | 1.0% | 0.25% | 20x | 825% | 47% | 1.61 |

**To re-run optimization:**
```bash
npm start  # Start backend first
node scripts/optimize-oi-scalp.js
```

**Filters:**
- RSI/ADX/BB Filters: OFF (default)
- Week 3-4 Only: OFF (default)

**Important - Exit Strategy:**
- Ultra preset uses `useUnderlyingPnL = true` → checks underlying price moves (not option P&L)
- This matches the optimization script and produces ~145 trades in 6 months
- If `useUnderlyingPnL = false` (option P&L), targets are hit faster → more trades but different results

#### Debugging

Open browser DevTools (F12) to see:
- `[DEBUG] Creating OI source with config: {...}` - Config values being used
- `[OI-WASP-OPT] Config: ...` - Signal source initialization

**Note:** 240m (daily) timeframe requires the backend server (`npm start`).

### Backtesting with Lumibot

The backtest UI now uses **Lumibot** (Python) for accurate options backtesting.

**Quick Start:**
```bash
# Terminal 1: Start Lumibot API
npm run lumibot

# Terminal 2: Start dev server
npm run dev

# Or run both together:
npm run backtest
```

**How it works:**
1. UI sends backtest request to Lumibot API (port 8002)
2. Lumibot runs Python backtest with real market data
3. Results displayed in the web UI

**Data Sources:**

| Source | Data | Cost | Setup |
|--------|------|------|-------|
| Yahoo | Stocks, daily | Free | Default |
| Polygon | Stocks + Options | Free tier | `export POLYGON_API_KEY=xxx` |
| ThetaData | Best options data | Subscription | Install lumibot[thetadata] |

**API Endpoints:**
- `GET http://localhost:8002/health` - Check API status
- `POST http://localhost:8002/backtest` - Run backtest

**Manual Python Backtest:**
```bash
source .venv-lumibot/bin/activate
python scripts/lumibot_oi_scalp_options.py
```

## Testing

### Unit Tests
```bash
npm test                     # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

### Test Files Location
```
src/
├── core/
│   ├── patterns/__tests__/
│   ├── data/__tests__/
│   ├── backtest/__tests__/
│   └── ...
├── dashboard/__tests__/
├── spy-options/__tests__/
└── ...
```

## Deployment

| Environment | Technology | URL |
|-------------|-----------|-----|
| Frontend | GitHub Pages | `dist/` folder |
| Backend | Node.js | `server.js` on port 3001 |
| Proxy | Cloudflare Workers | `cloudflare-worker/` |

## Common Tasks

### Adding a New Signal Source
1. Create adapter in `src/core/backtest/sources/`
2. Implement `{ candles, generateSignals() }` interface
3. Export from `src/core/backtest/index.js`
4. Add to backtest UI dropdown

### Adding a New Exit Strategy
1. Create strategy in `src/core/backtest/strategies/`
2. Implement `exitTrade(trade, candle, index)` method
3. Export from `src/core/backtest/index.js`
4. Add to backtest UI dropdown

### Modifying Pattern Detection
Edit `src/core/patterns/detector.js`:
- RSI thresholds: `rsi < 30` (oversold), `rsi > 70` (overbought)
- Bollinger Band: 2 standard deviations
- EMA crossover: 8-period vs 21-period

## Troubleshooting

### Build Fails
1. Check `vite.config.js` paths
2. Verify all imports resolve
3. Run `npm run verify`

### Data Loading Errors
1. Ensure Express server running (`npm start`)
2. Check Cloudflare Worker deployment
3. Verify CORS headers

### Pattern Detection Issues
1. Check indicator calculations in `core/patterns/`
2. Verify candle data format
3. Check timeframe configuration

### Backtest Errors
1. Verify data adapter format
2. Check date ranges
3. Ensure sufficient historical data

## Files Reference

| File | Purpose |
|------|---------|
| `vite.config.js` | Vite multi-page configuration |
| `package.json` | Dependencies and scripts |
| `server.js` | Express backend server |
| `src/core/index.js` | Central barrel export |
| `src/core/data/yahoo.js` | Primary data source (22KB) |
| `src/core/backtest/engine.js` | Core backtest logic |
| `src/core/patterns/detector.js` | Pattern detection engine |

## Notes

- All JavaScript (no TypeScript) - ES modules
- No framework (vanilla JS with classes)
- Charts: TradingView Lightweight Charts + Chart.js
- Build artifacts (`dist/`) committed for GitHub Pages
- Python required for Robinhood API bridge


## Lumibot (Alternative Backtesting)

For production-grade backtesting, consider [Lumibot](https://lumibot.lumiwealth.com/):

```bash
# Create clean virtual environment
python -m venv lumibot_env
source lumibot_env/bin/activate
pip install lumibot

# Run OI-Scalp strategy
python scripts/lumibot_oi_scalp.py
```

**Benefits:**
- Same code for backtest → live trading
- Built-in options support (ThetaData, Polygon)
- Event-based engine
- Professional tearsheets

**Data Sources:**
- Yahoo: Free, daily only
- Polygon.io: Intraday, requires API key
- ThetaData: Best for options, subscription required 