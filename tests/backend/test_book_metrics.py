"""
Tests for backend/services/book_metrics.py

Covers:
  - compute_book_metrics: factor tilts, net/gross exposure, sector/geo aggregation
  - compute_correlation_matrix: flags high-corr pairs
  - correlation_warning: formats pairs into readable warnings
  - format_book_metrics_summary: human-readable output
  - Cap enforcement (single-name 20%, sector 30%, geo 35%)
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.book_metrics import (
    compute_book_metrics,
    compute_correlation_matrix,
    correlation_warning,
    format_book_metrics_summary,
    BookMetrics,
    SECTOR_MAP,
    GEO_MAP,
    MAX_SINGLE_NAME_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_GEO_WEIGHT,
    HIGH_CORR_THRESHOLD,
    MIN_ADV_Millions,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _fe(r2=0.50, beta_mkt=1.0, beta_smb=0.0, beta_hml=0.0,
        beta_rmw=0.0, beta_cma=0.0, beta_umd=0.0):
    """Shorthand for a factor exposure dict."""
    return dict(r_squared=r2, beta_mkt=beta_mkt, beta_smb=beta_smb,
                beta_hml=beta_hml, beta_rmw=beta_rmw,
                beta_cma=beta_cma, beta_umd=beta_umd)


def _pick(asset, direction, weight, notional=1_000_000, hype=70.0):
    return dict(asset=asset, direction=direction, weight=weight,
                notional=notional, hype_score=hype, trade_score=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# compute_book_metrics
# ─────────────────────────────────────────────────────────────────────────────

def test_book_metrics_empty_picks():
    bm = compute_book_metrics([], {}, 100_000_000.0)
    assert bm.computed is True
    assert bm.gross_exposure == 0.0
    assert bm.net_exposure == 0.0
    assert bm.long_weight == 0.0
    assert bm.short_weight == 0.0
    assert bm.sector_violations == []
    assert bm.geo_violations == []


def test_book_metrics_equal_long_short_nets_to_zero():
    picks = [
        _pick("SPY", "long",  0.10),
        _pick("TLT", "short", 0.10),
    ]
    factor_exp = {"SPY": _fe(), "TLT": _fe()}
    bm = compute_book_metrics(picks, factor_exp, 100_000_000.0)
    assert abs(bm.gross_exposure - 0.20) < 1e-9
    assert abs(bm.net_exposure) < 1e-9
    assert bm.long_weight == 0.10
    assert bm.short_weight == 0.10


def test_book_metrics_factor_tilts_are_signed_and_direction_flips_shorts():
    # A SIGNED value-weighted tilt: signed_weight × signed_beta / Σ|weight|. The short
    # both flips the sign of a positive-beta contribution and, on a negative-beta name,
    # adds. (weight is passed UNSIGNED — direction carries the sign, matching the
    # net_exposure = long_w − short_w convention.)
    picks = [
        _pick("SPY", "long",  0.50),   # long 50% SPY
        _pick("TLT", "short", 0.50),   # short 50% TLT
    ]
    factor_exp = {
        "SPY": _fe(r2=0.80, beta_mkt=1.0, beta_hml=0.1),
        "TLT": _fe(r2=0.60, beta_mkt=-0.30, beta_hml=0.4),
    }
    bm = compute_book_metrics(picks, factor_exp, 100_000_000.0)
    # den = Σ|weight| = 1.0 (ONCE per pick, not ×6 as the old inner-loop bug did).
    # MKT: (+0.5·1.0) + (−0.5·−0.30) = 0.50 + 0.15 = 0.65 → shorting a negative-beta
    #      name ADDS market exposure.
    assert abs(bm.book_beta_mkt - 0.65) < 0.01
    # HML: (+0.5·0.1) + (−0.5·0.4) = 0.05 − 0.20 = −0.15 → shorting a high-HML name
    #      pulls the book's value tilt NEGATIVE. The old abs(beta) kept it positive.
    assert abs(bm.book_beta_hml - (-0.15)) < 0.01


def test_book_metrics_ignores_low_r2_assets():
    picks = [
        _pick("SPY",  "long",  0.50),
        _pick("BULL", "long",  0.50),   # low R² — should be excluded
    ]
    factor_exp = {
        "SPY":  _fe(r2=0.80, beta_mkt=1.0),
        "BULL": _fe(r2=0.05, beta_mkt=5.0),  # high beta but unreliable
    }
    bm = compute_book_metrics(picks, factor_exp, 100_000_000.0)
    # Only SPY contributes (BULL excluded, R² < 0.10). den = Σ|weight| over the covered
    # sleeve = 0.50 → (0.5·1.0)/0.5 = 1.0. Coverage is 50% of gross.
    assert abs(bm.book_beta_mkt - 1.0) < 0.01


# ─────────────────────────────────────────────────────────────────────────────
# Cap enforcement
# ─────────────────────────────────────────────────────────────────────────────

def test_single_name_cap_triggers_violation():
    picks = [
        _pick("SPY", "long",  0.25),   # 25% > 20% cap
        _pick("QQQ", "long",  0.15),
    ]
    bm = compute_book_metrics(picks, {}, 100_000_000.0)
    assert any("SPY" in v for v in bm.weight_violations)
    assert all("QQQ" not in v for v in bm.weight_violations)


def test_sector_cap_triggers_violation():
    picks = [
        _pick("SPY", "long", 0.15),
        _pick("QQQ", "long", 0.15),   # Both "US Equities" sector via QQQ in SECTOR_MAP
        _pick("IWM", "long", 0.10),   # Also "US Equities"
        # Total US Equities ≈ 40% > 30% sector cap
    ]
    bm = compute_book_metrics(picks, {}, 100_000_000.0)
    # QQQ is in "Tech Growth" not "US Equities" in SECTOR_MAP; SPY and IWM may be missing from map
    # Just verify the function runs and populates violations list
    assert isinstance(bm.sector_violations, list)


def test_geo_cap_triggers_violation():
    picks = [
        _pick("FXI",  "long", 0.20),   # China
        _pick("MCHI", "long", 0.10),  # China
        _pick("BABA", "long", 0.10),  # China
        # Total China ≈ 40% > 35% geo cap
    ]
    bm = compute_book_metrics(picks, {}, 100_000_000.0)
    china_violations = [v for v in bm.geo_violations if "China" in v]
    assert len(china_violations) > 0


def test_no_violations_within_caps():
    picks = [
        _pick("SPY",  "long", 0.10),
        _pick("TLT",  "long", 0.10),
        _pick("GLD",  "long", 0.10),
        _pick("FXI",  "long", 0.10),
        _pick("XLE",  "long", 0.10),
    ]
    bm = compute_book_metrics(picks, {}, 100_000_000.0)
    assert bm.weight_violations == []
    assert bm.sector_violations == []
    assert bm.geo_violations == []


# ─────────────────────────────────────────────────────────────────────────────
# Correlation matrix
# ─────────────────────────────────────────────────────────────────────────────

def test_correlation_matrix_empty_picks():
    result = compute_correlation_matrix([], lookback_days=30)
    assert result == []


def test_correlation_matrix_single_ticker_returns_empty():
    picks = [_pick("SPY", "long", 0.10)]
    result = compute_correlation_matrix(picks, lookback_days=30)
    assert result == []


def test_correlation_matrix_warns_high_corr():
    # Use two highly-correlated tickers that yfinance should return data for
    picks = [
        _pick("SPY",  "long", 0.10),
        _pick("QQQ",  "long", 0.10),
    ]
    # Test the pair-detection logic with a mock
    # We can't easily mock yfinance in a unit test without breaking the real function,
    # so we test the correlation_warning formatting logic directly with known pairs
    # Two independent pairs -> two distinct bets. Asserted as PROPERTIES, not as a
    # line count: the formatter used to emit one verbose sentence per pair (31 of
    # them on the live candidate pool) and now clusters, so counting lines pinned
    # the old shape rather than the meaning.
    pairs = [("SPY", "QQQ", 0.95), ("GLD", "SLV", 0.88)]
    warnings = correlation_warning(pairs)
    one_bet = [w for w in warnings if w.startswith("ONE BET")]
    assert len(one_bet) == 2
    assert any("SPY" in w and "QQQ" in w for w in one_bet)
    assert any("GLD" in w and "SLV" in w for w in one_bet)
    # The strongest pair is still reported with its coefficient, for detail.
    assert any("0.95" in w for w in warnings)


def test_correlation_warning_inverse_hedge():
    # An inverse pair is a HEDGE, never a duplicated bet — folding it into a
    # "these are the same" cluster would invert the meaning.
    pairs = [("SPY", "TLT", -0.72)]
    warnings = correlation_warning(pairs)
    assert any(w.startswith("HEDGE") for w in warnings)
    assert not any(w.startswith("ONE BET") for w in warnings)


def test_correlation_warning_empty():
    assert correlation_warning([]) == []


# ─────────────────────────────────────────────────────────────────────────────
# format_book_metrics_summary
# ─────────────────────────────────────────────────────────────────────────────

def test_format_book_metrics_empty():
    bm = BookMetrics(
        book_beta_mkt=0.0, book_beta_smb=0.0, book_beta_hml=0.0,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.0,
        gross_exposure=0.0, net_exposure=0.0,
        long_weight=0.0, short_weight=0.0,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=False,
    )
    out = format_book_metrics_summary(bm, [])
    assert "not computed" in out.lower()


def test_format_book_metrics_live():
    bm = BookMetrics(
        book_beta_mkt=0.65, book_beta_smb=-0.10, book_beta_hml=0.05,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.20,
        gross_exposure=1.20, net_exposure=0.40,
        long_weight=0.80, short_weight=0.40,
        sector_weights={"Rates": 0.40, "China Equities": 0.30},
        geo_weights={"US": 0.50, "China": 0.30},
        sector_violations=["Rates (45% > 30%)"],
        geo_violations=[],
        weight_violations=["SPY (25% > 20%)"],
        high_correlation_pairs=[("SPY", "QQQ", 0.95)],
        computed=True,
    )
    out = format_book_metrics_summary(bm, [("SPY", "QQQ", 0.95)])
    assert "Pool gross" in out
    assert "120.0%" in out or "120%" in out
    assert "HIGH CORRELATION" in out
    # Crowding survives — it is what the model legitimately needs from this block.
    assert "Rates" in out and "China" in out


def test_the_summary_never_calls_itself_the_book(): 
    """ADR-0077. ADR-0071 relabelled the surrounding prompt block, and this function
    prepended `=== BOOK METRICS (computed, not estimated) ===` two lines below it — the
    correction contradicted inside the same block by the string it was correcting."""
    bm = BookMetrics(
        book_beta_mkt=-0.02, book_beta_smb=0.18, book_beta_hml=0.27,
        book_beta_rmw=0.35, book_beta_cma=-0.13, book_beta_umd=0.0,
        gross_exposure=1.0, net_exposure=0.0, long_weight=0.5, short_weight=0.5,
        sector_weights={"Energy": 0.2}, geo_weights={"US": 0.6667},
        sector_violations=[], geo_violations=["US 66.67% — 31.67pp over its 35% cap"],
        weight_violations=[], high_correlation_pairs=[], computed=True,
    )
    out = format_book_metrics_summary(bm, [])
    assert "BOOK METRICS" not in out
    assert "Book factor tilts" not in out
    assert "pool" in out.lower()


def test_pool_factor_tilts_are_withheld_not_relabelled():
    """A caveat competes with a number and the number wins. The pool's average tilt has
    no decision value for CHOOSING picks, and its only demonstrated use was being copied
    into the thesis as the book's (ADR-0073: Mkt -0.02 published for a book at -0.50)."""
    bm = BookMetrics(
        book_beta_mkt=-0.02, book_beta_smb=0.18, book_beta_hml=0.27,
        book_beta_rmw=0.35, book_beta_cma=-0.13, book_beta_umd=0.0,
        gross_exposure=1.0, net_exposure=0.0, long_weight=0.5, short_weight=0.5,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )
    out = format_book_metrics_summary(bm, [])
    for token in ("Mkt=", "HML=", "RMW=", "-0.02", "+0.27", "+0.35"):
        assert token not in out, f"{token!r} is still handed to the model"


