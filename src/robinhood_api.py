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
    challenge_id: Optional[str] = None
    challenge_code: Optional[str] = None


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
    """Login with provided credentials and MFA code - handles verification challenges"""
    import secrets
    from robin_stocks.robinhood.helper import request_post, request_get, update_session, set_login_state
    from robin_stocks.robinhood.urls import login_url
    import pickle
    import os

    def generate_device_token():
        rands = [secrets.randbelow(256) for _ in range(16)]
        hexa = [str(hex(i + 256)).lstrip("0x")[1:] for i in range(256)]
        token = ""
        for i, r in enumerate(rands):
            token += hexa[r]
            if i in [3, 5, 7, 9]:
                token += "-"
        return token

    try:
        # Use stored device token if responding to challenge, otherwise generate new one
        device_token = request.challenge_id.split('|')[1] if request.challenge_id and '|' in request.challenge_id else generate_device_token()

        login_payload = {
            'client_id': 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
            'expires_in': 86400,
            'grant_type': 'password',
            'password': request.password,
            'scope': 'internal',
            'username': request.username,
            'device_token': device_token,
            'try_passkeys': False,
            'token_request_path': '/login',
            'create_read_only_secondary_token': True,
        }

        if request.mfa_code:
            login_payload['mfa_code'] = request.mfa_code

        # If responding to a challenge verification code
        if request.challenge_id and request.challenge_code:
            challenge_id = request.challenge_id.split('|')[0] if '|' in request.challenge_id else request.challenge_id
            challenge_url = f"https://api.robinhood.com/challenge/{challenge_id}/respond/"
            challenge_payload = {"response": request.challenge_code}
            challenge_response = request_post(url=challenge_url, payload=challenge_payload)

            if not challenge_response or challenge_response.get("status") != "validated":
                raise HTTPException(status_code=401, detail="Invalid verification code. Please try again.")

            # Challenge validated, now complete the login
            data = request_post(login_url(), login_payload)
            if data and 'access_token' in data:
                token = '{0} {1}'.format(data['token_type'], data['access_token'])
                update_session('Authorization', token)
                set_login_state(True)

                # Save session
                home_dir = os.path.expanduser("~")
                data_dir = os.path.join(home_dir, ".tokens")
                if not os.path.exists(data_dir):
                    os.makedirs(data_dir)
                pickle_path = os.path.join(data_dir, "robinhood.pickle")
                with open(pickle_path, 'wb') as f:
                    pickle.dump({
                        'token_type': data['token_type'],
                        'access_token': data['access_token'],
                        'refresh_token': data['refresh_token'],
                        'device_token': device_token
                    }, f)

                service.is_authenticated = True
                service.username = request.username
                return {"status": "authenticated", "username": request.username}
            raise HTTPException(status_code=401, detail="Login failed after verification")

        # Initial login attempt
        data = request_post(login_url(), login_payload)

        if not data:
            raise HTTPException(status_code=401, detail="Login failed - no response from Robinhood")

        # Check if verification workflow is required
        if 'verification_workflow' in data:
            workflow_id = data['verification_workflow']['id']

            # Start the verification process
            pathfinder_url = "https://api.robinhood.com/pathfinder/user_machine/"
            machine_payload = {'device_id': device_token, 'flow': 'suv', 'input': {'workflow_id': workflow_id}}
            machine_data = request_post(url=pathfinder_url, payload=machine_payload, json=True)

            if machine_data and "id" in machine_data:
                machine_id = machine_data["id"]
                inquiries_url = f"https://api.robinhood.com/pathfinder/inquiries/{machine_id}/user_view/"

                # Poll briefly to get challenge info
                import time
                for _ in range(3):
                    time.sleep(2)
                    inquiries_response = request_get(inquiries_url)

                    if inquiries_response and "context" in inquiries_response:
                        if "sheriff_challenge" in inquiries_response["context"]:
                            challenge = inquiries_response["context"]["sheriff_challenge"]
                            challenge_type = challenge.get("type", "sms")
                            challenge_id = challenge.get("id")

                            if challenge_type == "prompt":
                                # App-based verification required
                                return {
                                    "status": "app_approval_required",
                                    "challenge_id": f"{challenge_id}|{device_token}",
                                    "challenge_type": "app",
                                    "message": "Please approve the login in your Robinhood app, then click 'Continue'"
                                }
                            elif challenge_type in ["sms", "email"]:
                                return {
                                    "status": "challenge_required",
                                    "challenge_id": f"{challenge_id}|{device_token}",
                                    "challenge_type": challenge_type,
                                    "message": f"Enter the verification code sent via {challenge_type}"
                                }

            # Fallback - return generic challenge required
            return {
                "status": "challenge_required",
                "challenge_id": f"{workflow_id}|{device_token}",
                "challenge_type": "unknown",
                "message": "Verification required. Check your phone/email for a code or approve in the Robinhood app."
            }

        # Direct login success
        if 'access_token' in data:
            token = '{0} {1}'.format(data['token_type'], data['access_token'])
            update_session('Authorization', token)
            set_login_state(True)

            # Save session
            home_dir = os.path.expanduser("~")
            data_dir = os.path.join(home_dir, ".tokens")
            if not os.path.exists(data_dir):
                os.makedirs(data_dir)
            pickle_path = os.path.join(data_dir, "robinhood.pickle")
            with open(pickle_path, 'wb') as f:
                pickle.dump({
                    'token_type': data['token_type'],
                    'access_token': data['access_token'],
                    'refresh_token': data['refresh_token'],
                    'device_token': device_token
                }, f)

            service.is_authenticated = True
            service.username = request.username
            return {"status": "authenticated", "username": request.username}

        raise HTTPException(status_code=401, detail="Login failed - unexpected response")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


