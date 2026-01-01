---
date: 2026-01-01T22:53:31Z
session_name: opput-refactor
researcher: Claude
git_commit: 0261bc5588442ff3dcaa0e2def25045fa9b711eb
branch: claude/nvda-options-analysis-5H0Ee
repository: OPPUT
topic: "EODHD Options Data Integration"
tags: [implementation, options-data, eodhd, pipeline, cache]
status: complete
last_updated: 2026-01-01
last_updated_by: Claude
type: implementation_strategy
root_span_id:
turn_span_id:
---

# Handoff: EODHD Options API Integration (Replacing DoltHub)

## Task(s)

| Task | Status |
|------|--------|
| Onboard to OPPUT project | Completed |
| Plan Schwab API replacement for DoltHub | Completed |
| Create SQLite cache system | Completed |
| Create Schwab API client | Completed (but replaced with EODHD) |
| Create data pipeline with cache-first pattern | Completed |
| Update iv-adapter and oi-adapter to use pipeline | Completed |
| Replace Schwab with EODHD (simpler, no OAuth) | Completed |

**Summary:** User originally requested replacing DoltHub with Charles Schwab Trader API. After planning, discovered user had no Schwab accounts (3-7 day approval required). Pivoted to EODHD - simpler API key auth, has options data with OI for WASP calculations.

## Critical References

- `thoughts/ledgers/CONTINUITY_CLAUDE-opput.md` - Main continuity ledger created during onboarding
- `.claude/plans/harmonic-sleeping-alpaca.md` - Original Schwab implementation plan (still valid architecture, just swap provider)

## Recent changes

- `src/core/data/eodhd.js:1-130` - NEW: EODHD options API client with WASP/IV calculations
- `src/core/data/cache.js:1-350` - NEW: SQLite cache (better-sqlite3) for local options data
- `src/core/data/pipeline.js:1-430` - NEW: Unified data layer (cache → EODHD → DoltHub fallback)
- `src/core/data/schwab.js:1-240` - NEW: Schwab client (not used, kept for reference)
- `src/core/data/token-manager.js:1-120` - NEW: OAuth token manager (for Schwab, not used)
- `src/core/data/rate-limiter.js:1-60` - NEW: Rate limiter utility
- `src/core/backtest/sources/iv-adapter.js:11,41,57,65,295,320` - MODIFIED: Uses DataPipeline instead of direct DoltHub
- `src/core/backtest/sources/oi-adapter.js:11,39,52,253` - MODIFIED: Uses DataPipeline instead of direct DoltHub
- `vite.config.js:18-28` - MODIFIED: Excludes Node.js modules from browser bundle
- `.gitignore:7-11` - MODIFIED: Added data/*.db* and token files
- `.env` - NEW: Contains EODHD_API_KEY
- `.env.example` - UPDATED: Now just EODHD key (simplified from Schwab)
- `scripts/daily-fetch.js:1-100` - NEW: Cron script for daily data collection

## Learnings

1. **Browser vs Node.js compatibility**: Vite bundles everything statically. Node.js modules (fs, path, better-sqlite3) must be excluded via `rollupOptions.external` in vite.config.js. The pipeline uses `typeof window !== 'undefined'` to detect browser and falls back to DoltHub-only mode.

2. **EODHD is simpler than Schwab**: No OAuth dance, no brokerage account required, just API key. Has options data with open interest - sufficient for WASP calculations.

3. **DoltHub still works as fallback**: The pipeline maintains DoltHub as fallback for historical data (2019-2024). EODHD is primarily for live/today data.

4. **Architecture pattern**: Cache-first with provider fallback chain:
   - Browser: DoltHub only (fetch-based)
   - Node.js: SQLite Cache → EODHD → DoltHub

## Post-Mortem (Required for Artifact Index)

### What Worked
- **Dynamic imports for Node.js modules**: Used `await import('./cache.js')` instead of static imports to prevent Vite from bundling Node.js code
- **Getter properties for lazy initialization**: `get eodhd()` and `get cache()` allow deferred loading
- **Browser detection**: Simple `typeof window !== 'undefined'` check enables same codebase for browser/Node.js
- **Keeping DoltHub as fallback**: No breaking changes to existing functionality

### What Failed
- **Static imports of Node.js modules**: Initial attempt imported cache.js/schwab.js directly → Rollup tried to bundle better-sqlite3 → build failed
- **External array not matching import paths**: Had to use exact paths like `'./cache.js'` not just `'cache'`

### Key Decisions
- **Decision: Use EODHD instead of Schwab**
  - Alternatives: Schwab (full broker API), Polygon.io, Tradier
  - Reason: User had no Schwab accounts (7-day wait), EODHD has simple API key auth, cheaper, has OI data

- **Decision: Keep Schwab client code (unused)**
  - Alternatives: Delete it
  - Reason: User may want to upgrade later; architecture is identical, just swap provider

- **Decision: Browser uses DoltHub directly**
  - Alternatives: Try to use EODHD in browser
  - Reason: Keeps frontend simple, DoltHub works via fetch, EODHD could require CORS proxy

## Artifacts

- `src/core/data/eodhd.js` - EODHD client with options chain, WASP, ATM IV
- `src/core/data/cache.js` - SQLite cache matching DoltHub interface
- `src/core/data/pipeline.js` - Unified data access layer
- `src/core/data/schwab.js` - Schwab client (preserved, not used)
- `src/core/data/token-manager.js` - OAuth token manager (for Schwab)
- `src/core/data/rate-limiter.js` - Rate limiting utility
- `scripts/daily-fetch.js` - Daily data collection script
- `.env` - EODHD API key configured
- `thoughts/ledgers/CONTINUITY_CLAUDE-opput.md` - Project continuity ledger

## Action Items & Next Steps

1. **Test EODHD integration**: Run the backtest page to verify EODHD data fetching works
2. **Set up daily-fetch cron**: `0 16 * * 1-5 node scripts/daily-fetch.js` (4 PM ET weekdays)
3. **Commit changes**: Many uncommitted files from this session
4. **Consider removing Schwab code**: If not planning to use Schwab, can delete schwab.js and token-manager.js

## Other Notes

- **EODHD API Key**: Already saved in `.env` as `EODHD_API_KEY=6956f9a0af98f2.93745588`
- **Rate limits**: EODHD free tier allows 20 requests/day, paid tier 100k/day
- **Data freshness**: EODHD provides end-of-day data, not real-time intraday
- **Build verified**: `npm run build` passes successfully
- **Original task was bug fixes**: User's stated goal was "bug fixes / maintenance" - this evolved into data source replacement
