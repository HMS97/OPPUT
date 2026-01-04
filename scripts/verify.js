#!/usr/bin/env node
/**
 * OPPUT Verification Script
 *
 * USAGE:
 *   node scripts/verify.js [--full] [--quiet]
 *
 * OPTIONS:
 *   --full    Run all verification levels including smoke tests
 *   --quiet   Only output on failure
 *
 * EXIT CODES:
 *   0 - All verifications passed
 *   1 - Build failed
 *   2 - Module import failed
 *   3 - Smoke test failed
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const QUIET = args.includes('--quiet');

const log = (msg) => !QUIET && console.log(msg);
const error = (msg) => console.error(msg);

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const pass = (msg) => log(`${colors.green}✓${colors.reset} ${msg}`);
const fail = (msg) => error(`${colors.red}✗${colors.reset} ${msg}`);
const info = (msg) => log(`${colors.blue}→${colors.reset} ${msg}`);
const section = (msg) => log(`\n${colors.bold}${msg}${colors.reset}`);

/**
 * Run a shell command and return promise
 */
function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT,
      shell: true,
      stdio: options.capture ? 'pipe' : 'inherit',
      ...options
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      proc.stdout?.on('data', (data) => stdout += data);
      proc.stderr?.on('data', (data) => stderr += data);
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed: ${cmd} ${args.join(' ')}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Level 1: Build Verification
 */
async function verifyBuild() {
  section('Level 1: Build Verification');

  try {
    info('Running npm run build...');
    await runCommand('npm', ['run', 'build'], { capture: QUIET });

    // Check output files exist
    const expectedFiles = [
      'dist/index.html',
      'dist/backtest/index.html',
      'dist/dashboard/index.html',
      'dist/spy-options/index.html',
      'dist/strategies/index.html',
      'dist/trading/index.html'
    ];

    for (const file of expectedFiles) {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) {
        throw new Error(`Missing expected output: ${file}`);
      }
    }

    pass('Build completed successfully');
    pass(`All ${expectedFiles.length} HTML pages generated`);
    return true;
  } catch (err) {
    fail(`Build failed: ${err.message}`);
    return false;
  }
}

/**
 * Level 2: Module Import Verification
 */
async function verifyModules() {
  section('Level 2: Module Import Verification');

  const modules = [
    { name: 'Core barrel', path: './src/core/index.js' },
    { name: 'Backtest engine', path: './src/core/backtest/engine.js' },
    { name: 'Statistics', path: './src/core/backtest/statistics.js' },
    { name: 'Trade tracker', path: './src/core/backtest/trade.js' },
    { name: 'OI Adapter', path: './src/core/backtest/sources/oi-adapter.js' },
    { name: 'IV Adapter', path: './src/core/backtest/sources/iv-adapter.js' },
    { name: 'Pattern Adapter', path: './src/core/backtest/sources/pattern-adapter.js' },
    { name: 'Daily Signal Adapter', path: './src/core/backtest/sources/daily-signal-adapter.js' },
    { name: 'Target-Stop Strategy', path: './src/core/backtest/strategies/target-stop.js' },
    { name: 'Fixed Bars Strategy', path: './src/core/backtest/strategies/fixed-bars.js' },
    { name: 'Indicators', path: './src/core/patterns/indicators.js' },
    { name: 'Pattern Detector', path: './src/core/patterns/detector.js' }
  ];

  let allPassed = true;

  for (const mod of modules) {
    const fullPath = join(ROOT, mod.path);

    if (!existsSync(fullPath)) {
      fail(`${mod.name}: File not found (${mod.path})`);
      allPassed = false;
      continue;
    }

    try {
      await import(fullPath);
      pass(mod.name);
    } catch (err) {
      fail(`${mod.name}: ${err.message}`);
      allPassed = false;
    }
  }

  return allPassed;
}

/**
 * Level 3: Smoke Tests
 */
async function runSmokeTests() {
  section('Level 3: Smoke Tests');

  let allPassed = true;

  // Test 1: Statistics module
  try {
    const { calculateStatistics } = await import(join(ROOT, 'src/core/backtest/statistics.js'));

    const mockTrades = [
      { pnl: 100, pnlPercent: 0.02, barsHeld: 5 },
      { pnl: -50, pnlPercent: -0.01, barsHeld: 3 },
      { pnl: 75, pnlPercent: 0.015, barsHeld: 4 }
    ];

    const stats = calculateStatistics(mockTrades, 10000);

    const requiredKeys = ['totalPnL', 'winRate', 'totalTrades'];
    for (const key of requiredKeys) {
      if (!(key in stats)) {
        throw new Error(`Missing key: ${key}`);
      }
    }

    pass('Statistics module: calculateStatistics works');
  } catch (err) {
    fail(`Statistics module: ${err.message}`);
    allPassed = false;
  }

  // Test 2: Indicators
  try {
    const indicators = await import(join(ROOT, 'src/core/patterns/indicators.js'));

    const mockData = [
      { close: 100, high: 101, low: 99 },
      { close: 102, high: 103, low: 100 },
      { close: 101, high: 104, low: 100 },
      { close: 103, high: 105, low: 101 },
      { close: 105, high: 106, low: 102 }
    ];

    if (typeof indicators.calculateSMA === 'function') {
      const sma = indicators.calculateSMA(mockData, 3);
      if (!Array.isArray(sma)) throw new Error('SMA should return array');
      pass('Indicators: SMA calculation works');
    }

    if (typeof indicators.calculateRSI === 'function') {
      pass('Indicators: RSI function exists');
    }

    if (typeof indicators.calculateEMA === 'function') {
      pass('Indicators: EMA function exists');
    }
  } catch (err) {
    fail(`Indicators: ${err.message}`);
    allPassed = false;
  }

  // Test 3: Backtest Engine
  try {
    const { BacktestEngine } = await import(join(ROOT, 'src/core/backtest/engine.js'));

    if (typeof BacktestEngine === 'function' || typeof BacktestEngine === 'object') {
      pass('Backtest Engine: Class/constructor exists');
    } else {
      throw new Error('BacktestEngine not exported properly');
    }
  } catch (err) {
    fail(`Backtest Engine: ${err.message}`);
    allPassed = false;
  }

  return allPassed;
}

/**
 * Main execution
 */
async function main() {
  log(`${colors.bold}OPPUT Verification${colors.reset}`);
  log(`Mode: ${FULL ? 'Full' : 'Standard'}`);
  log('─'.repeat(40));

  const results = {
    build: false,
    modules: false,
    smoke: true // Default to true if not running
  };

  // Level 1: Build
  results.build = await verifyBuild();
  if (!results.build) {
    error('\nBuild verification failed. Aborting.');
    process.exit(1);
  }

  // Level 2: Module Imports
  results.modules = await verifyModules();
  if (!results.modules) {
    error('\nModule import verification failed. Aborting.');
    process.exit(2);
  }

  // Level 3: Smoke Tests (only if --full)
  if (FULL) {
    results.smoke = await runSmokeTests();
    if (!results.smoke) {
      error('\nSmoke tests failed.');
      process.exit(3);
    }
  }

  // Summary
  section('Summary');
  const allPassed = Object.values(results).every(Boolean);

  if (allPassed) {
    log(`${colors.green}${colors.bold}All verifications passed!${colors.reset}`);
    process.exit(0);
  } else {
    log(`${colors.red}${colors.bold}Some verifications failed${colors.reset}`);
    process.exit(1);
  }
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
