# SPY Options Dashboard Enhancement Plan

## Goal
Enhance the existing SPY Options page into a comprehensive trading dashboard that integrates signal detection with options analysis.

## Current State
- Basic options chain display (Strike, Last, Bid, Ask, Volume, OI, IV)
- Expiration selector
- ATM/ITM/OTM highlighting
- 244 lines of code

## Target State
A full-featured options dashboard with:
1. Options Greeks (Delta, Gamma, Theta, Vega)
2. Signal integration from pattern detector
3. P&L calculator for position sizing
4. Visual heatmap for volume/OI distribution
5. Quick expiry selectors (0DTE, 1DTE, Weekly)

---

## Implementation Phases

### Phase 1: Add Options Greeks Display
**Files to modify:** `src/spy-options/main.js`, `src/spy-options/index.html`, `src/spy-options/styles.css`

**Changes:**
1. Update table headers to include Delta, Gamma, Theta, Vega columns
2. Parse Greek values from Yahoo Finance response (already returned in API)
3. Add toggle to show/hide Greeks for cleaner view
4. Format Greeks appropriately (Delta 0.XX, Theta -$X.XX, etc.)

**Yahoo API Returns:**
```javascript
// Each option object contains:
{
  strike, lastPrice, bid, ask, volume, openInterest, impliedVolatility,
  delta, gamma, theta, vega,  // <-- These are available!
  inTheMoney, contractSymbol
}
```

### Phase 2: Signal Integration
**Files to modify:** `src/spy-options/main.js`

**Changes:**
1. Import `PutPatternDetector` and `fetchCandleData` from core
2. Run pattern detection on SPY price data
3. Display current signal (PUT/CALL) with strength
4. Show recommended option type based on signal direction
5. Highlight options that align with current signal

**Integration Points:**
```javascript
import { PutPatternDetector, fetchCandleData } from '@core'

// Get signal
const detector = new PutPatternDetector(candles, sensitivity)
const analysis = detector.analyze()
// analysis.overallSignal = 'PUT' | 'CALL' | 'NEUTRAL'
// analysis.putStrength, analysis.callStrength (0-100)
```

### Phase 3: P&L Calculator
**Files to modify:** `src/spy-options/main.js`, `src/spy-options/index.html`, `src/spy-options/styles.css`

**Changes:**
1. Add "Calculate P&L" button on each option row
2. Create modal with P&L calculator:
   - Entry price (auto-filled from current ask for buys)
   - Number of contracts
   - Target price scenarios (+1%, +2%, +3% move in underlying)
3. Calculate max profit/loss
4. Show breakeven price

**Calculations:**
```javascript
// For a call option:
// Breakeven = Strike + Premium
// Profit at expiry = max(0, Stock Price - Strike) - Premium

// For a put option:
// Breakeven = Strike - Premium
// Profit at expiry = max(0, Strike - Stock Price) - Premium
```

### Phase 4: Visual Heatmap
**Files to modify:** `src/spy-options/main.js`, `src/spy-options/styles.css`

**Changes:**
1. Add heatmap view toggle
2. Color-code cells based on volume/OI intensity
3. Highlight unusual activity (volume > 3x avg OI)
4. Add gradient scale legend

**Visual Design:**
- Low activity: Cool colors (blue/purple)
- High activity: Warm colors (orange/red)
- Unusual spikes: Highlighted with glow effect

### Phase 5: Quick Expiry Selectors
**Files to modify:** `src/spy-options/index.html`, `src/spy-options/main.js`

**Changes:**
1. Add quick-select buttons: 0DTE, 1DTE, Weekly, Monthly
2. Calculate which expiry corresponds to each
3. Auto-select on button click
4. Highlight active selection

---

## File Changes Summary

### `src/spy-options/index.html`
- Add Greeks toggle checkbox
- Add P&L calculator modal
- Add quick expiry buttons
- Add signal display panel
- Add heatmap toggle

### `src/spy-options/main.js`
- Add Greeks parsing and display
- Add signal integration
- Add P&L calculation logic
- Add heatmap rendering
- Add quick expiry logic

### `src/spy-options/styles.css`
- Style Greeks columns
- Style P&L modal
- Style heatmap colors
- Style signal panel
- Style quick expiry buttons

---

## Test Plan
1. Verify Greeks display correctly for all options
2. Verify signal detection matches dashboard
3. Test P&L calculator with known values
4. Verify heatmap colors reflect actual volume
5. Test quick expiry selectors across different dates

## Dependencies
- Uses existing `@core` modules (no new dependencies)
- Yahoo Finance API already returns Greeks

## Estimated LOC Change
- Current: ~244 lines
- After: ~600-700 lines
