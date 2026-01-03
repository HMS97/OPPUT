# OPPUT Verification & Testing Plan

## Purpose
Verify project integrity before commits to catch build failures, import errors, and critical functionality issues.

## Verification Levels

### Level 1: Build Verification (Fast - ~10s)
- [ ] `npm run build` succeeds without errors
- [ ] All 5 HTML pages generated in `dist/`
- [ ] No missing module errors

### Level 2: Module Import Verification (Medium - ~5s)
- [ ] Core barrel exports load (`src/core/index.js`)
- [ ] All adapters load without errors
- [ ] All strategies load without errors
- [ ] Data modules load (cache, rate-limiter, etc.)

### Level 3: Smoke Tests (Medium - ~15s)
- [ ] Backtest engine initializes
- [ ] Statistics module calculations work
- [ ] Indicators produce expected output shapes
- [ ] Pattern detector runs without errors

### Level 4: Server Health (Optional - ~5s)
- [ ] Server starts on port 3001
- [ ] `/api/health` responds (if implemented)

## Critical Modules to Verify

| Module | Path | Verification |
|--------|------|--------------|
| Backtest Engine | `src/core/backtest/engine.js` | Constructor, runBacktest shape |
| Statistics | `src/core/backtest/statistics.js` | calculateStats returns expected keys |
| OI Adapter | `src/core/backtest/sources/oi-adapter.js` | Loads without error |
| IV Adapter | `src/core/backtest/sources/iv-adapter.js` | Loads without error |
| Yahoo Data | `src/core/data/yahoo.js` | Exports fetchCandles |
| Indicators | `src/core/patterns/indicators.js` | RSI, EMA, SMA functions exist |

## Pre-Commit Verification

Before every commit, run:
```bash
npm run verify
```

This runs Level 1 + Level 2 verification by default.

For full verification (including smoke tests):
```bash
npm run verify:full
```

## Exit Codes

- `0`: All verifications passed
- `1`: Build failed
- `2`: Module import failed
- `3`: Smoke test failed
- `4`: Server health check failed

## Integration with Claude Code

A PreToolUse hook on `Bash` commands matching `git commit` triggers the `/verify` skill automatically.