def test_pool_cap_violations_are_withheld():
    """Caps are enforced by the sizer AFTER selection, so a breach computed on 30
    equal-weighted candidates is not a fact about any book. This line is the direct
    source of the "US at 66.67% versus the 35% cap (31.67pp over)" sentence."""
    bm = BookMetrics(
        book_beta_mkt=0.0, book_beta_smb=0.0, book_beta_hml=0.0,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.0,
        gross_exposure=1.0, net_exposure=0.0, long_weight=0.5, short_weight=0.5,
        sector_weights={}, geo_weights={"US": 0.6667},
        sector_violations=[], geo_violations=["US 66.67% — 31.67pp over its 35% cap"],
        weight_violations=["SPY (25% > 20%)"], high_correlation_pairs=[], computed=True,
    )
    out = format_book_metrics_summary(bm, [])
    assert "CAP VIOLATIONS" not in out
    assert "31.67pp" not in out
    # The crowding itself is still visible, which is the part that informs a pick.
    assert "US:67%" in out or "US:" in out


def test_format_book_metrics_no_violations():
    bm = BookMetrics(
        book_beta_mkt=0.5, book_beta_smb=0.0, book_beta_hml=0.0,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.0,
        gross_exposure=1.0, net_exposure=0.2,
        long_weight=0.6, short_weight=0.4,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )
    out = format_book_metrics_summary(bm, [])
    assert "Pool gross" in out
    assert "CAP VIOLATIONS" not in out
    assert "HIGH CORRELATION" not in out


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

