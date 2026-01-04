/**
 * Tweet Parser - Extracts trade signals from tweet text
 * Parses various formats used by options traders on Twitter
 */

// Common stock symbols (expand as needed)
const KNOWN_SYMBOLS = new Set([
  // Index ETFs
  'SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'UVXY', 'SQQQ', 'TQQQ', 'SPX',
  // Tech giants
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'AMD', 'INTC', 'NFLX', 'BABA', 'NIO', 'PLTR', 'COIN', 'MARA',
  // Finance
  'BA', 'DIS', 'JPM', 'GS', 'MS', 'V', 'MA', 'PYPL',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'OXY', 'PCG',
  // Commodities
  'GLD', 'SLV', 'USO', 'UNG',
  // Popular meme/swing stocks (used by @StockOptions888)
  'BULL', 'NLY', 'TIGR', 'ABR', 'NKE', 'HPQ', 'RIOT', 'MSTR',
  'SOFI', 'HOOD', 'RBLX', 'SNAP', 'UBER', 'LYFT', 'RIVN', 'LCID',
  'GME', 'AMC', 'BBBY', 'BB', 'NOK', 'WISH', 'CLOV', 'WKHS'
])

/**
 * Parse a tweet to extract trade signal
 * @param {string} text - Tweet text
 * @returns {Object|null} Parsed trade or null if no trade detected
 */
export function parseTweet(text) {
  const upperText = text.toUpperCase()

  // Try different parsing patterns
  const patterns = [
    parseDollarSymbolFormat,  // $NKE 61 2 JAN 26 CALL 100 (Twitter trader format)
    parseDollarCallPutFormat, // $BULL 10.5 Call 1/09 avg .17
    parseStandardFormat,      // SPY 400P 1/17 @ $1.50
    parseActionFormat,        // Bought NVDA 120C 2/21
    parseEntryFormat,         // Entry: SPY puts 395 1/10
    parseSimpleFormat,        // SPY 400 puts
    parsePriceOnlyFormat      // SPY 400P @ 1.50
  ]

  for (const pattern of patterns) {
    const result = pattern(text, upperText)
    if (result && result.confidence >= 0.5) {
      return result
    }
  }

  return null
}

/**
 * Parse dollar symbol format: $NKE 61 2 JAN 26 CALL 100
 * Used by Twitter traders like @StockOptions888
 */
function parseDollarSymbolFormat(text, upperText) {
  // Match: $SYMBOL [emojis/noise] STRIKE DAY MMM [YY] CALL/PUT [QUANTITY]
  // Example: $NKE 🏎️ 61 2 JAN 26 CALL 100
  // Skip non-word chars (emojis, etc.) after symbol
  const regex = /\$([A-Z]{1,5})\s*[^\w\d]*\s*(\d+(?:\.\d+)?)\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{2})?\s*(CALL|PUT|C|P)\b/i
  const match = upperText.match(regex)

  if (match) {
    const [, symbol, strike, day, monthStr, year, type] = match
    if (!isValidSymbol(symbol)) return null

    const monthMap = {
      'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
      'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
    }
    const month = monthMap[monthStr.toUpperCase()]
    const fullYear = year ? (parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year)) : new Date().getFullYear()

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase().startsWith('C') ? 'CALL' : 'PUT',
      strike: parseFloat(strike),
      expiry: `${fullYear}-${String(month).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`,
      price: null,
      confidence: 0.9,
      format: 'dollar-symbol',
      rawText: text
    }
  }

  return null
}

/**
 * Parse dollar call/put format: $BULL 10.5 Call 1/09 avg .17
 * Also handles: $PCG 16.5 CALL 1/09 @ 0.10
 */
function parseDollarCallPutFormat(text, upperText) {
  // Match: $SYMBOL STRIKE CALL/PUT MM/DD [avg/@ $PRICE]
  const regex = /\$([A-Z]{1,5})\s+(\d+(?:\.\d+)?)\s*(CALL|PUT|C|P)\s+(\d{1,2})\/(\d{1,2})(?:\s*(?:avg|@|at)\s*\$?(\d+(?:\.\d+)?))?/i
  const match = upperText.match(regex)

  if (match) {
    const [, symbol, strike, type, month, day, price] = match
    if (!isValidSymbol(symbol)) return null

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase().startsWith('C') ? 'CALL' : 'PUT',
      strike: parseFloat(strike),
      expiry: formatExpiry(parseInt(month), parseInt(day)),
      price: price ? parseFloat(price) : null,
      confidence: price ? 0.95 : 0.85,
      format: 'dollar-callput',
      rawText: text
    }
  }

  return null
}

