#!/usr/bin/env python3
"""
Lumibot Backtest API Server
Runs Lumibot backtests and returns results as JSON for the UI

Run: uvicorn scripts.lumibot_api:app --host 0.0.0.0 --port 8002 --reload
"""

import os
import sys
import subprocess
import json
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load .env file from project root
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(project_root, '.env'))

app = FastAPI(title="Lumibot Backtest API", version="1.0.0")

# CORS for UI access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BacktestRequest(BaseModel):
    symbol: str = "SPY"
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    wasp_period: int = 8
    entry_deviation: float = 0.05
    target_percent: float = 1.0
    stop_percent: float = 0.5
    position_size: float = 0.1
    initial_capital: float = 10000
    data_source: str = "yahoo"  # yahoo or polygon
    timeframe: str = "1D"  # 1D, 1H, 15M, 5M, 1M


class BacktestResult(BaseModel):
    success: bool
    error: Optional[str] = None
    final_value: float = 0
    total_return: float = 0
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0
    sharpe: float = 0
    max_drawdown: float = 0
    cagr: float = 0
    trades: list = []
    equity_curve: list = []


def run_backtest(request: BacktestRequest) -> BacktestResult:
    """Run a Lumibot backtest via subprocess to avoid signal handler issues"""
    import subprocess

    try:
        # Build command
        script_path = os.path.join(project_root, "scripts", "lumibot_runner.py")
        python_path = sys.executable

        cmd = [
            python_path, script_path,
            "--start", request.start_date,
            "--end", request.end_date,
            "--symbol", request.symbol,
            "--wasp-period", str(request.wasp_period),
            "--entry-deviation", str(request.entry_deviation),
            "--target-percent", str(request.target_percent),
            "--stop-percent", str(request.stop_percent),
            "--position-size", str(request.position_size),
            "--initial-capital", str(request.initial_capital),
            "--data-source", request.data_source,
            "--timeframe", request.timeframe,
        ]

        # Run subprocess
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            env={**os.environ, "POLYGON_API_KEY": os.environ.get("POLYGON_API_KEY", "")},
        )

        if result.returncode != 0:
            return BacktestResult(success=False, error=f"Runner failed: {result.stderr}")

        # Parse JSON output
        try:
            output = json.loads(result.stdout.strip())
        except json.JSONDecodeError as e:
            return BacktestResult(success=False, error=f"Invalid JSON: {result.stdout[:500]}")

        # Return parsed output directly
        return BacktestResult(
            success=True,
            final_value=output.get("final_value", 0),
            total_return=output.get("total_return", 0),
            total_trades=output.get("total_trades", 0),
            wins=output.get("wins", 0),
            losses=output.get("losses", 0),
            win_rate=output.get("win_rate", 0),
            sharpe=output.get("sharpe", 0),
            max_drawdown=output.get("max_drawdown", 0),
            cagr=output.get("cagr", 0),
            trades=output.get("trades", []),
            equity_curve=output.get("equity_curve", []),
        )

    except subprocess.TimeoutExpired:
        return BacktestResult(success=False, error="Backtest timed out (5 min limit)")
    except Exception as e:
        return BacktestResult(success=False, error=str(e))


@app.get("/")
def root():
    return {"status": "ok", "service": "Lumibot Backtest API"}


@app.post("/backtest", response_model=BacktestResult)
def backtest(request: BacktestRequest):
    """Run a backtest with the given parameters"""
    return run_backtest(request)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "polygon_api_key": bool(os.environ.get("POLYGON_API_KEY")),
        "data_sources": ["yahoo"] + (["polygon"] if os.environ.get("POLYGON_API_KEY") else [])
    }


if __name__ == "__main__":
    import uvicorn
    print("Starting Lumibot Backtest API on port 8002...")
    print(f"Polygon API Key: {'Yes' if os.environ.get('POLYGON_API_KEY') else 'No'}")
    # Use loop="none" to avoid signal handler issues
    uvicorn.run(app, host="0.0.0.0", port=8002, loop="asyncio")
