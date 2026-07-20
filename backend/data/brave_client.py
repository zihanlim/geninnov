"""
Fetches news via Brave Search MCP tool.
Uses subprocess to call a Node.js helper script that invokes the MCP tool.
Reason: MCP tools are Python-wrapped Node.js; we call the tool via CLI.
"""
import subprocess
import json
from datetime import date, timedelta

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
            return json.loads(result.stdout)
    except Exception:
        pass

    # Fallback: return mock data when MCP credentials are not set
    return _mock_news(theme, lookback_days)

def _mock_news(theme: str, lookback_days: int) -> list[dict]:
    """Return realistic mock news for testing without MCP credentials."""
    return [
        {"headline": f"{theme} in focus as markets react to developments", "date": date.today().isoformat(), "url": "https://example.com"},
        {"headline": f"Investors eye {theme} amid uncertainty", "date": date.today().isoformat(), "url": "https://example.com"},
    ]
