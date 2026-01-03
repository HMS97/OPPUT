---
date: 2026-01-01T16:32:30-08:00
session_name: opput-refactor
researcher: Claude
git_commit: 95bc397
branch: claude/nvda-options-analysis-5H0Ee
repository: OPPUT
topic: "Butterfly Spread Backtest P&L Model Implementation"
tags: [options, butterfly-spread, black-scholes, backtesting]
status: in_progress
last_updated: 2026-01-01
last_updated_by: Claude
type: implementation_strategy
root_span_id:
turn_span_id:
---

# Handoff: Butterfly Spread Backtest with Black-Scholes Pricing

## Task(s)

### Completed
1. **Butterfly exit strategy with Black-Scholes** - Rewrote `src/core/backtest/strategies/butterfly-exit.js` to use proper options pricing instead of simplified zone-based model
2. **Market hours filter** - Added filter to exclude pre/post market candles (9:30 AM - 4:00 PM ET using `Intl.DateTimeFormat`)
3. **localStorage caching for candle data** - Added caching to `src/core/data/yahoo.js` to speed up repeated backtests
4. **Exit time column** - Added exit time display in trade log table
5. **Engine fix for butterfly P&L** - Fixed double-calculation bug in `src/core/backtest/engine.js:168-184`

### In Progress (User's Last Request)
- **Display option details in trade log**: User requested showing:
  - Option type (call/put butterfly)
  - Target date (expiration)
  - Target strike price (center strike K2)
  - Wing strikes (K1, K3)

## Critical References
- `nvida-option_stragety/` - Original NVDA butterfly strategy images showing 8:1 R:R
- `src/core/backtest/strategies/butterfly-exit.js` - Main file to modify
- `src/backtest/main.js:861-880` - Trade log rendering (needs option details columns)

## Recent changes
- `src/core/backtest/strategies/butterfly-exit.js:1-177` - Complete rewrite with Black-Scholes
- `src/core/backtest/engine.js:168-184` - Fixed butterfly P&L to not double-calculate
- `src/core/data/yahoo.js:439-466` - Market hours filter with ET timezone
- `src/core/data/yahoo.js:9-127` - localStorage candle caching
- `src/backtest/index.html:191-204` - Added Exit Time column
- `src/backtest/main.js:20-25` - Extended 5m timeframe to 30 days
- `src/core/backtest/sources/oi-adapter.js:28-36` - Lowered signal thresholds

## Learnings

### Black-Scholes for Butterfly Spreads
The proper formula for butterfly value before expiration:
```javascript
butterflyValue = BS(K1) - 2*BS(K2) + BS(K3)
```
Where BS() is Black-Scholes option pricing. At expiration:
```javascript
payoff = max(0, wingWidth - abs(spot - centerStrike))
```

### Key Parameters for Butterfly
- **Wing width**: $5 typical (K2-K1 = K3-K2 = 5)
- **Net debit**: ~11% of wing width (~$0.55 for $5 wide)
- **Max profit**: wingWidth - netDebit (~$4.45)
- **Max loss**: netDebit (~$0.55)
- **R:R ratio**: ~8:1

### Market Hours Filter
Must use `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` to properly handle ET timezone regardless of user's local timezone.

## Post-Mortem

### What Worked
- **Black-Scholes implementation**: Standard formula worked well for pricing each leg
- **localStorage caching**: Significantly speeds up repeated backtests with same parameters
- **Zone-based approach was wrong**: Discovered that simplified zone P&L ignored actual options pricing dynamics

### What Failed
- **UTC timezone calculation**: Initial market hours filter used raw UTC math which was incorrect
- **Direction-only check**: Previous version only checked if price moved in right direction, not actual butterfly payoff
- **Linear leverage multiplier**: Multiplying underlying price movement by 8x is NOT how butterfly spreads work

### Key Decisions
- **Decision**: Use Black-Scholes instead of simplified zones
  - Alternatives: Zone-based approximation, simple interpolation
  - Reason: Accurate theta decay and proper payoff curve

- **Decision**: Fixed 5-point wing width
  - Alternatives: Dynamic based on IV
  - Reason: Simplicity, matches typical SPY butterfly trades

## Artifacts
- `src/core/backtest/strategies/butterfly-exit.js` - Black-Scholes butterfly pricing
- `src/core/backtest/engine.js` - Fixed P&L calculation
- `src/core/data/yahoo.js` - Caching + market hours filter
- `src/backtest/main.js` - UI updates
- `src/backtest/index.html` - Added columns
- `.claude/cache/agents/research-agent/latest-output.md` - Research on butterfly pricing

## Action Items & Next Steps

### Immediate (User's Request)
1. **Add option details to trade log table**:
   - Add columns: "Type", "Target Strike", "Expiry", "Wings"
   - Update `src/backtest/index.html:191-204` header
   - Update `src/backtest/main.js:861-880` row rendering
   - Pass strike info through trade.metadata from ButterflyExit

2. **Store butterfly details in trade metadata**:
   - Modify `ButterflyExit.shouldExit()` to include K1, K2, K3 in result
   - Engine needs to save this to trade.metadata

### Future Improvements
1. Add IV input parameter to UI (currently hardcoded 20%)
2. Support 0 DTE vs 1+ DTE different theta decay curves
3. Add Greeks display (delta, gamma, theta, vega)
4. Consider fetching real IV from options chain data

## Other Notes

### File Locations
- Backtest page: `src/backtest/main.js`, `src/backtest/index.html`
- Exit strategies: `src/core/backtest/strategies/`
- Data fetching: `src/core/data/yahoo.js`
- Signal sources: `src/core/backtest/sources/`

### Build Command
```bash
npm run build
```

### Testing
Clear browser cache after rebuilding - localStorage caches old candle data. Click "Clear Cache" button in UI.

### CLI Backtest (for comparison)
```bash
node scripts/backtest-oiwasp-realistic.js
```
This shows ~200% returns but uses different (simpler) model than web page.
