/**
 * Balanced Pattern Recognition Library
 * Detects both PUT (bearish) and CALL (bullish) trading opportunities
 */

class PutPatternDetector {
  constructor(config = {}) {
    this.config = {
      rejectionThreshold: 0.003, // 0.3% wick rejection
      consolidationBars: 3, // Min bars for consolidation
      lowerHighTolerance: 0.001, // 0.1% tolerance for lower high
      higherLowTolerance: 0.001, // 0.1% tolerance for higher low
      falseBreakoutThreshold: 0.002, // 0.2% for false breakout
      ...config
    };
    this.patterns = [];
    this.putPatterns = [];
    this.callPatterns = [];
  }

  /**
   * Analyze candle data and detect both PUT and CALL patterns
   * @param {Array} candles - Array of {open, high, low, close, time}
   * @returns {Array} Detected patterns with signals
   */
  analyze(candles) {
    if (!candles || candles.length < 10) return [];

    this.patterns = [];
    this.putPatterns = [];
    this.callPatterns = [];

    // Run all pattern detectors for both directions
    this.detectLowerHigh(candles);      // PUT signal
    this.detectHigherLow(candles);       // CALL signal
    this.detectRejectionAtResistance(candles);  // PUT signal
    this.detectRejectionAtSupport(candles);     // CALL signal
    this.detectFalseBreakoutUp(candles);        // PUT signal
    this.detectFalseBreakoutDown(candles);      // CALL signal
    this.detectAbsorptionSelling(candles);      // PUT signal
    this.detectAbsorptionBuying(candles);       // CALL signal
    this.detectDoubleRejectionTop(candles);     // PUT signal
    this.detectDoubleRejectionBottom(candles);  // CALL signal
    this.detectPriceStallingHigh(candles);      // PUT signal
    this.detectPriceStallingLow(candles);       // CALL signal

    return this.patterns;
  }

  // ==================== PUT PATTERNS ====================

