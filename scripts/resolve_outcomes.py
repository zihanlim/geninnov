"""Record published picks as claims, then resolve the recorded claims against the spec.

TWO PASSES, TWO WRITE DISCIPLINES, AND THE SPLIT IS THE POINT (ADR-0205).

  1. RECORD THE COMMITMENT — reads `research_recommendations` (lens-scoped), writes
     INSERT-IF-ABSENT, `pending` only. Every published pick gets a row as soon as its
     book exists, so the denominator is fixed before any outcome is known. A scored set
     assembled after the fact can quietly omit the calls that went wrong; this cannot.
  2. RESOLVE WHAT HAS MATURED — reads `pick_outcomes` WHERE verdict = 'pending', writes
     upserts onto those rows only.

Pass 2 reads the RECORD, not the current book, and that is the whole change. It used to
re-derive its claim set from `research_recommendations.picks`, i.e. from what is still
published — so a pick whose book was replaced by a later run on the same run_date was
never in the claim set, stayed `pending` forever past its expected exit, and could
permanently pin `first_expected_maturity`. Measured 2026-07-31: **20 of ~80 live claims**
were in that state, unfalsifiable, on a table whose ADR is titled "a published pick must
be falsifiable". Nothing was wrong with the rows; nothing was ever going to grade them.

Idempotent, and now honestly so: a resolved row is never re-scored, because pass 2's read
excludes terminal verdicts and they are therefore absent from the payload. The previous
version claimed this in a docstring while re-upserting every claim nightly, so a single
yfinance outage would write `pending` with NULL prices over a resolved `hit` — the exact
erasure ADR-0117 forbids, in the file that ADR exempted.

Usage:
    python -m scripts.resolve_outcomes                # record + resolve, 21d
    python -m scripts.resolve_outcomes --dry-run      # print, write nothing
    python -m scripts.resolve_outcomes --horizon 63   # a second horizon, additive
    python -m scripts.resolve_outcomes --as-of 2026-09-01 --dry-run
                                                      # what a future run would decide

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (the table is anon-read-only).
See ADR-0090 (the instrument), ADR-0117 (the recording guarantee), ADR-0203 (why
superseded claims are counted and not removed), ADR-0205 (this split).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.pick_outcomes import (  # noqa: E402
    DEFAULT_HORIZON_DAYS,
    ENTRY_LOOKBACK_DAYS,
    SPEC_VERSION,
    build_scorecard,
    commitment_rows,
    earliest_run_date,
    eligible_for_resolution,
    resolve_pick,
)

CONFLICT_KEY = "run_date,asset,direction,horizon_days,spec_version"

# PostgREST caps a response server-side (max-rows, 1000 by default) and returns the
# truncated page WITHOUT an error. A silently short claim set is the one failure this
# table exists to prevent — it would under-report the denominator, which is the number
# ADR-0090 built the instrument around — so the pending read is PAGED and the page size
# is stated rather than assumed.
PAGE = 1000


def _parse_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v[:10]).date()
        except ValueError:
            return None
    return None


def fetch_closes(tickers: list[str], start: date, horizon_days: int) -> dict[str, list[tuple[date, float]]]:
    """Daily closes per ticker from `start` to today.

    Uses auto_adjust=True so the series is total-return-adjusted: an unadjusted series
    would score a dividend payment as a price fall and turn a flat long into a miss.
    """
    import pandas as pd
    import yfinance as yf

    # Pad the window generously — horizon_days is in TRADING days, and the caller may be
    # resolving a book published months ago.
    end = date.today() + timedelta(days=1)
    out: dict[str, list[tuple[date, float]]] = {}
    if not tickers:
        return out

    raw = yf.download(
        tickers=" ".join(sorted(set(tickers))),
        start=start.isoformat(),
        end=end.isoformat(),
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    if raw is None or len(raw) == 0:
        return out

    for t in sorted(set(tickers)):
        try:
            col = raw[t]["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw["Close"]
        except (KeyError, TypeError):
            continue
        series: list[tuple[date, float]] = []
        for idx, val in col.items():
            if pd.isna(val):
                continue
            d = idx.date() if hasattr(idx, "date") else _parse_date(idx)
            if d is not None:
                series.append((d, float(val)))
        if series:
            out[t] = sorted(series)
    return out


def record_pass(sb, horizon_days: int, dry_run: bool) -> int:
    """PASS 1 — record every published pick as a `pending` claim. Returns rows written.

    Reads the CURRENT books, which is exactly right for this pass and exactly wrong for
    the next one: recording is a statement about what is published now, grading is a
    statement about what was ever claimed.

    This pass is also the REPAIR PATH. `check_data_integrity.py` tells an operator to run
    this script to fix published-but-unrecorded claims (it caught 9 of 32 missing on
    2026-07-27), and `record_published_claims` in the pipeline never raises, so this
    backstop is load-bearing precisely on the days it is needed. Dropping this read — the
    tempting simplification once pass 2 reads the table — would silently retire that
    repair and make the guard's remediation string a lie.

    It is also the ONLY way a second horizon can come into existence: `daily_refresh`
    calls `commitment_rows` without a horizon, so it only ever writes 21d. `--horizon 63`
    has nothing to resolve until this pass creates the rows (ADR-0090: "a 63-day
    companion is a row, not a migration").

    INSERT-IF-ABSENT, and `commitment_rows` rather than `resolve_pick`, because a recorded
    claim must enter the record as `pending` and only ever leave it via pass 2. Building
    rows with prices here would, once anything has matured, insert a fully RESOLVED row
    that never existed as pending — which ADR-0117 distinguishes as "a different act
    entirely" from backfilling a pending row. Nobody has hit that yet only because
    nothing has matured; this closes it before the calendar gets there.
    """
    # ADR-0194 (migration 062): a run_date can carry a second, non-multi_asset row (the
    # credit lens), which coexists with but is NEVER entered into pick_outcomes —
    # ADR-0090's falsifiable record is multi-asset only.
    #
    # The gate belongs HERE, on this pass, and the reason has changed: it is no longer
    # "this script derives its own claim set independently" (pass 2 no longer does). It is
    # that PASS 1 IS THE ONLY PASS THAT CREATES ROWS. Pass 2 can only update rows that
    # already exist, so it is structurally incapable of admitting a credit-lens claim —
    # a stronger guarantee than a filter, because there is no filter left to delete.
    books = (
        sb.table("research_recommendations")
        .select("run_date, picks")
        .eq("lens", "multi_asset")
        .order("run_date")
        .execute()
        .data
    ) or []

    rows: list[dict] = []
    for b in books:
        rd = _parse_date(b.get("run_date"))
        if rd is None:
            continue
        rows.extend(commitment_rows(rd, b.get("picks") or [], horizon_days=horizon_days))

    print(f"pass 1 record: {len(books)} books -> {len(rows)} claims (insert-if-absent)")
    if not rows or dry_run:
        return 0

    # ignore_duplicates -> ON CONFLICT DO NOTHING. Same call shape as
    # daily_refresh.record_published_claims, and for the same reason: re-running an older
    # run_date must never write `pending` over a verdict (ADR-0117).
    sb.table("pick_outcomes").upsert(
        rows, on_conflict=CONFLICT_KEY, ignore_duplicates=True
    ).execute()
    return len(rows)


def fetch_pending(sb, horizon_days: int) -> list[dict]:
    """Every `pending` claim at this horizon, paged so a truncation cannot hide.

    `verdict = 'pending'` is the load-bearing filter, three ways over: it excludes
    terminal rows from the write payload (so a resolved verdict cannot be overwritten),
    it stops the ticker set and the download window growing with the whole history, and
    it hits the partial index migration 043 built for exactly this
    (`idx_pick_outcomes_pending`).
    """
    out: list[dict] = []
    offset = 0
    while True:
        page = (
            sb.table("pick_outcomes")
            # `entry_price` is selected so the write filter can tell a pending row that
            # would LEARN something from one that is already complete as a pending row.
            # Without it every pending claim is re-upserted with identical values every
            # night — 70 pointless writes today, growing with the record.
            .select("run_date, asset, direction, horizon_days, spec_version, verdict,"
                    " entry_price")
            .eq("verdict", "pending")
            .eq("horizon_days", horizon_days)
            .order("run_date")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
        ) or []
        out.extend(page)
        if len(page) < PAGE:
            return out
        offset += PAGE


def resolve_pass(sb, horizon_days: int, as_of: date, dry_run: bool) -> int:
    """PASS 2 — grade the recorded claims. Returns rows written.

    Reads the RECORD, so a claim survives its book being replaced. This is the fix.
    """
    pending = fetch_pending(sb, horizon_days)
    gradeable, foreign_spec = eligible_for_resolution(pending)

    print(f"pass 2 resolve: {len(pending)} pending at {horizon_days}d"
          f" | gradeable {len(gradeable)} | other spec {len(foreign_spec)}")
    for row in foreign_spec:
        # Named, never silently skipped: this needs a resolver for that spec, not a re-run.
        print(f"  SKIP spec {row.get('spec_version')!r} {row.get('run_date')}"
              f" {row.get('asset')} {row.get('direction')} - this code is {SPEC_VERSION}")
    if not gradeable:
        return 0

    start = earliest_run_date(gradeable)
    tickers = sorted({str(r["asset"]) for r in gradeable if r.get("asset")})
    # PADDED BACK BY THE ENTRY LOOK-BACK, and this is half of ADR-0210's fix rather than
    # defensive slack. `resolve_pick` now takes the last close AT OR BEFORE run_date, so a
    # window starting AT the earliest run_date cannot supply an entry for that claim when
    # its run_date is a non-trading day: the prior session's bar is outside the download.
    # Fixing only the lookup would pass every unit test -- a test builds its own series --
    # and still void the earliest book live. The two halves ship together or neither works.
    closes = fetch_closes(tickers, start - timedelta(days=ENTRY_LOOKBACK_DAYS), horizon_days)

    # A FAILED FETCH MUST NEVER VOID ANYTHING. `fetch_closes` returns {} when yf.download
    # fails, and pass 2 now voids an empty series past its grace window — so one outage
    # would permanently void the entire matured set. Zero tickers back is a broken fetch,
    # not a market in which nothing trades: refuse to write and exit non-zero so the
    # nightly job fails loudly instead of quietly destroying the record.
    if tickers and not closes:
        print(f"\nFETCH FAILED: 0 of {len(tickers)} tickers returned data. Writing nothing.",
              file=sys.stderr)
        return -1

    outcomes = []
    stored_entry: dict[tuple, object] = {}
    for row in gradeable:
        rd = _parse_date(row.get("run_date"))
        asset, direction = row.get("asset"), row.get("direction")
        if rd is None or not asset or direction not in ("long", "short"):
            continue
        outcome = resolve_pick(
            rd, str(asset), str(direction), closes.get(str(asset), []),
            horizon_days=int(row.get("horizon_days") or horizon_days),
            # The ROW's spec, never the module constant — see ADR-0205.
            spec_version=str(row.get("spec_version") or SPEC_VERSION),
            as_of=as_of,
        )
        outcomes.append(outcome)
        stored_entry[(rd, str(asset), str(direction))] = row.get("entry_price")

    sc = build_scorecard(outcomes, horizon_days=horizon_days)
    by_verdict: dict[str, int] = defaultdict(int)
    for o in outcomes:
        by_verdict[o.verdict] += 1

    # ASCII only, and every print sits BEFORE the upsert. A Unicode separator here
    # raises UnicodeEncodeError on a cp1252 stdout and kills the run before it writes —
    # the same defect ADR-0059 hit in backtest_hype (froze the /method IC panel) and
    # ADR-0065's follow-up hit in check_data_integrity. Twice is enough.
    print(f"  spec {SPEC_VERSION} | as of {as_of.isoformat()} | {sc.total} graded")
    print("  " + " | ".join(f"{k}={v}" for k, v in sorted(by_verdict.items())))
    print(f"  hit_rate={sc.hit_rate if sc.hit_rate is not None else 'not yet answerable'}"
          f" | void_rate={sc.void_rate if sc.void_rate is not None else 'n/a'}")
    if sc.first_expected_maturity:
        print(f"  first expected maturity {sc.first_expected_maturity.isoformat()}"
              " (business-day estimate)")
    for o in outcomes:
        if o.verdict == "void":
            print(f"  VOID {o.run_date} {o.asset} {o.direction}: {o.void_reason}")

    # Still-pending outcomes are dropped UNLESS they now carry an entry price the record
    # LACKS. Re-writing an unchanged `pending` row every night is pure churn — 70 rows
    # today, growing with the record — but the first run after publication does learn the
    # entry price, and recording it early is worth one write: it is the price the eventual
    # verdict will be measured from, so having it on the row makes the claim auditable
    # before it matures.
    def _worth_writing(o) -> bool:
        if o.verdict != "pending":
            return True
        if o.entry_price is None:
            return False
        return stored_entry.get((o.run_date, o.asset, o.direction)) is None

    writable = [o for o in outcomes if _worth_writing(o)]
    terminal = sum(1 for o in outcomes if o.verdict != "pending")
    print(f"  newly terminal {terminal} | rows to write {len(writable)}")

    if dry_run:
        return 0
    if not writable:
        return 0

    sb.table("pick_outcomes").upsert(
        [{**o.to_row(), "resolved_at": _stamp(o, as_of)} for o in writable],
        on_conflict=CONFLICT_KEY,
    ).execute()
    return len(writable)


def _stamp(outcome, as_of: date) -> str | None:
    """`resolved_at` for a terminal verdict, None while pending.

    The column has existed since migration 043 and nothing has ever written it, so every
    resolved row in the table has a NULL there. Stamped in the payload rather than in
    `Outcome.to_row`, which stays clock-free so it remains a pure projection.
    """
    return as_of.isoformat() if outcome.verdict != "pending" else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=DEFAULT_HORIZON_DAYS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--as-of",
        default=None,
        help="Grade as if today were this date (YYYY-MM-DD). REHEARSAL ONLY — implies "
             "--dry-run and is refused without it, see the check below.",
    )
    args = ap.parse_args()

    as_of = _parse_date(args.as_of) if args.as_of else date.today()
    if as_of is None:
        print(f"--as-of {args.as_of!r} is not a YYYY-MM-DD date.", file=sys.stderr)
        return 2
    if args.as_of and not args.dry_run:
        # REFUSED, not warned. Measured on the live table 2026-07-31: `--as-of 2026-10-01`
        # voids 70 of 70 pending claims, because the price series necessarily stops at
        # today while the grace window is computed against the supplied clock. A void is
        # terminal, so one careless invocation would destroy the entire forward record —
        # and a printed warning on a script that runs in a CI log is not a safeguard.
        #
        # There is no legitimate write that needs a shifted clock: grading is a statement
        # about what the prices show NOW. If a future need appears, it should arrive as its
        # own flag with its own argument for why, not by relaxing this.
        print(
            f"--as-of {as_of.isoformat()} is a rehearsal flag and cannot be used for a "
            "real write: the price series ends today, so a future clock voids every claim "
            "whose horizon it has moved past. Re-run with --dry-run.",
            file=sys.stderr,
        )
        return 2

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.", file=sys.stderr)
        return 2

    from supabase import create_client
    sb = create_client(url, key)

    recorded = record_pass(sb, args.horizon, args.dry_run)
    written = resolve_pass(sb, args.horizon, as_of, args.dry_run)
    if written < 0:
        return 1

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    print(f"\nRecorded {recorded} new claims; wrote {written} resolutions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
