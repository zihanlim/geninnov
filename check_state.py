"""Check live Supabase state - v2 (without hype_score in signals history)."""
import os
from dotenv import dotenv_values
from supabase import create_client

vals = dotenv_values(".env")
os.environ.update({k: v for k, v in vals.items() if v})

c = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

print("=== theme_assets (per theme) ===")
ta = c.table("theme_assets").select("theme_id, ticker, run_date").order("theme_id").execute().data
by_theme = {}
for r in ta:
    by_theme.setdefault(r["theme_id"], []).append((r["ticker"], r["run_date"]))
for tid, items in by_theme.items():
    print(f"  {tid[:8]}: {len(items)} assets; latest run_date: {max(d for _,d in items)}; sample: {[t for t,_ in items[:3]]}")

print(f"\n=== Total theme_assets rows: {len(ta)} ===")
print(f"=== Distinct themes: {len(by_theme)} ===")

# Now also dump scored[0] from a re-run to debug
import sys
from pathlib import Path
sys.path.insert(0, 'scripts')
sys.path.insert(0, str(Path('scripts').parent / 'backend'))
import daily_refresh
from datetime import date

# Re-run just the steps up to rank_and_persist with prints
themes = daily_refresh.load_themes()
raw = daily_refresh.build_theme_signals(themes, date.today())
cfg = daily_refresh.load_config()
hyped = daily_refresh.compute_hype_scores(raw, cfg)
scored = daily_refresh.compute_trade_scores(hyped)

print(f"\n=== scored: {len(scored)} themes ===")
for s in scored:
    print(f"  {s['theme_id'][:8]}  hype={s['hype_score']:.2f}  trade={s['trade_score']:+.3f}  sent={s['avg_sentiment']:+.2f}")

print("\n=== rank_trade_candidates with threshold=50, top_n=5 ===")
from daily_refresh import load_theme_assets_map
theme_ids = [s["theme_id"] for s in scored]
asset_map = load_theme_assets_map(theme_ids, date.today())
for tid, assets in asset_map.items():
    print(f"  {tid[:8]}: {assets}")
longs, shorts = daily_refresh.rank_trade_candidates(scored, asset_map, 50.0, 5)
print(f"longs: {len(longs)}, shorts: {len(shorts)}")
for c in longs:
    print(f"  LONG: {c.asset} (theme={c.theme_id[:8]}, trade_score={c.trade_score:+.3f}, hype={c.hype_score:.2f})")
for c in shorts:
    print(f"  SHORT: {c.asset} (theme={c.theme_id[:8]}, trade_score={c.trade_score:+.3f}, hype={c.hype_score:.2f})")