  /**
   * Detect Lower High pattern (bearish)
   */
  detectLowerHigh(candles) {
    const swingHighs = this.findSwingHighs(candles, 5);

    for (let i = 1; i < swingHighs.length; i++) {
      const prevHigh = swingHighs[i - 1];
      const currHigh = swingHighs[i];

      if (currHigh.high < prevHigh.high * (1 - this.config.lowerHighTolerance)) {
        const pattern = {
          type: 'LOWER_HIGH',
          name: 'Lower High',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: currHigh.index,
          price: currHigh.high,
          description: 'Price forms lower high - weakening upward momentum',
          stopLoss: prevHigh.high,
          entry: currHigh.close
        };
        this.patterns.push(pattern);
        this.putPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect rejection at resistance zones (bearish)
   */
  detectRejectionAtResistance(candles) {
    const resistanceLevels = this.findResistanceLevels(candles);

    for (let i = 5; i < candles.length; i++) {
      const candle = candles[i];
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const totalRange = candle.high - candle.low;

      if (totalRange === 0) continue;

      const wickRatio = upperWick / totalRange;

      for (const resistance of resistanceLevels) {
        if (candle.high >= resistance * 0.998 &&
            candle.high <= resistance * 1.002 &&
            wickRatio > 0.6) {
          const pattern = {
            type: 'REJECTION_AT_RESISTANCE',
            name: 'Rejection at Resistance',
            signal: 'PUT',
            strength: 'HIGH',
            index: i,
            price: candle.high,
            description: 'Price rejected at resistance level',
            stopLoss: candle.high * 1.002,
            entry: candle.close
          };
          this.patterns.push(pattern);
          this.putPatterns.push(pattern);
        }
      }
    }
  }

  /**
   * Detect false breakout upward (bearish)
   */
  detectFalseBreakoutUp(candles) {
    const resistanceLevels = this.findResistanceLevels(candles);

    for (let i = 5; i < candles.length - 1; i++) {
      const candle = candles[i];
      const nextCandle = candles[i + 1];

      for (const resistance of resistanceLevels) {
        if (candle.high > resistance * 1.002) {
          if (candle.close < resistance ||
              (nextCandle && nextCandle.close < nextCandle.open &&
               nextCandle.close < resistance)) {
            const pattern = {
              type: 'FALSE_BREAKOUT',
              name: 'False Breakout Up',
              signal: 'PUT',
              strength: 'HIGH',
              index: i,
              price: candle.high,
              description: 'Failed upward breakout - price reverses down',
              stopLoss: candle.high * 1.003,
              entry: nextCandle ? nextCandle.open : candle.close
            };
            this.patterns.push(pattern);
            this.putPatterns.push(pattern);
          }
        }
      }
    }
  }

  /**
   * Detect absorption selling pressure (bearish)
   */
  detectAbsorptionSelling(candles) {
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

      if (absorptionCount >= 2) {
        const candle = candles[i];
        const pattern = {
          type: 'ABSORPTION',
          name: 'Selling Absorption',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candle.high,
          description: 'Multiple upper wicks show selling pressure',
          stopLoss: Math.max(...recentCandles.map(c => c.high)) * 1.002,
          entry: candle.close
        };
        this.patterns.push(pattern);
        this.putPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect double rejection at top (bearish)
   */
  detectDoubleRejectionTop(candles) {
    const rejections = [];

    for (let i = 2; i < candles.length; i++) {
      const candle = candles[i];
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const totalRange = candle.high - candle.low;

      if (totalRange > 0 && upperWick / totalRange > 0.5) {
        rejections.push({ index: i, high: candle.high, close: candle.close });
      }
    }

    for (let i = 1; i < rejections.length; i++) {
      const prev = rejections[i - 1];
      const curr = rejections[i];
      const priceDiff = Math.abs(curr.high - prev.high) / prev.high;

      if (priceDiff < 0.005 && curr.index - prev.index < 20) {
        const pattern = {
          type: 'DOUBLE_REJECTION',
          name: 'Double Top Rejection',
          signal: 'PUT',
          strength: 'VERY_HIGH',
          index: curr.index,
          price: curr.high,
          description: 'Price rejected twice at similar level - strong bearish',
          stopLoss: Math.max(prev.high, curr.high) * 1.002,
          entry: curr.close
        };
        this.patterns.push(pattern);
        this.putPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect price stalling at highs (bearish)
   */
  detectPriceStallingHigh(candles) {
    for (let i = this.config.consolidationBars; i < candles.length; i++) {
      const recentCandles = candles.slice(i - this.config.consolidationBars, i + 1);
      const highs = recentCandles.map(c => c.high);
      const lows = recentCandles.map(c => c.low);

      const highestHigh = Math.max(...highs);
      const lowestLow = Math.min(...lows);
      const avgClose = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;

      const rangePercent = (highestHigh - lowestLow) / avgClose;
      const lookback = Math.min(50, candles.length);
      const recentHighest = Math.max(...candles.slice(Math.max(0, i - lookback), i).map(c => c.high));

      if (rangePercent < 0.01 && highestHigh > recentHighest * 0.995) {
        const pattern = {
          type: 'PRICE_STALLING',
          name: 'Stalling at High',
          signal: 'PUT',
          strength: 'MEDIUM',
          index: i,
          price: candles[i].close,
          description: 'Price stalling at highs - may reverse down',
          stopLoss: highestHigh * 1.003,
          entry: lowestLow
        };
        this.patterns.push(pattern);
        this.putPatterns.push(pattern);
      }
    }
  }

  // ==================== CALL PATTERNS ====================

  /**
   * Detect Higher Low pattern (bullish)
   */
  detectHigherLow(candles) {
    const swingLows = this.findSwingLows(candles, 5);

    for (let i = 1; i < swingLows.length; i++) {
      const prevLow = swingLows[i - 1];
      const currLow = swingLows[i];

      if (currLow.low > prevLow.low * (1 + this.config.higherLowTolerance)) {
        const pattern = {
          type: 'HIGHER_LOW',
          name: 'Higher Low',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: currLow.index,
          price: currLow.low,
          description: 'Price forms higher low - strengthening upward momentum',
          stopLoss: prevLow.low,
          entry: currLow.close
        };
        this.patterns.push(pattern);
        this.callPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect rejection at support zones (bullish)
   */
  detectRejectionAtSupport(candles) {
    const supportLevels = this.findSupportLevels(candles);

    for (let i = 5; i < candles.length; i++) {
      const candle = candles[i];
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const totalRange = candle.high - candle.low;

      if (totalRange === 0) continue;

      const wickRatio = lowerWick / totalRange;

      for (const support of supportLevels) {
        if (candle.low <= support * 1.002 &&
            candle.low >= support * 0.998 &&
            wickRatio > 0.6) {
          const pattern = {
            type: 'REJECTION_AT_SUPPORT',
            name: 'Rejection at Support',
            signal: 'CALL',
            strength: 'HIGH',
            index: i,
            price: candle.low,
            description: 'Price rejected at support level - bullish bounce',
            stopLoss: candle.low * 0.998,
            entry: candle.close
          };
          this.patterns.push(pattern);
          this.callPatterns.push(pattern);
        }
      }
    }
  }

  /**
   * Detect false breakout downward (bullish)
   */
  detectFalseBreakoutDown(candles) {
    const supportLevels = this.findSupportLevels(candles);

    for (let i = 5; i < candles.length - 1; i++) {
      const candle = candles[i];
      const nextCandle = candles[i + 1];

      for (const support of supportLevels) {
        if (candle.low < support * 0.998) {
          if (candle.close > support ||
              (nextCandle && nextCandle.close > nextCandle.open &&
               nextCandle.close > support)) {
            const pattern = {
              type: 'FALSE_BREAKOUT_DOWN',
              name: 'False Breakout Down',
              signal: 'CALL',
              strength: 'HIGH',
              index: i,
              price: candle.low,
              description: 'Failed downward breakout - price reverses up',
              stopLoss: candle.low * 0.997,
              entry: nextCandle ? nextCandle.open : candle.close
            };
            this.patterns.push(pattern);
            this.callPatterns.push(pattern);
          }
        }
      }
    }
  }

  /**
   * Detect absorption buying pressure (bullish)
   */
  detectAbsorptionBuying(candles) {
    for (let i = 3; i < candles.length; i++) {
      const recentCandles = candles.slice(i - 3, i + 1);
      let absorptionCount = 0;

      for (const candle of recentCandles) {
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        const totalRange = candle.high - candle.low;

        if (totalRange > 0 && lowerWick / totalRange > 0.5) {
          absorptionCount++;
        }
      }

      if (absorptionCount >= 2) {
        const candle = candles[i];
        const pattern = {
          type: 'ABSORPTION_BUYING',
          name: 'Buying Absorption',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: i,
          price: candle.low,
          description: 'Multiple lower wicks show buying pressure',
          stopLoss: Math.min(...recentCandles.map(c => c.low)) * 0.998,
          entry: candle.close
        };
        this.patterns.push(pattern);
        this.callPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect double rejection at bottom (bullish)
   */
  detectDoubleRejectionBottom(candles) {
    const rejections = [];

    for (let i = 2; i < candles.length; i++) {
      const candle = candles[i];
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const totalRange = candle.high - candle.low;

      if (totalRange > 0 && lowerWick / totalRange > 0.5) {
        rejections.push({ index: i, low: candle.low, close: candle.close });
      }
    }

    for (let i = 1; i < rejections.length; i++) {
      const prev = rejections[i - 1];
      const curr = rejections[i];
      const priceDiff = Math.abs(curr.low - prev.low) / prev.low;

      if (priceDiff < 0.005 && curr.index - prev.index < 20) {
        const pattern = {
          type: 'DOUBLE_REJECTION_BOTTOM',
          name: 'Double Bottom Rejection',
          signal: 'CALL',
          strength: 'VERY_HIGH',
          index: curr.index,
          price: curr.low,
          description: 'Price rejected twice at similar low - strong bullish',
          stopLoss: Math.min(prev.low, curr.low) * 0.998,
          entry: curr.close
        };
        this.patterns.push(pattern);
        this.callPatterns.push(pattern);
      }
    }
  }

  /**
   * Detect price stalling at lows (bullish)
   */
  detectPriceStallingLow(candles) {
    for (let i = this.config.consolidationBars; i < candles.length; i++) {
      const recentCandles = candles.slice(i - this.config.consolidationBars, i + 1);
      const highs = recentCandles.map(c => c.high);
      const lows = recentCandles.map(c => c.low);

      const highestHigh = Math.max(...highs);
      const lowestLow = Math.min(...lows);
      const avgClose = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;

      const rangePercent = (highestHigh - lowestLow) / avgClose;
      const lookback = Math.min(50, candles.length);
      const recentLowest = Math.min(...candles.slice(Math.max(0, i - lookback), i).map(c => c.low));

      if (rangePercent < 0.01 && lowestLow < recentLowest * 1.005) {
        const pattern = {
          type: 'PRICE_STALLING_LOW',
          name: 'Stalling at Low',
          signal: 'CALL',
          strength: 'MEDIUM',
          index: i,
          price: candles[i].close,
          description: 'Price stalling at lows - may reverse up',
          stopLoss: lowestLow * 0.997,
          entry: highestHigh
        };
        this.patterns.push(pattern);
        this.callPatterns.push(pattern);
      }
    }
  }

  // ==================== HELPER FUNCTIONS ====================

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

  findSwingLows(candles, lookback = 5) {
    const swingLows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const candle = candles[i];
      let isSwingLow = true;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && candles[j].low <= candle.low) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          low: candle.low,
          close: candle.close,
          time: candle.time
        });
      }
    }

    return swingLows;
  }

  findResistanceLevels(candles) {
    const levels = [];
    const swingHighs = this.findSwingHighs(candles, 3);

    for (const sh of swingHighs) {
      let foundCluster = false;

      for (let i = 0; i < levels.length; i++) {
        if (Math.abs(sh.high - levels[i]) / levels[i] < 0.003) {
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

  findSupportLevels(candles) {
    const levels = [];
    const swingLows = this.findSwingLows(candles, 3);

    for (const sl of swingLows) {
      let foundCluster = false;

      for (let i = 0; i < levels.length; i++) {
        if (Math.abs(sl.low - levels[i]) / levels[i] < 0.003) {
          levels[i] = (levels[i] + sl.low) / 2;
          foundCluster = true;
          break;
        }
      }

      if (!foundCluster) {
        levels.push(sl.low);
      }
    }

    return levels;
  }

  /**
   * Get signal summary - determines PUT or CALL based on pattern weights
   */
  getSignalSummary() {
    if (this.patterns.length === 0) {
      return {
        signal: 'NONE',
        strength: 0,
        patterns: [],
        direction: 'NEUTRAL'
      };
    }

    const strengthWeights = {
      'VERY_HIGH': 4,
      'HIGH': 3,
      'MEDIUM': 2,
      'LOW': 1
    };

    // Calculate PUT weight
    let putWeight = 0;
    for (const pattern of this.putPatterns) {
      putWeight += strengthWeights[pattern.strength] || 1;
    }

    // Calculate CALL weight
    let callWeight = 0;
    for (const pattern of this.callPatterns) {
      callWeight += strengthWeights[pattern.strength] || 1;
    }

    // Determine direction based on weight difference
    const totalWeight = putWeight + callWeight;
    const netWeight = putWeight - callWeight;

    let signal, direction;
    if (Math.abs(netWeight) < 1) {
      // Weights are roughly equal - no clear signal
      signal = 'NEUTRAL';
      direction = 'NEUTRAL';
    } else if (netWeight > 0) {
      // More PUT patterns
      signal = putWeight > 6 ? 'STRONG_PUT' : 'PUT';
      direction = 'PUT';
    } else {
      // More CALL patterns
      signal = callWeight > 6 ? 'STRONG_CALL' : 'CALL';
      direction = 'CALL';
    }

    // Calculate strength based on dominant direction
    const dominantWeight = Math.max(putWeight, callWeight);
    const patternCount = direction === 'PUT' ? this.putPatterns.length :
                         direction === 'CALL' ? this.callPatterns.length :
                         this.patterns.length;

    // Strength is based on weight and how much it dominates the opposite direction
    const dominanceRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0;
    const baseStrength = patternCount > 0 ? (dominantWeight / patternCount) * 25 : 0;
    const normalizedStrength = Math.min(100, baseStrength * dominanceRatio * 2);

    return {
      signal: signal,
      strength: normalizedStrength,
      patterns: this.patterns,
      direction: direction,
      putWeight: putWeight,
      callWeight: callWeight,
      recommendation: this.getRecommendation(normalizedStrength, direction)
    };
  }

  getRecommendation(strength, direction) {
    if (direction === 'NEUTRAL') {
      return 'No clear direction - wait for stronger signal.';
    }

    const dirLabel = direction === 'PUT' ? 'short/PUT' : 'long/CALL';

    if (strength >= 75) {
      return `Strong ${dirLabel} signal! Consider entry.`;
    } else if (strength >= 50) {
      return `Clear ${dirLabel} signal - consider position.`;
    } else if (strength >= 25) {
      return `Weak ${dirLabel} signal - wait for confirmation.`;
    }
    return 'Signal too weak - continue monitoring.';
  }
}

// Export for use in content script
if (typeof window !== 'undefined') {
  window.PutPatternDetector = PutPatternDetector;
}
