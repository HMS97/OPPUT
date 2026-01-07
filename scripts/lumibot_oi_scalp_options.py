#!/usr/bin/env python3
"""
OI-Scalp Options Strategy using Lumibot
Proper options backtesting with real option prices

Data Sources:
- Polygon: Stock + Options data (requires API key, free tier available)
- ThetaData: Best for options (requires subscription)

Install: pip install lumibot pandas numpy

Run: python scripts/lumibot_oi_scalp_options.py
"""

import os
from datetime import datetime, timedelta, date
import numpy as np
from lumibot.strategies import Strategy
from lumibot.backtesting import PolygonDataBacktesting, YahooDataBacktesting
from lumibot.entities import Asset

# Try to load Polygon API key from environment
POLYGON_API_KEY = os.environ.get('POLYGON_API_KEY', '')


class OIScalpOptionsStrategy(Strategy):
    """
    OI-Scalp Mean Reversion Strategy with Real Options

    Uses WASP (SMA proxy) for mean reversion signals.
    Trades actual SPY options with proper pricing.

    Optimized parameters (from 840-combination grid search):
    - WASP Period: 8
    - Entry Deviation: 0.05%
    - Target: 1.0% (underlying)
    - Stop: 0.5% (underlying)
    """

    parameters = {
        "symbol": "SPY",
        "wasp_period": 8,           # SMA period for WASP proxy
        "entry_deviation": 0.05,    # 0.05% deviation threshold
        "target_percent": 1.0,      # 1% underlying target
        "stop_percent": 0.5,        # 0.5% underlying stop
        "position_size": 0.1,       # 10% of portfolio per trade
        "dte_min": 5,               # Minimum days to expiration
        "dte_max": 14,              # Maximum days to expiration (2 weeks)
        "delta_target": 0.5,        # Target delta for ATM options
    }

    def initialize(self):
        """Initialize strategy state"""
        self.sleeptime = "5M"  # 5-minute bars
        self.prices = []
        self.last_signal_time = None
        self.cooldown_bars = 1
        self.in_position = False
        self.entry_price = None
        self.position_type = None  # 'CALL' or 'PUT'
        self.option_position = None
        self.entry_option_price = None

        # Track statistics
        self.trades = []
        self.wins = 0
        self.losses = 0

    def on_trading_iteration(self):
        """Main trading logic - runs every bar"""
        symbol = self.parameters["symbol"]

        # Get current price
        price = self.get_last_price(symbol)
        if price is None:
            return

        self.prices.append(price)

        # Need enough data for SMA
        wasp_period = self.parameters["wasp_period"]
        if len(self.prices) < wasp_period + 10:
            return

        # Calculate WASP proxy (SMA)
        wasp = np.mean(self.prices[-wasp_period:])

        # Calculate deviation
        deviation_pct = ((price - wasp) / wasp) * 100
        entry_dev = self.parameters["entry_deviation"]

        # Check exit conditions first
        if self.in_position:
            self._check_exit(price, wasp)
            return

        # Check cooldown
        if self.last_signal_time:
            time_diff = self.get_datetime() - self.last_signal_time
            if time_diff < timedelta(minutes=5 * self.cooldown_bars):
                return

        # Generate signals
        signal = None
        if deviation_pct <= -entry_dev:
            signal = "CALL"  # Price below WASP - expect reversion up
        elif deviation_pct >= entry_dev:
            signal = "PUT"   # Price above WASP - expect reversion down

        if signal:
            self._enter_option_position(signal, price)

    def _get_option_asset(self, signal, current_price):
        """Get the appropriate option contract"""
        symbol = self.parameters["symbol"]

        try:
            # Get option chain
            chains = self.get_chains(Asset(symbol=symbol))
            if not chains:
                self.log_message(f"No option chains available for {symbol}")
                return None

            # Find expiration in target range
            dte_min = self.parameters["dte_min"]
            dte_max = self.parameters["dte_max"]
            today = self.get_datetime().date()

            expirations = self.get_expiration(chains)
            target_expiry = None

            for exp in sorted(expirations):
                exp_date = exp if isinstance(exp, date) else exp.date()
                dte = (exp_date - today).days
                if dte_min <= dte <= dte_max:
                    target_expiry = exp_date
                    break

            if not target_expiry:
                self.log_message(f"No suitable expiration found ({dte_min}-{dte_max} DTE)")
                return None

            # Get strikes
            strikes = self.get_strikes(chains)
            if not strikes:
                return None

            # Find ATM strike
            atm_strike = min(strikes, key=lambda x: abs(x - current_price))

            # Create option asset
            right = "CALL" if signal == "CALL" else "PUT"
            option_asset = Asset(
                symbol=symbol,
                asset_type=Asset.AssetType.OPTION,
                expiration=target_expiry,
                strike=atm_strike,
                right=right
            )

            return option_asset

        except Exception as e:
            self.log_message(f"Error getting option: {e}")
            return None

    def _enter_option_position(self, signal, price):
        """Enter a new options position"""
        symbol = self.parameters["symbol"]
        position_size = self.parameters["position_size"]

        # Get option contract
        option_asset = self._get_option_asset(signal, price)

        if option_asset is None:
            # Fallback to stock trading if options not available
            self.log_message(f"Options not available, trading stock for {signal}")
            qty = int((self.portfolio_value * position_size) / price)
            if qty < 1:
                return

            if signal == "CALL":
                order = self.create_order(symbol, quantity=qty, side="buy")
            else:
                order = self.create_order(symbol, quantity=qty, side="sell")

            self.submit_order(order)
            self.option_position = None
        else:
            # Trade options
            option_price = self.get_last_price(option_asset)
            if option_price is None or option_price <= 0:
                self.log_message(f"No price for option {option_asset}")
                return

            # Calculate number of contracts
            contract_cost = option_price * 100  # Each contract = 100 shares
            contracts = int((self.portfolio_value * position_size) / contract_cost)
            contracts = max(1, contracts)

            order = self.create_order(option_asset, quantity=contracts, side="buy")
            self.submit_order(order)

            self.option_position = option_asset
            self.entry_option_price = option_price
            self.log_message(f"OPTION ENTRY: {signal} {option_asset.strike} {option_asset.expiration} @ ${option_price:.2f} x {contracts}")

        self.in_position = True
        self.entry_price = price
        self.position_type = signal
        self.last_signal_time = self.get_datetime()

        self.log_message(f"ENTRY: {signal} @ ${price:.2f}")

    def _check_exit(self, current_price, wasp):
        """Check if we should exit the current position"""
        if not self.in_position or self.entry_price is None:
            return

        target_pct = self.parameters["target_percent"]
        stop_pct = self.parameters["stop_percent"]

        # Calculate underlying P&L
        if self.position_type == "CALL":
            underlying_pnl_pct = ((current_price - self.entry_price) / self.entry_price) * 100
        else:  # PUT
            underlying_pnl_pct = ((self.entry_price - current_price) / self.entry_price) * 100

        # Check exit conditions based on underlying
        should_exit = False
        reason = ""

        if underlying_pnl_pct >= target_pct:
            should_exit = True
            reason = f"TARGET HIT: {underlying_pnl_pct:.2f}%"
        elif underlying_pnl_pct <= -stop_pct:
            should_exit = True
            reason = f"STOP HIT: {underlying_pnl_pct:.2f}%"

        if should_exit:
            self._exit_position(current_price, reason, underlying_pnl_pct)

    def _exit_position(self, price, reason, pnl_pct):
        """Exit the current position"""
        # Close all positions
        self.sell_all()

        # Calculate actual option P&L if we have an option position
        if self.option_position and self.entry_option_price:
            exit_option_price = self.get_last_price(self.option_position)
            if exit_option_price:
                option_pnl_pct = ((exit_option_price - self.entry_option_price) / self.entry_option_price) * 100
                if self.position_type == "PUT":
                    # PUT profits when price goes down
                    option_pnl_pct = -option_pnl_pct if option_pnl_pct < 0 else -option_pnl_pct

                self.log_message(f"EXIT: {reason} | Underlying: {pnl_pct:.2f}% | Option: {option_pnl_pct:.2f}% @ ${exit_option_price:.2f}")

                # Track win/loss based on actual option P&L
                if option_pnl_pct > 0:
                    self.wins += 1
                else:
                    self.losses += 1

                self.trades.append({
                    'entry_price': self.entry_price,
                    'exit_price': price,
                    'signal': self.position_type,
                    'underlying_pnl': pnl_pct,
                    'option_entry': self.entry_option_price,
                    'option_exit': exit_option_price,
                    'option_pnl': option_pnl_pct,
                    'reason': reason
                })
        else:
            self.log_message(f"EXIT: {reason} @ ${price:.2f} | Underlying P&L: {pnl_pct:.2f}%")
            if pnl_pct > 0:
                self.wins += 1
            else:
                self.losses += 1

        self.in_position = False
        self.entry_price = None
        self.position_type = None
        self.option_position = None
        self.entry_option_price = None

    def on_abrupt_closing(self):
        """Handle unexpected shutdown"""
        self.sell_all()

    def on_strategy_end(self):
        """Called when strategy ends - print summary"""
        total_trades = self.wins + self.losses
        win_rate = (self.wins / total_trades * 100) if total_trades > 0 else 0

        self.log_message("=" * 60)
        self.log_message(" STRATEGY SUMMARY")
        self.log_message("=" * 60)
        self.log_message(f"Total Trades: {total_trades}")
        self.log_message(f"Wins: {self.wins}")
        self.log_message(f"Losses: {self.losses}")
        self.log_message(f"Win Rate: {win_rate:.1f}%")
        self.log_message(f"Final Portfolio Value: ${self.portfolio_value:.2f}")
        self.log_message("=" * 60)