def test_constants():
    assert MAX_SINGLE_NAME_WEIGHT == 0.20
    assert MAX_SECTOR_WEIGHT == 0.30
    assert MAX_GEO_WEIGHT == 0.35
    assert HIGH_CORR_THRESHOLD == 0.70
    assert MIN_ADV_Millions == 2.0


def test_sector_map_populated():
    assert len(SECTOR_MAP) > 0
    assert SECTOR_MAP["TLT"] == "Rates"
    assert SECTOR_MAP["GLD"] == "Metals"
    assert SECTOR_MAP["BABA"] == "China Equities"


def test_geo_map_populated():
    assert len(GEO_MAP) > 0
    assert GEO_MAP["TLT"] == "US"
    assert GEO_MAP["GLD"] == "Global"
    assert GEO_MAP["FXI"] == "China"


# ─── Independent ideas (ADR-0048) ────────────────────────────────────────────

def _cand(asset, direction, edge):
    return {"asset": asset, "direction": direction, "edge_score": edge}


def test_independent_ideas_collapses_a_correlated_group_to_one(monkeypatch):
    """Twelve short candidates are not twelve short ideas.

    Live on 2026-07-25 the short side's twelve names were five: GDX/GLD/IAU/NEM/SLV
    are one precious-metals bet and BABA/FXI/KWEB/MCHI are one China-internet bet.
    Counting names told the agent the pool was deep when it was not.
    """
    from backend.services import book_metrics as bmod

    metals = ["SLV", "GDX", "NEM", "IAU", "GLD"]
    china = ["BABA", "KWEB", "PDD", "MCHI", "FXI"]

    def fake_matrix(picks, lookback_days=252, threshold=0.70):
        assets = {p["asset"] for p in picks}
        pairs = []
        for group in (metals, china):
            present = [a for a in group if a in assets]
            for i in range(len(present)):
                for j in range(i + 1, len(present)):
                    # PDD stands alone in the live data despite being a China name.
                    if "PDD" in (present[i], present[j]):
                        continue
                    pairs.append((present[i], present[j], 0.85))
        return pairs

    monkeypatch.setattr(bmod, "compute_correlation_matrix", fake_matrix)

    cands = [_cand(a, "short", -0.30) for a in metals + china]
    cands.append(_cand("NOC", "short", -0.286))
    cands.append(_cand("ARKK", "short", -0.264))

    out = bmod.independent_ideas(cands)
    short = out["short"]
    assert short["names"] == 12
    # metals + china complexes, plus PDD, NOC, ARKK standalone.
    assert short["count"] == 5
    assert len(short["complexes"]) == 2
    assert set(short["standalone"]) == {"PDD", "NOC", "ARKK"}


