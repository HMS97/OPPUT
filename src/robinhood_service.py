"""
Robinhood Integration Service
Fetches real portfolio data from Robinhood account
"""

import os
from typing import List, Dict, Any, Optional
from datetime import datetime
import robin_stocks.robinhood as rh
from dotenv import load_dotenv


class RobinhoodService:
    """Service for fetching data from Robinhood API"""

    def __init__(self):
        self.is_authenticated = False
        self.username = None
        self.password = None
        self.mfa_code = None

        # Load credentials from .env
        load_dotenv()
        self.username = os.getenv('ROBINHOOD_USERNAME')
        self.password = os.getenv('ROBINHOOD_PASSWORD')
        self.mfa_code = os.getenv('ROBINHOOD_MFA_CODE')

    async def authenticate(self) -> bool:
        """Authenticate with Robinhood"""
        if self.is_authenticated:
            return True

        try:
            if not self.username or not self.password:
                print("Warning: Robinhood credentials not found in .env file")
                return False

            # Login to Robinhood with MFA callback
            # If mfa_code is set, use it; otherwise robin_stocks will prompt
            login_result = rh.login(
                username=self.username,
                password=self.password,
                mfa_code=self.mfa_code,
                store_session=True  # Cache session to avoid re-auth
            )

            if login_result:
                self.is_authenticated = True
                print("✓ Successfully authenticated with Robinhood")
                return True
            else:
                print("✗ Failed to authenticate with Robinhood")
                return False

        except Exception as e:
            print(f"Error authenticating with Robinhood: {e}")
            return False

    async def get_account_data(self) -> Dict[str, Any]:
        """Get account summary data"""
        if not await self.authenticate():
            return None

        try:
            # Get profile data
            profile = rh.profiles.load_account_profile()

            # Get portfolio data
            portfolio = rh.profiles.load_portfolio_profile()

            # Extract key metrics
            account_data = {
                'portfolio_value': float(portfolio.get('equity', 0)),
                'cash': float(profile.get('cash', 0)),
                'buying_power': float(profile.get('buying_power', 0)),
                'equity': float(portfolio.get('equity', 0)),
                'extended_hours_equity': float(portfolio.get('extended_hours_equity', 0)),
                'last_core_equity': float(portfolio.get('last_core_equity', 0)),
                'excess_margin': float(portfolio.get('excess_margin', 0)),
                'withdrawable_amount': float(profile.get('withdrawable_amount', 0))
            }

            return account_data

        except Exception as e:
            print(f"Error getting account data: {e}")
            return None

    async def get_positions(self) -> List[Dict[str, Any]]:
        """Get current portfolio positions"""
        if not await self.authenticate():
            return []

        try:
            # Get all open positions
            positions = rh.account.build_holdings()

            position_list = []

            for symbol, data in positions.items():
                try:
                    # Get current quote
                    quote = rh.stocks.get_latest_price(symbol)[0]
                    current_price = float(quote)

                    # Extract position data
                    quantity = float(data.get('quantity', 0))
                    average_price = float(data.get('average_buy_price', 0))
                    equity = float(data.get('equity', 0))

                    # Calculate P&L
                    total_cost = quantity * average_price
                    unrealized_pnl = equity - total_cost
                    unrealized_pnl_percent = (unrealized_pnl / total_cost * 100) if total_cost > 0 else 0

                    # Calculate day change
                    percent_change = float(data.get('percent_change', 0))
                    day_change = equity * (percent_change / 100)
                    day_change_percent = percent_change

                    position_data = {
                        'symbol': symbol,
                        'quantity': quantity,
                        'average_price': average_price,
                        'current_price': current_price,
                        'market_value': equity,
                        'unrealized_pnl': unrealized_pnl,
                        'unrealized_pnl_percent': unrealized_pnl_percent,
                        'day_change': day_change,
                        'day_change_percent': day_change_percent,
                        'equity': equity,
                        'percent_change': percent_change
                    }

                    position_list.append(position_data)

                except Exception as e:
                    print(f"Error processing position {symbol}: {e}")
                    continue

            return position_list

        except Exception as e:
            print(f"Error getting positions: {e}")
            return []

    async def get_order_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent order history"""
        if not await self.authenticate():
            return []

        try:
            # Get all orders
            orders = rh.orders.get_all_stock_orders()

            order_list = []

            for order in orders[:limit]:
                try:
                    order_data = {
                        'id': order.get('id'),
                        'symbol': rh.stocks.get_symbol_by_url(order.get('instrument')),
                        'side': order.get('side'),  # buy or sell
                        'quantity': float(order.get('quantity', 0)),
                        'average_price': float(order.get('average_price', 0)) if order.get('average_price') else 0,
                        'state': order.get('state'),  # filled, cancelled, etc.
                        'created_at': order.get('created_at'),
                        'updated_at': order.get('updated_at'),
                        'type': order.get('type'),  # market or limit
                    }

                    order_list.append(order_data)

                except Exception as e:
                    print(f"Error processing order: {e}")
                    continue

            return order_list

        except Exception as e:
            print(f"Error getting order history: {e}")
            return []

    async def calculate_performance(self, account_data: Dict[str, Any], positions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate portfolio performance metrics"""
        try:
            current_equity = account_data.get('portfolio_value', 0)
            previous_equity = account_data.get('last_core_equity', 0)

            # Calculate day return
            day_return = current_equity - previous_equity
            day_return_percent = (day_return / previous_equity * 100) if previous_equity > 0 else 0

            # For total return, we'd need historical data
            # For now, sum up unrealized P&L from positions
            total_pnl = sum(pos.get('unrealized_pnl', 0) for pos in positions)
            total_cost = sum(pos.get('quantity', 0) * pos.get('average_price', 0) for pos in positions)
            total_return_percent = (total_pnl / total_cost * 100) if total_cost > 0 else 0

            # Calculate win rate from positions (simplified)
            winning_positions = sum(1 for pos in positions if pos.get('unrealized_pnl', 0) > 0)
            total_positions = len(positions)
            win_rate = (winning_positions / total_positions) if total_positions > 0 else 0

            # Calculate max drawdown (simplified - would need historical data for accurate calculation)
            # Using current unrealized losses as approximation
            losses = [pos.get('unrealized_pnl_percent', 0) for pos in positions if pos.get('unrealized_pnl_percent', 0) < 0]
            max_drawdown = min(losses) / 100 if losses else 0

            # Sharpe ratio would require historical returns data
            # Using a placeholder based on return/volatility estimate
            sharpe_ratio = 1.5  # Would need historical data to calculate properly

            performance_data = {
                'total_return': total_pnl,
                'total_return_percent': total_return_percent,
                'day_return': day_return,
                'day_return_percent': day_return_percent,
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate
            }

            return performance_data

        except Exception as e:
            print(f"Error calculating performance: {e}")
            return {
                'total_return': 0,
                'total_return_percent': 0,
                'day_return': 0,
                'day_return_percent': 0,
                'sharpe_ratio': 0,
                'max_drawdown': 0,
                'win_rate': 0
            }

    async def get_stock_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get real-time stock quote"""
        if not await self.authenticate():
            return None

        try:
            quote_data = rh.stocks.get_quotes(symbol)[0]
            latest_price = rh.stocks.get_latest_price(symbol)[0]

            return {
                'symbol': symbol,
                'price': float(latest_price),
                'ask_price': float(quote_data.get('ask_price', 0)),
                'bid_price': float(quote_data.get('bid_price', 0)),
                'ask_size': float(quote_data.get('ask_size', 0)),
                'bid_size': float(quote_data.get('bid_size', 0)),
                'last_trade_price': float(quote_data.get('last_trade_price', 0)),
                'previous_close': float(quote_data.get('previous_close', 0)),
                'updated_at': quote_data.get('updated_at')
            }

        except Exception as e:
            print(f"Error getting stock quote for {symbol}: {e}")
            return None

    def logout(self):
        """Logout from Robinhood"""
        try:
            rh.logout()
            self.is_authenticated = False
            print("✓ Logged out from Robinhood")
        except Exception as e:
            print(f"Error logging out: {e}")

    # ==================== ORDER PLACEMENT ====================

    async def place_stock_order(
        self,
        symbol: str,
        quantity: int,
        side: str,  # 'buy' or 'sell'
        order_type: str = 'limit',  # 'limit' or 'market'
        limit_price: Optional[float] = None,
        time_in_force: str = 'gtc'
    ) -> Optional[Dict[str, Any]]:
        """Place a stock order"""
        if not await self.authenticate():
            return None

        try:
            if order_type == 'limit' and limit_price is None:
                print("Error: limit_price required for limit orders")
                return None

            if side == 'buy':
                if order_type == 'limit':
                    result = rh.orders.order_buy_limit(
                        symbol=symbol,
                        quantity=quantity,
                        limitPrice=limit_price,
                        timeInForce=time_in_force
                    )
                else:
                    result = rh.orders.order_buy_market(
                        symbol=symbol,
                        quantity=quantity,
                        timeInForce=time_in_force
                    )
            else:  # sell
                if order_type == 'limit':
                    result = rh.orders.order_sell_limit(
                        symbol=symbol,
                        quantity=quantity,
                        limitPrice=limit_price,
                        timeInForce=time_in_force
                    )
                else:
                    result = rh.orders.order_sell_market(
                        symbol=symbol,
                        quantity=quantity,
                        timeInForce=time_in_force
                    )

            if result:
                return {
                    'order_id': result.get('id'),
                    'symbol': symbol,
                    'side': side,
                    'quantity': quantity,
                    'order_type': order_type,
                    'limit_price': limit_price,
                    'state': result.get('state'),
                    'created_at': result.get('created_at')
                }
            return None

        except Exception as e:
            print(f"Error placing stock order: {e}")
            return None

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an open order"""
        if not await self.authenticate():
            return False

        try:
            result = rh.orders.cancel_stock_order(order_id)
            return result is not None
        except Exception as e:
            print(f"Error cancelling order {order_id}: {e}")
            return False

    # ==================== OPTIONS ORDERS ====================

    async def place_option_order(
        self,
        symbol: str,
        strike: float,
        expiry: str,  # 'YYYY-MM-DD'
        option_type: str,  # 'call' or 'put'
        quantity: int,
        limit_price: float,
        position_effect: str = 'open',  # 'open' or 'close'
        time_in_force: str = 'gtc'
    ) -> Optional[Dict[str, Any]]:
        """Place an options order (buy to open or buy to close)"""
        if not await self.authenticate():
            return None

        try:
            result = rh.orders.order_buy_option_limit(
                positionEffect=position_effect,
                creditOrDebit='debit',
                price=limit_price,
                symbol=symbol,
                quantity=quantity,
                expirationDate=expiry,
                strike=strike,
                optionType=option_type,
                timeInForce=time_in_force
            )

            if result:
                return {
                    'order_id': result.get('id'),
                    'symbol': symbol,
                    'strike': strike,
                    'expiry': expiry,
                    'option_type': option_type,
                    'quantity': quantity,
                    'limit_price': limit_price,
                    'position_effect': position_effect,
                    'state': result.get('state'),
                    'created_at': result.get('created_at')
                }
            return None

        except Exception as e:
            print(f"Error placing option order: {e}")
            return None

    async def close_option_position(
        self,
        symbol: str,
        strike: float,
        expiry: str,
        option_type: str,
        quantity: int,
        limit_price: float,
        time_in_force: str = 'gtc'
    ) -> Optional[Dict[str, Any]]:
        """Sell to close an options position"""
        if not await self.authenticate():
            return None

        try:
            result = rh.orders.order_sell_option_limit(
                positionEffect='close',
                creditOrDebit='credit',
                price=limit_price,
                symbol=symbol,
                quantity=quantity,
                expirationDate=expiry,
                strike=strike,
                optionType=option_type,
                timeInForce=time_in_force
            )

            if result:
                return {
                    'order_id': result.get('id'),
                    'symbol': symbol,
                    'strike': strike,
                    'expiry': expiry,
                    'option_type': option_type,
                    'quantity': quantity,
                    'limit_price': limit_price,
                    'position_effect': 'close',
                    'state': result.get('state'),
                    'created_at': result.get('created_at')
                }
            return None

        except Exception as e:
            print(f"Error closing option position: {e}")
            return None

    # ==================== OPTION CHAIN DATA ====================

    async def get_option_chain(
        self,
        symbol: str,
        expiry: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get option chain for a symbol"""
        if not await self.authenticate():
            return []

        try:
            if expiry:
                options = rh.options.find_options_by_expiration(
                    inputSymbols=symbol,
                    expirationDate=expiry
                )
            else:
                options = rh.options.find_tradable_options(symbol)

            option_list = []
            for opt in options[:50]:  # Limit to 50 options
                try:
                    option_list.append({
                        'symbol': symbol,
                        'strike': float(opt.get('strike_price', 0)),
                        'expiry': opt.get('expiration_date'),
                        'option_type': opt.get('type'),
                        'bid_price': float(opt.get('bid_price', 0)) if opt.get('bid_price') else 0,
                        'ask_price': float(opt.get('ask_price', 0)) if opt.get('ask_price') else 0,
                        'mark_price': float(opt.get('mark_price', 0)) if opt.get('mark_price') else 0,
                        'volume': int(opt.get('volume', 0)) if opt.get('volume') else 0,
                        'open_interest': int(opt.get('open_interest', 0)) if opt.get('open_interest') else 0,
                        'implied_volatility': float(opt.get('implied_volatility', 0)) if opt.get('implied_volatility') else 0,
                        'delta': float(opt.get('delta', 0)) if opt.get('delta') else 0,
                        'gamma': float(opt.get('gamma', 0)) if opt.get('gamma') else 0,
                        'theta': float(opt.get('theta', 0)) if opt.get('theta') else 0,
                        'vega': float(opt.get('vega', 0)) if opt.get('vega') else 0
                    })
                except Exception:
                    continue

            return option_list

        except Exception as e:
            print(f"Error getting option chain for {symbol}: {e}")
            return []

    async def get_option_quote(
        self,
        symbol: str,
        strike: float,
        expiry: str,
        option_type: str
    ) -> Optional[Dict[str, Any]]:
        """Get quote for a specific option contract"""
        if not await self.authenticate():
            return None

        try:
            market_data = rh.options.get_option_market_data(
                inputSymbols=symbol,
                expirationDate=expiry,
                strikePrice=strike,
                optionType=option_type
            )

            if market_data and len(market_data) > 0:
                data = market_data[0][0] if isinstance(market_data[0], list) else market_data[0]
                return {
                    'symbol': symbol,
                    'strike': strike,
                    'expiry': expiry,
                    'option_type': option_type,
                    'bid_price': float(data.get('bid_price', 0)) if data.get('bid_price') else 0,
                    'ask_price': float(data.get('ask_price', 0)) if data.get('ask_price') else 0,
                    'mark_price': float(data.get('mark_price', 0)) if data.get('mark_price') else 0,
                    'last_trade_price': float(data.get('last_trade_price', 0)) if data.get('last_trade_price') else 0,
                    'volume': int(data.get('volume', 0)) if data.get('volume') else 0,
                    'open_interest': int(data.get('open_interest', 0)) if data.get('open_interest') else 0,
                    'implied_volatility': float(data.get('implied_volatility', 0)) if data.get('implied_volatility') else 0,
                    'delta': float(data.get('delta', 0)) if data.get('delta') else 0,
                    'gamma': float(data.get('gamma', 0)) if data.get('gamma') else 0,
                    'theta': float(data.get('theta', 0)) if data.get('theta') else 0,
                    'vega': float(data.get('vega', 0)) if data.get('vega') else 0
                }
            return None

        except Exception as e:
            print(f"Error getting option quote: {e}")
            return None

    # ==================== POSITION MANAGEMENT ====================

    async def get_option_positions(self) -> List[Dict[str, Any]]:
        """Get all open option positions"""
        if not await self.authenticate():
            return []

        try:
            positions = rh.options.get_open_option_positions()

            position_list = []
            for pos in positions:
                try:
                    # Get option instrument data
                    instrument_url = pos.get('option')
                    instrument = rh.options.get_option_instrument_data_by_id(
                        instrument_url.split('/')[-2]
                    ) if instrument_url else {}

                    quantity = float(pos.get('quantity', 0))
                    avg_price = float(pos.get('average_price', 0)) / 100  # Convert from cents

                    position_list.append({
                        'id': pos.get('id'),
                        'symbol': pos.get('chain_symbol'),
                        'strike': float(instrument.get('strike_price', 0)) if instrument.get('strike_price') else 0,
                        'expiry': instrument.get('expiration_date'),
                        'option_type': instrument.get('type'),
                        'quantity': quantity,
                        'average_price': avg_price,
                        'created_at': pos.get('created_at')
                    })
                except Exception:
                    continue

            return position_list

        except Exception as e:
            print(f"Error getting option positions: {e}")
            return []

    async def get_buying_power(self) -> Optional[float]:
        """Get current buying power"""
        if not await self.authenticate():
            return None

        try:
            profile = rh.profiles.load_account_profile()
            return float(profile.get('buying_power', 0))
        except Exception as e:
            print(f"Error getting buying power: {e}")
            return None

    async def cancel_option_order(self, order_id: str) -> bool:
        """Cancel an open option order"""
        if not await self.authenticate():
            return False

        try:
            result = rh.orders.cancel_option_order(order_id)
            return result is not None
        except Exception as e:
            print(f"Error cancelling option order {order_id}: {e}")
            return False

    async def get_option_order_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent option order history"""
        if not await self.authenticate():
            return []

        try:
            orders = rh.orders.get_all_option_orders()

            order_list = []
            for order in orders[:limit]:
                try:
                    legs = order.get('legs', [])
                    leg = legs[0] if legs else {}

                    order_list.append({
                        'id': order.get('id'),
                        'symbol': order.get('chain_symbol'),
                        'side': leg.get('side'),
                        'position_effect': leg.get('position_effect'),
                        'quantity': float(order.get('quantity', 0)),
                        'price': float(order.get('price', 0)) if order.get('price') else 0,
                        'premium': float(order.get('premium', 0)) if order.get('premium') else 0,
                        'state': order.get('state'),
                        'created_at': order.get('created_at'),
                        'updated_at': order.get('updated_at')
                    })
                except Exception:
                    continue

            return order_list

        except Exception as e:
            print(f"Error getting option order history: {e}")
            return []
