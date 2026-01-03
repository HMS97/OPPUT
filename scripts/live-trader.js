#!/usr/bin/env node
/**
 * Live Trader CLI
 * Automated trading based on OI-WASP signals via Robinhood
 *
 * Usage:
 *   node scripts/live-trader.js --symbol SPY --dry-run
 *   node scripts/live-trader.js --symbol SPY --live --max-trades 3 --max-position 500
 *
 * Prerequisites:
 *   1. Set environment variables in .env:
 *      ROBINHOOD_USERNAME=your_email
 *      ROBINHOOD_PASSWORD=your_password
 *      ROBINHOOD_MFA_CODE=optional_totp
 *
 *   2. Start the Robinhood API server:
 *      cd src && uvicorn robinhood_api:app --port 8001
 */

import { SignalRunner } from '../src/core/trading/signal-runner.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    symbol: 'SPY',
    timeframe: 5,
    dryRun: true,
    apiUrl: 'http://localhost:8001',
    riskLimits: {
      maxDailyTrades: 3,
      maxPositionSize: 500,
      maxDailyLoss: 300,
      maxConcurrentPositions: 1,
      minStrengthThreshold: 60
    }
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol':
      case '-s':
        config.symbol = args[++i]?.toUpperCase() || 'SPY';
        break;
      case '--timeframe':
      case '-t':
        config.timeframe = parseInt(args[++i]) || 5;
        break;
      case '--live':
        config.dryRun = false;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--max-trades':
        config.riskLimits.maxDailyTrades = parseInt(args[++i]) || 3;
        break;
      case '--max-position':
        config.riskLimits.maxPositionSize = parseInt(args[++i]) || 500;
        break;
      case '--max-loss':
        config.riskLimits.maxDailyLoss = parseInt(args[++i]) || 300;
        break;
      case '--min-strength':
        config.riskLimits.minStrengthThreshold = parseInt(args[++i]) || 60;
        break;
      case '--api-url':
        config.apiUrl = args[++i] || 'http://localhost:8001';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
OPPUT Live Trader - Automated trading via Robinhood

USAGE:
  node scripts/live-trader.js [OPTIONS]

OPTIONS:
  -s, --symbol <SYM>       Stock symbol (default: SPY)
  -t, --timeframe <MIN>    Candle timeframe in minutes (default: 5)
  --dry-run                Simulate trades without executing (default)
  --live                   Execute real trades (requires API auth)
  --max-trades <N>         Max trades per day (default: 3)
  --max-position <$>       Max position size in $ (default: 500)
  --max-loss <$>           Daily loss limit in $ (default: 300)
  --min-strength <N>       Min signal strength % (default: 60)
  --api-url <URL>          Robinhood API URL (default: http://localhost:8001)
  -h, --help               Show this help message

EXAMPLES:
  # Dry-run mode (safe testing)
  node scripts/live-trader.js --symbol SPY --dry-run

  # Live trading with conservative limits
  node scripts/live-trader.js --symbol SPY --live --max-trades 3 --max-position 500

  # Monitor NVDA with custom settings
  node scripts/live-trader.js -s NVDA -t 15 --min-strength 70

PREREQUISITES:
  1. Set environment variables in .env:
     ROBINHOOD_USERNAME=your_email
     ROBINHOOD_PASSWORD=your_password

  2. Start the Robinhood API server:
     cd src && pip install -r ../requirements.txt
     uvicorn robinhood_api:app --port 8001

  3. Run this script:
     node scripts/live-trader.js --dry-run
`);
}

async function main() {
  const config = parseArgs();

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              OPPUT Live Trader                             ║
╠════════════════════════════════════════════════════════════╣
║  Symbol: ${config.symbol.padEnd(12)} Timeframe: ${config.timeframe}m                   ║
║  Mode: ${config.dryRun ? 'DRY-RUN (safe)    ' : 'LIVE TRADING      '}                          ║
╠════════════════════════════════════════════════════════════╣
║  Risk Limits:                                              ║
║    Max Daily Trades: ${String(config.riskLimits.maxDailyTrades).padEnd(5)}                              ║
║    Max Position Size: $${String(config.riskLimits.maxPositionSize).padEnd(5)}                           ║
║    Max Daily Loss: $${String(config.riskLimits.maxDailyLoss).padEnd(5)}                              ║
║    Min Signal Strength: ${config.riskLimits.minStrengthThreshold}%                            ║
╚════════════════════════════════════════════════════════════╝
`);

  if (!config.dryRun) {
    console.log('\n⚠️  WARNING: Live trading mode enabled!');
    console.log('    Real orders will be placed on your Robinhood account.');
    console.log('    Press Ctrl+C within 5 seconds to abort...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const runner = new SignalRunner(config);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    runner.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    runner.stop();
    process.exit(0);
  });

  // Start the runner
  const started = await runner.start();

  if (!started) {
    console.error('Failed to start signal runner');
    process.exit(1);
  }

  // Keep process alive
  await new Promise(() => {});
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
