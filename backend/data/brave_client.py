"""
Fetches news via Brave Search MCP tool.
Uses subprocess to call a Node.js helper script that invokes the MCP tool.
Reason: MCP tools are Python-wrapped Node.js; we call the tool via CLI.
"""
import os
import subprocess
import json
from datetime import date, timedelta


def _mock_allowed() -> bool:
    """Whether the mock fallback may be used. Default on (for local dev + tests);
    set ANDROMEDA_ALLOW_MOCK=0 in production so a failed feed returns [] rather
    than fabricating data (RESIDUAL R0/R0b — prefer empty over fake)."""
    return os.environ.get("ANDROMEDA_ALLOW_MOCK", "1").strip().lower() not in ("0", "false", "no")


THEME_KEYWORDS = {
    "Fed Policy":       ["Federal Reserve", "FOMC", "interest rates", "monetary policy"],
    "Inflation":        ["CPI", "PPI", "PCE", "inflation", "price pressure", "hot CPI"],
    "China Growth":     ["China GDP", "PBOC", "Chinese economy", "China stimulus", "property crisis"],
    "US Dollar":        ["US dollar", "DXY", "currency", "FX", "dollar weakness", "dollar strength"],
    "Geopolitical Risk":["war", "sanctions", "NATO", "geopolitics", "conflict", "Taiwan"],
    "Corporate Credit":  ["credit spreads", "high yield", "junk bonds", "corporate bonds", "IG credit"],
    "Energy Prices":    ["crude oil", "OPEC", "natural gas", "energy prices", "WTI", "Brent"],
    "US Election":     ["election", "Democratic", "Republican", "campaign", "policy uncertainty"],
}

def fetch_news_for_theme(theme: str, lookback_days: int = 7) -> list[dict]:
    """
    Fetch news for a theme using Brave Search MCP.
    Returns list of {headline, date, url}.
    Falls back to mock data if MCP is unavailable (for local testing without credentials).
    """
    keywords = THEME_KEYWORDS.get(theme, [theme])
    query = " OR ".join(f'"{k}"' for k in keywords[:3])
    date_from = (date.today() - timedelta(days=lookback_days)).isoformat()

    try:
        result = subprocess.run(
            ["node", "scripts/call_brave_mcp.js", query, date_from],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            items = json.loads(result.stdout)
            # Tag provenance so mock data can never masquerade as real (R0b).
            for it in items:
                if isinstance(it, dict):
                    it.setdefault("source", "brave")
            return items
    except Exception:
        pass

    # Feed unavailable. In production (ANDROMEDA_ALLOW_MOCK=0) return nothing
    # rather than fabricate; only fall back to mock for local dev / tests.
    if not _mock_allowed():
        return []
    return _mock_news(theme, lookback_days)

def _mock_news(theme: str, lookback_days: int) -> list[dict]:
    """Return realistic mock news for testing without MCP credentials.

    Every item is source-tagged ``mock_brave`` so the pipeline can distinguish a
    real HypeScore from one computed off fallback data (RESIDUAL R0b).
    """
    return [
        {"headline": f"{theme} in focus as markets react to developments", "date": date.today().isoformat(), "url": "https://example.com", "source": "mock_brave"},
        {"headline": f"Investors eye {theme} amid uncertainty", "date": date.today().isoformat(), "url": "https://example.com", "source": "mock_brave"},
    ]
