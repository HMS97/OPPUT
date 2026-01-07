#!/usr/bin/env python3
"""
Lumibot Backtest Runner
Runs a single backtest and outputs JSON results

Usage: python lumibot_runner.py --start 2024-07-01 --end 2025-01-01 [options]
"""

import os
import sys
import io

# Save real stdout for final JSON output
_real_stdout = sys.stdout

# Redirect stdout/stderr to devnull BEFORE importing lumibot
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()

import json
import argparse
import logging
from datetime import datetime
import numpy as np

# Suppress all logging
logging.disable(logging.CRITICAL)
os.environ['LUMIBOT_LOG_LEVEL'] = 'CRITICAL'

# Load .env
from dotenv import load_dotenv
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(project_root, '.env'))

from lumibot.strategies import Strategy
from lumibot.backtesting import PolygonDataBacktesting, YahooDataBacktesting

# Restore stderr for error messages (but keep stdout suppressed until JSON output)
sys.stderr = sys.__stderr__


class OIScalpStrategy(Strategy):
    """OI-Scalp Mean Reversion Strategy"""

    parameters = {
        "symbol": "SPY",
        "wasp_period": 8,
        "entry_deviation": 0.05,
        "target_percent": 1.0,
        "stop_percent": 0.5,
        "position_size": 0.1,
        "timeframe": "1D",
    }

    def initialize(self):
        self.sleeptime = self.parameters.get("timeframe", "1D")
        self.prices = []
        self.last_signal_time = None
        self.cooldown_bars = 1
        self.in_position = False
        self.entry_price = None
        self.position_type = None
        self.trades_list = []
        self.wins = 0
        self.losses = 0
        self.equity_history = []

    def on_trading_iteration(self):
        symbol = self.parameters["symbol"]
        price = self.get_last_price(symbol)
        if price is None:
            return

        self.prices.append(price)

        # Record equity
        self.equity_history.append({
            "time": self.get_datetime().isoformat(),
            "equity": self.portfolio_value
        })

        wasp_period = self.parameters["wasp_period"]
        if len(self.prices) < wasp_period + 5:
            return

        wasp = np.mean(self.prices[-wasp_period:])
        deviation_pct = ((price - wasp) / wasp) * 100
        entry_dev = self.parameters["entry_deviation"]

        if self.in_position:
            self._check_exit(price)
            return

        signal = None
        if deviation_pct <= -entry_dev:
            signal = "CALL"
        elif deviation_pct >= entry_dev:
            signal = "PUT"

        if signal:
            self._enter_position(signal, price)

    def _enter_position(self, signal, price):
        symbol = self.parameters["symbol"]
        position_size = self.parameters["position_size"]
        qty = int((self.portfolio_value * position_size) / price)
        if qty < 1:
            return

        if signal == "CALL":
            order = self.create_order(symbol, quantity=qty, side="buy")
        else:
            order = self.create_order(symbol, quantity=qty, side="sell")

        self.submit_order(order)
        self.in_position = True
        self.entry_price = price
        self.position_type = signal
        self.last_signal_time = self.get_datetime()

    def _check_exit(self, current_price):
        if not self.in_position or self.entry_price is None:
            return

        target_pct = self.parameters["target_percent"]
        stop_pct = self.parameters["stop_percent"]

        if self.position_type == "CALL":
            pnl_pct = ((current_price - self.entry_price) / self.entry_price) * 100
        else:
            pnl_pct = ((self.entry_price - current_price) / self.entry_price) * 100

        should_exit = False
        reason = ""

        if pnl_pct >= target_pct:
            should_exit = True
            reason = "TARGET"
        elif pnl_pct <= -stop_pct:
            should_exit = True
            reason = "STOP"

        if should_exit:
            self._exit_position(current_price, reason, pnl_pct)

    def _exit_position(self, price, reason, pnl_pct):
        self.sell_all()

        trade = {
            "entry_time": self.last_signal_time.isoformat() if self.last_signal_time else "",
            "exit_time": self.get_datetime().isoformat(),
            "signal": self.position_type,
            "entry_price": float(self.entry_price),
            "exit_price": float(price),
            "pnl_percent": float(pnl_pct),
            "reason": reason
        }
        self.trades_list.append(trade)

        if pnl_pct > 0:
            self.wins += 1
        else:
            self.losses += 1

        self.in_position = False
        self.entry_price = None
        self.position_type = None

    def on_abrupt_closing(self):
        self.sell_all()


