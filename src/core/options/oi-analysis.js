/**
 * Options Open Interest Analysis Module
 * Calculates OI-WASP, Max Pain, GEX, and deviation signals
 * Based on academic research on options price pinning effects
 */

/**
 * Calculate Open Interest Weighted Average Strike Price (OI-WASP)
 * @param {Array} options - Array of options with strike and openInterest
 * @returns {{callWASP: number, putWASP: number, allWASP: number}}
 */
export function calculateOIWASP(calls, puts) {
  // Call WASP - resistance level
  let callNumerator = 0
  let callDenominator = 0
  for (const opt of calls) {
    const oi = opt.openInterest || 0
    callNumerator += opt.strike * oi
    callDenominator += oi
  }
  const callWASP = callDenominator > 0 ? callNumerator / callDenominator : 0

  // Put WASP - support level
  let putNumerator = 0
  let putDenominator = 0
  for (const opt of puts) {
    const oi = opt.openInterest || 0
    putNumerator += opt.strike * oi
    putDenominator += oi
  }
  const putWASP = putDenominator > 0 ? putNumerator / putDenominator : 0

  // Combined WASP - fair value estimate
  const allNumerator = callNumerator + putNumerator
  const allDenominator = callDenominator + putDenominator
  const allWASP = allDenominator > 0 ? allNumerator / allDenominator : 0

  return {
    callWASP: Math.round(callWASP * 100) / 100,
    putWASP: Math.round(putWASP * 100) / 100,
    allWASP: Math.round(allWASP * 100) / 100,
    totalCallOI: callDenominator,
    totalPutOI: putDenominator,
    putCallRatio: callDenominator > 0 ? putDenominator / callDenominator : 0,
  }
}

/**
 * Calculate Max Pain - strike where most options expire worthless
 * @param {Array} calls - Call options array
 * @param {Array} puts - Put options array
 * @returns {{maxPain: number, painByStrike: Object}}
 */
export function calculateMaxPain(calls, puts) {
  // Get all unique strikes
  const strikes = new Set([
    ...calls.map((c) => c.strike),
    ...puts.map((p) => p.strike),
  ])
  const sortedStrikes = [...strikes].sort((a, b) => a - b)

  // Build OI maps
  const callOI = {}
  const putOI = {}
  for (const c of calls) {
    callOI[c.strike] = c.openInterest || 0
  }
  for (const p of puts) {
    putOI[p.strike] = p.openInterest || 0
  }

  // Calculate pain at each strike
  const painByStrike = {}
  let minPain = Infinity
  let maxPainStrike = sortedStrikes[0]

  for (const targetStrike of sortedStrikes) {
    let totalPain = 0

    // For each strike, calculate how much options holders lose
    for (const strike of sortedStrikes) {
      const cOI = callOI[strike] || 0
      const pOI = putOI[strike] || 0

      // Call holders lose if strike < target (ITM calls)
      if (strike < targetStrike) {
        totalPain += (targetStrike - strike) * cOI * 100
      }

      // Put holders lose if strike > target (ITM puts)
      if (strike > targetStrike) {
        totalPain += (strike - targetStrike) * pOI * 100
      }
    }

    painByStrike[targetStrike] = totalPain

    if (totalPain < minPain) {
      minPain = totalPain
      maxPainStrike = targetStrike
    }
  }

  return {
    maxPain: maxPainStrike,
    painByStrike,
    totalPainAtMaxPain: minPain,
  }
}

/**
 * Calculate Gamma Exposure (GEX) profile
 * Positive GEX = low volatility/pinning, Negative GEX = high volatility
 * @param {Array} calls - Call options with gamma
 * @param {Array} puts - Put options with gamma
 * @param {number} spotPrice - Current spot price
 * @returns {{netGEX: number, gexByStrike: Object, gexFlipLevel: number}}
 */
