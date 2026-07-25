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

# A cap breach must not be decided by floating-point representation error.
#
# `allocate_portfolio` CLAMPS a group to its cap (ADR-0037), so a fully-utilised book
# lands on the limit exactly by design. Summing the clamped per-position floats then
# reintroduces error: the live 2026-07-25 book carried geo US at
# 0.35000000000000003 against a 0.35 cap — one ULP, 5.55e-17 over — and `w > cap`
# reported a governance violation reading **"US (35.0% > 35%)"**. 35.0% is not greater
# than 35%; the message asserted a strict inequality its own printed numbers deny, on
# a book that was correctly capped.
#
# 1e-9 is a representation-error guard, NOT an economic tolerance. It is nine orders
# of magnitude above the observed 5.55e-17 error and seven below a single basis point
# (1e-4), so it cannot mask a breach anyone could act on — deliberately unlike a
# fitted threshold, which ADR-0047 warns is a statement about the day's numbers rather
# than about the rule.
CAP_EPSILON = 1e-9


def exceeds_cap(weight: float, cap: float, eps: float = CAP_EPSILON) -> bool:
    """Is `weight` over `cap` by more than floating-point noise?

    Sitting exactly on a cap is compliance, not breach: the allocator puts it there.
    """
    return weight - cap > eps


def _violation_text(key: str, weight: float, cap: float) -> str:
    """A violation message whose own numbers support the claim it makes.

    The old form printed the weight at one decimal against a whole-number cap
    (`"US (35.0% > 35%)"`), so any overshoot smaller than 0.05pp rendered as a strict
    inequality between two equal-looking numbers. Stating the EXCESS instead means the
    sentence is checkable at the precision it is printed to.
    """
    return f"{key} {weight:.2%} — {(weight - cap) * 100:.2f}pp over its {cap:.0%} cap"
MIN_ADV_Millions = 2.0            # exclude names with ADV < $2M/day


@dataclass
class BookMetrics:
    """Value-weighted factor tilts of the full book."""
    book_beta_mkt: float          # SIGNED value-weighted tilt (shorts reduce exposure)
    book_beta_smb: float          # SIGNED
    book_beta_hml: float          # SIGNED
    book_beta_rmw: float          # SIGNED
    book_beta_cma: float          # SIGNED
    book_beta_umd: float          # SIGNED
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

        # SIGNED value-weighted tilt: (±|weight| by direction) × SIGNED beta, so a short
        # in a positive-beta name (and a long in a negative-beta name) REDUCES the book's
        # exposure to that factor — which is what a "tilt" means. Three things were wrong:
        #   1. `weight` here is UNSIGNED (net_exposure below is long_w − short_w, which
        #      only works if shorts are positive), so `weight × beta` treated every short
        #      as a long. Sign it by direction.
        #   2. `abs(beta)` discarded factor direction, so a factor like SMB came out with
        #      the wrong sign on the live book.
        #   3. `total_weighted` was summed INSIDE this per-factor loop — six times per
        #      pick — so every tilt came out a sixth of its true size, which is why /risk
        #      read the book "close to factor-neutral" when it was not.
        # The "unsigned because scenario_analysis applies direction" note was stale:
        # scenario_analysis reads per-pick betas, never these fields.
        signed_w = -abs(weight) if p.get("direction") == "short" else abs(weight)
        for f in factors:
            beta = fe.get(f, 0.0) or 0.0
            weighted_factors[f] += signed_w * beta
        total_weighted += abs(weight)

    # Normalize by gross of the covered sleeve (sum of |weight|), once per pick.
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

        if exceeds_cap(w, MAX_SINGLE_NAME_WEIGHT):
            weight_violations.append(_violation_text(asset, w, MAX_SINGLE_NAME_WEIGHT))

    for sec, w in sector_weights.items():
        if exceeds_cap(w, MAX_SECTOR_WEIGHT):
            sector_violations.append(_violation_text(sec, w, MAX_SECTOR_WEIGHT))

    for geo, w in geo_weights.items():
        if exceeds_cap(w, MAX_GEO_WEIGHT):
            geo_violations.append(_violation_text(geo, w, MAX_GEO_WEIGHT))

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


