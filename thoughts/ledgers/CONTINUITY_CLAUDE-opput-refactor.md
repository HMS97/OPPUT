# CONTINUITY_CLAUDE-opput-refactor

## Goal
Refactor OPPUT using Vite bundler for better code organization, module sharing, and developer experience.

**Success Criteria:**
- [x] Initial onboarding complete
- [x] Code analysis complete
- [ ] Vite setup with proper build pipeline
- [ ] Shared modules for pattern detection, data fetching
- [ ] Dashboard and SPY options pages use shared modules
- [ ] Extension can import from shared core

## Architecture Overview

### Current Structure (Problematic)
```
OPPUT/
├── docs/                        # Static files served by GitHub Pages
│   ├── index.html               # Dashboard
│   ├── app.js                   # 1562 lines - monolithic
│   ├── patterns.js              # 1367 lines - V2 pattern detector
│   ├── spy-options.html         # Options analysis page
│   └── spy-options.js           # 888 lines - monolithic
├── put-reminder-extension/
│   ├── src/lib/patterns.js      # 375 lines - DUPLICATE (V1)
│   ├── webapp/app.js            # 493 lines - DUPLICATE
│   └── ...
├── server.js                    # Express backend
└── cloudflare-worker/           # Yahoo Finance proxy
```

### Target Structure (After Refactor)
```
OPPUT/
├── src/                         # Source code (Vite entry)
│   ├── core/                    # Shared business logic
│   │   ├── patterns/
│   │   │   ├── detector.js      # PutPatternDetector class
│   │   │   ├── indicators.js    # RSI, BB, EMA, MACD calculations
│   │   │   └── types.js         # Pattern types and configs
│   │   ├── data/
│   │   │   ├── yahoo.js         # Yahoo Finance fetching
│   │   │   ├── tradingview.js   # TradingView API client
│   │   │   └── cors-proxy.js    # CORS proxy logic
│   │   └── utils/
│   │       ├── formatting.js    # Number/time formatting
│   │       └── constants.js     # Timeframe configs, pattern icons
│   ├── dashboard/               # Main dashboard app
│   │   ├── index.html
│   │   ├── main.js              # Entry point
│   │   ├── Dashboard.js         # Main class (UI-focused)
│   │   └── styles.css
│   ├── spy-options/             # SPY options page
│   │   ├── index.html
│   │   ├── main.js
│   │   ├── SPYOptionsAnalyzer.js
│   │   └── styles.css
│   └── extension/               # Browser extension source
│       └── ...                  # Can import from core/
├── dist/                        # Vite build output (for GitHub Pages)
├── server.js                    # Express backend (unchanged)
├── cloudflare-worker/           # CORS proxy (unchanged)
├── vite.config.js               # Vite configuration
└── package.json                 # Updated with Vite deps
```

## Tech Stack
- **Bundler:** Vite 5.x
- **Language:** JavaScript (ES6+ modules)
- **Backend:** Express.js (unchanged)
- **Deployment:**
  - Dashboard: GitHub Pages (from dist/)
  - Backend: Node.js server
  - Proxy: Cloudflare Workers

## Key Refactoring Decisions

| Decision | Rationale |
|----------|-----------|
| Use Vite | Fast dev server, native ES modules, simple config |
| Multi-page app | Dashboard and SPY options are separate pages |
| Shared core/ | Pattern detection and data fetching reused |
| Keep extension separate | Chrome extensions have own build requirements |
| No TypeScript (yet) | Incremental improvement, can add later |

## State
- Done:
  - [x] Initial project onboarding
  - [x] Code analysis and duplication identification
  - [x] User confirmed Vite approach
  - [x] Install Vite and configure vite.config.js
  - [x] Create src/core/patterns/detector.js (700+ lines)
  - [x] Create src/core/patterns/indicators.js (RSI, BB, EMA, MACD)
  - [x] Create src/core/data/yahoo.js (CORS proxy, data fetching)
  - [x] Create src/core/utils/constants.js, formatting.js
  - [x] Create src/dashboard/ (index.html, main.js, styles.css)
  - [x] Create src/spy-options/ (index.html, main.js, styles.css)
  - [x] Test build with `npm run build` - SUCCESS!
  - [x] **SPY Options Dashboard Enhancements:**
    - [x] Options Greeks display (Delta, Gamma, Theta, Vega)
    - [x] Signal integration from pattern detector
    - [x] P&L calculator modal
    - [x] Visual heatmap for volume/OI
    - [x] Quick expiry selectors (0DTE, 1DTE, Weekly, Monthly)
- Now: [→] Ready for use / Testing
- Next: Extension integration (optional)
- Remaining:
  - [ ] Update extension to import from shared core (optional)
  - [ ] Remove old docs/*.js files after confirming new build works

## Refactoring Plan

### Phase 1: Vite Setup
1. Install Vite as dev dependency
2. Create vite.config.js for multi-page app
3. Create src/ directory structure
4. Configure build to output to dist/

### Phase 2: Extract Core Modules
1. Create `src/core/patterns/detector.js` from docs/patterns.js
2. Create `src/core/patterns/indicators.js` (RSI, BB, EMA, MACD)
3. Create `src/core/data/yahoo.js` from CORS proxy logic
4. Create `src/core/utils/` for shared helpers

### Phase 3: Migrate Dashboard
1. Move docs/index.html → src/dashboard/index.html
2. Split docs/app.js → Dashboard.js (UI) + imports from core/
3. Create src/dashboard/main.js entry point

### Phase 4: Migrate SPY Options
1. Move docs/spy-options.html → src/spy-options/index.html
2. Split docs/spy-options.js → SPYOptionsAnalyzer.js + imports
3. Create src/spy-options/main.js entry point

### Phase 5: Extension Integration
1. Keep extension in put-reminder-extension/
2. Bundle core modules for extension use
3. Update extension build process

## Open Questions
- CONFIRMED: User wants Vite bundler approach
- UNCONFIRMED: Should we add TypeScript in a later phase?
- UNCONFIRMED: Should dist/ be committed or built in CI?

## Working Set
- **Branch:** `claude/nvda-options-analysis-5H0Ee`
- **Build command:** `npm run dev` (after Vite setup)
- **Key files to create:**
  - `vite.config.js`
  - `src/core/patterns/detector.js`
  - `src/core/data/yahoo.js`
  - `src/dashboard/main.js`
  - `src/spy-options/main.js`

## Agent Reports

### onboard (2026-01-01T22:03:59.256Z)
- Task: 
- Summary: 
- Output: `.claude/cache/agents/onboard/latest-output.md`

