---
name: verify
description: Run verification checks before commit (build, imports, smoke tests)
allowed-tools: [Bash, Read]
---

# Verify Skill

Run project verification to ensure build integrity and module correctness.

## When to Use

- Before any `git commit`
- After significant code changes
- When you want to validate the build works

## Quick Commands

```bash
# Standard verification (build + module imports)
npm run verify

# Full verification (includes smoke tests)
npm run verify:full

# Quiet mode (only output on failure)
npm run verify -- --quiet
```

## What It Checks

### Level 1: Build
- Vite build succeeds
- All 5 HTML pages generated in `dist/`

### Level 2: Module Imports
- Core barrel (`src/core/index.js`) loads
- All adapters (OI, IV, Pattern, Daily Signal) load
- All strategies (Target-Stop, Fixed Bars, etc.) load
- Indicators and patterns load

### Level 3: Smoke Tests (--full only)
- Statistics `calculateStats()` returns expected shape
- Indicators functions exist and work
- Backtest engine exports correctly

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All passed |
| 1 | Build failed |
| 2 | Module import failed |
| 3 | Smoke test failed |

## Usage in Claude Code

This skill is auto-invoked by the pre-commit hook. You can also run it manually:

```
/verify
/verify --full
```
