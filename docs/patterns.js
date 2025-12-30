/**
 * PUT Pattern Recognition Library
 * Detects short/put trading opportunities based on price action patterns
 */

class PutPatternDetector {
  constructor(config = {}) {
    this.config = {
      rejectionThreshold: 0.003, // 0.3% wick rejection
      consolidationBars: 3, // Min bars for consolidation
      lowerHighTolerance: 0.001, // 0.1% tolerance for lower high
      falseBreakoutThreshold: 0.002, // 0.2% for false breakout
      ...config
    };
    this.patterns = [];
  }

  /**
   * Analyze candle data and detect PUT patterns
   * @param {Array} candles - Array of {open, high, low, close, time}
   * @returns {Array} Detected patterns with signals
   */
  analyze(candles) {
    if (!candles || candles.length < 10) return [];

    this.patterns = [];

    // Run all pattern detectors
    this.detectLowerHigh(candles);
    this.detectRejectionAtResistance(candles);
    this.detectFalseBreakout(candles);
    this.detectAbsorption(candles);
    this.detectDoubleRejection(candles);
    this.detectPriceStalling(candles);

    return this.patterns;
  }

  /**
   * Detect Lower High pattern (后面有了跟进 Lower High)
   * Price makes a high, then makes a lower high
   */
  detectLowerHigh(candles) {
    const swingHighs = this.findSwingHighs(candles, 5);

    for (let i = 1; i < swingHighs.length; i++) {
      const prevHigh = swingHighs[i - 1];
      const currHigh = swingHighs[i];

      // Check if current high is lower than previous
      if (currHigh.high < prevHigh.high * (1 - this.config.lowerHighTolerance)) {
        this.patterns.push({
          type: 'LOWER_HIGH',
          name: 'Lower High (跟进)',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: currHigh.index,
          price: currHigh.high,
          description: '价格形成更低的高点，显示上涨动能减弱',
          stopLoss: prevHigh.high,
          entry: currHigh.close
        });
      }
    }
  }

  /**
   * Detect rejection at resistance zones
   * (在价格行为上立即被拒绝)
   */
  detectRejectionAtResistance(candles) {
    const resistanceLevels = this.findResistanceLevels(candles);

    for (let i = 5; i < candles.length; i++) {
      const candle = candles[i];
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const body = Math.abs(candle.close - candle.open);
      const totalRange = candle.high - candle.low;

      if (totalRange === 0) continue;

      // Check for rejection wick (upper wick > 60% of total range)
      const wickRatio = upperWick / totalRange;

      for (const resistance of resistanceLevels) {
        // If high touches resistance and has rejection wick
        if (candle.high >= resistance * 0.998 &&
            candle.high <= resistance * 1.002 &&
            wickRatio > 0.6) {
          this.patterns.push({
            type: 'REJECTION_AT_RESISTANCE',
            name: 'Rejection at Resistance (拒绝)',
            signal: 'PUT',
            strength: 'HIGH',
            index: i,
            price: candle.high,
            description: '价格触及阻力位后立即被拒绝',
            stopLoss: candle.high * 1.002,
            entry: candle.close
          });
        }
      }
    }
  }

  /**
   * Detect false breakout (假向上突破)
   * Price breaks above resistance then quickly reverses
   */
  detectFalseBreakout(candles) {
    const resistanceLevels = this.findResistanceLevels(candles);

    for (let i = 5; i < candles.length - 1; i++) {
      const candle = candles[i];
      const nextCandle = candles[i + 1];

      for (const resistance of resistanceLevels) {
        // Check if candle breaks above resistance
        if (candle.high > resistance * 1.002) {
          // Check if it closes back below or next candle reverses
          if (candle.close < resistance ||
              (nextCandle && nextCandle.close < nextCandle.open &&
               nextCandle.close < resistance)) {
            this.patterns.push({
              type: 'FALSE_BREAKOUT',
              name: 'False Breakout (假突破)',
              signal: 'PUT',
              strength: 'HIGH',
              index: i,
              price: candle.high,
              description: '价格假向上突破后立即回落，是做空的好机会',
              stopLoss: candle.high * 1.003,
              entry: nextCandle ? nextCandle.open : candle.close
            });
          }
        }
      }
    }
  }

  /**
   * Detect absorption pattern (蜡烛的影线向上延伸)
   * Long upper wicks showing selling pressure
   */
  detectAbsorption(candles) {
    for (let i = 3; i < candles.length; i++) {
      const recentCandles = candles.slice(i - 3, i + 1);
      let absorptionCount = 0;

      for (const candle of recentCandles) {
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const totalRange = candle.high - candle.low;

        if (totalRange > 0 && upperWick / totalRange > 0.5) {
          absorptionCount++;
        }
      }

      // Multiple candles with long upper wicks = absorption
      if (absorptionCount >= 2) {
        const candle = candles[i];
        this.patterns.push({
          type: 'ABSORPTION',
          name: 'Absorption (吸收)',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candle.high,
          description: '多根蜡烛上影线延伸，显示卖压吸收',
          stopLoss: Math.max(...recentCandles.map(c => c.high)) * 1.002,
          entry: candle.close
        });
      }
    }
  }

