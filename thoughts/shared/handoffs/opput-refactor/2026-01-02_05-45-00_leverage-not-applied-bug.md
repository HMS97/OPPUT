---
date: 2026-01-02T05:45:00-08:00
session_name: opput-refactor
researcher: Claude
git_commit: 95bc397
branch: claude/nvda-options-analysis-5H0Ee
repository: OPPUT
topic: "OI-Scalp Leverage Bug Fix"
tags: [backtesting, leverage, oi-scalp, bug-fix]
status: in_progress
last_updated: 2026-01-02
last_updated_by: Claude
type: implementation_strategy
root_span_id:
turn_span_id:
---

# Handoff: OI-Scalp Backtest Leverage Not Being Applied

## Task(s)

| Task | Status |
|------|--------|
| Analyze NVDA OI-WASP strategy from screenshots | Completed |
| Add 200% preset button to backtest page | Completed |
| Create optimization script with presets | Completed |
| Cap leverage slider at 8x max | Completed |
| **Fix leverage not being applied to trades** | **IN PROGRESS - BUG** |

**Current Problem:** Screenshot shows 118 trades with 44.1% win rate but only ~0.5% total return. Expected with 8x leverage: ~40% return. The leverage multiplier UI shows 8x but P&L is not multiplied.

## Critical References

1. `src/backtest/main.js:694-700` - Leverage application logic
2. `src/backtest/main.js:114-184` - apply200PercentPreset() function
3. `nvida-option_stragety/OIWASP_STRATEGY_ANALYSIS.md` - Target strategy (200%+ monthly)

## Recent changes

Key files modified this session:
```
src/backtest/main.js:107-184 - Updated apply200PercentPreset() to use target-stop exit
src/backtest/main.js:694-700 - Leverage application (THIS IS WHERE BUG IS)
src/backtest/index.html:112 - Changed leverage slider max from 20 to 8
src/backtest/styles.css:357-378 - Added .btn-accent gold button styling
scripts/optimize-oi-scalp.js:19-129 - New presets with 8x max leverage
```

## Learnings

### Root Cause Analysis
The leverage code at `src/backtest/main.js:694` looks correct:
```javascript
if (this.config.exitStrategy !== 'butterfly' && this.config.leverageMultiplier > 1) {
  processedTrades = results.trades.map(trade => ({
    ...trade,
    pnlPercent: trade.pnlPercent * this.config.leverageMultiplier,
    pnl: trade.pnl * this.config.leverageMultiplier,
  }))
}
```

**Suspected issues:**
1. `this.config.leverageMultiplier` might not be set (check initialization)
2. Config might be string "8" not integer 8 (type coercion issue)
3. The slider value might not sync with config properly

### Screenshot Evidence
- Total Trades: 118
- Win Rate: 44.1%
- Expectancy: 0.32% (should be ~2.5% with 8x)
- Avg Win: 2.18% (should be ~17% with 8x)
- Avg Loss: 1.14% (should be ~9% with 8x)
- Max Drawdown: -6.7%
- Total Return: ~0.5% (from equity curve 10000→10055)

This confirms NO leverage is being applied.

## Post-Mortem

### What Worked
- OI-Scalp signal generation works (118 trades, 44% win rate is good)
- Target-Stop exit strategy works correctly
- UI preset button applies correct settings
- Build process works reliably

### What Failed
- **Leverage multiplication not applied** - trades show raw stock P&L
- Butterfly exit strategy had massive P&L calculation bug (-26000% returns)
- Original 200%+ target unrealistic with 8x leverage cap

### Key Decisions
- **Decision:** Cap leverage at 8x
  - Alternatives: Keep 20x or 40x
  - Reason: User requested max 8x for realistic butterfly spread simulation

- **Decision:** Use target-stop instead of butterfly exit
  - Alternatives: Fix butterfly Black-Scholes pricing
  - Reason: Butterfly exit had severe bugs, target-stop validates better

## Artifacts

- `src/backtest/main.js` - Main backtest UI (leverage bug here)
- `src/backtest/index.html` - Updated with 8x max slider
- `src/backtest/styles.css` - Gold accent button
- `scripts/optimize-oi-scalp.js` - Optimization presets
- `thoughts/ledgers/CONTINUITY_CLAUDE-opput.md` - Updated ledger

## Action Items & Next Steps

### IMMEDIATE: Fix Leverage Bug
1. Add console.log in runBacktest() to verify `this.config.leverageMultiplier` value:
   ```javascript
   console.log('[Backtest] Leverage config:', this.config.leverageMultiplier, typeof this.config.leverageMultiplier)
   ```

2. Check if leverageMultiplier is initialized properly in constructor (line 51)

3. Verify slider event handler sets integer not string:
   ```javascript
   // Line 352 - ensure parseInt is used
   this.config.leverageMultiplier = parseInt(e.target.value)
   ```

4. Test by running backtest and checking console for leverage value

### After Fix Verified
5. Run optimization script to validate returns:
   ```bash
   node --experimental-vm-modules scripts/optimize-oi-scalp.js
   ```

6. Expected with 8x leverage and ~150 trades: 30-40% monthly return

## Other Notes

### Dev Commands
```bash
npm run dev      # Start dev server (port 5173)
npm run build    # Build for production
```

### Backtest Page URL
http://localhost:5173/backtest/

### Expected Results (when leverage works)
With 8x leverage, "High Freq 8x" preset should show:
- ~150+ trades
- ~43% win rate
- ~37% total return (not 0.5%)
- ~8% max drawdown

### Optimization Script Presets (8x max)
| Preset | Expected Return |
|--------|-----------------|
| Butterfly 8x | Broken (butterfly exit bug) |
| Target-Stop 8x | ~31% |
| High Freq 8x | ~37% |
| Conservative 5x | ~3% |