export function calculateGEX(calls, puts, spotPrice) {
  const gexByStrike = {}
  let totalGEX = 0

  // Calculate GEX at each strike
  for (const call of calls) {
    const gamma = call.gamma || 0
    const oi = call.openInterest || 0
    // Calls: MMs are typically short, so positive gamma exposure
    const callGEX = gamma * oi * 100 * spotPrice
    gexByStrike[call.strike] = (gexByStrike[call.strike] || 0) + callGEX
    totalGEX += callGEX
  }

  for (const put of puts) {
    const gamma = put.gamma || 0
    const oi = put.openInterest || 0
    // Puts: MMs are typically short, negative gamma exposure
    const putGEX = gamma * oi * 100 * spotPrice * -1
    gexByStrike[put.strike] = (gexByStrike[put.strike] || 0) + putGEX
    totalGEX += putGEX
  }

  // Find GEX flip level (where cumulative GEX crosses zero)
  const strikes = Object.keys(gexByStrike)
    .map(Number)
    .sort((a, b) => a - b)
  let gexFlipLevel = spotPrice
  let cumulativeGEX = 0
  let prevCumGEX = 0

  for (let i = 0; i < strikes.length; i++) {
    prevCumGEX = cumulativeGEX
    cumulativeGEX += gexByStrike[strikes[i]]

    // Check for sign change
    if (prevCumGEX * cumulativeGEX < 0) {
      gexFlipLevel = strikes[i]
      break
    }
  }

  return {
    netGEX: Math.round(totalGEX),
    gexByStrike,
    gexFlipLevel,
    volRegime: totalGEX > 0 ? 'low_vol' : 'high_vol',
  }
}

/**
 * Calculate deviation metrics and generate entry signals
 * @param {number} spotPrice - Current spot price
 * @param {Object} wasp - OI-WASP results
 * @param {number} maxPain - Max pain strike
 * @param {Object} gex - GEX results
 * @returns {Object} Deviation analysis and signals
 */
export function calculateDeviation(spotPrice, wasp, maxPain, gex) {
  const deviationFromWASP = ((spotPrice - wasp.allWASP) / wasp.allWASP) * 100
  const deviationFromMaxPain = ((spotPrice - maxPain) / maxPain) * 100
  const deviationFromCallWASP = ((spotPrice - wasp.callWASP) / wasp.callWASP) * 100
  const deviationFromPutWASP = ((spotPrice - wasp.putWASP) / wasp.putWASP) * 100

  // Entry signal thresholds
  const ENTRY_THRESHOLD = 1.5 // 1.5% deviation triggers signal
  const STRONG_THRESHOLD = 2.5 // 2.5% deviation = strong signal

  let signal = 'NEUTRAL'
  let signalStrength = 0
  let strategy = null

  // Generate signals based on deviation + GEX regime
  if (Math.abs(deviationFromWASP) > ENTRY_THRESHOLD) {
    if (gex.volRegime === 'low_vol') {
      // Mean reversion expected - butterfly at WASP
      signalStrength = Math.min(100, Math.abs(deviationFromWASP) * 30)

      if (deviationFromWASP > 0) {
        signal = 'BEARISH_REVERSION'
        strategy = {
          type: 'PUT_BUTTERFLY',
          center: Math.round(wasp.allWASP),
          reason: `Spot ${deviationFromWASP.toFixed(1)}% above WASP in low-vol regime`,
        }
      } else {
        signal = 'BULLISH_REVERSION'
        strategy = {
          type: 'CALL_BUTTERFLY',
          center: Math.round(wasp.allWASP),
          reason: `Spot ${Math.abs(deviationFromWASP).toFixed(1)}% below WASP in low-vol regime`,
        }
      }
    } else {
      // High vol - trend may continue
      signalStrength = Math.min(80, Math.abs(deviationFromWASP) * 20)
      signal = 'WAIT_FOR_GEX_FLIP'
      strategy = {
        type: 'WAIT',
        reason: 'High vol regime - wait for GEX to flip positive',
      }
    }
  }

  // Strong signal override
  if (Math.abs(deviationFromWASP) > STRONG_THRESHOLD && gex.volRegime === 'low_vol') {
    signalStrength = Math.min(100, signalStrength + 20)
    if (strategy) {
      strategy.reason += ' [STRONG SIGNAL]'
    }
  }

  return {
    spotPrice,
    predictedClose: wasp.allWASP,
    resistance: wasp.callWASP,
    support: wasp.putWASP,
    maxPain,
    deviation: {
      fromWASP: Math.round(deviationFromWASP * 100) / 100,
      fromMaxPain: Math.round(deviationFromMaxPain * 100) / 100,
      fromCallWASP: Math.round(deviationFromCallWASP * 100) / 100,
      fromPutWASP: Math.round(deviationFromPutWASP * 100) / 100,
    },
    signal,
    signalStrength: Math.round(signalStrength),
    strategy,
    volRegime: gex.volRegime,
    netGEX: gex.netGEX,
  }
}

/**
 * Get OI distribution data for charting
 * @param {Array} calls - Call options
 * @param {Array} puts - Put options
 * @param {number} spotPrice - Current spot price
 * @returns {Array} Distribution data for chart
 */
