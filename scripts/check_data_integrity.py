"""
Guard against RESIDUAL R0: fabricated portfolio data reaching production.

A gitignored local script (`tests/backend/seed_realistic_data.py`) once deleted
the real `portfolio_risk` rows and inserted hardcoded metrics (hhi=1850,
var_95=2.5M, cvar_95=4M, sharpe=1.15, beta=0.65) plus a synthetic
alternating ±0.0015/-0.0008 return series. Because that script is gitignored it
can't be removed from the repo — but its *fingerprint* can be detected. This
guard flags those sentinels so seeded data can never masquerade as pipeline
output unnoticed.

The detection functions are pure and unit-tested. The CLI reads the live
Supabase tables and exits non-zero when the fingerprint is present, so it can
run in CI or a pre-deploy check.

Run:  python -m scripts.check_data_integrity      # exits 1 if fabricated
"""
from __future__ import annotations

import json
import os
import re
import sys

# The repo root, so `backend.*` imports resolve however this file is invoked.
#
# `daily-refresh.yml` runs it as a SCRIPT — `python scripts/check_data_integrity.py` —
# which puts `scripts/` on sys.path and NOT the repo root, so the lazy
# `backend.services.q1_agent` import in check_published_book_claims raised
# ModuleNotFoundError and the guard exited 1 before printing its verdict. The step is
# wrapped in `|| echo "::warning::"`, so that crash would have shown up as a warning
# rather than as the missing check it was.
#
# It was verified as a MODULE (`python -m scripts.check_data_integrity`), which puts the
# repo root on sys.path and works — so the check passed against production while being
# broken in the invocation production actually uses. Verify the entry point that runs,
# not a convenient one. Same guard the other scripts here already carry.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# This guard prints check marks, and a guard that dies formatting its own verdict is
# worse than one that says nothing. On a console defaulting to cp1252 — any Windows
# shell without PYTHONIOENCODING set — `print("✓ …")` raises UnicodeEncodeError and the
# process exits 1, which the workflow's `|| echo "::warning::"` turns into a warning
# that looks exactly like a real integrity flag. Force UTF-8 where the stream supports
# it; `reconfigure` exists on 3.7+ and is a no-op when the encoding is already right.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError, OSError):
        pass

# Hardcoded metrics the seed script wrote (RESIDUAL R0). The genuine computed
# HHI for the same book is ~1000.12 — nowhere near 1850.
RISK_SENTINELS: dict[str, float] = {
    "concentration_hhi": 1850.0,
    "var_95": 2_500_000.0,
    "cvar_95": 4_000_000.0,
    "sharpe": 1.15,
    "beta": 0.65,
}

# The seed return series: daily_ret = 0.0015 if i % 2 == 0 else -0.0008.
SEED_RET_A = 0.0015
SEED_RET_B = -0.0008


def _close(x, target, rel_tol: float = 1e-3, abs_tol: float = 1e-6) -> bool:
    try:
        x = float(x)
    except (TypeError, ValueError):
        return False
    return abs(x - target) <= max(abs_tol, rel_tol * abs(target))


def _looks_like_alternating_seed(rets: list[float], a: float = SEED_RET_A,
                                 b: float = SEED_RET_B, min_len: int = 4) -> bool:
    """True when the return series is the seed's alternating pattern (either
    phase — the run_date ordering could start on a or b)."""
    if len(rets) < min_len:
        return False

    def matches(first, second) -> bool:
        return all(_close(r, first if i % 2 == 0 else second, abs_tol=1e-6)
                   for i, r in enumerate(rets))

    return matches(a, b) or matches(b, a)


