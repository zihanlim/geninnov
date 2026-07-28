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
    # ADR-0129. Only the first THREE are used to build the Brave query, so the
    # order is load-bearing: "AI capex" and "data center" are the phrases that
    # return the buildout story rather than consumer-AI coverage.
    "AI Capex":        ["AI capex", "data center", "AI infrastructure",
                        "hyperscaler", "GPU demand", "AI spending"],
}

# Short forms a headline actually uses, kept OUT of THEME_KEYWORDS because they
# are poor search queries — "fed", "oil" and "war" would each drag in a corpus far
# wider than the theme — but which unambiguously identify the theme when they turn
# up as a tracked phrase.
#
# Without these, `narrative_tracker.anchor_for_phrase` reported Fed Policy's own
# vocabulary as unwatched: measured on the live corpus, "fed" (9.3% share) and
# "rates" (7.7%) both came back `covered_by = None`, because "Federal Reserve"
# tokenises to {federal, reserve} and never matches the token "fed". Those are the
# two loudest false "nothing is watching this" claims the shortlist could make.
#
# This list only affects ATTRIBUTION of a phrase already discovered. It cannot
# make a narrative visible or invisible — that is MARKET_SEED_QUERIES' job — so
# adding to it narrows what the shortlist claims is unwatched, never what the
# tracker can see.
THEME_COVERAGE_ALIASES: dict[str, list[str]] = {
    "Fed Policy":        ["fed", "federal", "rates", "interest", "rate cut", "rate hike",
                         "powell", "hawkish", "dovish", "fomc meeting"],
    "Inflation":         ["prices", "disinflation", "deflation"],
    "China Growth":      ["china", "chinese", "beijing", "yuan", "renminbi"],
    "US Dollar":         ["dollar", "usd", "dollar index", "greenback", "euro", "yen", "forex"],
    "Geopolitical Risk": ["ukraine", "russia", "israel", "iran", "gaza", "tariffs", "tariff"],
    "Corporate Credit":  ["credit", "bonds", "junk", "spreads", "default", "leveraged loans"],
    "Energy Prices":     ["oil", "gas", "energy", "barrel", "crude", "opec"],
    "US Election":       ["trump", "biden", "harris", "congress", "senate",
                         "democrats", "republicans"],
    "AI Capex":          ["ai", "artificial intelligence", "nvidia", "chips",
                          "semiconductor", "gpu", "datacenter", "data centre",
                          "hyperscalers", "openai", "compute", "capex"],
}


def coverage_keywords() -> dict[str, list[str]]:
    """THEME_KEYWORDS plus the short forms, for narrative attribution only.

    Never use this to build a search query: the aliases are deliberately generic
    and would widen every fetch.
    """
    return {
        theme: [*keywords, *THEME_COVERAGE_ALIASES.get(theme, [])]
        for theme, keywords in THEME_KEYWORDS.items()
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
            # Decode the node process's stdout as UTF-8 explicitly. Without this,
            # text mode uses the locale codec (cp1252 on Windows), which cannot
            # decode the non-ASCII in real news headlines (em-dashes, curly quotes,
            # accented names) — byte 0x9d crashes the stdout reader thread, and the
            # dead thread hangs subprocess.run indefinitely, defeating even the
            # timeout. errors="replace" is a belt-and-suspenders guard.
            encoding="utf-8",
            errors="replace",
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

# ─── The un-themed corpus (ADR-0128) ─────────────────────────────────────────
#
# THEME_KEYWORDS above is a list of eight things to look for. Everything the
# pipeline could see was in it, which made theme discovery circular: the corpus
# was collected by asking for the eight themes, so clustering it could only ever
# return sub-themes of those eight. A narrative nothing had named — the AI capex
# cycle is the standing example — produced no headline, no mention count and no
# score, and was invisible rather than merely quiet.
#
# These queries are deliberately about the MARKET, not about a theme. They ask
# "what is financial news about today" and accept whatever comes back. That is the
# only kind of query whose results can contain a narrative we did not think of.
#
# They are still queries, and a query is still an editorial act — this widens the
# aperture, it does not remove it. What it buys is that the aperture is no longer
# the same eight labels the scoring layer already knows, so `narrative_tracker`
# reading this corpus is measuring something the anchors did not pre-select.
MARKET_SEED_QUERIES: list[str] = [
    '"stock market" OR "equities" OR "bond market"',
    '"investors" OR "traders" OR "fund managers"',
    '"global markets" OR "world economy" OR "central banks"',
    '"commodities" OR "currencies" OR "credit markets"',
    '"earnings" OR "guidance" OR "capital spending"',
]


def fetch_market_news(lookback_days: int = 7) -> list[dict]:
    """Fetch general market news — NOT scoped to any theme.

    Returns the same ``{headline, date, url, source}`` shape as
    ``fetch_news_for_theme``, deduplicated by headline across the seed queries
    (the queries overlap by design, so the same story arrives several times and
    would otherwise inflate its own document frequency).

    Returns ``[]`` — never mock data — when the feed is unavailable. This is the
    one fetcher where a fallback would be actively harmful: mock headlines are
    generated from a fixed template, so a narrative tracker reading them would
    "discover" the template's own vocabulary and report it as an emerging market
    narrative. An empty corpus produces no signal, which is the truth.
    """
    date_from = (date.today() - timedelta(days=lookback_days)).isoformat()
    seen: set[str] = set()
    out: list[dict] = []

    for query in MARKET_SEED_QUERIES:
        try:
            result = subprocess.run(
                ["node", "scripts/call_brave_mcp.js", query, date_from],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
            )
            if result.returncode != 0:
                continue
            items = json.loads(result.stdout)
        except Exception:
            continue

        for it in items or []:
            if not isinstance(it, dict):
                continue
            headline = (it.get("headline") or "").strip()
            if not headline:
                continue
            key = headline.lower()
            if key in seen:
                continue
            seen.add(key)
            it.setdefault("source", "brave_market")
            it["query"] = query
            out.append(it)

    return out


def _mock_news(theme: str, lookback_days: int) -> list[dict]:
    """Return realistic mock news for testing without MCP credentials.

    Every item is source-tagged ``mock_brave`` so the pipeline can distinguish a
    real HypeScore from one computed off fallback data (RESIDUAL R0b).
    """
    return [
        {"headline": f"{theme} in focus as markets react to developments", "date": date.today().isoformat(), "url": "https://example.com", "source": "mock_brave"},
        {"headline": f"Investors eye {theme} amid uncertainty", "date": date.today().isoformat(), "url": "https://example.com", "source": "mock_brave"},
    ]
