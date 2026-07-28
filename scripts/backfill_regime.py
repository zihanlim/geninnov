"""
Backfill L3 regime classifications from the macro history already stored.

WHY THIS IS THE ONE LAYER WORTH BACKFILLING. `macro_daily_history` holds a year
of L0 observations (~250 trading days per series), while
`regime_classifications` holds four rows. L3 is a PURE FUNCTION of those
observations — no news, no LLM, no API cost — so a year of regime history is
sitting in the database already computed in all but name.

WHAT IS DELIBERATELY NOT BACKFILLED, and why asking is reasonable but the answer
is no:

  * L1 HypeScore. Its price_corr and momentum components are reconstructible
    from yfinance, but mention_count and sentiment come from Brave News and
    Reddit, which are recency-biased. Nothing can tell you how much attention a
    theme drew on 2025-11-14. Backfilling the half that is available would
    produce a number that is not HypeScore while being stored in the column that
    says it is.
  * L5's book. Re-running the agent over reconstructed inputs produces a
    SIMULATED book; writing it into `research_recommendations` would assert the
    system published on days it did not. That is fabricating the audit trail of
    a product whose entire claim is an auditable trail. If you want to know how
    the book WOULD have looked, that belongs in `backtest_results` under a name
    that says so.

This script reuses `RegimeClassifier.classify(run_date)` rather than
reimplementing the rules. That matters more than it looks: the classifier
converts percent to basis points before applying its thresholds (a bug that once
made two of its three cycle rules unreachable), and a backfill with its own copy
of the arithmetic would reintroduce exactly that class of divergence.

THE FILL MODE (`--fill-crosscurrents`) is different in kind from the default
mode, and the difference is the point. Migrations 052/053 added the ADR-0139
debasement and ADR-0140 posture columns to rows the live runs had already
PUBLISHED. Re-running `classify()` over those dates would recompute — and
potentially restate — the published `cycle`/`sentiment` too, which is exactly
what the `--overwrite` guard exists to prevent. The fill mode instead UPDATEs
only the twelve new columns, on existing rows only (it cannot invent a date),
in CHRONOLOGICAL order — non-negotiably, because `fed_pivot_delta` reads the
posture ~13 weeks prior, so later rows depend on earlier writes (migration
053's ordering note). A row is "already filled" when `fed_posture_evidence` is
non-NULL: the live path writes that blob unconditionally, so its NULLness
marks a row the new code has never touched.

Usage:
    python -m scripts.backfill_regime                     # dry run, whole range
    python -m scripts.backfill_regime --from 2025-08-01 --to 2026-07-01
    python -m scripts.backfill_regime --apply             # actually write
    python -m scripts.backfill_regime --apply --overwrite # re-do existing rows
    python -m scripts.backfill_regime --fill-crosscurrents          # dry run
    python -m scripts.backfill_regime --fill-crosscurrents --apply  # write
"""
from __future__ import annotations

import argparse
import os
from collections import Counter
from datetime import date
from typing import Optional

from supabase import Client, create_client

from backend.services.regime_classifier import (
    DEBASEMENT_LOOKBACK_WEEKS,
    POSTURE_SIGN,
    POSTURE_WINDOW_WEEKS,
    RegimeClassifier,
    _classify_cycle,
    _classify_sentiment,
    _compute_spx_breadth,
    _fetch_latest_series,
    _fetch_prior_posture,
    _fetch_series_window,
    build_posture_evidence,
    classify_debasement,
    classify_fed_posture,
    crosscurrents_columns,
)

# The series L3 reads. A date with none of these has no macro observation at all
# and is not a trading day worth classifying.
REQUIRED_ANY = ["DGS10", "DGS2", "BAMLH0A0HYM2", "^VIX", "^VIX3M", "T10YIE"]

# Below this many resolvable inputs, the classification is being driven by
# defaults rather than by data. Writing it would put a confident cycle/sentiment
# label on a row that measured almost nothing — the shape of claim design goal 2
# exists to prevent. Such dates are skipped and reported, not written.
MIN_INPUTS = 4


#: PostgREST caps a response at 1000 rows regardless of `.limit()`. Six series
#: over a year is ~1,500 rows, so an unpaginated read returns the EARLIEST 1000
#: and nothing says it truncated. The first dry run of this script reported "175
#: candidate dates" for a year of data and looked entirely plausible.
PAGE = 1000


def trading_dates(sb: Client, lo: Optional[date], hi: Optional[date]) -> list[date]:
    """Distinct dates that have at least one L3-relevant observation.

    Paginated: see PAGE. A backfill that silently covers the first two-thirds of
    its range is the worst kind of wrong — it succeeds, prints a count, and
    leaves a gap nobody looks for.
    """
    out: set[date] = set()
    start = 0
    while True:
        q = sb.table("macro_daily_history").select("trading_date").in_("series_id", REQUIRED_ANY)
        if lo:
            q = q.gte("trading_date", lo.isoformat())
        if hi:
            q = q.lte("trading_date", hi.isoformat())
        rows = q.order("trading_date").range(start, start + PAGE - 1).execute().data or []
        out.update(date.fromisoformat(r["trading_date"]) for r in rows)
        if len(rows) < PAGE:
            break
        start += PAGE
    return sorted(out)