def detect_fabricated_seed(risk_row: dict | None, returns_rows: list[dict] | None,
                           min_sentinels: int = 3) -> list[str]:
    """
    Return a list of red-flag strings (empty == clean).

    Risk sentinels are only flagged when a strong majority match at once
    (>= ``min_sentinels`` of 5), so a single coincidental value (e.g. a real
    beta of 0.65) does not raise a false alarm. The return-series fingerprint is
    specific enough to flag on its own.
    """
    flags: list[str] = []

    if risk_row:
        matched = [k for k, v in RISK_SENTINELS.items()
                   if risk_row.get(k) is not None and _close(risk_row[k], v)]
        if len(matched) >= min_sentinels:
            flags.append(
                f"portfolio_risk matches {len(matched)}/{len(RISK_SENTINELS)} seed "
                f"sentinels {matched} — looks fabricated (RESIDUAL R0)."
            )

    rets = [float(r["daily_return"]) for r in (returns_rows or [])
            if r.get("daily_return") is not None]
    if _looks_like_alternating_seed(rets):
        flags.append(
            "portfolio_returns matches the alternating ±0.0015/-0.0008 seed "
            "pattern — looks fabricated (RESIDUAL R0)."
        )

    return flags


def check_edge_score_reconciles(
    signal_rows: list[dict] | None,
    weights: dict[str, float] | None,
    tol: float = 5e-4,
) -> list[str]:
    """Does every persisted ``edge_score`` equal its own components, recomputed?

    `compute_edge_score` drops a component that is ``None`` — not computable for that
    theme — and renormalises the weights over the ones present
    (``sum(w*v) / sum(w)``, ADR-0036). This recomputes that from the persisted columns
    and flags any row where the stored score disagrees.

    **Why this is worth a daily check rather than a one-off.** ADR-0064 was a display
    surface that recomputed the score the *wrong* way — plain ``sum(w * (v or 0))``,
    with no renormalisation — and then published a red RECONCILIATION FAILURE blaming
    the pipeline. Measured across the live 2026-07-25 run, the renormalised
    recomputation matched **8 of 8** themes while the naive sum matched only **5 of
    8**: the three themes lacking a carry and value proxy (China Growth, Energy Prices,
    US Election) diverged by 0.11–0.18.

    So the pipeline was right and the page was wrong — but *nothing was checking*, and
    the only reason anyone looked was that a page happened to render the disagreement.
    This makes the invariant explicit: **a stored score must be reproducible from the
    stored components by the documented formula.** If a future change to the weights,
    the components, or the formula breaks that, the daily run says so instead of
    waiting for a surface to notice.

    Silent when there is nothing to check — no rows, no weights, or a row whose
    ``edge_score`` is null (a theme that was never scored is not a mismatch).

    Returns a list of failure strings; empty means every row reconciles.
    """
    if not signal_rows or not weights:
        return []

    fields = (
        ("trend", "trend_signal"),
        ("regime", "regime_bias"),
        ("carry", "carry_signal"),
        ("value", "value_signal"),
        ("sentiment", "sentiment_signal"),
    )
    failures: list[str] = []
    for row in signal_rows:
        stored = row.get("edge_score")
        if stored is None:
            continue
        present = [
            (weights[key], row.get(col))
            for key, col in fields
            if key in weights and row.get(col) is not None
        ]
        weight_present = sum(w for w, _ in present)
        # Nothing computable -> 0.0, which abstains. Matches edge_signals.py's
        # `if total_w <= 0: return 0.0`.
        recomputed = (
            sum(w * v for w, v in present) / weight_present if weight_present > 0 else 0.0
        )
        if abs(recomputed - float(stored)) >= tol:
            missing = [
                key for key, col in fields if key in weights and row.get(col) is None
            ]
            failures.append(
                f"theme {row.get('theme_id', '?')} on {row.get('run_date', '?')}: "
                f"edge_score={float(stored):.6f} but components renormalise to "
                f"{recomputed:.6f}"
                + (f" (not computable: {', '.join(missing)})" if missing else "")
            )
    return failures


