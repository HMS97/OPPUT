# Handoff: OI-WASP Strategy Comparison

## Goal
Implement and backtest 3 different OI-WASP strategies to find the best performer.

## Strategies to Implement

### Strategy 1: Pure Scalping (5m Only)
**File:** `src/core/backtest/strategies/oi-scalping.js`
- Timeframe: 5m only
- Entry: 0.2% deviation from WASP
- Exit: Butterfly spread (1 day hold)
- Expected: High frequency, small wins

### Strategy 2: Trend-Following (1H/4H)
**File:** `src/core/backtest/strategies/oi-trend.js`
- Timeframe: 1H or 4H
- Entry: When price crosses WASP with momentum confirmation
- Direction: Trade WITH the trend (not mean reversion)
  - Price > WASP + 0.5% AND rising → CALL (trend continuation)
  - Price < WASP - 0.5% AND falling → PUT (trend continuation)
- Exit: Trailing stop or opposite WASP cross
- Expected: Lower frequency, larger moves

### Strategy 3: Multi-Timeframe (4H Direction + 5m Entry)
**File:** `src/core/backtest/strategies/oi-multi-tf.js`
- Higher TF (4H): Determine bias
  - Price > WASP → Bullish bias (only take CALLs)
  - Price < WASP → Bearish bias (only take PUTs)
- Lower TF (5m): Entry timing
  - Wait for 5m mean-reversion signal IN direction of 4H bias
- Exit: Butterfly spread
- Expected: Filtered signals, higher win rate

## Implementation Steps

### Phase 1: Create Strategy Files
1. Create `oi-scalping.js` - wrap existing OISignalSource with 5m lock
2. Create `oi-trend.js` - new trend-following logic
3. Create `oi-multi-tf.js` - dual timeframe with bias filter

### Phase 2: Add to Backtest UI
1. Update signal source tabs to include new strategies
2. Add config options for each strategy
3. Wire up to BacktestEngine

### Phase 3: Run Comparison Backtest
1. Same date range for all 3 (e.g., last 3 months)
2. Same starting capital ($10,000)
3. Collect metrics:
   - Total return %
   - Win rate
   - Max drawdown
   - Sharpe ratio
   - Trade count
   - Avg trade duration

### Phase 4: Analysis
1. Create comparison table in results
2. Identify best strategy per metric
3. Recommend overall winner

## Code Snippets

### Trend-Following Signal Logic
```javascript
// In oi-trend.js
analyze(candles, index) {
  const price = candles[index].close
  const prevPrice = candles[index - 1].close
  const wasp = this.getWASP(candles, index)

  const deviation = (price - wasp) / wasp * 100
  const momentum = price > prevPrice ? 1 : -1

  // Trend continuation signals (opposite of mean reversion)
  if (deviation > 0.5 && momentum > 0) {
    return { type: 'CALL', direction: 'CALL', ... }  // Bullish trend
  }
  if (deviation < -0.5 && momentum < 0) {
    return { type: 'PUT', direction: 'PUT', ... }  // Bearish trend
  }
  return null
}
```

### Multi-Timeframe Bias Logic
```javascript
// In oi-multi-tf.js
async loadData(symbol, startDate, endDate) {
  // Load 4H candles for bias
  this.biasCandles = await fetchCandleData(symbol, 240, { startDate, endDate })
  // Load 5m candles for entries
  this.entryCandles = await fetchCandleData(symbol, 5, { startDate, endDate })
}

getBias(timestamp) {
  const biasCandle = this.findCandleForTime(this.biasCandles, timestamp)
  const wasp4H = this.calculateWASP(this.biasCandles, biasCandle.index)
  return biasCandle.close > wasp4H ? 'BULLISH' : 'BEARISH'
}

analyze(candles, index) {
  const bias = this.getBias(candles[index].time)
  const signal = this.getMeanReversionSignal(candles, index)  // 5m signal

  // Only take signals aligned with 4H bias
  if (signal && signal.direction === 'CALL' && bias === 'BULLISH') return signal
  if (signal && signal.direction === 'PUT' && bias === 'BEARISH') return signal
  return null
}
```

## Files to Modify
- `src/core/backtest/index.js` - Export new strategies
- `src/backtest/main.js` - Add UI tabs and config
- `src/backtest/index.html` - Add strategy selection buttons

## Current State
- OI-WASP scalping (5m) is working
- Timeframe scaling added but may not be optimal
- Need to implement trend and multi-TF strategies

## Testing Commands
```bash
npm run dev   # Start dev server
# Open http://localhost:5173/backtest/
# Select each strategy tab and run backtest
# Compare results
```

## Success Criteria
- All 3 strategies runnable from UI
- Comparison table showing key metrics
- Clear winner identified with reasoning
