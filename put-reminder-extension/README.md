# PUT Pattern Reminder - Browser Extension

A browser extension that recognizes PUT/Short trading patterns on TradingView and Binance charts and alerts you when to enter short positions.

## Features

- **Real-time Pattern Detection**: Monitors charts for short/put entry signals
- **Multiple Pattern Types**:
  - Lower High (跟进)
  - Rejection at Resistance (拒绝)
  - False Breakout (假突破)
  - Absorption (吸收)
  - Double Rejection (二次拒绝)
  - Price Stalling (高位停滞)
- **Desktop Notifications**: Get alerted when strong signals are detected
- **Floating Indicator**: On-chart indicator showing current signal strength
- **Customizable Settings**: Adjust sensitivity, refresh interval, and sound alerts

## Installation

### Chrome/Edge (Manual)

1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `put-reminder-extension` folder

### Firefox (Manual)

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file

## Usage

1. Navigate to TradingView or Binance
2. The floating indicator will appear on the chart
3. Click "Scan" to manually trigger a scan
4. Configure settings via the popup (click extension icon)

## Pattern Recognition

The extension detects the following patterns based on the trading strategy:

### Lower High (后面有了跟进 Lower High)
Price makes a high, then makes a lower high - indicates weakening upward momentum.

### Rejection at Resistance (在价格行为上立即被拒绝)
Price touches resistance and immediately gets rejected with a long upper wick.

### False Breakout (假向上突破)
Price breaks above resistance then quickly reverses back below - strong short signal.

### Absorption (蜡烛的影线向上延伸)
Multiple candles with long upper wicks showing selling pressure being absorbed.

### Double Rejection (第一次拒绝, 第二次拒绝)
Price gets rejected multiple times at similar levels - very strong short signal.

### Price Stalling (价格在高位出现停滞)
Price consolidates in a tight range near highs before potential breakdown.

## Settings

- **Alert Sensitivity**: Low/Medium/High - adjusts pattern detection thresholds
- **Sound Alert**: Enable/disable notification sounds
- **Auto Refresh**: 5s/10s/30s/1min - scan frequency

## Signal Strength

- **0-25%**: Weak signal - wait for confirmation
- **25-50%**: Moderate signal - consider entry
- **50-75%**: Strong signal - good entry opportunity
- **75-100%**: Very strong signal - high probability setup

## Development

```bash
# Clone the repository
git clone <repo-url>

# Load unpacked extension in Chrome
# Navigate to chrome://extensions/
# Enable Developer mode
# Click "Load unpacked" and select the put-reminder-extension folder
```

## License

MIT License