def moving_average_context(
    tickers: list[str],
    window: int = 200,
) -> dict[str, dict]:
    """Where each name sits against its `window`-day moving average.

    **Why this is worth computing.** Every pick already carries a `counter_thesis` with a
    measurable trigger — that part works. But on the 2026-07-25 book, **six of ten** read
    *"…is wrong if X breaks above/below its 200-day MA on sustained basis (3+ daily
    closes)"*, and nothing on the page says what that moving average **is**.

    Compare XLE's, which names a level: *"wrong if WTI breaks below $80/bbl"*, against a
    macro snapshot showing WTI at $90.47 — a reader can see there is ~11% of room. The MA
    triggers are the same sentence with the ticker swapped and no number attached, so a
    reviewer asking *"how close is this to being wrong?"* — the whole point of a
    disqualifier — cannot answer it from the page. **A trigger you cannot locate is not
    falsifiable in practice**, and six identical ones also fail `GOAL.md`'s rule that every
    per-row surface must differentiate.

    The distance is the number that carries the information: NOC 1.2% above its MA is a
    trade about to be disqualified; ARKK 18% above is not.

    Returns `{ticker: {last, ma, pct_from_ma, window, observations}}`, omitting any ticker
    with fewer than `window` observations rather than averaging a short history — a 200-day
    mean of 40 days is not a 200-day mean ([ADR-0066](0066)). `{}` on any fetch failure:
    this is explanatory context, and a failed measurement costs a panel, not a run.
    """
    if not tickers:
        return {}
    try:
        end = date.today()
        # Calendar days needed to contain `window` trading days, plus slack.
        start = end - timedelta(days=int(window * 1.6) + 40)
        data = yf.download(list(set(tickers)), start=start, end=end,
                           progress=False, auto_adjust=True)
        if data.empty:
            return {}
        closes = data["Close"] if isinstance(data.columns, pd.MultiIndex) else \
            data[["Close"]].rename(columns={"Close": tickers[0]})
    except Exception:
        return {}

    out: dict[str, dict] = {}
    for t in set(tickers):
        if t not in closes.columns:
            continue
        series = closes[t].dropna()
        if len(series) < window:
            continue
        try:
            last = float(series.iloc[-1])
            ma = float(series.tail(window).mean())
            if not (last == last) or not (ma == ma) or ma == 0:
                continue
            out[t] = {
                "last": last,
                "ma": ma,
                "pct_from_ma": (last - ma) / ma,
                "window": window,
                "observations": int(len(series)),
            }
        except (ValueError, TypeError, IndexError):
            continue
    return out


def candidate_book_correlation(
    candidate_assets: list[str],
    held_assets: list[str],
    lookback_days: int = 252,
    returns: pd.DataFrame | None = None,
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

    if returns is None:
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
    returns: pd.DataFrame | None = None,
) -> list[tuple[str, str, float]]:
    """
    Compute pairwise Pearson correlation of daily returns for pick assets.
    Returns list of (asset_a, asset_b, correlation) for pairs where |corr| > threshold.

    Pass ``returns`` to reuse a pre-fetched frame instead of hitting yfinance again.
    ``.corr()`` uses pairwise-complete observations, so a wider frame (extra columns for
    other assets) yields byte-identical pairwise correlations — the result is the same
    whether the frame was fetched for these tickers alone or hoisted for the whole book.
    """
    tickers = list({p["asset"] for p in picks if p.get("asset")})
    if len(tickers) < 2:
        return []

    if returns is None:
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