export function getOIDistribution(calls, puts, spotPrice) {
  // Build strike map
  const strikeMap = {}

  for (const c of calls) {
    if (!strikeMap[c.strike]) {
      strikeMap[c.strike] = { strike: c.strike, callOI: 0, putOI: 0 }
    }
    strikeMap[c.strike].callOI = c.openInterest || 0
  }

  for (const p of puts) {
    if (!strikeMap[p.strike]) {
      strikeMap[p.strike] = { strike: p.strike, callOI: 0, putOI: 0 }
    }
    strikeMap[p.strike].putOI = p.openInterest || 0
  }

  // Sort and filter to strikes near the money
  const distribution = Object.values(strikeMap)
    .filter((d) => {
      const distance = Math.abs(d.strike - spotPrice) / spotPrice
      return distance <= 0.1 // Within 10% of spot
    })
    .sort((a, b) => a.strike - b.strike)

  return distribution
}

/**
 * Check if current week is 3rd week of month (monthly OpEx)
 * @returns {{isThirdWeek: boolean, isOpExWeek: boolean, daysToOpEx: number}}
 */
export function checkMonthlyOpEx() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  // Find 3rd Friday of current month
  let thirdFriday = new Date(year, month, 1)
  let fridayCount = 0

  while (fridayCount < 3) {
    if (thirdFriday.getDay() === 5) {
      fridayCount++
      if (fridayCount < 3) thirdFriday.setDate(thirdFriday.getDate() + 1)
    } else {
      thirdFriday.setDate(thirdFriday.getDate() + 1)
    }
  }

  // Calculate days to OpEx
  const diffTime = thirdFriday.getTime() - now.getTime()
  const daysToOpEx = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  // Check if we're in OpEx week (Mon-Fri of 3rd week)
  const opExWeekStart = new Date(thirdFriday)
  opExWeekStart.setDate(opExWeekStart.getDate() - 4) // Monday of that week

  const isOpExWeek = now >= opExWeekStart && now <= thirdFriday
  const isThirdWeek = isOpExWeek

  return {
    isThirdWeek,
    isOpExWeek,
    daysToOpEx,
    opExDate: thirdFriday.toISOString().split('T')[0],
  }
}

/**
 * VIX thresholds for strategy selection
 * OPTIMIZED: Backtest showed VIX < 15 produces best results
 */
export const VIX_THRESHOLDS = {
  LOW: 15,        // VIX < 15: Excellent - OPTIMAL for mean reversion
  MEDIUM: 18,     // VIX 15-18: Good for butterflies
  HIGH: 22,       // VIX 18-22: Caution - reduced position size
  EXTREME: 25,    // VIX > 25: Avoid mean reversion
}

/**
 * Strategy parameters - OPTIMIZED via backtest
 */
export const STRATEGY_PARAMS = {
  DEVIATION_THRESHOLD: 1.0,    // Entry when deviation > 1% (optimized from 1.5%)
  BUTTERFLY_THRESHOLD: 1.5,    // Butterfly requires > 1.5%
  VIX_MAX: 15,                 // Only trade when VIX < 15 (optimized from 20)
  HOLDING_PERIOD: 3,           // 3 days optimal (optimized from 5)
  WING_WIDTH: 5,               // $5 butterfly wings
  MAX_POSITION_PCT: 0.33,      // Max 1/3 of account per trade
}

/**
 * Get VIX regime description
 * @param {number} vix - Current VIX value
 * @returns {{regime: string, tradeable: boolean, confidence: number, description: string}}
 */
export function getVIXRegime(vix) {
  if (vix < VIX_THRESHOLDS.LOW) {
    return {
      regime: 'LOW',
      tradeable: true,
      confidence: 100,
      description: 'Excellent conditions for OI-WASP strategy. Low fear = strong pinning effect.',
    }
  } else if (vix < VIX_THRESHOLDS.MEDIUM) {
    return {
      regime: 'MODERATE',
      tradeable: true,
      confidence: 80,
      description: 'Good conditions for butterflies. Moderate vol allows mean reversion.',
    }
  } else if (vix < VIX_THRESHOLDS.HIGH) {
    return {
      regime: 'ELEVATED',
      tradeable: false,
      confidence: 40,
      description: 'Elevated VIX - reduce position size or wait. Mean reversion less reliable.',
    }
  } else if (vix < VIX_THRESHOLDS.EXTREME) {
    return {
      regime: 'HIGH',
      tradeable: false,
      confidence: 20,
      description: 'High VIX - avoid butterfly spreads. Trend continuation more likely.',
    }
  } else {
    return {
      regime: 'EXTREME',
      tradeable: false,
      confidence: 0,
      description: 'Extreme fear - OI-WASP strategy not recommended. Wait for VIX to normalize.',
    }
  }
}

/**
 * Check all trade conditions for the strategy
 * @param {Object} params - Trade condition parameters
 * @returns {{conditions: Array, allMet: boolean, score: number}}
 */
