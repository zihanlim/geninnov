"""
What changed when a published book was overwritten.

`research_recommendations` is written with `upsert(..., on_conflict="run_date")`, so a
second run for the same run_date REPLACES the published book in place and no prior version
survives. A dated publication whose numbers can change silently cannot be cited: a reader
who quoted yesterday's gross exposure has no way to tell whether the figure on screen now
is the one they read.

The scale is the argument, not the theory. On 2026-07-26 `research_agent_runs` held **17
runs for run_date 2026-07-25** spanning 16.7 hours and **25 for 2026-07-24** — 70 across
four published books. The runs did not agree: the 04:24 run produced the published book
(ARKK/BABA/GDX/NOC/NUE/PDD/SHY/SVXY/UNH/XLE) while the LATEST run at 09:04 proposed a
materially different one (short FXI/KWEB/MCHI, long BIL/EWJ/TLT) and was correctly refused
by the citation guardrail with `verified = false`. The right book is live. What was missing
is any record that a choice had been made.

This module is the pure half: given the row already published and the row about to replace
it, decide which differences are worth telling a reader about. `scripts/` and
`q1_agent._persist_to_supabase` do the writing.

DESIGN: report the FACT of a change per field, not a snapshot of the whole prior book.
Storing every superseded $100M book keyed by a date that gets overwritten seventeen times
in a day is a different and much larger decision. See ADR-0093.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

# Trigger vocabulary, matching the CHECK constraint in migration 044.
PIPELINE_RERUN = "pipeline_rerun"
MANUAL_CORRECTION = "manual_correction"
BACKFILL = "backfill"

# A float that moves by less than this is representation noise, not a revision.
#
# One basis point. Deliberately an ECONOMIC threshold, unlike the 1e-9 representation guard
# in book_metrics (which exists so a clamped cap does not report itself breached). Here the
# question is different: would a reader who quoted the old figure notice? Below a basis
# point on a weight or an exposure, no — and a log that reports the sixteenth decimal place
# moving is a log nobody reads, which is the failure mode that makes a correction surface
# worthless.
MATERIAL_EPSILON = 1e-4

# Fields worth reporting, as dotted paths in the same `table.column` vocabulary the
# citations use — so a reader can match a revision to the figure they quoted.
#
# Deliberately a LIST rather than "diff everything": a full recursive diff of two book rows
# reports the reordering of a correlation matrix and the re-rendering of a prompt string,
# and buries the two numbers that actually moved.
TRACKED_METRICS: tuple[str, ...] = (
    "gross_exposure",
    "net_exposure",
    "long_weight",
    "short_weight",
    "book_beta_mkt",
)


@dataclass
class Revision:
    """One field of one published book, changed."""
    run_date: str
    field: str
    previous_value: Optional[str]
    new_value: Optional[str]
    trigger_type: str
    reason: str
    evidence: Optional[str] = None
    actor: Optional[str] = None

    def to_row(self) -> dict:
        return {
            "run_date": self.run_date,
            "field": self.field,
            "previous_value": self.previous_value,
            "new_value": self.new_value,
            "trigger_type": self.trigger_type,
            "reason": self.reason,
            "evidence": self.evidence,
            "actor": self.actor,
        }


def _fmt(v: Any) -> Optional[str]:
    """Render a value the way the page renders it, so a revision is legible beside the
    figure it describes. None stays None — a field that was absent is not a field that
    was zero (ADR-0066)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return f"{v:.6f}".rstrip("0").rstrip(".")
    return str(v)


def _materially_different(a: Any, b: Any) -> bool:
    """Would a reader notice?

    Absence is always material in one direction: None -> a value, or a value -> None, is a
    change worth reporting even if the value is tiny, because it is the difference between
    "not computable" and "computed" (ADR-0066).
    """
    if a is None and b is None:
        return False
    if (a is None) != (b is None):
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(float(a) - float(b)) >= MATERIAL_EPSILON
    return a != b


def _position_key(p: dict) -> str:
    """A position's identity is (asset, direction) — the same key ADR-0040 matches picks
    back on. Direction is part of it because flipping a name from long to short is not an
    edit to a position, it is a different position."""
    return f"{p.get('asset', '?')}:{p.get('direction', '?')}"


