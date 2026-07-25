"""
L0: Polymarket prediction markets fetcher.

Pulls active macro-relevant events from Polymarket's public gamma API and
stores them in the prediction_markets table for the homepage / research
page to render. No API key required.

Covers:
- Fed rate decisions (next meeting, end of year)
- Fed rate cut / hike counts
- Recession probability
- Oil / WTI prices
- Geopolitical (China-Taiwan, Russia-Ukraine)
- Bitcoin price targets

Usage:
    from backend.data.polymarket_fetcher import PolymarketFetcher
    fetcher = PolymarketFetcher(supabase_url=..., supabase_key=...)
    markets = fetcher.fetch_macro_markets()
"""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from typing import Any

import requests
from supabase import Client, create_client

GAMMA_BASE = "https://gamma-api.polymarket.com"

# Keywords for macro-relevant events. Order matters for category inference —
# first match wins.
MACRO_KEYWORDS: list[tuple[str, list[str]]] = [
    ("Fed", ["fed decision", "fed rate", "fomc", "powell", "federal reserve"]),
    ("Rates", ["rate cut", "rate hike", "interest rate", "bps after", "no change in fed"]),
    ("Recession", ["recession", "unemployment rate", "gdp"]),
    ("Inflation", ["cpi", "inflation", "pce", "core cpi"]),
    ("Oil", ["wti", "crude oil", "brent"]),
    ("Bitcoin", ["bitcoin", "btc"]),
    ("Equities", ["s&p 500", "spy", "nasdaq 100", "russell"]),
    ("Geopolitics", ["china invade taiwan", "russia ukraine", "iran israel", "north korea"]),
    ("Tariffs", ["tariff"]),
    ("Crypto", ["ethereum", "eth", "solana"]),
]

# Limit: how many macro events to surface (top N by volume after filtering)
MAX_MARKETS = 8


def _categorize(title: str) -> str:
    t = title.lower()
    for cat, kws in MACRO_KEYWORDS:
        for kw in kws:
            # Whole-word (plural-tolerant) match, not substring: "eth" was matching
            # inside "Ethiopia", filing "Next Prime Minister of Ethiopia?" under Crypto
            # and — because a categorised event clears the Other filter — surfacing it
            # on the homepage as a macro market the book supposedly cites.
            if re.search(rf"\b{re.escape(kw)}s?\b", t):
                return cat
    return "Other"


def _fetch_events(limit: int = 200) -> list[dict]:
    """Fetch top active events from Polymarket gamma API."""
    try:
        resp = requests.get(
            f"{GAMMA_BASE}/events",
            params={
                "active": "true",
                "closed": "false",
                "limit": limit,
                "order": "volume",
                "ascending": "false",
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _pick_representative_market(markets: list[dict]) -> dict | None:
    """
    From a list of markets in an event, pick the one with the highest
    probability outcome that's not a long-shot (probability < 5%).
    """
    best = None
    best_balance = 0.0
    for m in markets:
        if m.get("closed"):
            continue
        try:
            prices = json.loads(m.get("outcomePrices", "[]"))
            outcomes = json.loads(m.get("outcomes", "[]"))
        except (ValueError, TypeError):
            continue
        if not prices or not outcomes or len(prices) != len(outcomes):
            continue
        # Find the most-probable outcome
        max_price = max(float(p) for p in prices)
        if max_price < 0.05:
            continue
        # Prefer markets where the leader has clear but not overwhelming lead
        balance = max_price if max_price < 0.95 else (1.0 - max_price)
        if balance > best_balance:
            best_balance = balance
            best = {"prices": prices, "outcomes": outcomes, "market": m}
    return best


class PolymarketFetcher:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)

    def fetch_macro_markets(self) -> list[dict[str, Any]]:
        """
        Fetch all events, filter to macro-relevant, take top MAX_MARKETS by volume.
        Returns list of dicts ready for upsert into prediction_markets.
        """
        events = _fetch_events()
        if not events:
            return []

        # Filter + sort by volume
        macro_events = []
        for e in events:
            title = e.get("title", "")
            cat = _categorize(title)
            if cat == "Other":
                continue
            vol = float(e.get("volume", 0) or 0)
            if vol < 100_000:  # filter tiny markets
                continue
            macro_events.append((vol, cat, e))

        macro_events.sort(key=lambda x: -x[0])
        macro_events = macro_events[:MAX_MARKETS]

        today = date.today().isoformat()
        rows: list[dict] = []
        for vol, cat, e in macro_events:
            markets = e.get("markets", [])
            rep = _pick_representative_market(markets)
            if not rep:
                continue
            top_outcome = rep["outcomes"][rep["prices"].index(max(rep["prices"], key=float))]
            top_price = max(float(p) for p in rep["prices"])
            market = rep["market"]
            end_date = (market.get("endDate") or "")[:10]
            slug = e.get("slug", "")
            rows.append({
                "slug": slug,
                "event_title": e.get("title", ""),
                "category": cat,
                "top_outcome": top_outcome,
                "top_price": round(top_price, 4),
                "outcomes": rep["outcomes"],
                "prices": [float(p) for p in rep["prices"]],
                "volume": vol,
                "end_date": end_date,
                "url": f"https://polymarket.com/event/{slug}" if slug else None,
                "fetched_at": datetime.utcnow().isoformat() + "Z",
            })

        if rows:
            # Wipe and replace — these are point-in-time snapshots
            self.supabase.table("prediction_markets").delete().neq("slug", "").execute()
            self.supabase.table("prediction_markets").insert(rows).execute()
        return rows


if __name__ == "__main__":
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if url and key:
        f = PolymarketFetcher(url, key)
        markets = f.fetch_macro_markets()
        print(f"Stored {len(markets)} prediction markets")
        for m in markets:
            print(f"  [{m['category']:12s}] {m['event_title'][:60]} | {m['top_outcome']}: {m['top_price']*100:.1f}%")
    else:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to run")