export function checkTradeConditions({ deviation, volRegime, vix, opEx }) {
  const conditions = []
  let score = 0
  const maxScore = 100

  // Condition 1: Deviation > 1.0% (OPTIMIZED from 1.5%)
  const deviationPct = Math.abs(deviation?.deviation?.fromWASP || 0)
  const deviationMet = deviationPct >= STRATEGY_PARAMS.DEVIATION_THRESHOLD
  conditions.push({
    name: 'Deviation from WASP',
    required: true,
    met: deviationMet,
    current: `${deviationPct.toFixed(2)}%`,
    target: `>${STRATEGY_PARAMS.DEVIATION_THRESHOLD}%`,
    weight: 30,
    explanation: deviationMet
      ? `Price deviation ${deviationPct.toFixed(2)}% exceeds threshold`
      : `Need at least ${STRATEGY_PARAMS.DEVIATION_THRESHOLD}% deviation for entry`,
  })
  if (deviationMet) score += 30

  // Condition 2: Low Vol Regime (required)
  const isLowVol = volRegime === 'low_vol'
  conditions.push({
    name: 'GEX Regime',
    required: true,
    met: isLowVol,
    current: volRegime || 'unknown',
    target: 'low_vol',
    weight: 25,
    explanation: isLowVol
      ? 'Positive GEX - market makers dampen volatility, supporting mean reversion'
      : 'Negative GEX - market makers amplify moves, mean reversion less reliable',
  })
  if (isLowVol) score += 25

  // Condition 3: VIX < 15 (OPTIMIZED - now required)
  const vixValue = vix?.vix || 20
  const vixRegime = getVIXRegime(vixValue)
  const vixMet = vixValue < STRATEGY_PARAMS.VIX_MAX
  conditions.push({
    name: 'VIX Level',
    required: true, // OPTIMIZED: VIX filter is now required
    met: vixMet,
    current: vixValue.toFixed(1),
    target: `<${STRATEGY_PARAMS.VIX_MAX}`,
    weight: 25,
    explanation: vixMet
      ? `VIX ${vixValue.toFixed(1)} is below optimal threshold - excellent conditions`
      : `VIX ${vixValue.toFixed(1)} is too high. Backtest showed VIX < ${STRATEGY_PARAMS.VIX_MAX} produces 50% win rate vs 0% otherwise.`,
  })
  if (vixMet) score += 25

  // Condition 4: OpEx Week (bonus)
  const isOpExWeek = opEx?.isOpExWeek || false
  conditions.push({
    name: 'OpEx Timing',
    required: false,
    met: isOpExWeek,
    current: isOpExWeek ? 'OpEx Week' : `${opEx?.daysToOpEx || '?'}d to OpEx`,
    target: 'OpEx Week',
    weight: 20,
    explanation: isOpExWeek
      ? 'Monthly OpEx week has strongest pinning effect'
      : 'Outside OpEx week - pinning effect may be weaker',
  })
  if (isOpExWeek) score += 20

  // Check if all required conditions are met
  const requiredConditions = conditions.filter(c => c.required)
  const allRequiredMet = requiredConditions.every(c => c.met)

  return {
    conditions,
    allMet: allRequiredMet,
    score,
    maxScore,
    tradeable: allRequiredMet && vixMet,
    confidence: Math.round((score / maxScore) * 100),
  }
}

/**
 * Generate specific trade suggestions based on OI analysis
 * @param {Array} calls - Call options
 * @param {Array} puts - Put options
 * @param {number} spotPrice - Current spot price
 * @param {Object} wasp - WASP analysis
 * @param {Object} deviation - Deviation analysis
 * @param {Object} vix - VIX data (optional)
 * @param {Object} opEx - OpEx data (optional)
 * @returns {Array} Trade suggestions
 */