  /**
   * Detect double/multiple rejection (第一次拒绝, 第二次拒绝)
   * Price gets rejected multiple times at similar levels
   */
  detectDoubleRejection(candles) {
    const rejections = [];

    // Find all rejection points
    for (let i = 2; i < candles.length; i++) {
      const candle = candles[i];
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const totalRange = candle.high - candle.low;

      if (totalRange > 0 && upperWick / totalRange > 0.5) {
        rejections.push({
          index: i,
          high: candle.high,
          close: candle.close
        });
      }
    }

    // Find rejections at similar levels
    for (let i = 1; i < rejections.length; i++) {
      const prev = rejections[i - 1];
      const curr = rejections[i];

      // Check if highs are within 0.5% of each other
      const priceDiff = Math.abs(curr.high - prev.high) / prev.high;

      if (priceDiff < 0.005 && curr.index - prev.index < 20) {
        this.patterns.push({
          type: 'DOUBLE_REJECTION',
          name: 'Double Rejection (二次拒绝)',
          signal: 'PUT',
          strength: 'VERY_HIGH',
          index: curr.index,
          price: curr.high,
          description: '价格在相近水平被两次拒绝，强烈做空信号',
          stopLoss: Math.max(prev.high, curr.high) * 1.002,
          entry: curr.close
        });
      }
    }
  }

  /**
   * Detect price stalling at highs (价格在高位出现停滞)
   * Consolidation near highs before breakdown
   */
  detectPriceStalling(candles) {
    for (let i = this.config.consolidationBars; i < candles.length; i++) {
      const recentCandles = candles.slice(i - this.config.consolidationBars, i + 1);
      const highs = recentCandles.map(c => c.high);
      const lows = recentCandles.map(c => c.low);

      const highestHigh = Math.max(...highs);
      const lowestLow = Math.min(...lows);
      const avgClose = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;

      // Calculate range as percentage
      const rangePercent = (highestHigh - lowestLow) / avgClose;

      // Check if we're near recent highs and consolidating
      const lookback = Math.min(50, candles.length);
      const recentHighest = Math.max(...candles.slice(Math.max(0, i - lookback), i).map(c => c.high));

      // If range is tight (<1%) and near recent highs
      if (rangePercent < 0.01 && highestHigh > recentHighest * 0.995) {
        this.patterns.push({
          type: 'PRICE_STALLING',
          name: 'Price Stalling (高位停滞)',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candles[i].close,
          description: '价格在高位出现停滞，可能即将下跌',
          stopLoss: highestHigh * 1.003,
          entry: lowestLow
        });
      }
    }
  }

  /**
   * Find swing highs in candle data
   */
  findSwingHighs(candles, lookback = 5) {
    const swingHighs = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const candle = candles[i];
      let isSwingHigh = true;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].high >= candle.high) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          high: candle.high,
          close: candle.close,
          time: candle.time
        });
      }
    }

    return swingHighs;
  }

  /**
   * Find resistance levels from recent price action
   */
  findResistanceLevels(candles) {
    const levels = [];
    const swingHighs = this.findSwingHighs(candles, 3);

    // Cluster swing highs to find significant levels
    for (const sh of swingHighs) {
      let foundCluster = false;

      for (let i = 0; i < levels.length; i++) {
        if (Math.abs(sh.high - levels[i]) / levels[i] < 0.003) {
          // Average with existing level
          levels[i] = (levels[i] + sh.high) / 2;
          foundCluster = true;
          break;
        }
      }

      if (!foundCluster) {
        levels.push(sh.high);
      }
    }

    return levels;
  }

  /**
   * Get overall PUT signal strength
   * @returns {Object} Signal summary
   */
  getSignalSummary() {
    if (this.patterns.length === 0) {
      return {
        signal: 'NONE',
        strength: 0,
        patterns: []
      };
    }

    // Weight different pattern strengths
    const strengthWeights = {
      'VERY_HIGH': 4,
      'HIGH': 3,
      'MEDIUM': 2,
      'LOW': 1
    };

    let totalWeight = 0;
    for (const pattern of this.patterns) {
      totalWeight += strengthWeights[pattern.strength] || 1;
    }

    // Normalize to 0-100
    const normalizedStrength = Math.min(100, (totalWeight / this.patterns.length) * 25);

    return {
      signal: normalizedStrength > 50 ? 'STRONG_PUT' : 'PUT',
      strength: normalizedStrength,
      patterns: this.patterns,
      recommendation: this.getRecommendation(normalizedStrength)
    };
  }

  /**
   * Get trading recommendation
   */
  getRecommendation(strength) {
    if (strength >= 75) {
      return '强烈做空信号！建议立即考虑进场做空。';
    } else if (strength >= 50) {
      return '做空信号明确，可以考虑进场做空。';
    } else if (strength >= 25) {
      return '有做空迹象，建议继续观察确认。';
    }
    return '信号较弱，建议等待更好的机会。';
  }
}

// Export for use in content script
if (typeof window !== 'undefined') {
  window.PutPatternDetector = PutPatternDetector;
}
