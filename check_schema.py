"""Quick schema introspection helper for one-off use. Not part of the pipeline."""
import os
import sys
from pathlib import Path

from dotenv import dotenv_values
import requests

vals = dotenv_values(".env")
os.environ.update({k: v for k, v in vals.items() if v})

url = os.environ["SUPABASE_URL"] + "/rest/v1/"
headers = {
    "apikey": os.environ["SUPABASE_SERVICE_KEY"],
    "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_KEY"],
}

r = requests.get(url, headers=headers)
spec = r.json()
for table in ["theme_signals_history", "trade_candidates", "portfolio_positions", "portfolio_risk", "portfolio_returns"]:
    cols = spec.get("definitions", {}).get(table, {}).get("properties", {})
    print(f"--- {table} ---")
    for col, info in cols.items():
        t = info.get("type", info.get("$ref", "?"))
        fmt = info.get("format", "")
        print(f"  {col}: {t} {fmt}".rstrip())
    print()