def main():
    parser = argparse.ArgumentParser(description='Run Lumibot backtest')
    parser.add_argument('--start', required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--symbol', default='SPY', help='Symbol to trade')
    parser.add_argument('--wasp-period', type=int, default=8, help='WASP period')
    parser.add_argument('--entry-deviation', type=float, default=0.05, help='Entry deviation %')
    parser.add_argument('--target-percent', type=float, default=1.0, help='Target %')
    parser.add_argument('--stop-percent', type=float, default=0.5, help='Stop %')
    parser.add_argument('--position-size', type=float, default=0.1, help='Position size (0-1)')
    parser.add_argument('--initial-capital', type=float, default=10000, help='Initial capital')
    parser.add_argument('--data-source', default='yahoo', choices=['yahoo', 'polygon'], help='Data source')
    parser.add_argument('--timeframe', default='1D', help='Timeframe: 1D, 1H, 15M, 5M, 1M')

    args = parser.parse_args()

    # Set strategy parameters
    OIScalpStrategy.parameters = {
        "symbol": args.symbol,
        "wasp_period": args.wasp_period,
        "entry_deviation": args.entry_deviation,
        "target_percent": args.target_percent,
        "stop_percent": args.stop_percent,
        "position_size": args.position_size,
        "timeframe": args.timeframe,
    }

    # Parse dates
    start_date = datetime.strptime(args.start, "%Y-%m-%d")
    end_date = datetime.strptime(args.end, "%Y-%m-%d")

    # Choose data source
    if args.data_source == "polygon" and os.environ.get("POLYGON_API_KEY"):
        backtesting_source = PolygonDataBacktesting
    else:
        backtesting_source = YahooDataBacktesting

    try:
        # Run backtest (suppress output)
        import io
        import contextlib

        # Capture stdout/stderr
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            results = OIScalpStrategy.run_backtest(
                backtesting_source,
                start_date,
                end_date,
                benchmark_asset=args.symbol,
                show_plot=False,
                show_tearsheet=False,
                save_tearsheet=False,
                budget=args.initial_capital,
            )

        if not results or not isinstance(results, tuple) or len(results) != 2:
            output = {"success": False, "error": "Backtest returned no results"}
        else:
            result_dict, strategy = results

            initial = args.initial_capital
            final = strategy.portfolio_value
            total_return = ((final - initial) / initial) * 100
            total_trades = strategy.wins + strategy.losses
            win_rate = (strategy.wins / total_trades * 100) if total_trades > 0 else 0

            # Extract metrics
            sharpe = 0
            max_drawdown = 0
            cagr = 0

            if isinstance(result_dict, dict):
                sharpe = float(result_dict.get("sharpe", 0) or 0)
                cagr = float(result_dict.get("cagr", 0) or 0)
                dd = result_dict.get("max_drawdown", {})
                if isinstance(dd, dict):
                    max_drawdown = float(dd.get("drawdown", 0) or 0) * 100
                elif isinstance(dd, (int, float)):
                    max_drawdown = float(dd) * 100

            output = {
                "success": True,
                "final_value": float(final),
                "total_return": float(total_return),
                "total_trades": total_trades,
                "wins": strategy.wins,
                "losses": strategy.losses,
                "win_rate": float(win_rate),
                "sharpe": float(sharpe),
                "max_drawdown": float(max_drawdown),
                "cagr": float(cagr * 100),
                "trades": strategy.trades_list[:100],
                "equity_curve": strategy.equity_history[::10][:500],
            }

    except Exception as e:
        output = {"success": False, "error": str(e)}

    # Output JSON to real stdout (bypassing suppression)
    _real_stdout.write(json.dumps(output))
    _real_stdout.write("\n")
    _real_stdout.flush()


if __name__ == "__main__":
    main()