export function generateTradeSuggestions(calls, puts, spotPrice, wasp, deviation, vix = null, opEx = null) {
  const suggestions = []
  const noSuggestionReasons = []
  const strike5 = Math.round(spotPrice / 5) * 5 // Round to nearest $5

  // Helper to find option by strike
  const findOption = (options, strike) => options.find(o => Math.abs(o.strike - strike) < 0.5)

  // Track why suggestions may not be generated
  const deviationPct = Math.abs(deviation.deviation.fromWASP)
  const isLowVol = deviation.volRegime === 'low_vol'

  // 1. Directional plays based on WASP deviation
  if (Math.abs(deviation.deviation.fromWASP) > 1.0) {
    const isBullish = deviation.deviation.fromWASP < 0 // Below WASP = bullish

    if (isBullish) {
      // CALL suggestion - spot below WASP, expect reversion up
      const callStrike = strike5
      const call = findOption(calls, callStrike)

      if (call && call.ask) {
        const targetPrice = wasp.allWASP
        const potentialProfit = Math.max(0, targetPrice - callStrike - call.ask)

        suggestions.push({
          type: 'CALL',
          direction: 'bullish',
          strikes: [callStrike],
          entry: call.ask,
          maxProfit: 'Unlimited',
          maxLoss: call.ask * 100,
          breakeven: callStrike + call.ask,
          riskReward: potentialProfit > 0 ? (potentialProfit / call.ask).toFixed(1) : '0',
          confidence: Math.min(90, 50 + Math.abs(deviation.deviation.fromWASP) * 15),
          rationale: `Spot $${spotPrice.toFixed(2)} is ${Math.abs(deviation.deviation.fromWASP).toFixed(1)}% below WASP ($${wasp.allWASP.toFixed(2)}). Mean reversion expected.`,
          detailedReason: {
            signal: 'BULLISH - Price Below Fair Value',
            analysis: [
              `Current spot ($${spotPrice.toFixed(2)}) trades ${Math.abs(deviation.deviation.fromWASP).toFixed(2)}% BELOW the OI-weighted fair value`,
              `OI-WASP predicts price should converge to $${wasp.allWASP.toFixed(2)} by expiry`,
              `Put WASP support at $${wasp.putWASP.toFixed(2)} provides downside floor`,
              `Call WASP resistance at $${wasp.callWASP.toFixed(2)} is the upside target`,
              isLowVol ? 'LOW VOL regime favors mean reversion - MMs will buy dips' : 'HIGH VOL regime - consider smaller position size',
            ],
            theory: 'OI-WASP theory: Options market makers hedge delta exposure, creating "gravity" toward high-OI strikes. When price deviates significantly from the weighted average, hedging flows push price back toward equilibrium.',
            risk: 'Risk: News events or trend continuation can override OI-based predictions. Max loss is premium paid.',
          },
          delta: call.delta,
          iv: call.impliedVolatility,
        })
      }
    } else {
      // PUT suggestion - spot above WASP, expect reversion down
      const putStrike = strike5
      const put = findOption(puts, putStrike)

      if (put && put.ask) {
        const targetPrice = wasp.allWASP
        const potentialProfit = Math.max(0, putStrike - targetPrice - put.ask)

        suggestions.push({
          type: 'PUT',
          direction: 'bearish',
          strikes: [putStrike],
          entry: put.ask,
          maxProfit: 'Unlimited',
          maxLoss: put.ask * 100,
          breakeven: putStrike - put.ask,
          riskReward: potentialProfit > 0 ? (potentialProfit / put.ask).toFixed(1) : '0',
          confidence: Math.min(90, 50 + Math.abs(deviation.deviation.fromWASP) * 15),
          rationale: `Spot $${spotPrice.toFixed(2)} is ${deviation.deviation.fromWASP.toFixed(1)}% above WASP ($${wasp.allWASP.toFixed(2)}). Mean reversion expected.`,
          detailedReason: {
            signal: 'BEARISH - Price Above Fair Value',
            analysis: [
              `Current spot ($${spotPrice.toFixed(2)}) trades ${deviation.deviation.fromWASP.toFixed(2)}% ABOVE the OI-weighted fair value`,
              `OI-WASP predicts price should pull back to $${wasp.allWASP.toFixed(2)} by expiry`,
              `Call WASP resistance at $${wasp.callWASP.toFixed(2)} caps upside`,
              `Put WASP support at $${wasp.putWASP.toFixed(2)} is the downside target`,
              isLowVol ? 'LOW VOL regime favors mean reversion - MMs will sell rallies' : 'HIGH VOL regime - consider smaller position size',
            ],
            theory: 'OI-WASP theory: When price trades above the weighted average OI strike, market maker hedging creates selling pressure. The higher the deviation, the stronger the gravitational pull back to fair value.',
            risk: 'Risk: Strong momentum or bullish news can override OI-based predictions. Max loss is premium paid.',
          },
          delta: put.delta,
          iv: put.impliedVolatility,
        })
      }
    }
  }

  // 2. Butterfly spread at WASP (primary strategy from the screenshot)
  if (deviation.volRegime === 'low_vol' && Math.abs(deviation.deviation.fromWASP) > 1.5) {
    const centerStrike = Math.round(wasp.allWASP / 5) * 5
    const wingWidth = 5 // $5 wings

    if (deviation.deviation.fromWASP > 0) {
      // PUT BUTTERFLY - expect price to drop to WASP
      const highStrike = centerStrike + wingWidth
      const lowStrike = centerStrike - wingWidth

      const highPut = findOption(puts, highStrike)
      const centerPut = findOption(puts, centerStrike)
      const lowPut = findOption(puts, lowStrike)

      if (highPut && centerPut && lowPut && highPut.ask && centerPut.bid && lowPut.ask) {
        const netDebit = highPut.ask - (2 * centerPut.bid) + lowPut.ask
        const maxProfit = wingWidth - netDebit
        const rr = maxProfit / netDebit

        if (netDebit > 0 && rr > 3) {
          suggestions.push({
            type: 'PUT_BUTTERFLY',
            direction: 'bearish',
            strikes: [highStrike, centerStrike, lowStrike],
            entry: netDebit,
            maxProfit: maxProfit * 100,
            maxLoss: netDebit * 100,
            breakeven: `${(centerStrike - maxProfit).toFixed(2)} - ${(centerStrike + maxProfit).toFixed(2)}`,
            riskReward: rr.toFixed(1),
            confidence: Math.min(85, 60 + Math.abs(deviation.deviation.fromWASP) * 10),
            rationale: `Butterfly centered at WASP ($${centerStrike}). ${rr.toFixed(0)}:1 R:R. Spot needs to reach $${centerStrike} by expiry for max profit.`,
            detailedReason: {
              signal: 'PUT BUTTERFLY - High R:R Mean Reversion Play',
              analysis: [
                `Spot ($${spotPrice.toFixed(2)}) is ${deviation.deviation.fromWASP.toFixed(2)}% ABOVE predicted close ($${wasp.allWASP.toFixed(2)})`,
                `Butterfly centered at $${centerStrike} (nearest $5 strike to WASP)`,
                `${rr.toFixed(0)}:1 Risk/Reward ratio - risk $${(netDebit * 100).toFixed(0)} to make $${(maxProfit * 100).toFixed(0)}`,
                `LOW VOL regime (positive GEX) - market makers dampen volatility, favoring pinning`,
                `Max profit achieved if SPY closes at exactly $${centerStrike} at expiry`,
                `Profit zone: $${(centerStrike - maxProfit).toFixed(2)} to $${(centerStrike + maxProfit).toFixed(2)}`,
              ],
              theory: 'Butterfly Strategy: Buy wings, sell body at predicted close. OI-WASP analysis shows price should converge to center strike. Low vol regime reduces whipsaw risk. Strategy from Chinese trading post showed 300% monthly returns using this approach with 9:1 R:R.',
              risk: 'Risk: Price must reach center strike for profit. Time decay hurts if price stays away. Max loss limited to net debit paid.',
            },
            legs: [
              { action: 'BUY', strike: highStrike, type: 'PUT', qty: 1 },
              { action: 'SELL', strike: centerStrike, type: 'PUT', qty: 2 },
              { action: 'BUY', strike: lowStrike, type: 'PUT', qty: 1 },
            ],
          })
        }
      }
    } else {
      // CALL BUTTERFLY - expect price to rise to WASP
      const lowStrike = centerStrike - wingWidth
      const highStrike = centerStrike + wingWidth

      const lowCall = findOption(calls, lowStrike)
      const centerCall = findOption(calls, centerStrike)
      const highCall = findOption(calls, highStrike)

      if (lowCall && centerCall && highCall && lowCall.ask && centerCall.bid && highCall.ask) {
        const netDebit = lowCall.ask - (2 * centerCall.bid) + highCall.ask
        const maxProfit = wingWidth - netDebit
        const rr = maxProfit / netDebit

        if (netDebit > 0 && rr > 3) {
          suggestions.push({
            type: 'CALL_BUTTERFLY',
            direction: 'bullish',
            strikes: [lowStrike, centerStrike, highStrike],
            entry: netDebit,
            maxProfit: maxProfit * 100,
            maxLoss: netDebit * 100,
            breakeven: `${(centerStrike - maxProfit).toFixed(2)} - ${(centerStrike + maxProfit).toFixed(2)}`,
            riskReward: rr.toFixed(1),
            confidence: Math.min(85, 60 + Math.abs(deviation.deviation.fromWASP) * 10),
            rationale: `Butterfly centered at WASP ($${centerStrike}). ${rr.toFixed(0)}:1 R:R. Spot needs to reach $${centerStrike} by expiry for max profit.`,
            detailedReason: {
              signal: 'CALL BUTTERFLY - High R:R Mean Reversion Play',
              analysis: [
                `Spot ($${spotPrice.toFixed(2)}) is ${Math.abs(deviation.deviation.fromWASP).toFixed(2)}% BELOW predicted close ($${wasp.allWASP.toFixed(2)})`,
                `Butterfly centered at $${centerStrike} (nearest $5 strike to WASP)`,
                `${rr.toFixed(0)}:1 Risk/Reward ratio - risk $${(netDebit * 100).toFixed(0)} to make $${(maxProfit * 100).toFixed(0)}`,
                `LOW VOL regime (positive GEX) - market makers dampen volatility, favoring pinning`,
                `Max profit achieved if SPY closes at exactly $${centerStrike} at expiry`,
                `Profit zone: $${(centerStrike - maxProfit).toFixed(2)} to $${(centerStrike + maxProfit).toFixed(2)}`,
              ],
              theory: 'Butterfly Strategy: Buy wings, sell body at predicted close. OI-WASP analysis shows price should rise to center strike. Low vol regime reduces whipsaw risk. Strategy from Chinese trading post showed 300% monthly returns using this approach with 9:1 R:R.',
              risk: 'Risk: Price must reach center strike for profit. Time decay hurts if price stays away. Max loss limited to net debit paid.',
            },
            legs: [
              { action: 'BUY', strike: lowStrike, type: 'CALL', qty: 1 },
              { action: 'SELL', strike: centerStrike, type: 'CALL', qty: 2 },
              { action: 'BUY', strike: highStrike, type: 'CALL', qty: 1 },
            ],
          })
        }
      }
    }
  }

  // 3. Iron Condor for low vol range-bound expectation
  if (deviation.volRegime === 'low_vol' && Math.abs(deviation.deviation.fromWASP) < 1.0) {
    const putStrike = Math.round(wasp.putWASP / 5) * 5
    const callStrike = Math.round(wasp.callWASP / 5) * 5

    if (callStrike - putStrike >= 10) {
      const shortPut = findOption(puts, putStrike)
      const longPut = findOption(puts, putStrike - 5)
      const shortCall = findOption(calls, callStrike)
      const longCall = findOption(calls, callStrike + 5)

      if (shortPut && longPut && shortCall && longCall) {
        const putCredit = (shortPut.bid || 0) - (longPut.ask || 0)
        const callCredit = (shortCall.bid || 0) - (longCall.ask || 0)
        const totalCredit = putCredit + callCredit

        if (totalCredit > 0.3) {
          suggestions.push({
            type: 'IRON_CONDOR',
            direction: 'neutral',
            strikes: [putStrike - 5, putStrike, callStrike, callStrike + 5],
            entry: totalCredit,
            maxProfit: totalCredit * 100,
            maxLoss: (5 - totalCredit) * 100,
            breakeven: `${putStrike - totalCredit} - ${callStrike + totalCredit}`,
            riskReward: (totalCredit / (5 - totalCredit)).toFixed(1),
            confidence: 65,
            rationale: `Low vol regime with spot near WASP. Collect premium if SPY stays between $${putStrike} - $${callStrike}.`,
            legs: [
              { action: 'BUY', strike: putStrike - 5, type: 'PUT', qty: 1 },
              { action: 'SELL', strike: putStrike, type: 'PUT', qty: 1 },
              { action: 'SELL', strike: callStrike, type: 'CALL', qty: 1 },
              { action: 'BUY', strike: callStrike + 5, type: 'CALL', qty: 1 },
            ],
          })
        }
      }
    }
  }

  // Check VIX condition
  const vixValue = vix?.vix || null
  const vixRegime = vixValue ? getVIXRegime(vixValue) : null
  const vixTradeable = vixRegime ? vixRegime.tradeable : true // Default to true if no VIX data

  // Generate detailed reasons if no suggestions
  if (suggestions.length === 0) {
    // Check each condition and explain why it's not met
    if (deviationPct < 1.0) {
      noSuggestionReasons.push({
        condition: 'Insufficient Deviation',
        status: 'NOT MET',
        current: `${deviationPct.toFixed(2)}%`,
        required: '>1.0%',
        explanation: `Spot ($${spotPrice.toFixed(2)}) is only ${deviationPct.toFixed(2)}% away from WASP ($${wasp.allWASP.toFixed(2)}). Need >1% deviation for directional plays, >1.5% for butterfly spreads.`,
      })
    }

    if (!isLowVol) {
      noSuggestionReasons.push({
        condition: 'High Vol Regime',
        status: 'CAUTION',
        current: 'Negative GEX',
        required: 'Positive GEX',
        explanation: 'Market is in HIGH VOL regime (negative GEX). Market makers amplify moves rather than dampening them. Mean reversion strategies have lower win rate. Wait for GEX to flip positive.',
      })
    }

    // VIX condition
    if (vixValue && !vixTradeable) {
      noSuggestionReasons.push({
        condition: 'VIX Too High',
        status: 'CAUTION',
        current: vixValue.toFixed(1),
        required: '<20',
        explanation: vixRegime.description,
      })
    }

    if (deviationPct < 1.5 && isLowVol) {
      noSuggestionReasons.push({
        condition: 'Butterfly Threshold',
        status: 'NOT MET',
        current: `${deviationPct.toFixed(2)}%`,
        required: '>1.5%',
        explanation: `Butterfly spreads require >1.5% deviation for favorable R:R. Current deviation (${deviationPct.toFixed(2)}%) is too small. The 9:1 R:R from the strategy requires significant mispricing.`,
      })
    }

    // OpEx timing info
    if (opEx && !opEx.isOpExWeek) {
      noSuggestionReasons.push({
        condition: 'OpEx Timing',
        status: 'INFO',
        current: `${opEx.daysToOpEx}d to OpEx`,
        required: 'OpEx Week',
        explanation: 'Monthly OpEx week (3rd Friday) has the strongest pinning effect. Consider waiting or reducing position size.',
      })
    }

    // Add general market context
    noSuggestionReasons.push({
      condition: 'Current Market State',
      status: 'INFO',
      current: 'Neutral',
      required: 'N/A',
      explanation: `SPY at $${spotPrice.toFixed(2)} | WASP: $${wasp.allWASP.toFixed(2)} | Support: $${wasp.putWASP.toFixed(2)} | Resistance: $${wasp.callWASP.toFixed(2)} | Vol Regime: ${isLowVol ? 'LOW' : 'HIGH'}${vixValue ? ` | VIX: ${vixValue.toFixed(1)}` : ''}`,
    })
  }

  // Get trade conditions summary
  const tradeConditions = checkTradeConditions({
    deviation,
    volRegime: isLowVol ? 'low_vol' : 'high_vol',
    vix,
    opEx,
  })

  return {
    suggestions: suggestions.sort((a, b) => b.confidence - a.confidence),
    noSuggestionReasons,
    tradeConditions,
    marketContext: {
      spot: spotPrice,
      wasp: wasp.allWASP,
      deviation: deviationPct,
      volRegime: isLowVol ? 'low_vol' : 'high_vol',
      support: wasp.putWASP,
      resistance: wasp.callWASP,
      vix: vixValue,
      vixRegime: vixRegime?.regime || 'UNKNOWN',
      opExWeek: opEx?.isOpExWeek || false,
      daysToOpEx: opEx?.daysToOpEx || null,
    },
  }
}