def correlation_summary(pairs: list[tuple[str, str, float]] | None) -> dict:
    """The book's correlation structure as two numbers, not just the flagged tail.

    ``correlation_pairs`` keeps only pairs at or above ``HIGH_CORR_THRESHOLD``, so on a
    well-diversified book it is **empty** — and every surface can then say only
    *"nothing crossed the flag"*, an absence indistinguishable from missing data
    (ADR-0067). It also leaves the agent with no figure for a held pair below the flag:
    asked to justify BABA/PDD co-movement on 2026-07-25, the thesis cited **MCHI/KWEB at
    +0.92** — two names it does not hold — when the pair it was discussing is
    **+0.4753**.

    The data was always there and was thrown away by the filter. A 9-name book is 36
    pairs; passing ``threshold=0.0`` returns all of them. This reduces them to what a
    reader actually needs:

        max_abs_pair   the most correlated pair in the book, signed, with both names
        mean_abs_corr  the mean |rho| across every pair

    so a page can say *"the highest pair in this book is BABA/PDD +0.48"* — a
    measurement — instead of reporting that nothing crossed a line.

    Returns ``{}`` when there is nothing to summarise. A book of one position has no
    pairs, which is not a correlation of zero.
    """
    if not pairs:
        return {}
    a, b, corr = max(pairs, key=lambda p: abs(p[2]))
    return {
        "pair_count": len(pairs),
        "max_abs_pair": {"asset_a": a, "asset_b": b, "corr": corr},
        "mean_abs_corr": sum(abs(c) for _, _, c in pairs) / len(pairs),
        "flag_threshold": HIGH_CORR_THRESHOLD,
    }


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
                    # Same predicate the violation list uses, so the row's badge and
                    # the message can never disagree about whether a cap was breached.
                    "breached": exceeds_cap(w, cap),
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
    """Format the CANDIDATE-POOL metrics as a compact table for the LLM prompt.

    **This function is called on the equal-weighted screened pool, before selection.**
    `compute_book_metrics_node` runs at node 3; `reason_picks` at node 5. So every figure
    here describes a portfolio the book is a *subset* of, at weights the book will not use.

    [ADR-0071](0071) relabelled the surrounding prompt block for exactly that reason — and
    this function then prepended its own header, `=== BOOK METRICS (computed, not
    estimated) ===`, two lines below it, and labelled its tilt row *"Book factor tilts"*.
    **The correction was contradicted inside the same block by the string it was
    correcting.** The model was told twice that these were the book's, which is why
    [ADR-0073](0073) found the tilts restated in the thesis after ADR-0071 had supposedly
    stopped it, and why the published book at Mkt −0.50 was called *"market-neutral (Mkt
    −0.02)"*.

    Two things are now **withheld rather than relabelled**, because a caveat competes with
    a number and the number wins:

    - **The factor-tilt row is gone.** A pool-average tilt carries no decision value for
      *choosing* picks — it is the average of things the model is about to select among —
      and its only demonstrated use was being copied into the thesis as the book's.
    - **`CAP VIOLATIONS` is gone.** Caps are enforced by the sizer *after* selection, so a
      breach computed on 30 equal-weighted candidates is not a fact about any book. That
      line is the direct source of the *"US at 66.67% versus the 35% cap (31.67pp over)"*
      sentence ADR-0071 was written about. What the model legitimately needs from it —
      which complexes are crowded — is already in the sector/geo weights below.

    You cannot restate a number you were never given. [ADR-0077].
    """
    lines = ["--- (pool, equal-weighted, pre-selection) ---"]

    if not bm.computed:
        return "Candidate-pool metrics not computed (insufficient factor data)."

    lines.append(
        f"  Pool gross: {bm.gross_exposure:.1%} | "
        f"Net: {bm.net_exposure:+.1%} | "
        f"Long: {bm.long_weight:.1%} | Short: {bm.short_weight:.1%}"
    )

    if bm.sector_weights:
        top_sectors = sorted(bm.sector_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        sec_str = " | ".join(f"{s}:{w:.0%}" for s, w in top_sectors)
        lines.append(f"  Pool sector share: {sec_str}")

    if bm.geo_weights:
        top_geos = sorted(bm.geo_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        geo_str = " | ".join(f"{g}:{w:.0%}" for g, w in top_geos)
        lines.append(f"  Pool geo share: {geo_str}")

    if pairs:
        warnings = correlation_warning(pairs)
        lines.append(f"  ⚠ HIGH CORRELATION PAIRS:")
        for w in warnings:
            lines.append(f"    {w}")

    return "\n".join(lines)


def independent_ideas(
    candidates: list[dict],
    lookback_days: int = 252,
    threshold: float = HIGH_CORR_THRESHOLD,
) -> dict:
    """How many genuinely SEPARATE bets does each side of the pool contain?

    Q1 asks for five long and five short trades. The book has answered with fewer for
    many iterations, and the reason kept moving: first the universe was too narrow,
    then the attention gate was discarding whole themes (ADR-0046). With the gate
    fixed the pool reached 39 names — 27 long, 12 short — and the book still came
    back 4 and 3. Twelve short candidates is not twelve short ideas, and until now
    nothing measured the difference.

    A "complex" is a connected component of names correlated at or above `threshold`
    over `lookback_days` — the same clustering and the same threshold /risk uses to
    flag redundancy inside the book, so one number means one thing across the site.
    Taking two names from one complex is one idea expressed twice, which is why an
    agent told to avoid compounding correlated exposure correctly declines to do it.

    Measured on 2026-07-25: the LONG side's 27 names collapse to 13 ideas (a 12-name
    beta/duration complex, two energy complexes, and ten standalone names), and the
    SHORT side's 12 collapse to exactly 5 (precious metals; China internet; PDD; NOC;
    ARKK). So five-and-five is reachable on the short side today and comfortably
    reachable on the long side — the pool is no longer the constraint, and saying so
    with a number is what turns "why not five?" from a shrug into a check.

    Returns {"long": {...}, "short": {...}} with, per side:
        count      — independent ideas available
        names      — how many candidates the side holds
        complexes  — [{"members": [...], "strongest": ticker}] for multi-name groups
        standalone — tickers correlated with nothing else on their side

    Correlation needs history; a name with none simply cannot be clustered, so it is
    reported as standalone rather than dropped. That biases the count UP, which is the
    safe direction: it never understates how much choice the agent had.
    """
    out: dict = {}
    for side in ("long", "short"):
        members = [c for c in candidates if c.get("direction") == side and c.get("asset")]
        assets = list(dict.fromkeys(c["asset"] for c in members))
        if not assets:
            out[side] = {"count": 0, "names": 0, "complexes": [], "standalone": []}
            continue

        pairs = compute_correlation_matrix(
            [{"asset": a} for a in assets], lookback_days=lookback_days, threshold=threshold
        )
        clusters = correlation_clusters(pairs)
        # Only clusters drawn from THIS side count — correlation_matrix was already
        # scoped to it, but be explicit so a future caller cannot pass a mixed list.
        clusters = [sorted(set(c) & set(assets)) for c in clusters]
        clusters = [c for c in clusters if len(c) > 1]

        clustered = {a for c in clusters for a in c}
        standalone = [a for a in assets if a not in clustered]

        edge_by = {c["asset"]: abs(c.get("edge_score") or 0.0) for c in members}
        complexes = [
            {"members": c, "strongest": max(c, key=lambda a: edge_by.get(a, 0.0))}
            for c in clusters
        ]
        out[side] = {
            "count": len(complexes) + len(standalone),
            "names": len(assets),
            "complexes": complexes,
            "standalone": standalone,
        }
    return out
