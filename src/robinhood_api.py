"""
Robinhood FastAPI HTTP Bridge
Exposes RobinhoodService methods as REST endpoints for JavaScript integration
"""

import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio

from robinhood_service import RobinhoodService

app = FastAPI(
    title="Robinhood Trading API",
    description="HTTP bridge for Robinhood trading operations",
    version="1.0.0"
)

# Enable CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize service
service = RobinhoodService()


# ==================== REQUEST MODELS ====================

class StockOrderRequest(BaseModel):
    symbol: str
    quantity: int
    side: str  # 'buy' or 'sell'
    order_type: str = 'limit'  # 'limit' or 'market'
    limit_price: Optional[float] = None
    time_in_force: str = 'gtc'


class OptionOrderRequest(BaseModel):
    symbol: str
    strike: float
    expiry: str  # 'YYYY-MM-DD'
    option_type: str  # 'call' or 'put'
    quantity: int
    limit_price: float
    position_effect: str = 'open'  # 'open' or 'close'
    time_in_force: str = 'gtc'


class CloseOptionRequest(BaseModel):
    symbol: str
    strike: float
    expiry: str
    option_type: str
    quantity: int
    limit_price: float
    time_in_force: str = 'gtc'


class LoginRequest(BaseModel):
    username: str
    password: str
    mfa_code: Optional[str] = None


# ==================== HEALTH CHECK ====================

@app.get("/health")
async def health_check():
    """Check if service is running and authenticated"""
    return {
        "status": "ok",
        "authenticated": service.is_authenticated
    }


@app.post("/authenticate")
async def authenticate():
    """Authenticate with Robinhood using .env credentials"""
    success = await service.authenticate()
    if success:
        return {"status": "authenticated"}
    raise HTTPException(status_code=401, detail="Authentication failed")


@app.post("/login")
async def login(request: LoginRequest):
    """Login with provided credentials and MFA code"""
    try:
        import robin_stocks.robinhood as rh

        result = rh.login(
            username=request.username,
            password=request.password,
            mfa_code=request.mfa_code,
            store_session=True
        )

        if result:
            service.is_authenticated = True
            service.username = request.username
            return {"status": "authenticated", "username": request.username}
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials or MFA code")
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


# ==================== ACCOUNT ====================

@app.get("/account")
async def get_account():
    """Get account data"""
    data = await service.get_account_data()
    if data is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return data


@app.get("/buying-power")
async def get_buying_power():
    """Get current buying power"""
    power = await service.get_buying_power()
    if power is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"buying_power": power}


@app.get("/positions")
async def get_positions():
    """Get stock positions"""
    positions = await service.get_positions()
    return {"positions": positions}


@app.get("/positions/options")
async def get_option_positions():
    """Get option positions"""
    positions = await service.get_option_positions()
    return {"positions": positions}


# ==================== STOCK ORDERS ====================

@app.post("/order/stock")
async def place_stock_order(request: StockOrderRequest):
    """Place a stock order"""
    result = await service.place_stock_order(
        symbol=request.symbol,
        quantity=request.quantity,
        side=request.side,
        order_type=request.order_type,
        limit_price=request.limit_price,
        time_in_force=request.time_in_force
    )
    if result is None:
        raise HTTPException(status_code=400, detail="Order failed")
    return result


@app.delete("/order/stock/{order_id}")
async def cancel_stock_order(order_id: str):
    """Cancel a stock order"""
    success = await service.cancel_order(order_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cancel failed")
    return {"status": "cancelled", "order_id": order_id}


@app.get("/orders/stock")
async def get_stock_orders(limit: int = 10):
    """Get stock order history"""
    orders = await service.get_order_history(limit=limit)
    return {"orders": orders}


# ==================== OPTION ORDERS ====================

@app.post("/order/option")
async def place_option_order(request: OptionOrderRequest):
    """Place an options order (buy to open)"""
    result = await service.place_option_order(
        symbol=request.symbol,
        strike=request.strike,
        expiry=request.expiry,
        option_type=request.option_type,
        quantity=request.quantity,
        limit_price=request.limit_price,
        position_effect=request.position_effect,
        time_in_force=request.time_in_force
    )
    if result is None:
        raise HTTPException(status_code=400, detail="Option order failed")
    return result


@app.post("/order/option/close")
async def close_option_position(request: CloseOptionRequest):
    """Close an options position (sell to close)"""
    result = await service.close_option_position(
        symbol=request.symbol,
        strike=request.strike,
        expiry=request.expiry,
        option_type=request.option_type,
        quantity=request.quantity,
        limit_price=request.limit_price,
        time_in_force=request.time_in_force
    )
    if result is None:
        raise HTTPException(status_code=400, detail="Close option failed")
    return result


@app.delete("/order/option/{order_id}")
async def cancel_option_order(order_id: str):
    """Cancel an option order"""
    success = await service.cancel_option_order(order_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cancel failed")
    return {"status": "cancelled", "order_id": order_id}


@app.get("/orders/options")
async def get_option_orders(limit: int = 10):
    """Get option order history"""
    orders = await service.get_option_order_history(limit=limit)
    return {"orders": orders}


# ==================== OPTION CHAIN ====================

@app.get("/option-chain/{symbol}")
async def get_option_chain(symbol: str, expiry: Optional[str] = None):
    """Get option chain for a symbol"""
    chain = await service.get_option_chain(symbol=symbol, expiry=expiry)
    return {"symbol": symbol, "options": chain}


@app.get("/option-quote/{symbol}")
async def get_option_quote(
    symbol: str,
    strike: float,
    expiry: str,
    option_type: str
):
    """Get quote for a specific option contract"""
    quote = await service.get_option_quote(
        symbol=symbol,
        strike=strike,
        expiry=expiry,
        option_type=option_type
    )
    if quote is None:
        raise HTTPException(status_code=404, detail="Option not found")
    return quote


# ==================== STOCK QUOTES ====================

@app.get("/quote/{symbol}")
async def get_stock_quote(symbol: str):
    """Get stock quote"""
    quote = await service.get_stock_quote(symbol)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found")
    return quote


# ==================== LOGOUT ====================

@app.post("/logout")
async def logout():
    """Logout from Robinhood"""
    service.logout()
    return {"status": "logged_out"}


# ==================== RUN SERVER ====================

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("ROBINHOOD_API_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
