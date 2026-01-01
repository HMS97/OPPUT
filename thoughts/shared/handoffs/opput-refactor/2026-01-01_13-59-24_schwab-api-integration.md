---
date: 2026-01-01T21:59:24Z
session_name: opput-refactor
git_commit: 0261bc5
branch: claude/nvda-options-analysis-5H0Ee
repository: OPPUT
topic: "Charles Schwab API Integration for Real-Time OI WASP Data"
tags: [options, schwab-api, oiwasp, backtest]
status: in_progress
last_updated: 2026-01-01
type: implementation_strategy
---

# Handoff: Integrate Charles Schwab Trader API for Options OI Data

## Task(s)

### Completed
1. **OIWASP Strategy Research** - Analyzed nvida-option_stragety screenshots showing 300% monthly returns using OI WASP
2. **Backtest Infrastructure** - Created multiple backtest scripts for OIWASP strategy
3. **Options Leverage Multiplier** - Added UI slider (1x-20x) to simulate options returns
4. **OI-WASP Defaults** - Auto-set optimized params when OI-WASP selected (15m, 8x leverage, 20% strength)
5. **DoltHub WASP Integration** - Added `fetchOIWASP()` to fetch real WASP from historical data (2019-2024)
6. **OI Adapter Update** - Modified to use real DoltHub data with SMA fallback

### Next Task (User Requested)
- **Integrate Charles Schwab Trader API** to replace DoltHub for 2025+ real-time options OI data

## Critical References
- `nvida-option_stragety/OIWASP_STRATEGY_ANALYSIS.md` - Full strategy documentation
- `src/core/backtest/sources/oi-adapter.js` - OI signal source (needs Schwab integration)
- `src/core/data/dolthub.js` - Current DoltHub client (reference for new Schwab client)

## Recent Changes
- `src/core/data/dolthub.js:210-261` - Added `fetchOIWASP()` function
- `src/core/backtest/sources/oi-adapter.js:1-76` - Added real WASP loading from DoltHub
- `src/backtest/main.js:65-96` - Added `applyOIWASPDefaults()` method
- `src/backtest/main.js:474-483` - Load DoltHub data for OI source
- `src/backtest/index.html:102-109` - Added Options Leverage Multiplier slider

## Learnings

### OIWASP Strategy Core Concept
1. **WASP** = Weighted Average Strike Price from options Open Interest
2. When spot price deviates from WASP → mean reversion expected
3. Original strategy uses **butterfly spreads** with 8:1 R:R ($445 profit / $55 loss)
4. Third week of month shows highest deviation (monthly options expiry)

### Why Current Backtest Shows Poor Results
- **SMA proxy is NOT the same as real OI WASP** - market maker positioning not captured
- DoltHub only has data through ~2024, so 2025 dates fall back to SMA
- Need real-time options OI data for accurate WASP calculation

### Key Files Structure
```
src/core/data/
├── yahoo.js       # Price data
├── dolthub.js     # Historical options (2019-2024) - has fetchOIWASP()
└── schwab.js      # NEW: Real-time options OI (to create)

src/core/backtest/sources/
├── oi-adapter.js  # Uses dolthub.js, needs schwab.js integration
└── iv-adapter.js  # Reference for async data loading pattern
```

## Post-Mortem

### What Worked
- **DoltHub SQL API** - Free historical options data, easy to query
- **Options Leverage Multiplier** - Simple UI to simulate options returns
- **Auto-defaults** - Setting optimized params when OI-WASP selected improved UX

### What Failed
- **SMA as WASP proxy** - Doesn't capture actual market maker positioning, gives ~22% win rate
- **2025 data unavailable** - DoltHub historical only, user needs current data

### Key Decisions
- **Decision**: Use DoltHub for historical (2019-2024), Schwab for real-time (2025+)
  - Alternatives: Polygon.io, CBOE LiveVol, IBKR
  - Reason: User specifically requested Charles Schwab Trader API

## Artifacts
- `nvida-option_stragety/OIWASP_STRATEGY_ANALYSIS.md` - Strategy documentation
- `scripts/backtest-oiwasp.js` - Basic OIWASP backtest
- `scripts/backtest-oiwasp-realistic.js` - Butterfly spread simulation
- `src/core/data/dolthub.js` - DoltHub client with `fetchOIWASP()`
- `src/core/backtest/sources/oi-adapter.js` - Updated OI signal source

## Action Items & Next Steps

### 1. Create Schwab API Client (`src/core/data/schwab.js`)
- Implement OAuth2 authentication flow
- Create `fetchOptionsChain(symbol, expiration)` function
- Create `fetchOIWASP(symbol)` that calculates WASP from live OI data
- Handle rate limiting and error cases

### 2. Update OI Adapter
- Modify `src/core/backtest/sources/oi-adapter.js` to:
  - Check date range: if 2025+ use Schwab, else use DoltHub
  - Add `loadData()` call for Schwab similar to DoltHub

### 3. Add Schwab Auth UI (Optional)
- API key input in settings
- Token storage in localStorage

### 4. Schwab API Reference
- Docs: https://developer.schwab.com/
- Options endpoint: `/marketdata/v1/chains`
- Returns: strikes, OI, volume, greeks for each contract

## Other Notes

### Charles Schwab Trader API Key Points
- Requires developer account at developer.schwab.com
- OAuth2 flow for authentication
- Options chain endpoint provides open interest per strike
- Rate limits: ~120 requests/minute

### WASP Calculation Formula
```javascript
// From options chain data:
callWASP = SUM(strike * callOI) / SUM(callOI)
putWASP = SUM(strike * putOI) / SUM(putOI)
totalWASP = SUM(strike * totalOI) / SUM(totalOI)
```

### Testing Command
```bash
npm run dev  # http://localhost:5175/backtest/
```
Select OI-WASP → defaults auto-apply → change dates to 2023 for DoltHub data