def existing_run_dates(sb: Client) -> set[date]:
    rows = sb.table("regime_classifications").select("run_date").limit(10000).execute().data or []
    return {date.fromisoformat(r["run_date"]) for r in rows}


def inputs_for(sb: Client, d: date) -> dict:
    """Assemble the six L3 inputs as known on `d`.

    Every read is bounded by `d` — `_fetch_latest_series(as_of=...)` and
    `_compute_spx_breadth(as_of=...)`. A backfill is precisely the situation
    those bounds exist for: without them, every historical row would be stamped
    with today's readings and the whole exercise would be look-ahead noise
    dressed as history.
    """
    dgs10 = _fetch_latest_series(sb, "DGS10", as_of=d)
    dgs2 = _fetch_latest_series(sb, "DGS2", as_of=d)
    hy_oas = _fetch_latest_series(sb, "BAMLH0A0HYM2", as_of=d)
    vix = _fetch_latest_series(sb, "^VIX", as_of=d)
    vix3m = _fetch_latest_series(sb, "^VIX3M", as_of=d)
    breakeven = _fetch_latest_series(sb, "T10YIE", as_of=d)

    return {
        "yield_curve_slope": (dgs10 - dgs2) if (dgs10 is not None and dgs2 is not None) else None,
        "hy_oas": hy_oas,
        "vix_level": vix,
        "vix_term_diff": (vix - vix3m) if (vix is not None and vix3m is not None) else None,
        "real_rate": (dgs10 - breakeven) if (dgs10 is not None and breakeven is not None) else None,
        "spx_breadth": _compute_spx_breadth(as_of=d),
    }


def classify_row(inputs: dict) -> tuple[str, str]:
    """Apply the SAME rules `classify()` applies, including its unit conversion.

    The percent → basis-point conversion is not incidental: the thresholds are
    calibrated in bp ("yc < -50", "HY OAS > 350") while FRED reports percent
    (0.34, 2.77). Skipping it makes those rules unreachable, which is a bug this
    file's docstring records as having already happened once.
    """
    yc_bps = inputs["yield_curve_slope"] * 100 if inputs["yield_curve_slope"] is not None else None
    hy_bps = inputs["hy_oas"] * 100 if inputs["hy_oas"] is not None else None
    cycle = _classify_cycle(yc_bps, hy_bps, inputs["real_rate"])
    sentiment = _classify_sentiment(inputs["vix_level"], inputs["vix_term_diff"], hy_bps, inputs["spx_breadth"])
    return cycle, sentiment


#: The six series the crosscurrents readings consume (ADR-0139 / ADR-0140).
CROSSCURRENT_SERIES = ("DFII10", "DX-Y.NYB", "GC=F", "DFF", "DGS2", "DGS10")

#: PostgREST's silent page cap (see PAGE above). A series history that comes
#: back exactly this long has probably been truncated at the OLD end — the
#: fill warns instead of quietly computing on a shortened window.
SERIES_PAGE_CAP = 1000


def crosscurrent_rows(sb: Client, lo: Optional[date], hi: Optional[date]) -> list[tuple[date, bool]]:
    """Existing regime rows in range, ascending, with whether the new columns
    were ever computed (`fed_posture_evidence` non-NULL — see module docstring)."""
    rows = (
        sb.table("regime_classifications")
        .select("run_date, fed_posture_evidence")
        .order("run_date")
        .limit(10000)
        .execute()
        .data
        or []
    )
    out: list[tuple[date, bool]] = []
    for r in rows:
        d = date.fromisoformat(r["run_date"])
        if lo and d < lo:
            continue
        if hi and d > hi:
            continue
        out.append((d, r["fed_posture_evidence"] is not None))
    return out