def check_published_book_claims(
    rec_row: dict | None,
    candidates: list[dict] | None,
) -> list[str]:
    """Re-run the thesis guardrails against **what is actually published**.

    `verify_citations` runs *during* generation and blocks a bad book from being
    written. That leaves two ways an unchecked thesis reaches the page:

    1. **The fallback is terminal.** After the retries are spent, `reason_picks` returns
       `fallback_picks(state)`, whose templated thesis is persisted without going back
       through `verify_citations`.
    2. **A row published by older code stays live.** The 2026-07-25 book carried
       *"ARKK … is not present in the tradable candidate pool"* — false, ARKK was the
       eleventh of twelve short candidates — for as long as it took someone to read it.
       [ADR-0061] added the check that rejects that claim, but only on the *next*
       generation; nothing re-examined the row already on the page.

    Both are the shape [ADR-0040] exists to prevent: **check the published book, do not
    assume it.** This applies the two exact-match prose checks — the availability claim
    (ADR-0061) and the restated idea count (ADR-0049) — to the persisted `book_view`,
    so a wrong claim on the live page is reported by the daily run rather than by
    whoever happens to read it.

    Deliberately reuses `q1_agent`'s functions rather than reimplementing them: a second
    copy of a guardrail is a second thing to drift, which is the defect
    [ADR-0064] was about. Imported lazily so this module stays importable without the
    agent's dependencies.

    Silent when there is nothing to check. Returns failure strings; empty means the
    published thesis makes no checkable false claim.
    """
    if not rec_row:
        return []
    prose = rec_row.get("book_view") or ""
    if not prose:
        return []

    from backend.services.q1_agent import (  # noqa: PLC0415 - lazy by design
        check_availability_claims,
        check_idea_count_claims,
    )

    run_date = rec_row.get("run_date", "?")
    failures = [
        f"published book {run_date}: {f}"
        for f in check_availability_claims(prose, candidates or [])
    ]
    failures += [
        f"published book {run_date}: {f}"
        for f in check_idea_count_claims(prose, rec_row.get("independent_ideas") or {})
    ]
    return failures


_CAP_BREACH_CLAIM = re.compile(
    r"(?:\b(?:over|above|exceed(?:s|ing)?|breach(?:es|ing|ed)?|versus|vs\.?)\b[^.]{0,60}?"
    r"\bcap\b|\bcap\b[^.]{0,60}?\b(?:breach(?:ed|es)?|exceeded|violat\w*)\b|\bpp over\b)",
    re.IGNORECASE,
)


def check_cap_breach_claims(rec_row: dict | None) -> list[str]:
    """Reject a thesis claiming a cap breach when the book has none.

    `compute_book_metrics_node` runs BEFORE `reason_picks` and computes sector, geo and
    exposure figures over the **screened candidate pool, equal-weighted** — the prompt
    used to label that block ``BOOK METRICS (computed, not estimated)``. The model
    reported them as the book's own, which on 2026-07-25 published:

        "US geographic concentration: pre-computed book metrics show US at 66.67%
         versus the 35% cap (31.67pp over)"
        "Gold Miners at 7% already in the book"

    Both false of the book. `book_metrics.geo_weights` held **US 35.00%** with
    ``cap_utilisation.violations == []``, and **no gold miner was held at all**. Both
    figures are exactly the equal-weighted pool numbers — the screened pool caps at 30
    names, so 20/30 = 66.67% and 2/30 = 6.67% — so the model was faithfully repeating
    what it was handed under a label that said "book".

    That matters more than a stray number: it appeared in **book_risks**, the panel a
    reviewer reads to learn what could break the book, asserting a 31.67pp governance
    breach on a portfolio that sits exactly at its cap and breaches nothing.

    This checks the one falsifiable half — **a claimed cap breach against
    `cap_utilisation.violations`**, which the sizer computes on the real book. It does
    not judge composition figures in prose; that is the prompt's job now, and
    over-reaching would be the unfalsifiable verdict ADR-0045 refused.

    Silent when there is no thesis, no `cap_utilisation`, or when the book genuinely
    breaches something — a real breach SHOULD be discussed.

    Returns failure strings; empty means no false breach claim.
    """
    if not rec_row:
        return []
    prose = rec_row.get("book_view") or ""
    risks = rec_row.get("book_risks") or []
    cap = rec_row.get("cap_utilisation")
    if not prose and not risks:
        return []
    if cap is None:
        return []
    violations = cap.get("violations")
    if violations is None or violations:
        # No measurement, or a genuine breach the thesis is right to raise.
        return []

    run = rec_row.get("run_date", "?")
    out: list[str] = []
    for label, text in [("thesis", prose)] + [
        (f"book_risks[{i}]", str(x)) for i, x in enumerate(risks)
    ]:
        for sentence in re.split(r"(?<=[.;])\s+", text):
            if _CAP_BREACH_CLAIM.search(sentence):
                out.append(
                    f"book {run}: {label} claims a cap breach — \"{sentence.strip()[:150]}\" "
                    f"— but cap_utilisation.violations is empty. The pool metrics in the "
                    f"prompt are equal-weighted and pre-selection; the book's caps are "
                    f"enforced by the sizer."
                )
                break
    return out