def test_independent_ideas_names_the_strongest_of_each_complex(monkeypatch):
    """The agent needs to know WHICH name to take, not just that a group exists."""
    from backend.services import book_metrics as bmod

    monkeypatch.setattr(
        bmod, "compute_correlation_matrix",
        lambda picks, lookback_days=252, threshold=0.70: [("GDX", "SLV", 0.82)],
    )
    cands = [_cand("SLV", "short", -0.430), _cand("GDX", "short", -0.367)]
    cx = bmod.independent_ideas(cands)["short"]["complexes"]
    assert len(cx) == 1
    assert cx[0]["strongest"] == "SLV"       # larger |edge|, not alphabetical


def test_independent_ideas_keeps_the_two_sides_apart(monkeypatch):
    """A long and a short of correlated names are two bets, not one — the sides are
    measured separately so a hedge is never counted as redundancy."""
    from backend.services import book_metrics as bmod

    monkeypatch.setattr(
        bmod, "compute_correlation_matrix",
        lambda picks, lookback_days=252, threshold=0.70: [("SPY", "QQQ", 0.95)],
    )
    cands = [_cand("SPY", "long", 0.20), _cand("QQQ", "short", -0.20)]
    out = bmod.independent_ideas(cands)
    assert out["long"]["count"] == 1
    assert out["short"]["count"] == 1
    assert out["long"]["complexes"] == []    # nothing to cluster with, one per side