/**
 * Complete OI analysis for options chain
 * @param {Array} calls - Call options
 * @param {Array} puts - Put options
 * @param {number} spotPrice - Current spot price
 * @param {Object} vix - VIX data (optional) {vix, previousClose, change, changePercent}
 * @returns {Object} Complete analysis
 */
export function analyzeOptionsOI(calls, puts, spotPrice, vix = null) {
  const wasp = calculateOIWASP(calls, puts)
  const { maxPain, painByStrike } = calculateMaxPain(calls, puts)
  const gex = calculateGEX(calls, puts, spotPrice)
  const deviation = calculateDeviation(spotPrice, wasp, maxPain, gex)
  const distribution = getOIDistribution(calls, puts, spotPrice)
  const opEx = checkMonthlyOpEx()
  const tradeAnalysis = generateTradeSuggestions(calls, puts, spotPrice, wasp, deviation, vix, opEx)

  // Get VIX regime if VIX data provided
  const vixRegime = vix ? getVIXRegime(vix.vix) : null

  return {
    wasp,
    maxPain,
    gex,
    deviation,
    distribution,
    opEx,
    vix: vix ? {
      value: vix.vix,
      change: vix.change,
      changePercent: vix.changePercent,
      regime: vixRegime?.regime || 'UNKNOWN',
      tradeable: vixRegime?.tradeable ?? true,
      description: vixRegime?.description || '',
    } : null,
    suggestions: tradeAnalysis.suggestions,
    noSuggestionReasons: tradeAnalysis.noSuggestionReasons,
    tradeConditions: tradeAnalysis.tradeConditions,
    marketContext: tradeAnalysis.marketContext,
    summary: {
      predictedClose: wasp.allWASP,
      resistance: wasp.callWASP,
      support: wasp.putWASP,
      maxPain,
      signal: deviation.signal,
      signalStrength: deviation.signalStrength,
      strategy: deviation.strategy,
      volRegime: gex.volRegime,
      vixRegime: vixRegime?.regime || null,
      tradeable: tradeAnalysis.tradeConditions?.tradeable ?? true,
    },
  }
}