def check_book_arithmetic(
    rec_row: dict | None,
    total_capital: float = 100_000_000.0,
    tol: float = 1e-6,
) -> list[str]:
    """Do `/book`'s headline figures describe the positions printed beneath them?

    The six tiles at the top of `/book` — POSITIONS, LONGS / SHORTS, GROSS, NET,
    DEPLOYED, WORST SCENARIO — are read before anything else, and they come from
    `book_metrics`, while the table below comes from `picks`. Nothing checked that the
    two agree. That is the [ADR-0040] family exactly: a headline is a claim about the
    book, and a claim about the book must be checked against the book.

    Six invariants, all of them arithmetic rather than judgement:

    * ``Σ|weight| == gross_exposure``
    * ``Σ signed_weight == net_exposure``
    * ``long_weight + short_weight == gross`` and ``long_weight − short_weight == net``
    * ``notional == weight × total_capital`` per pick
    * ``|signed_weight| == weight`` per pick
    * ``sign(signed_weight)`` agrees with ``direction``

    All six hold on the live 2026-07-25 book, and this exists so that stays true rather
    than being rediscovered. The failures this repo has actually shipped were of exactly
    this shape — a computed number presented beside positions it did not describe: the
    provisional 40-name book behind a 9-name headline (iteration 32), HHI diluted by
    cash, net share divided by a near-zero denominator (ADR-0060).

    Silent when there is nothing to check — no row, no picks, or no `book_metrics`.
    Tolerance is `1e-6`, a float-accumulation guard on sums of ~10 terms, not an
    economic tolerance; the same distinction ADR-0068 draws.

    Returns failure strings; empty means the headline describes the book.
    """
    if not rec_row:
        return []
    picks = rec_row.get("picks")
    if isinstance(picks, str):
        try:
            picks = json.loads(picks)
        except (ValueError, TypeError):
            return []
    if not picks:
        return []
    bm = rec_row.get("book_metrics") or {}
    if not bm:
        return []

    run = rec_row.get("run_date", "?")
    out: list[str] = []

    def _num(v) -> float | None:
        return float(v) if isinstance(v, (int, float)) else None

    gross_actual = sum(abs(_num(p.get("weight")) or 0.0) for p in picks)
    net_actual = sum(_num(p.get("signed_weight")) or 0.0 for p in picks)

    gross_stated = _num(bm.get("gross_exposure"))
    net_stated = _num(bm.get("net_exposure"))
    lw = _num(bm.get("long_weight"))
    sw = _num(bm.get("short_weight"))

    if gross_stated is not None and abs(gross_actual - gross_stated) > tol:
        out.append(
            f"book {run}: gross_exposure {gross_stated:.6f} but the picks sum to "
            f"{gross_actual:.6f}"
        )
    if net_stated is not None and abs(net_actual - net_stated) > tol:
        out.append(
            f"book {run}: net_exposure {net_stated:.6f} but the picks sum to "
            f"{net_actual:.6f}"
        )
    if lw is not None and sw is not None:
        if gross_stated is not None and abs((lw + sw) - gross_stated) > tol:
            out.append(
                f"book {run}: long_weight + short_weight = {lw + sw:.6f} but "
                f"gross_exposure is {gross_stated:.6f}"
            )
        if net_stated is not None and abs((lw - sw) - net_stated) > tol:
            out.append(
                f"book {run}: long_weight − short_weight = {lw - sw:.6f} but "
                f"net_exposure is {net_stated:.6f}"
            )

    for p in picks:
        asset = p.get("asset", "?")
        w = _num(p.get("weight"))
        s = _num(p.get("signed_weight"))
        n = _num(p.get("notional"))
        if w is not None and n is not None and abs(n - w * total_capital) > 1.0:
            out.append(
                f"book {run}: {asset} notional {n:,.0f} but weight {w:.6f} × capital "
                f"is {w * total_capital:,.0f}"
            )
        if w is not None and s is not None:
            if abs(abs(s) - abs(w)) > tol:
                out.append(
                    f"book {run}: {asset} |signed_weight| {abs(s):.6f} != weight "
                    f"{abs(w):.6f}"
                )
            d = p.get("direction")
            if (d == "long" and s < 0) or (d == "short" and s > 0):
                out.append(
                    f"book {run}: {asset} is {d} but signed_weight is {s:+.6f} — the "
                    "sign is the direction (ADR-0016)"
                )
    return out


