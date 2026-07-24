"""
Book metrics computation — quant book construction layer.

Added after initial review to close the gap between
"LLM narrates HypeScore rankings" and "a coherent risk-controlled portfolio."

Functions:
  compute_book_metrics        — value-weighted factor tilts + net/gross exposure
  compute_correlation_matrix  — 252d Pearson correlation of pick returns, flags high-corr pairs
  fetch_pick_returns          — pull daily close prices for pick assets via yfinance
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf


# ─────────────────────────────────────────────────────────────────────────────
# Asset metadata
# ─────────────────────────────────────────────────────────────────────────────

# Sector and geography mappings for the Tier 1 universe.
# Keyed by ETF/common equity ticker.
SECTOR_MAP: dict[str, str] = {
    # Fixed income
    "TLT":   "Rates",
    "SVXY":  "Rates",
    "IEF":   "Rates",
    "SHY":   "Rates",
    "AGG":   "Rates",
    "LQD":   "Credit",
    "HYG":   "Credit",
    "JNK":   "Credit",
    "BKLN":  "Credit",
    "ANGL":  "Credit",
    "EMB":   "Credit",
    "BIL":   "Rates",
    # Metals / inflation
    "GLD":   "Metals",
    "SLV":   "Metals",
    "TIPS":  "Inflation",
    # FX
    "UUP":   "FX",
    "FXE":   "FX",
    "EWZ":   "FX-EM",
    # China equities
    "FXI":   "China Equities",
    "MCHI":  "China Equities",
    "BABA":  "China Equities",
    "KWEB":  "China Equities",
    # Geopolitical / defensive
    "EWJ":   "Japan Equities",
    "EFA":   "Developed Equities",
    "EEM":   "EM Equities",
    # Energy
    "XLE":   "Energy",
    "OIH":   "Energy",
    "CL":    "Energy-Commodity",
    "UNG":   "Energy-NatGas",
    # US election
    "QQQ":   "Tech Growth",
    "XLV":   "Healthcare",
    "XLF":   "Financials",
    "ARKK":  "Disruptive Innovation",
    # US equities (broad market ETFs)
    "SPY":   "US Equities",
    "IWM":   "US Equities",
    "BULL":  "US Equities",
    # Metals / inflation
    "GDX":   "Gold Miners",
    "IAU":   "Gold",
    # Single companies (ADR-0043) — see the ADR for why each maps to its theme.
    "JPM":   "Financials",
    "GS":    "Financials",
    "XOM":   "Energy",
    "CVX":   "Energy",
    "SLB":   "Energy",
    "UNH":   "Healthcare",
    "LMT":   "Defense",
    "NOC":   "Defense",
    "RTX":   "Defense",
    "F":     "Autos",
    "JD":    "China Equities",
    "PDD":   "China Equities",
    "FCX":   "Metals",
    "NEM":   "Gold Miners",
    "NUE":   "Metals",
}

GEO_MAP: dict[str, str] = {
    "TLT":   "US",
    "SVXY":  "US",
    "IEF":   "US",
    "SHY":   "US",
    "AGG":   "US",
    "LQD":   "US",
    "HYG":   "US",
    "JNK":   "US",
    "BKLN":  "US",
    "ANGL":  "US",
    "EMB":   "EM",
    "BIL":   "US",
    "GLD":   "Global",
    "SLV":   "Global",
    "TIPS":  "US",
    "UUP":   "US",
    "FXE":   "Europe",
    "EWZ":   "EM",
    "FXI":   "China",
    "MCHI":  "China",
    "BABA":  "China",
    "KWEB":  "China",
    "EWJ":   "Japan",
    "EFA":   "DM ex-US",
    "EEM":   "EM",
    "XLE":   "US",
    "OIH":   "US",
    "CL":    "Global",
    "UNG":   "Global",
    "QQQ":   "US",
    "XLV":   "US",
    "XLF":   "US",
    "ARKK":  "US",
    "SPY":   "US",
    "IWM":   "US",
    "BULL":  "US",
    "GDX":   "Global",
    "IAU":   "Global",
    # Single companies (ADR-0043)
    "JPM":   "US",
    "GS":    "US",
    "XOM":   "US",
    "CVX":   "US",
    "SLB":   "US",
    "UNH":   "US",
    "LMT":   "US",
    "NOC":   "US",
    "RTX":   "US",
    "F":     "US",
    "JD":    "China",
    "PDD":   "China",
    "FCX":   "US",
    "NEM":   "US",
    "NUE":   "US",
}

# Risk caps
MAX_SINGLE_NAME_WEIGHT = 0.20      # no single position > 20% of book
MAX_SECTOR_WEIGHT = 0.30           # no single sector > 30%
MAX_GEO_WEIGHT = 0.35             # no single geography > 35%
HIGH_CORR_THRESHOLD = 0.70         # flag pairs with correlation > this
MIN_ADV_Millions = 2.0            # exclude names with ADV < $2M/day


@dataclass
class BookMetrics:
    """Value-weighted factor tilts of the full book."""
    book_beta_mkt: float          # unsigned — direction applied separately in scenario analysis
    book_beta_smb: float          # unsigned
    book_beta_hml: float          # unsigned
    book_beta_rmw: float          # unsigned
    book_beta_cma: float          # unsigned
    book_beta_umd: float          # unsigned
    gross_exposure: float          # sum of abs(weights), 0-200%
    net_exposure: float           # sum of signed weights, -100 to +100%
    long_weight: float            # sum of long notionals / total_capital
    short_weight: float           # sum of short notionals / total_capital
    sector_weights: dict[str, float]   # {sector: weight}
    geo_weights: dict[str, float]       # {geo: weight}
    sector_violations: list[str]        # sectors exceeding cap
    geo_violations: list[str]            # geos exceeding cap
    weight_violations: list[str]         # names exceeding single-name cap
    high_correlation_pairs: list[tuple[str, str, float]]  # [(asset_a, asset_b, corr)]
    computed: bool                 # True if all fields are populated


# ─────────────────────────────────────────────────────────────────────────────
# Factor tilts + net/gross exposure
# ─────────────────────────────────────────────────────────────────────────────

def compute_book_metrics(
    picks: list[dict],
    factor_exposures: dict[str, dict],
    total_capital: float = 100_000_000.0,
) -> BookMetrics:
    """
    Compute value-weighted factor tilts and exposure summary for the book.

    picks: list of pick dicts with keys: asset, direction, notional, weight
           (weight is share of total_capital, signed by direction)
    factor_exposures: {asset: {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared}}
    total_capital: used to compute actual notional from fractional weights
    """
    longs = [p for p in picks if p.get("direction") == "long"]
    shorts = [p for p in picks if p.get("direction") == "short"]

    long_w = sum(p.get("weight", 0) for p in longs)
    short_w = sum(p.get("weight", 0) for p in shorts)
    gross = long_w + short_w
    net = long_w - short_w

    # Value-weighted factor exposure
    factors = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_umd"]
    weighted_factors: dict[str, float] = {f: 0.0 for f in factors}
    total_weighted = 0.0

    for p in picks:
        asset = p.get("asset", "")
        weight = p.get("weight", 0.0)  # signed by direction
        fe = factor_exposures.get(asset, {})
        r2 = fe.get("r_squared", 0.0)

        # Only use betas with meaningful R²
        if r2 < 0.10:
            continue

        for f in factors:
            beta = abs(fe.get(f, 0.0) or 0.0)
            # Unsigned: direction is stored separately as net_exposure
            # (scenario_analysis applies direction once using net_exposure)
            weighted_factors[f] += weight * beta
            total_weighted += abs(weight)

    # Normalize by total weight (unsigned — direction applied in scenario analysis)
    book_tilts = {}
    if total_weighted > 0:
        for f in factors:
            book_tilts[f] = weighted_factors[f] / total_weighted
    else:
        for f in factors:
            book_tilts[f] = 0.0

    # Sector and geography aggregation
    sector_weights: dict[str, float] = {}
    geo_weights: dict[str, float] = {}
    sector_violations: list[str] = []
    geo_violations: list[str] = []
    weight_violations: list[str] = []

    for p in picks:
        asset = p.get("asset", "")
        w = p.get("weight", 0.0)
        if w <= 0:
            continue

        sec = SECTOR_MAP[asset]
        geo = GEO_MAP[asset]
        sector_weights[sec] = sector_weights.get(sec, 0.0) + w
        geo_weights[geo] = geo_weights.get(geo, 0.0) + w

        if w > MAX_SINGLE_NAME_WEIGHT:
            weight_violations.append(f"{asset} ({w:.1%} > {MAX_SINGLE_NAME_WEIGHT:.0%})")

    for sec, w in sector_weights.items():
        if w > MAX_SECTOR_WEIGHT:
            sector_violations.append(f"{sec} ({w:.1%} > {MAX_SECTOR_WEIGHT:.0%})")

    for geo, w in geo_weights.items():
        if w > MAX_GEO_WEIGHT:
            geo_violations.append(f"{geo} ({w:.1%} > {MAX_GEO_WEIGHT:.0%})")

    return BookMetrics(
        book_beta_mkt=book_tilts["beta_mkt"],
        book_beta_smb=book_tilts["beta_smb"],
        book_beta_hml=book_tilts["beta_hml"],
        book_beta_rmw=book_tilts["beta_rmw"],
        book_beta_cma=book_tilts["beta_cma"],
        book_beta_umd=book_tilts["beta_umd"],
        gross_exposure=gross,
        net_exposure=net,
        long_weight=long_w,
        short_weight=short_w,
        sector_weights=sector_weights,
        geo_weights=geo_weights,
        sector_violations=sector_violations,
        geo_violations=geo_violations,
        weight_violations=weight_violations,
        high_correlation_pairs=[],   # filled by compute_correlation_matrix
        computed=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Correlation matrix + high-corr pair detection
# ─────────────────────────────────────────────────────────────────────────────

def fetch_pick_returns(
    tickers: list[str],
    lookback_days: int = 252,
) -> pd.DataFrame:
    """
    Fetch daily close returns for a list of tickers via yfinance.
    Returns DataFrame with date index and ticker columns, values = daily return.
    """
    if not tickers:
        return pd.DataFrame()

    end = date.today()
    start = end - timedelta(days=lookback_days + 30)   # extra buffer for missing days

    try:
        data = yf.download(tickers, start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            return pd.DataFrame()
        # Handle multi-level columns from yfinance
        if isinstance(data.columns, pd.MultiIndex):
            closes = data["Close"]
        else:
            closes = data[["Close"]].rename(columns={"Close": tickers[0]})
        returns = closes.pct_change().dropna(how="all")
        returns.index = pd.to_datetime(returns.index).date
        return returns
    except Exception:
        return pd.DataFrame()


def candidate_book_correlation(
    candidate_assets: list[str],
    held_assets: list[str],
    lookback_days: int = 252,
) -> dict[str, dict]:
    """For each candidate NOT held, its closest held position by |correlation|.

    Answers "why isn't X in the book?" with evidence instead of a proxy. /book used
    to answer it with theme overlap, which is nearly worthless: one theme routinely
    holds four positions across four sectors and both directions, so overlap says
    little about whether a name duplicates a held bet.

    Correlation says it directly. On the 2026-07-24 book the two precious-metals
    shorts the agent passed over scored SLV -> GDX +0.82 and GLD -> GDX +0.85 — the
    same bet it already holds through GDX. Compare BIL -> TLT -0.18, genuinely
    independent. (It does NOT follow that redundancy caps the short side: NOC scored
    only +0.20 against anything held and was passed over anyway on the day before it
    was picked up. That correction is ADR-0039's, not this function's.)

    Returns {candidate: {"closest": held_ticker, "corr": float}}. A candidate with no
    usable return history is OMITTED rather than given a 0.0 — an unmeasurable
    correlation is not an absent one.

    The correlation is between PRICES and is returned unsigned by position side, which
    is deliberate: this is a measurement, not a verdict. Whether a candidate DUPLICATES
    a held bet or would NET AGAINST it needs both directions, and the frontend applies
    them (`lib/candidateOverlap.ts`: aligned = rho * sign(candidate) * sign(held)).
    Choosing the closest holding by |corr| is unaffected — signing cannot change a
    magnitude, so the holding selected here is the same one either way.

    Reading this number without those two signs is how /book came to label long QQQ
    (+0.77 against a SHORT ARKK) "largely already held" on 2026-07-24, when it is
    nearer the reverse of that bet than a duplicate of it. See ADR-0045.
    """
    cands = [a for a in dict.fromkeys(candidate_assets) if a]
    held = [a for a in dict.fromkeys(held_assets) if a]
    if not cands or not held:
        return {}

    returns = fetch_pick_returns(sorted(set(cands) | set(held)), lookback_days)
    if returns.empty:
        return {}

    out: dict[str, dict] = {}
    for c in cands:
        if c not in returns.columns:
            continue
        best_t, best_v = None, None
        for h in held:
            if h not in returns.columns or h == c:
                continue
            v = returns[c].corr(returns[h])
            if pd.isna(v):
                continue
            if best_v is None or abs(v) > abs(best_v):
                best_t, best_v = h, float(v)
        if best_t is not None:
            out[c] = {"closest": best_t, "corr": round(best_v, 4)}
    return out

def compute_correlation_matrix(
    picks: list[dict],
    lookback_days: int = 252,
    threshold: float = HIGH_CORR_THRESHOLD,
) -> list[tuple[str, str, float]]:
    """
    Compute pairwise Pearson correlation of daily returns for pick assets.
    Returns list of (asset_a, asset_b, correlation) for pairs where |corr| > threshold.
    """
    tickers = list({p["asset"] for p in picks if p.get("asset")})
    if len(tickers) < 2:
        return []

    returns = fetch_pick_returns(tickers, lookback_days)
    if returns.empty or len(returns.columns) < 2:
        return []

    # Align: only use tickers that actually have return data
    valid = [c for c in tickers if c in returns.columns]
    if len(valid) < 2:
        return []

    corr_df = returns[valid].corr()

    high_corr: list[tuple[str, str, float]] = []
    seen = set()
    for i, a in enumerate(valid):
        for b in valid[i + 1:]:
            corr_val = corr_df.loc[a, b]
            if pd.isna(corr_val):
                continue
            if abs(corr_val) >= threshold:
                pair = tuple(sorted([a, b]))
                if pair not in seen:
                    seen.add(pair)
                    high_corr.append((a, b, float(corr_val)))

    high_corr.sort(key=lambda x: abs(x[2]), reverse=True)
    return high_corr


def correlation_clusters(
    pairs: list[tuple[str, str, float]],
) -> list[list[str]]:
    """Group high-correlation pairs into clusters of mutually-similar names.

    Connected components over the positively-correlated pairs. Two names land in the
    same cluster when a chain of high correlations links them, which is how a desk
    actually thinks about redundancy: "the duration complex", not "TLT-IEF, TLT-AGG,
    IEF-AGG, IEF-SHY, ...".

    Inverse pairs are deliberately excluded. A -0.8 correlation is a HEDGE, not a
    duplicated bet, and folding it into a "these are the same" cluster would invert
    the meaning.
    """
    adj: dict[str, set[str]] = {}
    for a, b, corr in pairs:
        if corr <= 0:
            continue
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)

    seen: set[str] = set()
    clusters: list[list[str]] = []
    for node in adj:
        if node in seen:
            continue
        stack, comp = [node], []
        seen.add(node)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nxt in adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        if len(comp) > 1:
            clusters.append(sorted(comp))
    # Biggest bets first — the ones most likely to be accidentally doubled.
    clusters.sort(key=lambda c: (-len(c), c[0]))
    return clusters


def correlation_warning(pairs: list[tuple[str, str, float]]) -> list[str]:
    """High-corr pairs as warnings a reader — or an LLM — can act on.

    This emitted ONE VERBOSE SENTENCE PER PAIR, each ending with the same
    "verify this is intentional, not accidental doubling of the same bet". On a
    23-name candidate pool that is 31 near-identical lines in the reasoning prompt:
    a wall of text where the useful content is which names form ONE bet. Pairwise is
    also the wrong shape — nobody reasons about TLT-IEF, TLT-AGG, IEF-AGG and
    IEF-SHY separately; they reason about the duration complex.

    Clusters come first, then the individually strongest pairs for detail, capped so
    the section stays readable. Inverse pairs are reported separately and NOT as
    duplication — a negative correlation is a hedge.
    """
    if not pairs:
        return []

    out: list[str] = []
    for comp in correlation_clusters(pairs):
        out.append(
            f"ONE BET: {', '.join(comp)} move together — holding several is "
            f"concentration, not diversification."
        )

    inverse = sorted(
        [(a, b, c) for a, b, c in pairs if c < 0], key=lambda t: t[2]
    )[:3]
    for a, b, corr in inverse:
        out.append(f"HEDGE: {a} and {b} are inversely correlated ({corr:+.2f}).")

    strongest = sorted(pairs, key=lambda t: -abs(t[2]))[:5]
    for a, b, corr in strongest:
        out.append(f"  {a}/{b} {corr:+.2f}")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Format helpers (for LLM prompt injection)
# ─────────────────────────────────────────────────────────────────────────────

def book_metrics_to_dict(bm: BookMetrics) -> dict:
    """Structured BookMetrics for persistence and charting.

    ``format_book_metrics_summary`` renders the same data as a string for the LLM
    prompt. That string is unusable downstream — a bar chart cannot be drawn from
    prose — so this is the machine-readable twin persisted to
    ``research_recommendations.book_metrics``.
    """
    return {
        "computed": bm.computed,
        "factor_tilts": {
            "beta_mkt": bm.book_beta_mkt,
            "beta_smb": bm.book_beta_smb,
            "beta_hml": bm.book_beta_hml,
            "beta_rmw": bm.book_beta_rmw,
            "beta_cma": bm.book_beta_cma,
            "beta_umd": bm.book_beta_umd,
        },
        "gross_exposure": bm.gross_exposure,
        "net_exposure": bm.net_exposure,
        "long_weight": bm.long_weight,
        "short_weight": bm.short_weight,
        "sector_weights": dict(bm.sector_weights),
        "geo_weights": dict(bm.geo_weights),
    }


def correlation_pairs_to_dict(
    pairs: list[tuple[str, str, float]],
) -> list[dict]:
    """High-correlation pairs as records, for the /risk correlation view."""
    return [
        {
            "asset_a": a,
            "asset_b": b,
            "corr": corr,
            "relationship": "same-direction" if corr > 0 else "inverse",
            "threshold": HIGH_CORR_THRESHOLD,
        }
        for a, b, corr in pairs
    ]


def cap_utilisation(bm: BookMetrics, picks: list[dict]) -> dict:
    """Headroom against each risk cap, for the limit monitor on /risk.

    A violation list answers "am I over?"; a PM also needs "how close am I?" so a
    limit can be managed before it binds. ``utilisation`` is weight/cap, so 1.0 is
    exactly at the limit.
    """
    def _rows(weights: dict[str, float], cap: float) -> list[dict]:
        return sorted(
            (
                {
                    "key": key,
                    "weight": w,
                    "cap": cap,
                    "utilisation": (w / cap) if cap else 0.0,
                    "breached": w > cap,
                }
                for key, w in weights.items()
            ),
            key=lambda r: r["utilisation"],
            reverse=True,
        )

    single_name = {
        p.get("asset", ""): abs(p.get("weight", 0.0))
        for p in picks
        if p.get("asset")
    }

    return {
        "single_name": _rows(single_name, MAX_SINGLE_NAME_WEIGHT),
        "sector": _rows(bm.sector_weights, MAX_SECTOR_WEIGHT),
        "geo": _rows(bm.geo_weights, MAX_GEO_WEIGHT),
        "limits": {
            "single_name": MAX_SINGLE_NAME_WEIGHT,
            "sector": MAX_SECTOR_WEIGHT,
            "geo": MAX_GEO_WEIGHT,
        },
        "violations": list(
            bm.weight_violations + bm.sector_violations + bm.geo_violations
        ),
    }


def format_book_metrics_summary(bm: BookMetrics, pairs: list[tuple[str, str, float]]) -> str:
    """Format book metrics as a compact table for the LLM prompt."""
    lines = ["=== BOOK METRICS (computed, not estimated) ==="]

    if not bm.computed:
        return "Book metrics not computed (insufficient factor data)."

    lines.append(
        f"  Gross exposure: {bm.gross_exposure:.1%} | "
        f"Net: {bm.net_exposure:+.1%} | "
        f"Long: {bm.long_weight:.1%} | Short: {bm.short_weight:.1%}"
    )

    lines.append(
        f"  Book factor tilts: Mkt={bm.book_beta_mkt:+.2f} "
        f"SMB={bm.book_beta_smb:+.2f} HML={bm.book_beta_hml:+.2f} "
        f"RMW={bm.book_beta_rmw:+.2f} CMA={bm.book_beta_cma:+.2f} UMD={bm.book_beta_umd:+.2f}"
    )

    if bm.sector_weights:
        top_sectors = sorted(bm.sector_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        sec_str = " | ".join(f"{s}:{w:.0%}" for s, w in top_sectors)
        lines.append(f"  Sector weights: {sec_str}")

    if bm.geo_weights:
        top_geos = sorted(bm.geo_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        geo_str = " | ".join(f"{g}:{w:.0%}" for g, w in top_geos)
        lines.append(f"  Geo weights: {geo_str}")

    violations = bm.sector_violations + bm.geo_violations + bm.weight_violations
    if violations:
        lines.append(f"  ⚠ CAP VIOLATIONS: {'; '.join(violations)}")

    if pairs:
        warnings = correlation_warning(pairs)
        lines.append(f"  ⚠ HIGH CORRELATION PAIRS:")
        for w in warnings:
            lines.append(f"    {w}")

    return "\n".join(lines)