def fill_crosscurrents(sb: Client, lo: Optional[date], hi: Optional[date],
                       apply_: bool, overwrite: bool) -> int:
    """Fill the ADR-0139/0140 columns on existing rows. UPDATE, never upsert:
    this mode must be unable to invent a date the live runs never published."""
    rows = crosscurrent_rows(sb, lo, hi)
    todo = sorted(d for d, computed in rows if overwrite or not computed)
    print(f"[backfill_regime] fill-crosscurrents: {len(rows)} regime rows, {len(todo)} to fill.")
    if not todo:
        return 0

    # One fetch per series for the whole span, sliced per date by the pure
    # functions' own as_of bounds (`_value_at_or_before` and the window
    # filters never read past as_of, so passing the full history is
    # look-ahead-safe by construction). ~6 reads instead of ~6 per date.
    span_days = (todo[-1] - todo[0]).days + DEBASEMENT_LOOKBACK_WEEKS * 7
    hists: dict[str, list[tuple[date, float]]] = {}
    for sid in CROSSCURRENT_SERIES:
        h = _fetch_series_window(sb, sid, todo[-1], days=span_days, max_rows=SERIES_PAGE_CAP)
        if len(h) >= SERIES_PAGE_CAP:
            print(f"[backfill_regime] WARNING: {sid} history hit the {SERIES_PAGE_CAP}-row page cap; "
                  f"the OLDEST dates may be missing and their readings will be NULL, not wrong.")
        hists[sid] = h

    posture_counts: Counter = Counter()
    pressures: list[float] = []
    pivots_nonzero = 0
    written = 0

    # Chronological, so a later row's prior-posture read (t−13w, from the DB)
    # can see this run's earlier writes. In a dry run those writes never
    # happen, so pivot deltas printed here may be NULL that an --apply run
    # would resolve — reported below rather than silently understated.
    for d in todo:
        deb = classify_debasement(
            hists["DFII10"], hists["DX-Y.NYB"], hists["GC=F"], as_of=d)
        post = classify_fed_posture(
            hists["DFF"], hists["DGS2"], hists["DGS10"], as_of=d)
        prior = _fetch_prior_posture(sb, d)
        pivot = None
        if post.posture is not None and prior in POSTURE_SIGN:
            pivot = POSTURE_SIGN[post.posture] - POSTURE_SIGN[prior]

        cols = crosscurrents_columns(deb, post, pivot, build_posture_evidence(post, prior))
        posture_counts[post.posture or "(null)"] += 1
        if deb.pressure is not None:
            pressures.append(deb.pressure)
        if pivot:
            pivots_nonzero += 1

        if apply_:
            sb.table("regime_classifications").update(cols).eq(
                "run_date", d.isoformat()).execute()
            written += 1

    print(f"[backfill_regime] postures: {dict(posture_counts)}; non-zero pivots: {pivots_nonzero}")
    if pressures:
        print(f"[backfill_regime] debasement_pressure computed on {len(pressures)}/{len(todo)} rows "
              f"(min {min(pressures)}, max {max(pressures)}); the rest are NULL — insufficient window, not zero.")
    else:
        print(f"[backfill_regime] debasement_pressure NULL on all {len(todo)} rows — insufficient window, not zero.")
    if apply_:
        print(f"[backfill_regime] wrote {written} row(s), new columns only.")
    else:
        print("[backfill_regime] DRY RUN — nothing written; pivot deltas may resolve differently on --apply "
              "(earlier writes feed later reads).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill regime_classifications from macro_daily_history.")
    ap.add_argument("--from", dest="lo", type=date.fromisoformat, default=None)
    ap.add_argument("--to", dest="hi", type=date.fromisoformat, default=None)
    ap.add_argument("--apply", action="store_true", help="Write rows. Without it, this only reports.")
    ap.add_argument(
        "--overwrite",
        action="store_true",
        help="Also rewrite dates that already have a row. Off by default: the existing rows are the "
             "PUBLISHED record, produced by live runs, and a backfill should not quietly restate them. "
             "In --fill-crosscurrents mode: also re-fill rows whose readings were already computed.",
    )
    ap.add_argument(
        "--fill-crosscurrents",
        action="store_true",
        help="Fill ONLY the ADR-0139/0140 debasement/posture columns on existing rows (chronological, "
             "update-only, published cycle/sentiment untouched). See module docstring.",
    )
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not (url and key):
        print("[backfill_regime] SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
        return 1

    sb: Client = create_client(url, key)

    if args.fill_crosscurrents:
        return fill_crosscurrents(sb, args.lo, args.hi, args.apply, args.overwrite)

    clf = RegimeClassifier(url, key)

    dates = trading_dates(sb, args.lo, args.hi)
    have = existing_run_dates(sb)
    todo = [d for d in dates if args.overwrite or d not in have]

    print(f"[backfill_regime] {len(dates)} candidate dates, {len(have)} already classified, {len(todo)} to do.")
    if not todo:
        return 0

    counts: Counter = Counter()
    skipped: list[tuple[date, int]] = []
    written = 0

    for d in todo:
        inputs = inputs_for(sb, d)
        resolved = sum(1 for v in inputs.values() if v is not None)
        if resolved < MIN_INPUTS:
            skipped.append((d, resolved))
            continue
        cycle, sentiment = classify_row(inputs)
        counts[f"{cycle} x {sentiment}"] += 1
        if args.apply:
            # classify() re-reads and re-persists through the one implementation,
            # so the written row is byte-for-byte what a live run would produce.
            clf.classify(run_date=d)
            written += 1

    print(f"[backfill_regime] regimes: {dict(counts)}")
    if skipped:
        print(f"[backfill_regime] skipped {len(skipped)} date(s) with < {MIN_INPUTS} resolvable inputs "
              f"(first few: {[(str(d), n) for d, n in skipped[:5]]})")
    print(f"[backfill_regime] {'wrote ' + str(written) if args.apply else 'DRY RUN — nothing written'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
