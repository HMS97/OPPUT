#!/usr/bin/env python3
"""
OI-Scalp Strategy using Lumibot
Mean reversion based on WASP (Weighted Average Strike Price) proxy

Install: pip install lumibot pandas numpy

Data Sources:
- Yahoo: Free, daily data only
- Polygon: Intraday data, requires API key
- ThetaData: Best for options, requires subscription
"""

from datetime import datetime, timedelta
import numpy as np
from lumibot.strategies import Strategy
from lumibot.backtesting import YahooDataBacktesting

class OIScalpStrategy(Strategy):
    """
    OI-Scalp Mean Reversion Strategy

    Signals:
    - CALL when price < WASP - deviation (underpriced)
    - PUT when price > WASP + deviation (overpriced)

    Uses SMA as WASP proxy for backtesting without options data.
    """

    parameters = {
        "symbol": "SPY",
        "wasp_period": 8,           # SMA period for WASP proxy
        "entry_deviation": 0.05,    # 0.05% deviation threshold
        "target_percent": 1.0,      # 1% profit target
        "stop_percent": 0.5,        # 0.5% stop loss
        "leverage": 10,             # Options leverage multiplier
        "position_size": 0.1,       # 10% of portfolio per trade
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
            self._check_exit(price)
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
            self._enter_position(signal, price)

    def _enter_position(self, signal, price):
        """Enter a new position"""
        symbol = self.parameters["symbol"]
        position_size = self.parameters["position_size"]

        # Calculate quantity based on portfolio
        qty = int((self.portfolio_value * position_size) / price)
        if qty < 1:
            return

        # For simplicity, we trade the underlying and simulate leverage via position sizing
        # In real options trading, you'd use self.create_order() with option Asset
        if signal == "CALL":
            order = self.create_order(symbol, quantity=qty, side="buy")
        else:
            order = self.create_order(symbol, quantity=qty, side="sell")

        self.submit_order(order)

        self.in_position = True
        self.entry_price = price
        self.position_type = signal
        self.last_signal_time = self.get_datetime()

        self.log_message(f"ENTRY: {signal} @ ${price:.2f}, qty={qty}")

    def _check_exit(self, current_price):
        """Check if we should exit the current position"""
        if not self.in_position or self.entry_price is None:
            return

        target_pct = self.parameters["target_percent"]
        stop_pct = self.parameters["stop_percent"]
        leverage = self.parameters["leverage"]

        # Calculate P&L
        if self.position_type == "CALL":
            pnl_pct = ((current_price - self.entry_price) / self.entry_price) * 100
        else:  # PUT
            pnl_pct = ((self.entry_price - current_price) / self.entry_price) * 100

        # Apply leverage to P&L calculation (simulating options)
        leveraged_pnl = pnl_pct * leverage

        # Check exit conditions
        should_exit = False
        reason = ""

        if leveraged_pnl >= target_pct:
            should_exit = True
            reason = f"TARGET HIT: {leveraged_pnl:.2f}%"
        elif leveraged_pnl <= -stop_pct:
            should_exit = True
            reason = f"STOP HIT: {leveraged_pnl:.2f}%"

        if should_exit:
            self._exit_position(current_price, reason)

    def _exit_position(self, price, reason):
        """Exit the current position"""
        symbol = self.parameters["symbol"]

        # Close all positions
        self.sell_all()

        self.log_message(f"EXIT: {reason} @ ${price:.2f}")

        self.in_position = False
        self.entry_price = None
        self.position_type = None

    def on_abrupt_closing(self):
        """Handle unexpected shutdown"""
        self.sell_all()


def run_backtest():
    """Run the backtest"""
    # Date range
    start_date = datetime(2024, 7, 1)
    end_date = datetime(2025, 1, 1)

    print("=" * 60)
    print(" OI-SCALP STRATEGY BACKTEST (Lumibot)")
    print("=" * 60)
    print(f"\nDate Range: {start_date.date()} to {end_date.date()}")
    print("\nParameters:")
    for k, v in OIScalpStrategy.parameters.items():
        print(f"  {k}: {v}")
    print()

    # Run backtest with Yahoo data (daily)
    # For intraday, use PolygonDataBacktesting with API key
    results = OIScalpStrategy.run_backtest(
        YahooDataBacktesting,
        start_date,
        end_date,
        benchmark_asset="SPY",
        show_plot=False,
        show_tearsheet=False,
        save_tearsheet=True,
        parameters=OIScalpStrategy.parameters,
    )

    print("\n" + "=" * 60)
    print(" RESULTS")
    print("=" * 60)

    if results:
        print(f"\nTotal Return: {results.get('total_return', 'N/A')}")
        print(f"Sharpe Ratio: {results.get('sharpe', 'N/A')}")
        print(f"Max Drawdown: {results.get('max_drawdown', 'N/A')}")
        print(f"Win Rate: {results.get('win_rate', 'N/A')}")
        print(f"Total Trades: {results.get('total_trades', 'N/A')}")

    print("\nTearsheet saved to logs/")
    return results


if __name__ == "__main__":
    run_backtest()