/**
 * Parse standard format: SPY 400P 1/17 @ $1.50
 */
function parseStandardFormat(text, upperText) {
  // Match: SYMBOL STRIKE[P/C] MM/DD [@ $PRICE]
  const regex = /\b([A-Z]{1,5})\s+(\d+(?:\.\d+)?)\s*([PC])\s+(\d{1,2})\/(\d{1,2})(?:\s*[@at]\s*\$?(\d+(?:\.\d+)?))?/i
  const match = upperText.match(regex)

  if (match) {
    const [, symbol, strike, type, month, day, price] = match
    if (!isValidSymbol(symbol)) return null

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase() === 'P' ? 'PUT' : 'CALL',
      strike: parseFloat(strike),
      expiry: formatExpiry(parseInt(month), parseInt(day)),
      price: price ? parseFloat(price) : null,
      confidence: price ? 0.95 : 0.85,
      format: 'standard',
      rawText: text
    }
  }

  return null
}

/**
 * Parse action format: Bought NVDA 120C 2/21
 */
function parseActionFormat(text, upperText) {
  // Match: (Bought|Buying|Sold|Selling|Got|Getting) SYMBOL STRIKE[P/C] [MM/DD]
  const regex = /\b(BOUGHT|BUYING|GOT|GETTING|SOLD|SELLING)\s+([A-Z]{1,5})\s+(\d+(?:\.\d+)?)\s*([PC])(?:\s*(\d{1,2})\/(\d{1,2}))?/i
  const match = upperText.match(regex)

  if (match) {
    const [, action, symbol, strike, type, month, day] = match
    if (!isValidSymbol(symbol)) return null

    const isSelling = action.toUpperCase().startsWith('SOLD') || action.toUpperCase().startsWith('SELL')

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase() === 'P' ? 'PUT' : 'CALL',
      strike: parseFloat(strike),
      expiry: month && day ? formatExpiry(parseInt(month), parseInt(day)) : getNextFriday(),
      price: null,
      confidence: month && day ? 0.9 : 0.75,
      format: 'action',
      action: isSelling ? 'CLOSE' : 'OPEN',
      rawText: text
    }
  }

  return null
}

/**
 * Parse entry format: Entry: SPY puts 395 1/10
 */
function parseEntryFormat(text, upperText) {
  // Match: (Entry|In) SYMBOL (puts|calls) STRIKE [MM/DD] [@ $PRICE]
  const regex = /\b(ENTRY|IN|ENTERED)\s*:?\s*([A-Z]{1,5})\s+(PUTS?|CALLS?)\s+(\d+(?:\.\d+)?)(?:\s+(\d{1,2})\/(\d{1,2}))?(?:\s*[@at]\s*\$?(\d+(?:\.\d+)?))?/i
  const match = upperText.match(regex)

  if (match) {
    const [, , symbol, type, strike, month, day, price] = match
    if (!isValidSymbol(symbol)) return null

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase().startsWith('PUT') ? 'PUT' : 'CALL',
      strike: parseFloat(strike),
      expiry: month && day ? formatExpiry(parseInt(month), parseInt(day)) : getNextFriday(),
      price: price ? parseFloat(price) : null,
      confidence: month && day ? 0.9 : 0.7,
      format: 'entry',
      rawText: text
    }
  }

  return null
}

/**
 * Parse simple format: SPY 400 puts
 */
function parseSimpleFormat(text, upperText) {
  // Match: SYMBOL STRIKE (puts|calls)
  const regex = /\b([A-Z]{1,5})\s+(\d+(?:\.\d+)?)\s+(PUTS?|CALLS?)\b/i
  const match = upperText.match(regex)

  if (match) {
    const [, symbol, strike, type] = match
    if (!isValidSymbol(symbol)) return null

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase().startsWith('PUT') ? 'PUT' : 'CALL',
      strike: parseFloat(strike),
      expiry: getNextFriday(),
      price: null,
      confidence: 0.6,
      format: 'simple',
      rawText: text
    }
  }

  return null
}

/**
 * Parse price-only format: SPY 400P @ 1.50
 */
