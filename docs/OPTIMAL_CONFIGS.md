# Optimal Strategy Configurations

Generated: 2026-01-04

## Summary

| Strategy | Best Period | Timeframe | Win Rate | Return | Profit Factor |
|----------|-------------|-----------|----------|--------|---------------|
| **OI-Scalp** | 1 Month | 15m | 65.6% | 3.93% | 2.40 |
| **OI-Hybrid** | 2 Months | 15m | 51.7% | 4.75% | 1.25 |
| **OI-Trend** | 1 Month | 15m | 56.7% | 2.32% | 1.53 |

## OI-Scalp (Mean Reversion) - RECOMMENDED

Best for: Range-bound markets, short-term scalping

**Optimal Configuration:**
```javascript
{
  timeframe: 15,          // 15-minute candles
  waspPeriod: 5,          // Short SMA for quick signals
  entryDeviation: 0.0015, // 0.15% deviation from WASP
  targetPct: 0.0015,      // 0.15% profit target
  stopPct: 0.002,         // 0.20% stop loss
}
```

**Performance (1 Month):**
- Trades: 32
- Win Rate: 65.6%
- Total Return: 3.93%
- Profit Factor: 2.40
- Max Drawdown: 1.1%

**With 10x Leverage:** ~39% monthly return

**Alternative Configs (All 1 Month, 15m):**
| WASP | Entry Dev | Target | Stop | Trades | Win% | Return | PF |
|------|-----------|--------|------|--------|------|--------|-----|
| 5 | 0.15% | 0.15% | 0.20% | 32 | 65.6% | 3.93% | 2.40 |
| 8 | 0.05% | 0.15% | 0.20% | 54 | 66.7% | 5.03% | 2.05 |
| 12 | 0.15% | 0.15% | 0.20% | 45 | 66.7% | 4.49% | 2.10 |
| 10 | 0.10% | 0.15% | 0.20% | 45 | 64.4% | 4.21% | 1.97 |

---

## OI-Hybrid (Adaptive) - FOR VOLATILE MARKETS

Best for: Markets switching between trending and range-bound

**Optimal Configuration:**
```javascript
{
  timeframe: 15,           // 15-minute candles
  waspPeriod: 12,          // Medium SMA
  entryDeviation: 0.0015,  // 0.15% deviation
  adxPeriod: 14,           // Standard ADX period
  adxThreshold: 20,        // Low threshold for regime detection
}
```

**Performance (2 Months):**
- Trades: 143
- Win Rate: 51.7%
- Total Return: 4.75%
- Profit Factor: 1.25
- Max Drawdown: 2.9%

**Note:** Higher trade frequency but lower win rate. Adapts to market conditions.

---

## OI-Trend (Trend Following)

Best for: Strong trending markets

**Optimal Configuration:**
```javascript
{
  timeframe: 15,           // 15-minute candles
  waspPeriod: 20,          // Long SMA for trend
  trendThreshold: 0.001,   // 0.1% trend confirmation
  targetPct: 0.003,        // 0.3% profit target
  stopPct: 0.002,          // 0.2% stop loss
}
```

**Performance (1 Month):**
- Trades: 30
- Win Rate: 56.7%
- Total Return: 2.32%
- Profit Factor: 1.53
- Max Drawdown: 1.2%

---

## Key Insights

### 1. Timeframe: 15m Wins

All strategies perform better on 15-minute candles vs 5-minute:
- Less noise, cleaner signals
- More reliable mean reversion
- Better trend identification

### 2. Conservative Parameters Work

- Smaller entry deviations (0.1-0.15%) beat larger ones
- Tight targets (0.15%) with slightly wider stops (0.20%) optimal
- Risk:Reward of ~1:1.3 works better than 1:2

### 3. Period Sensitivity

- **OI-Scalp:** Works best in recent month (mean reversion)
- **OI-Hybrid:** Needs 2 months for regime adaptation
- **OI-Trend:** Only works in trending periods

### 4. Leverage Recommendations

| Strategy | Base Return | Recommended Leverage | Leveraged Return |
|----------|-------------|---------------------|------------------|
| OI-Scalp | 3.93%/month | 10x | ~39%/month |
| OI-Hybrid | 4.75%/2mo | 8x | ~38%/2mo |
| OI-Trend | 2.32%/month | 5x | ~11.6%/month |

---

## UI Preset Values

For the backtest page preset buttons:

### "15m Scalp" Button
```javascript
{
  timeframe: 15,
  source: 'oi',
  waspPeriod: 5,
  entryDeviation: 0.15,
  targetPct: 0.15,
  stopPct: 0.20,
  leverage: 10,
  period: 30, // 1 month
}
```

### "15m Hybrid" Button
```javascript
{
  timeframe: 15,
  source: 'oi-hybrid',
  waspPeriod: 12,
  entryDeviation: 0.15,
  adxPeriod: 14,
  adxThreshold: 20,
  leverage: 8,
  period: 60, // 2 months
}
```

### "15m Trend" Button
```javascript
{
  timeframe: 15,
  source: 'oi-trend',
  waspPeriod: 20,
  trendThreshold: 0.10,
  targetPct: 0.30,
  stopPct: 0.20,
  leverage: 5,
  period: 30, // 1 month
}
```