def diff_books(
    run_date: str,
    previous: Optional[dict],
    new: dict,
    *,
    trigger_type: str = PIPELINE_RERUN,
    reason: Optional[str] = None,
    evidence: Optional[str] = None,
    actor: Optional[str] = None,
) -> list[Revision]:
    """Revisions to record when `new` replaces `previous` for one run_date.

    `previous is None` means this run_date is being published for the FIRST time, which is
    not a revision — returns []. A first publication is the baseline, and logging it as a
    change would drown the real ones.

    `reason` defaults to a stated-but-unattributed cause rather than an empty string,
    because migration 044 makes the column NOT NULL on purpose: an unexplained revision is
    indistinguishable from a silent overwrite, which is what the table exists to prevent.
    """
    if previous is None:
        return []

    why = reason or (
        "Unattributed pipeline re-run: the daily job persisted a second book for this "
        "run_date, replacing the one above."
    )

    def rev(field: str, old: Any, new_v: Any) -> Revision:
        return Revision(
            run_date=run_date,
            field=field,
            previous_value=_fmt(old),
            new_value=_fmt(new_v),
            trigger_type=trigger_type,
            reason=why,
            evidence=evidence,
            actor=actor,
        )

    out: list[Revision] = []

    # --- the position set -------------------------------------------------------
    # Reported as membership, not as a per-field diff of every pick. What a reader who
    # quoted the book cares about first is whether the names changed.
    old_picks = {_position_key(p): p for p in (previous.get("picks") or [])}
    new_picks = {_position_key(p): p for p in (new.get("picks") or [])}

    removed = sorted(set(old_picks) - set(new_picks))
    added = sorted(set(new_picks) - set(old_picks))
    if removed or added:
        out.append(
            rev(
                "picks[]",
                f"{len(old_picks)} positions: {', '.join(sorted(old_picks))}",
                f"{len(new_picks)} positions: {', '.join(sorted(new_picks))}",
            )
        )

    # A position held in both books whose WEIGHT moved materially. Reported per name,
    # because "the book is the same names at different sizes" is a different claim from
    # "the book holds different names" and a reader needs to tell them apart.
    for key in sorted(set(old_picks) & set(new_picks)):
        o, n = old_picks[key].get("weight"), new_picks[key].get("weight")
        if _materially_different(o, n):
            out.append(rev(f"picks[{key}].weight", o, n))

    # --- book-level metrics ----------------------------------------------------
    old_bm = previous.get("book_metrics") or {}
    new_bm = new.get("book_metrics") or {}
    for m in TRACKED_METRICS:
        if _materially_different(old_bm.get(m), new_bm.get(m)):
            out.append(rev(f"book_metrics.{m}", old_bm.get(m), new_bm.get(m)))

    # --- the thesis ------------------------------------------------------------
    # Not diffed word by word: a prose diff is unreadable in a log and the useful signal is
    # simply that the published narrative is not the one a reader may have quoted.
    if _materially_different(previous.get("book_view"), new.get("book_view")):
        out.append(
            rev(
                "book_view",
                f"{len(previous.get('book_view') or '')} chars (superseded)",
                f"{len(new.get('book_view') or '')} chars",
            )
        )

    # --- scenario set ----------------------------------------------------------
    # Count only. A scenario ADDED to an already-published book is the exact case
    # ADR-0088's S6 append created, and it is why `backfill` is a trigger type.
    old_n = len(previous.get("scenario_results") or [])
    new_n = len(new.get("scenario_results") or [])
    if old_n != new_n:
        out.append(rev("scenario_results", f"{old_n} scenarios", f"{new_n} scenarios"))

    return out


def summarise(revisions: Iterable[Revision]) -> str:
    """One line for a log or a CI step. Empty input says so rather than printing nothing —
    a silent tool is indistinguishable from one that did not run."""
    revs = list(revisions)
    if not revs:
        return "No material revision: the replacing book matches the published one."
    fields = ", ".join(sorted({r.field for r in revs}))
    return f"{len(revs)} revision(s) on {revs[0].run_date}: {fields}"