function parsePriceOnlyFormat(text, upperText) {
  // Match: SYMBOL STRIKE[P/C] @ $PRICE (without date)
  const regex = /\b([A-Z]{1,5})\s+(\d+(?:\.\d+)?)\s*([PC])\s*[@at]\s*\$?(\d+(?:\.\d+)?)\b/i
  const match = upperText.match(regex)

  if (match) {
    const [, symbol, strike, type, price] = match
    if (!isValidSymbol(symbol)) return null

    return {
      symbol: symbol.toUpperCase(),
      direction: type.toUpperCase() === 'P' ? 'PUT' : 'CALL',
      strike: parseFloat(strike),
      expiry: getNextFriday(),
      price: parseFloat(price),
      confidence: 0.8,
      format: 'price-only',
      rawText: text
    }
  }

  return null
}

/**
 * Check if symbol is valid
 * @param {string} symbol
 * @returns {boolean}
 */
function isValidSymbol(symbol) {
  // Check known symbols first
  if (KNOWN_SYMBOLS.has(symbol.toUpperCase())) return true

  // Accept 1-5 letter symbols that look like tickers
  if (/^[A-Z]{1,5}$/.test(symbol.toUpperCase())) return true

  return false
}

/**
 * Format expiry date as YYYY-MM-DD
 * @param {number} month
 * @param {number} day
 * @returns {string}
 */
function formatExpiry(month, day) {
  const now = new Date()
  let year = now.getFullYear()

  // If the date appears to be in the past, assume next year
  const expDate = new Date(year, month - 1, day)
  if (expDate < now) {
    year++
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Get next Friday date
 * @returns {string} YYYY-MM-DD
 */
function getNextFriday() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7
  const friday = new Date(now)
  friday.setDate(now.getDate() + daysUntilFriday)
  return friday.toISOString().split('T')[0]
}

/**
 * Check if tweet indicates closing a position
 * @param {string} text
 * @returns {boolean}
 */
export function isClosingTrade(text) {
  const closeKeywords = [
    'sold', 'selling', 'closed', 'closing', 'out of', 'exited', 'exiting',
    'took profit', 'taking profit', 'stopped out', 'cut', 'cutting'
  ]
  const lowerText = text.toLowerCase()
  return closeKeywords.some(keyword => lowerText.includes(keyword))
}

/**
 * Get confidence level description
 * @param {number} confidence
 * @returns {string}
 */
export function getConfidenceLabel(confidence) {
  if (confidence >= 0.9) return 'High'
  if (confidence >= 0.7) return 'Medium'
  if (confidence >= 0.5) return 'Low'
  return 'Very Low'
}

/**
 * Parse multiple tweets and return trade signals
 * @param {Array} tweets - Array of tweet objects
 * @returns {Array} Array of parsed trades with tweet info
 */
export function parseMultipleTweets(tweets) {
  return tweets.map(tweet => {
    const parsed = parseTweet(tweet.text)
    return {
      tweet: {
        id: tweet.id,
        text: tweet.text,
        createdAt: tweet.created_at || tweet.createdAt,
        author: tweet.author || 'StockOptions888'
      },
      parsed,
      isClosing: parsed ? isClosingTrade(tweet.text) : false,
      status: 'pending'
    }
  }).filter(item => item.parsed !== null || !item.isClosing)
}

/**
 * Validate parsed trade for execution
 * @param {Object} parsed - Parsed trade object
 * @returns {Object} Validation result
 */
export function validateForExecution(parsed) {
  const errors = []

  if (!parsed) {
    return { valid: false, errors: ['No trade signal parsed'] }
  }

  if (!parsed.symbol) errors.push('Missing symbol')
  if (!parsed.direction) errors.push('Missing direction (PUT/CALL)')
  if (!parsed.strike || parsed.strike <= 0) errors.push('Invalid strike price')
  if (!parsed.expiry) errors.push('Missing expiry date')

  // Check expiry is not in the past
  if (parsed.expiry) {
    const expiryDate = new Date(parsed.expiry)
    if (expiryDate < new Date()) {
      errors.push('Expiry date is in the past')
    }
  }

  // Check confidence threshold for auto-execute
  if (parsed.confidence < 0.8) {
    errors.push(`Confidence too low for auto-execute: ${(parsed.confidence * 100).toFixed(0)}%`)
  }

  return {
    valid: errors.length === 0,
    errors,
    canManualExecute: errors.length === 0 || (errors.length === 1 && errors[0].includes('Confidence'))
  }
}