def run_backtest():
    """Run the backtest"""
    # Date range
    start_date = datetime(2024, 7, 1)
    end_date = datetime(2025, 1, 1)

    print("=" * 60)
    print(" OI-SCALP OPTIONS STRATEGY BACKTEST (Lumibot)")
    print("=" * 60)
    print(f"\nDate Range: {start_date.date()} to {end_date.date()}")
    print("\nParameters:")
    for k, v in OIScalpOptionsStrategy.parameters.items():
        print(f"  {k}: {v}")
    print()

    # Choose data source
    if POLYGON_API_KEY:
        print(f"Using Polygon data source (API key found)")
        backtesting_source = PolygonDataBacktesting
        os.environ['POLYGON_API_KEY'] = POLYGON_API_KEY
    else:
        print("Using Yahoo data source (stock-only, no options)")
        print("Set POLYGON_API_KEY environment variable for options backtesting")
        backtesting_source = YahooDataBacktesting

    # Run backtest
    try:
        results = OIScalpOptionsStrategy.run_backtest(
            backtesting_source,
            start_date,
            end_date,
            benchmark_asset="SPY",
            show_plot=False,
            show_tearsheet=False,
            save_tearsheet=True,
            parameters=OIScalpOptionsStrategy.parameters,
        )

        print("\n" + "=" * 60)
        print(" RESULTS")
        print("=" * 60)

        if results:
            # Lumibot returns tuple (backtest_result_dict, strategy_instance)
            if isinstance(results, tuple) and len(results) == 2:
                result_dict, strategy = results

                # Print strategy stats
                print(f"\nFinal Portfolio Value: ${strategy.portfolio_value:,.2f}")
                total = strategy.wins + strategy.losses
                print(f"Total Trades: {total}")
                print(f"Wins: {strategy.wins}")
                print(f"Losses: {strategy.losses}")
                if total > 0:
                    print(f"Win Rate: {strategy.wins/total*100:.1f}%")

                # Calculate return
                initial = 100000
                final = strategy.portfolio_value
                total_return = ((final - initial) / initial) * 100
                print(f"Total Return: {total_return:.2f}%")

                # Print result dict metrics
                if isinstance(result_dict, dict):
                    print(f"\nPerformance Metrics:")
                    for key in ['cagr', 'volatility', 'sharpe', 'max_drawdown', 'sortino']:
                        if key in result_dict:
                            val = result_dict[key]
                            if isinstance(val, (int, float)):
                                print(f"  {key}: {val:.4f}")
                            else:
                                print(f"  {key}: {val}")

                # Show trade details
                if strategy.trades:
                    print(f"\nSample trades (first 5):")
                    for i, t in enumerate(strategy.trades[:5]):
                        pnl = t.get('option_pnl', t.get('underlying_pnl', 0))
                        print(f"  {i+1}. {t['signal']} @ ${t['entry_price']:.2f} -> ${t['exit_price']:.2f} = {pnl:.2f}%")
            else:
                print(f"Unexpected result format: {type(results)}")

        print("\nTearsheet saved to logs/")
        return results

    except Exception as e:
        print(f"\nError running backtest: {e}")
        print("\nTroubleshooting:")
        print("1. For Polygon: Set POLYGON_API_KEY environment variable")
        print("2. For ThetaData: Install lumibot[thetadata] and set THETADATA_USERNAME/PASSWORD")
        print("3. Yahoo only supports stock data, not options")
        return None


if __name__ == "__main__":
    run_backtest()
