---
date: 2026-01-01T20:16:45-08:00
session_name: opput-refactor
researcher: Claude
git_commit: 95bc397
branch: claude/nvda-options-analysis-5H0Ee
repository: OPPUT
topic: "OI-Scalp Backtesting Strategy Optimization"
tags: [backtesting, mean-reversion, oi-wasp, options, optimization]
status: in_progress
last_updated: 2026-01-01
last_updated_by: Claude
type: implementation_strategy
root_span_id:
turn_span_id:
---

# Handoff: OI-Scalp Strategy Optimization - Fixing Massive Losses

## Task(s)

**Goal:** Optimize OI-Scalp backtesting strategy to achieve 200%+ monthly returns (based on original Chinese NVDA strategy screenshots in `nvida-option_stragety/`)

| Task | Status |
|------|--------|
| Research original strategy from screenshots | Completed |
| Add RSI/ADX/BB/ATR filters to oi-adapter.js | Completed |
| Add ADX indicator to indicators.js | Completed |
| Add Week 3-4 monthly filter | Completed |
| Fix butterfly exit targeting | Completed |
| Simplify to target-stop exit | Completed |
| **Test and verify strategy works** | **IN PROGRESS** |

**Current Problem:** Backtest shows -95% drawdown, 0% win rate, all trades losing. User tested with 4H timeframe and butterfly exit - both were wrong.

## Critical References

1. `nvida-option_stragety/OIWASP_STRATEGY_ANALYSIS.md` - Original strategy analysis showing 200%+ returns
2. `nvida-option_stragety/preview*.webp` - Screenshots of original Chinese strategy (300% monthly on NVDA)
3. `src/core/backtest/sources/oi-adapter.js` - Main signal source (heavily modified)

## Recent changes

Key files modified:

```
src/core/patterns/indicators.js:191-339 - Added calculateATRArray, calculateADX, calculateBollingerPercentB
src/core/backtest/sources/oi-adapter.js:1-421 - Complete rewrite with filters
src/core/backtest/strategies/butterfly-exit.js:77-90 - Fixed center strike calculation for mean reversion
src/backtest/main.js:68-105 - Updated applyOIWASPDefaults() with simplified settings
src/backtest/main.js:351-375 - Updated OI config UI with filter checkboxes
```

## Learnings

### Root Cause of Losses
1. **Butterfly exit was targeting WRONG direction** - Was targeting 0.5% from entry, but mean reversion target is WASP (only 0.2-0.3% away)
2. **Filters too restrictive** - RSI<35, ADX<25, BB %B<0.2 combined eliminates almost all signals
3. **4H timeframe wrong** - Too few signals, especially with Week 3-4 filter; original uses 5m
4. **Week 3-4 filter reduces signals drastically** - Good for production, bad for initial testing

### Key Insight from Original Strategy
- OI deviation is highest in **Week 3-4** of each month (monthly options expiry)
- Butterfly 8:1 R:R ($445 max profit / $55 max loss) on NVDA
- Uses real OI WASP data, not SMA proxy

### Current Simplified Settings
```javascript
timeframe: 15           // Not 5m (too noisy) or 4H (too few signals)
exitStrategy: 'target-stop'
targetPercent: 0.3      // Revert toward WASP
stopPercent: 0.5        // Tight stop
leverageMultiplier: 5   // Options leverage
entryDeviation: 0.3     // Slightly wider
useFilters: false       // DISABLED for testing
useWeekFilter: false    // DISABLED for testing
```

## Post-Mortem

### What Worked
- Adding indicators (ADX, ATRArray, BollingerPercentB) to indicators.js was straightforward
- Week 3-4 filter logic is correct (getWeekOfMonth function)
- UI checkboxes for enabling/disabling filters

### What Failed
- **Butterfly exit with mean reversion**: Center strike calculation was inverted. Fixed but complex to verify.
- **All filters enabled by default**: Too restrictive, resulted in very few trades
- **4H timeframe**: User ran with this, got only 9 trades over 730 days, all lost
- **Butterfly P&L calculation**: May still have issues with Black-Scholes for mean reversion

### Key Decisions
- **Decision**: Switch from Butterfly to Target-Stop exit
  - Alternatives: Fix butterfly Black-Scholes, use fixed-bars
  - Reason: Target-Stop is simpler, more predictable, easier to debug

- **Decision**: Disable all filters by default
  - Alternatives: Keep filters on
  - Reason: Need to verify base strategy works before adding filters

- **Decision**: Use 15m timeframe instead of 5m or 4H
  - Alternatives: 5m (original), 4H (user tried)
  - Reason: Balance between signal quality and quantity

## Artifacts

- `src/core/patterns/indicators.js` - New ADX, ATRArray, BollingerPercentB functions
- `src/core/backtest/sources/oi-adapter.js` - Optimized OI signal source with filters
- `src/core/backtest/strategies/butterfly-exit.js` - Fixed mean reversion targeting
- `src/backtest/main.js` - Updated defaults and UI
- `nvida-option_stragety/OIWASP_STRATEGY_ANALYSIS.md` - Reference for target returns

## Action Items & Next Steps

1. **IMMEDIATE: Test simplified strategy**
   - Go to http://localhost:5175/backtest/
   - Click OI-Scalp tab (defaults auto-apply: 15m, target-stop, filters OFF)
   - Run 3-month backtest
   - Check if win rate > 0% and expectancy positive

2. **If still losing:**
   - Check if signal direction is correct (CALL when below WASP, PUT when above)
   - Add console.log in oi-adapter.js to debug signal generation
   - Try Pattern source as baseline comparison

3. **If profitable:**
   - Enable RSI/ADX/BB filters one at a time
   - Enable Week 3-4 filter
   - Increase leverage to achieve 200%+ target

4. **Future: Real WASP data**
   - Current uses SMA proxy, not real OI data
   - Need to verify Unicorn API is returning actual WASP values

## Other Notes

### Dev Server
Running at http://localhost:5175/ (port may vary, check output)

### Commands
```bash
npm run dev      # Start dev server
npm run build    # Build for production
```

### Original Strategy Summary (from screenshots)
- 300% monthly on NVDA using OI WASP deviation
- Butterfly/Condor spreads, 9:1 R:R
- Only trade Week 3-4 (highest OI deviation around monthly expiry)
- Max 1/3 account per position
