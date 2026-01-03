#!/usr/bin/env node

/**
 * Daily Options Data Fetch Script
 *
 * Fetches options data from Schwab API and caches locally.
 * Run daily after market close to build historical data.
 *
 * Usage:
 *   node scripts/daily-fetch.js                    # Fetch default symbols
 *   node scripts/daily-fetch.js SPY QQQ NVDA      # Fetch specific symbols
 *   node scripts/daily-fetch.js --all              # Fetch all tracked symbols
 *
 * Cron example (4 PM ET weekdays):
 *   0 16 * * 1-5 cd /path/to/OPPUT && node scripts/daily-fetch.js >> logs/daily-fetch.log 2>&1
 */

import { SchwabClient } from '../src/core/data/schwab.js'
import { OptionsCache } from '../src/core/data/cache.js'

// Default symbols to track
const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'AMD', 'META', 'GOOGL', 'AMZN', 'MSFT']

async function dailyFetch(symbols) {
  console.log('='.repeat(60))
  console.log(`Daily Options Fetch - ${new Date().toISOString()}`)
  console.log('='.repeat(60))

  const schwab = new SchwabClient()
  const cache = new OptionsCache()
  const today = new Date().toISOString().split('T')[0]

  // Check Schwab API availability
  const isAvailable = await schwab.healthCheck()
  if (!isAvailable) {
    console.error('\nSchwab API not available. Check credentials.')
    console.error('Set SCHWAB_APP_KEY, SCHWAB_SECRET, and SCHWAB_REFRESH_TOKEN')
    process.exit(1)
  }

  console.log(`\nFetching data for ${symbols.length} symbols: ${symbols.join(', ')}`)
  console.log(`Date: ${today}\n`)

  const results = {
    success: [],
    failed: [],
  }

  for (const symbol of symbols) {
    console.log(`[${symbol}] Fetching options chain...`)

    try {
      // Fetch full options chain
      const { options, underlyingPrice } = await schwab.fetchOptionsChain(symbol)

      if (options.length === 0) {
        console.log(`[${symbol}] No options data returned`)
        results.failed.push({ symbol, error: 'No options data' })
        continue
      }

      // Calculate metrics
      const wasp = schwab.calculateWASP(options, 30)
      const atmIV = schwab.calculateATMIV(options, underlyingPrice, 30)
      const skew = schwab.calculateIVSkew(options, underlyingPrice, 30)

      // Cache volatility data
      if (atmIV) {
        cache.upsertVolatility(symbol, today, {
          ivCurrent: atmIV.avgIV,
          hvCurrent: null,
          ivWeekAgo: null,
          ivMonthAgo: null,
          ivYearHigh: null,
          ivYearLow: null,
        })
      }

      // Options chain is already cached by fetchOptionsChain (cacheResults: true)

      console.log(`[${symbol}] Success:`)
      console.log(`  Price: $${underlyingPrice.toFixed(2)}`)
      console.log(`  Options: ${options.length}`)
      console.log(`  ATM IV: ${(atmIV?.avgIV * 100 || 0).toFixed(1)}%`)
      console.log(`  WASP: Call $${wasp.callWASP.toFixed(2)}, Put $${wasp.putWASP.toFixed(2)}, Total $${wasp.totalWASP.toFixed(2)}`)
      console.log(`  OI: Call ${wasp.callOI.toLocaleString()}, Put ${wasp.putOI.toLocaleString()}`)
      console.log(`  Skew: ${(skew.skew * 100).toFixed(2)}% (Put IV - Call IV)`)

      results.success.push({
        symbol,
        underlyingPrice,
        optionCount: options.length,
        atmIV: atmIV?.avgIV || 0,
        wasp: wasp.totalWASP,
        skew: skew.skew,
      })

      // Respect rate limits - wait 1 second between symbols
      await new Promise(r => setTimeout(r, 1000))

    } catch (error) {
      console.error(`[${symbol}] Error: ${error.message}`)
      results.failed.push({ symbol, error: error.message })
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  console.log(`Success: ${results.success.length}/${symbols.length}`)
  console.log(`Failed: ${results.failed.length}/${symbols.length}`)

  if (results.failed.length > 0) {
    console.log('\nFailed symbols:')
    results.failed.forEach(f => console.log(`  ${f.symbol}: ${f.error}`))
  }

  // Check data availability
  console.log('\nData Availability:')
  for (const symbol of symbols.slice(0, 3)) {
    const availability = cache.getDataAvailability(symbol)
    if (availability.optionChain) {
      console.log(`  ${symbol}: ${availability.optionChain.minDate.toISOString().split('T')[0]} to ${availability.optionChain.maxDate.toISOString().split('T')[0]} (${availability.optionChain.dayCount} days)`)
    }
  }

  cache.close()

  console.log('\nDone.')
  return results
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Daily Options Data Fetch Script

Usage:
  node scripts/daily-fetch.js                    # Fetch default symbols
  node scripts/daily-fetch.js SPY QQQ NVDA      # Fetch specific symbols
  node scripts/daily-fetch.js --all              # Fetch all tracked symbols

Default symbols: ${DEFAULT_SYMBOLS.join(', ')}

Environment variables required:
  SCHWAB_APP_KEY        - Schwab app key (client ID)
  SCHWAB_SECRET         - Schwab app secret
  SCHWAB_REFRESH_TOKEN  - OAuth refresh token
    `)
    process.exit(0)
  }

  if (args.includes('--all')) {
    return DEFAULT_SYMBOLS
  }

  if (args.length > 0) {
    return args.filter(a => !a.startsWith('-')).map(s => s.toUpperCase())
  }

  return DEFAULT_SYMBOLS.slice(0, 5) // Default to first 5
}

// Main
const symbols = parseArgs()
dailyFetch(symbols).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