WORKFLOW_TIMEOUT_MINUTES = 60   # daily-refresh.yml `timeout-minutes`
STALE_STAGE_MARGIN_MINUTES = 30


def check_stalled_stages(
    rows: list[dict] | None,
    now: "datetime | None" = None,
    max_age_minutes: int = WORKFLOW_TIMEOUT_MINUTES + STALE_STAGE_MARGIN_MINUTES,
) -> list[str]:
    """Did a pipeline stage start and never reach a terminal status?

    `record_pipeline_run` maps the internal ``"started"`` sentinel to the DB status
    ``'partial'``, updating it to ``'success'`` or ``'failure'`` on completion. So
    ``partial`` means *began and has not finished* — the transient state during a run,
    and the **permanent** state of a run that died.

    Nothing detected the second case. On 2026-07-24 the scheduled job's **L5 started at
    22:34:58 and never wrote a terminal status**: no book was published for that date, the
    site went on serving the previous run's, and `pipeline_runs` simply held `partial`
    indefinitely. The day before, the same stage had succeeded in 2.5 minutes. For a
    deliverable whose Q2 claim is *"a daily process"*, a daily job that silently stops
    finishing is the failure that matters most, and it was invisible.

    **The threshold has a stated basis rather than a fitted one.** `daily-refresh.yml`
    sets ``timeout-minutes: 60``, so no legitimately-running stage can be older than that
    — GitHub kills the job first. 90 minutes is that ceiling plus a 30-minute margin for
    a delayed scheduler and clock skew, so a run genuinely in progress can never trip it
    and a dead one always will.

    Silent when there is nothing to judge: no rows, a stage with no ``started_at``, or a
    stage that reached ``success``/``failure``. A stage still inside the window is
    *running*, not stalled, and saying otherwise would fire on every concurrent run.

    Returns failure strings; empty means no stage is stuck.
    """
    if not rows:
        return []
    from datetime import datetime, timedelta, timezone

    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=max_age_minutes)
    out: list[str] = []
    for r in rows:
        if (r.get("status") or "") != "partial":
            continue
        started = r.get("started_at")
        if not started:
            continue
        try:
            ts = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts < cutoff:
            age = int((now - ts).total_seconds() // 60)
            out.append(
                f"stage {r.get('stage', '?')} for run_date {r.get('run_date', '?')} has "
                f"been 'partial' for {age} min (started {str(started)[:19]}Z) — it began "
                f"and never finished, so that run published nothing"
            )
    return out


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to check live data.")
        return 2
    from supabase import create_client
    sb = create_client(url, key)

    risk_rows = (
        sb.table("portfolio_risk").select("*").order("run_date", desc=True).limit(1).execute().data
    )
    returns_rows = (
        sb.table("portfolio_returns").select("run_date, daily_return").order("run_date").execute().data
    )

    flags = detect_fabricated_seed(risk_rows[0] if risk_rows else None, returns_rows)
    if flags:
        print("✗ DATA INTEGRITY CHECK FAILED — production looks fabricated:")
        for f in flags:
            print(f"  - {f}")
        print("\nFix: re-run scripts/daily_refresh.py against real data to overwrite "
              "the seeded rows, then confirm concentration_hhi is no longer 1850.")
        return 1

    # Every persisted edge_score must be reproducible from its own components by the
    # documented formula (ADR-0036/0064). Read for the latest run only — an old row
    # written under different weights is history, not a live defect.
    latest = (
        sb.table("theme_signals_history")
        .select("run_date")
        .order("run_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if latest:
        run_date = latest[0]["run_date"]
        signal_rows = (
            sb.table("theme_signals_history")
            .select(
                "theme_id, run_date, edge_score, trend_signal, regime_bias, "
                "carry_signal, value_signal, sentiment_signal"
            )
            .eq("run_date", run_date)
            .execute()
            .data
        )
        cfg = {
            r["param_name"]: r["value"]
            for r in (sb.table("scoring_config").select("param_name, value").execute().data or [])
        }
        weights = {
            key: float(cfg[param])
            for key, param in (
                ("trend", "edge_trend_weight"),
                ("regime", "edge_regime_weight"),
                ("carry", "edge_carry_weight"),
                ("value", "edge_value_weight"),
                ("sentiment", "edge_sentiment_weight"),
            )
            if cfg.get(param) is not None
        }
        edge_flags = check_edge_score_reconciles(signal_rows, weights)
        if edge_flags:
            print("✗ DATA INTEGRITY CHECK FAILED — a persisted edge_score does not "
                  "match its own components:")
            for f in edge_flags:
                print(f"  - {f}")
            print("\nThe components are renormalised over what is computable "
                  "(ADR-0036). Either the weights changed after these rows were "
                  "written, or the score and component columns came from different "
                  "inputs.")
            return 1
        print(f"✓ edge_score reconciles from components for all "
              f"{len(signal_rows or [])} themes on {run_date}.")

    # The thesis guardrails run during generation; the fallback path is terminal and an
    # older row can stay live, so re-check what is actually on the page (ADR-0040).
    rec_rows = (
        sb.table("research_recommendations")
        .select("run_date, book_view, independent_ideas")
        .order("run_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if rec_rows:
        rec = rec_rows[0]
        cands = (
            sb.table("trade_candidates")
            .select("asset")
            .eq("run_date", rec["run_date"])
            .execute()
            .data
        )
        book_flags = check_published_book_claims(rec, cands)
        if book_flags:
            print("✗ DATA INTEGRITY CHECK FAILED — the PUBLISHED thesis makes a claim "
                  "its own inputs contradict:")
            for f in book_flags:
                print(f"  - {f}")
            print("\nThis is the live page, not a generation-time state. Re-run L5 so a "
                  "corrected thesis is published.")
            return 1
        print(f"✓ Published thesis for {rec['run_date']} makes no contradicted claim "
              f"(checked against {len(cands or [])} screened candidates).")

        # The headline tiles must describe the positions printed beneath them.
        book_row = (
            sb.table("research_recommendations")
            .select("run_date, picks, book_metrics")
            .eq("run_date", rec["run_date"])
            .limit(1)
            .execute()
            .data
        )
        # A thesis must not claim a cap breach the book does not have.
        cap_row = (
            sb.table("research_recommendations")
            .select("run_date, book_view, book_risks, cap_utilisation")
            .eq("run_date", rec["run_date"])
            .limit(1)
            .execute()
            .data
        )
        cap_flags = check_cap_breach_claims(cap_row[0] if cap_row else None)
        if cap_flags:
            print("✗ DATA INTEGRITY CHECK FAILED — the published thesis claims a cap "
                  "breach the book does not have:")
            for f in cap_flags:
                print(f"  - {f}")
            return 1
        print(f"✓ No false cap-breach claim in the {rec['run_date']} thesis.")

        arith = check_book_arithmetic(book_row[0] if book_row else None)
        if arith:
            print("✗ DATA INTEGRITY CHECK FAILED — /book's headline does not describe "
                  "its own positions:")
            for f in arith:
                print(f"  - {f}")
            return 1
        print(f"✓ Book arithmetic reconciles for {rec['run_date']} "
              f"(gross, net, long/short split, notional and signed weights).")

    # A stage that began and never finished means that run published nothing.
    stage_rows = (
        sb.table("pipeline_runs")
        .select("run_date, stage, status, started_at")
        .order("started_at", desc=True)
        .limit(60)
        .execute()
        .data
    )
    stalled = check_stalled_stages(stage_rows)
    if stalled:
        print("✗ DATA INTEGRITY CHECK FAILED — a pipeline stage started and never "
              "finished:")
        for f in stalled:
            print(f"  - {f}")
        print("\nRe-run the pipeline for that date; the site is serving an older run.")
        return 1
    print("✓ No pipeline stage is stuck mid-run.")

    print("✓ Data integrity check passed — no seed fingerprint detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
