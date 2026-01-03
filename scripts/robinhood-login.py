#!/usr/bin/env python3
"""
Robinhood Login Script
Run this to authenticate with MFA and cache your session.

Usage:
    python scripts/robinhood-login.py
"""

import os
import sys

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from dotenv import load_dotenv
import robin_stocks.robinhood as rh

def main():
    # Load .env from project root
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    load_dotenv(env_path)

    username = os.getenv('ROBINHOOD_USERNAME')
    password = os.getenv('ROBINHOOD_PASSWORD')
    mfa_code = os.getenv('ROBINHOOD_MFA_CODE')

    if not username or not password:
        print("Error: ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD must be set in .env")
        print(f"Checked: {env_path}")
        sys.exit(1)

    print("=" * 50)
    print("Robinhood Login")
    print("=" * 50)
    print(f"Username: {username}")
    print()

    try:
        # If no MFA code in env, will prompt for it
        if mfa_code:
            print("Using MFA code from .env (TOTP secret)")
            result = rh.login(
                username=username,
                password=password,
                mfa_code=mfa_code,
                store_session=True
            )
        else:
            print("No MFA code in .env - you will be prompted...")
            print()
            # This will prompt for MFA code interactively
            result = rh.login(
                username=username,
                password=password,
                store_session=True
            )

        if result:
            print()
            print("=" * 50)
            print("SUCCESS! Session cached.")
            print("=" * 50)
            print()
            print("You can now:")
            print("1. Start the API server: cd src && uvicorn robinhood_api:app --port 8001")
            print("2. Use the trading page: npm run dev, then go to /trading/")
            print()

            # Quick test - get account info
            profile = rh.profiles.load_account_profile()
            if profile:
                buying_power = profile.get('buying_power', 'N/A')
                print(f"Buying Power: ${buying_power}")
        else:
            print("Login failed - check credentials")
            sys.exit(1)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        # Don't logout - keep session cached
        pass

if __name__ == "__main__":
    main()