class AppApprovalRequest(BaseModel):
    challenge_id: str
    username: str
    password: str


@app.post("/login/check-app-approval")
async def check_app_approval(request: AppApprovalRequest):
    """Check if app-based verification has been approved"""
    from robin_stocks.robinhood.helper import request_get, request_post, update_session, set_login_state
    from robin_stocks.robinhood.urls import login_url
    import pickle
    import os

    try:
        parts = request.challenge_id.split('|')
        challenge_id = parts[0]
        device_token = parts[1] if len(parts) > 1 else ""

        # Check the challenge status
        prompt_url = f"https://api.robinhood.com/push/{challenge_id}/get_prompts_status/"
        prompt_status = request_get(url=prompt_url)

        if prompt_status and prompt_status.get("challenge_status") == "validated":
            # App approval received, complete the login
            login_payload = {
                'client_id': 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
                'expires_in': 86400,
                'grant_type': 'password',
                'password': request.password,
                'scope': 'internal',
                'username': request.username,
                'device_token': device_token,
                'try_passkeys': False,
                'token_request_path': '/login',
                'create_read_only_secondary_token': True,
            }

            data = request_post(login_url(), login_payload)
            if data and 'access_token' in data:
                token = '{0} {1}'.format(data['token_type'], data['access_token'])
                update_session('Authorization', token)
                set_login_state(True)

                # Save session
                home_dir = os.path.expanduser("~")
                data_dir = os.path.join(home_dir, ".tokens")
                if not os.path.exists(data_dir):
                    os.makedirs(data_dir)
                pickle_path = os.path.join(data_dir, "robinhood.pickle")
                with open(pickle_path, 'wb') as f:
                    pickle.dump({
                        'token_type': data['token_type'],
                        'access_token': data['access_token'],
                        'refresh_token': data['refresh_token'],
                        'device_token': device_token
                    }, f)

                service.is_authenticated = True
                service.username = request.username
                return {"status": "authenticated", "username": request.username}

        return {"status": "pending", "message": "Waiting for app approval..."}

    except Exception as e:
        return {"status": "pending", "message": str(e)}


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
