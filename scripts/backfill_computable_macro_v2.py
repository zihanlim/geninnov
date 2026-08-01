"""Re-run the computable_macro_runner with the now-real NDX parquet
in place, and write the JSONB to the latest regime row. Re-run
fact_extraction afterwards to mirror into structured_facts.

Replaces the now-stale write_all_macro.py helper.
"""
import os
import sys
import json
from datetime import date

sys.path.insert(0, r'C:\Users\zihan\projects\andromeda')

import pandas as pd
import psycopg2

# 1) Load NDX monthly returns from the parquet (now real, not fallback)
NDX_CACHE_PATH = r'C:\Users\zihan\projects\andromeda\backend\data\cache\seasonality.parquet'
df = pd.read_parquet(NDX_CACHE_PATH)
print(f"Parquet rows: {len(df)}, range: {df['date'].min()} -> {df['date'].max()}")
rows = [(d.date() if hasattr(d, 'date') else d, float(r)) for d, r in zip(df['date'], df['return_pct'])]

# 2) Compute ndx_seasonality
from backend.services.seasonality_analytics import compute_ndx_seasonality
as_of = date(2026, 7, 31)
ndx_result = compute_ndx_seasonality(rows, current_month=as_of.month)
aug_entry = next((m for m in ndx_result['per_month'] if m['month'] == 8), None)
print(f"ndx_seasonality: n_obs={ndx_result['n_observations']}, Aug mean={aug_entry.get('mean_pct') if aug_entry else None}")

# 3) Connect to DB
conn = psycopg2.connect(
    host='db.xrvwyubzraxzqiizicsg.supabase.co', port=5432,
    dbname='postgres', user='postgres', password='@andropmeda'
)
cur = conn.cursor()
cur.execute("SELECT run_date FROM regime_classifications ORDER BY run_date DESC LIMIT 1")
as_of = cur.fetchone()[0]
as_of_str = as_of.isoformat() if hasattr(as_of, 'isoformat') else str(as_of)
print(f"Latest regime: {as_of_str}")

# 4) Read SPX, DGS10, EPS
cur.execute("SELECT value FROM macro_daily_history WHERE series_id = '^SPX' AND trading_date <= %s ORDER BY trading_date DESC LIMIT 1", (as_of_str,))
spx = float(cur.fetchone()[0])
cur.execute("SELECT value FROM macro_daily_history WHERE series_id = 'DGS10' AND trading_date <= %s ORDER BY trading_date DESC LIMIT 1", (as_of_str,))
dgs10 = float(cur.fetchone()[0])
cur.execute("SELECT value FROM structured_facts WHERE entity = 'SPX' AND metric = 'trailing_eps_ttm'")
eps = float(cur.fetchone()[0])
print(f"SPX={spx}, DGS10={dgs10}, EPS={eps}")

# 5) Build JSONB
ey = (eps / spx) * 100
erp = ey - dgs10

# equity_bond_corr: 30d rolling correlation
cur.execute("""SELECT trading_date, value FROM macro_daily_history
               WHERE series_id IN ('^SPX', 'DGS10') AND trading_date <= %s
               ORDER BY trading_date DESC LIMIT 130""", (as_of_str,))
all_rows = cur.fetchall()
spx_map = {}
dgs_map = {}
for d, v in all_rows:
    if d in spx_map:
        dgs_map[d] = v
    else:
        spx_map[d] = v
common = sorted(set(spx_map) & set(dgs_map))[-30:]
corr = None
flip = 0
n = 0
if len(common) >= 20:
    spx_vals = [spx_map[d] for d in common]
    dgs_vals = [dgs_map[d] for d in common]
    spx_rets = [(spx_vals[i] - spx_vals[i-1]) / spx_vals[i-1] for i in range(1, len(spx_vals))]
    dgs_diffs = [dgs_vals[i] - dgs_vals[i-1] for i in range(1, len(dgs_vals))]
    n = min(len(spx_rets), len(dgs_diffs))
    if n >= 10:
        mean_s = sum(spx_rets) / n
        mean_d = sum(dgs_diffs) / n
        cov = sum((spx_rets[i] - mean_s) * (dgs_diffs[i] - mean_d) for i in range(n)) / n
        var_s = sum((x - mean_s) ** 2 for x in spx_rets) / n
        var_d = sum((x - mean_d) ** 2 for x in dgs_diffs) / n
        if var_s > 0 and var_d > 0:
            corr = cov / (var_s ** 0.5 * var_d ** 0.5)
            flip = 1 if dgs10 > 4.5 and corr < 0 else 0

# 6) ndx_seasonality
if aug_entry and aug_entry.get('mean_pct') is not None:
    ndx_value = round(aug_entry['mean_pct'], 3)
    ndx_status = "measured"
else:
    ndx_value = None
    ndx_status = "unknown"

payload = {
    "erp": {
        "status": "measured",
        "value": round(erp, 2),
        "unit": "pct",
        "as_of": as_of_str,
        "note": f"Earnings yield ({ey:.2f}%) - DGS10 ({dgs10:.2f}%)"
    },
    "equity_bond_corr": {
        "status": "measured" if corr is not None else "unknown",
        "value": round(corr, 3) if corr is not None else None,
        "unit": "correlation",
        "socgen_flip_active": flip,
        "as_of": as_of_str,
        "note": f"30d rolling correlation, n={n}" if corr is not None else "insufficient_history"
    },
    "ndx_seasonality": {
        "status": ndx_status,
        "value": ndx_value,
        "unit": "pct",
        "as_of": as_of_str,
        "current_month": as_of.month,
        "n_observations": ndx_result['n_observations'],
        "note": f"NDX August avg monthly return over {ndx_result['n_observations']} monthly observations"
    }
}

# 7) Write JSONB
cur.execute("UPDATE regime_classifications SET computable_macro = %s WHERE run_date = %s",
            (json.dumps(payload), as_of_str))
conn.commit()
print(f"\nWrote JSONB: erp={payload['erp']['value']}, eq_bond={payload['equity_bond_corr']['value']}, ndx_aug={payload['ndx_seasonality']['value']}")
conn.close()