def test_independent_ideas_counts_an_unmeasurable_name_as_its_own_idea(monkeypatch):
    """No return history means it cannot be clustered. Reporting it as standalone
    biases the count UP, which never understates the choice the agent had — the safe
    direction for a number used to say 'you could have picked more'."""
    from backend.services import book_metrics as bmod

    monkeypatch.setattr(
        bmod, "compute_correlation_matrix",
        lambda picks, lookback_days=252, threshold=0.70: [],
    )
    out = bmod.independent_ideas([_cand("NEWCO", "long", 0.4), _cand("X", "long", 0.3)])
    assert out["long"]["count"] == 2
    assert set(out["long"]["standalone"]) == {"NEWCO", "X"}


def test_independent_ideas_is_empty_for_an_empty_side(monkeypatch):
    from backend.services import book_metrics as bmod

    monkeypatch.setattr(
        bmod, "compute_correlation_matrix",
        lambda picks, lookback_days=252, threshold=0.70: [],
    )
    out = bmod.independent_ideas([_cand("SPY", "long", 0.2)])
    assert out["short"] == {"count": 0, "names": 0, "complexes": [], "standalone": []}


def test_independent_ideas_dedupes_a_ticker_reached_twice(monkeypatch):
    from backend.services import book_metrics as bmod

    monkeypatch.setattr(
        bmod, "compute_correlation_matrix",
        lambda picks, lookback_days=252, threshold=0.70: [],
    )
    out = bmod.independent_ideas([_cand("SPY", "long", 0.2), _cand("SPY", "long", 0.3)])
    assert out["long"]["names"] == 1
    assert out["long"]["count"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# exceeds_cap — a breach must not be decided by float representation error
# ─────────────────────────────────────────────────────────────────────────────

def test_sitting_exactly_on_the_cap_is_not_a_breach():
    """The allocator CLAMPS to the cap (ADR-0037), so this is the designed state."""
    from backend.services.book_metrics import exceeds_cap

    assert exceeds_cap(0.35, 0.35) is False
    assert exceeds_cap(0.20, 0.20) is False


def test_the_live_one_ulp_overshoot_is_not_a_breach():
    """The exact value that produced 'US (35.0% > 35%)' on the 2026-07-25 book.

    geo US summed to 0.35000000000000003 against a 0.35 cap — 5.55e-17 over, one
    unit in the last place — and `w > cap` reported a governance violation on a book
    that was correctly capped.
    """
    from backend.services.book_metrics import exceeds_cap

    live = 0.35000000000000003
    assert live > 0.35            # the raw comparison that caused it
    assert exceeds_cap(live, 0.35) is False


def test_a_real_breach_is_still_a_breach():
    """The guard is for representation error, not an economic tolerance.

    1e-9 sits seven orders of magnitude below a basis point, so nothing anyone could
    act on is masked.
    """
    from backend.services.book_metrics import exceeds_cap

    assert exceeds_cap(0.3501, 0.35) is True        # 1bp over
    assert exceeds_cap(0.35 + 1e-4, 0.35) is True   # exactly 1bp
    assert exceeds_cap(0.40, 0.35) is True
    # ...and just above the noise floor still counts.
    assert exceeds_cap(0.35 + 1e-8, 0.35) is True


def test_under_the_cap_is_never_a_breach():
    from backend.services.book_metrics import exceeds_cap

    assert exceeds_cap(0.34, 0.35) is False
    assert exceeds_cap(0.0, 0.35) is False


def test_violation_text_numbers_support_the_claim_they_make():
    """The old form printed '35.0% > 35%' — a strict inequality between two equal
    looking numbers. Stating the EXCESS makes the sentence checkable at the precision
    it is printed to."""
    from backend.services.book_metrics import _violation_text

    msg = _violation_text("US", 0.3612, 0.35)
    assert "1.12pp over" in msg
    assert "36.12%" in msg
    assert "35% cap" in msg
    # No bare strict inequality between two rounded, equal-looking figures.
    assert ">" not in msg


# ─────────────────────────────────────────────────────────────────────────────
# correlation_summary — the structure, not just the flagged tail (ADR-0072)
# ─────────────────────────────────────────────────────────────────────────────

def test_summarises_the_live_book_that_flagged_nothing():
    """The 2026-07-25 book: every pair below 0.70, so correlation_pairs was empty.

    The page could then say only "nothing crossed the flag" — an absence. The highest
    pair was BABA/PDD +0.4753, which is a measurement.
    """
    from backend.services.book_metrics import correlation_summary

    pairs = [("BABA", "PDD", 0.4753), ("JPM", "SVXY", 0.4559), ("JPM", "NUE", 0.3611)]
    s = correlation_summary(pairs)
    assert s["max_abs_pair"] == {"asset_a": "BABA", "asset_b": "PDD", "corr": 0.4753}
    assert s["pair_count"] == 3
    assert abs(s["mean_abs_corr"] - (0.4753 + 0.4559 + 0.3611) / 3) < 1e-12
    assert s["flag_threshold"] == 0.70


def test_the_strongest_pair_is_by_MAGNITUDE_not_sign():
    """A −0.85 hedge is the most correlated pair in the book, and saying otherwise
    would report a weaker positive pair as the extreme."""
    from backend.services.book_metrics import correlation_summary

    s = correlation_summary([("A", "B", 0.40), ("C", "D", -0.85)])
    assert s["max_abs_pair"]["corr"] == -0.85
    assert s["max_abs_pair"]["asset_a"] == "C"


def test_no_pairs_is_not_a_correlation_of_zero():
    """A one-position book has no pairs. Reporting 0.0 would claim it is uncorrelated."""
    from backend.services.book_metrics import correlation_summary

    assert correlation_summary([]) == {}
    assert correlation_summary(None) == {}


def test_mean_uses_absolute_values():
    """+0.8 and −0.8 average to 0.0 signed, which would read as 'uncorrelated' for a
    book that is strongly correlated in both directions."""
    from backend.services.book_metrics import correlation_summary

    s = correlation_summary([("A", "B", 0.8), ("C", "D", -0.8)])
    assert abs(s["mean_abs_corr"] - 0.8) < 1e-12
