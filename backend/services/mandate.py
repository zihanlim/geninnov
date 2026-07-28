"""The mandate: the constraints the book is run under, as ONE object.

Every number here was already being enforced. None of them was written down in a
place a reader could find, and the two places parts of them WERE written down
disagreed with each other:

  * `frontend/lib/risk/riskBoard.ts` declared `gross_exposure_pct: 2.0` — 200%
    gross — while `optimizer.py` has enforced `max_gross = 1.0` since ADR-0037.
    The risk board was permitting leverage the sizer structurally cannot produce,
    which is a published risk limit disagreeing with the published book (ADR-0123).
  * That same board looked up `max_single_name_weight` / `max_sector_weight` /
    `max_geo_weight` in `scoring_config`, where they had never been seeded, so all
    ten limits silently resolved to `house_default` — a lookup that reads as live
    and is dead.
  * `riskBoard.ts` also once carried the single-name and geo caps TRANSPOSED
    (0.35 / 0.20), judging every position against the wrong ceiling in both
    directions. The comment left behind asks the next person to keep the copies in
    step by hand. This module is the answer to that comment.

So the cap VALUES live here and nowhere else. `book_metrics` re-exports them for
the modules that already import from it, `OptimizerConstraints` is built FROM a
`Mandate` rather than from module constants, and
`frontend/tests/unit/mandate-drift.test.ts` parses this file and fails if the
TypeScript mirror disagrees — the pattern `risk-thresholds.test.ts` already uses
to pin the minimum-sample rule across the language boundary (ADR-0100).

WHAT IS ENFORCED AND WHAT IS ONLY WATCHED
-----------------------------------------
Only the constraints in this file are entered into the solver. The risk board also
renders VaR, CVaR, drawdown, HHI, net exposure and beta limits, and **nothing in
the backend constrains any of them**. They are monitoring thresholds, and the
frontend type keeps them in a separate shape so the two cannot be confused: a
reader looking at a limit is owed the difference between "the sizer cannot breach
this" and "we would like to know if this happens".

PROVENANCE IS PART OF THE VALUE
-------------------------------
`Mandate.sources` records, per field, whether the number came from
`scoring_config` or from the fallback in this module. A mandate panel that shows
35% without saying where 35% came from is a naked number (design goal 1), and the
honest answer differs per field: the caps are seeded, `max_longs` and `lens` are
not yet.

THE VALUES ARE AN OPERATOR DECISION
-----------------------------------
ADR-0037: "The limit *values* (20% single name / 30% sector / 35% geography) are
unchanged. They were never the defect and re-specifying them is an operator
decision, not an implementation one." Changing one is a `scoring_config` write and
takes effect on the next 21:30 UTC run. Nothing in the frontend may write them —
design goal 5.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ─── Enforced constraints ────────────────────────────────────────────────────
# These are entered into the solver as constraints (ADR-0107) and clamped by the
# heuristic allocator (ADR-0037). A book cannot breach them.

TOTAL_CAPITAL = 100_000_000.0  # the book is sized against this
MAX_SINGLE_NAME_WEIGHT = 0.20  # no single position > 20% of book
MAX_SECTOR_WEIGHT = 0.30       # no single sector > 30%
MAX_GEO_WEIGHT = 0.35          # no single geography > 35%
MAX_GROSS = 1.0                # long + short <= 100%; ADR-0037 banks the rest as cash

# A CORRELATION COMPLEX IS ONE IDEA, so it may hold at most what one name may
# (ADR-0115), and at most one name's worth of RISK (ADR-0118). Named separately
# from the single-name cap rather than aliased, so the two can diverge later with
# an argument rather than by accident.
MAX_COMPLEX_WEIGHT = 0.20

# A crowded name's single-name cap is HALVED (ADR-0110). Every other name is absent
# from the crowding map and sized bit-identically — absence is neutrality. This may
# only ever tighten a cap, never raise one.
CROWDED_CAP_MULTIPLIER = 0.5

# Book shape. Not currently seeded into scoring_config; `Mandate.sources` says so.
MAX_LONGS = 5
MAX_SHORTS = 5

# Which asset classes the candidate pool is filtered to before the LLM sees it
# (ADR-0015). `multi_asset` is what the nightly run ships; ADR-0015 records that
# Andromeda Capital's own mandate is credit + rates, which is a different lens and
# an operator decision with a real effect on the book.
DEFAULT_LENS = "multi_asset"

LENSES = ("multi_asset", "credit", "rates", "equity", "fx", "commodity")

# ─── scoring_config keys ─────────────────────────────────────────────────────
# The key each field is read from. `riskBoard.ts` already looks up the first three
# of these; until the seeding migration they resolved to nothing.

CONFIG_KEYS: dict[str, str] = {
    "total_capital": "total_capital",
    "max_single_name": "max_single_name_weight",
    "max_sector": "max_sector_weight",
    "max_geo": "max_geo_weight",
    "max_gross": "max_gross",
    "max_complex": "max_complex_weight",
    "crowded_multiplier": "crowded_cap_multiplier",
}

Source = Literal["scoring_config", "code_default"]


@dataclass(frozen=True)
class Mandate:
    """The constraints one book is run under.

    Frozen: a mandate is fixed for the duration of a run. Re-sizing under a
    different mandate constructs a different `Mandate` and calls the same sizer —
    which is what lets the nightly job, the workbench and the MCP `size_book` tool
    share one optimizer without being able to disagree.
    """

    total_capital: float = TOTAL_CAPITAL
    max_single_name: float = MAX_SINGLE_NAME_WEIGHT
    max_sector: float = MAX_SECTOR_WEIGHT
    max_geo: float = MAX_GEO_WEIGHT
    max_gross: float = MAX_GROSS
    max_complex: float = MAX_COMPLEX_WEIGHT
    crowded_multiplier: float = CROWDED_CAP_MULTIPLIER
    max_longs: int = MAX_LONGS
    max_shorts: int = MAX_SHORTS
    lens: str = DEFAULT_LENS
    # Per-field provenance. A field absent from this map came from this module's
    # fallback; `source_of` reports `code_default` for it rather than guessing.
    sources: dict[str, Source] = field(default_factory=dict)

    def source_of(self, name: str) -> Source:
        """Where did this field's value come from? Never guesses."""
        return self.sources.get(name, "code_default")

    @classmethod
    def from_rows(cls, rows: list[dict[str, Any]] | None) -> "Mandate":
        """Build from raw `scoring_config` rows.

        Takes the same shape `ScoringConfig.from_db_rows` takes, so a caller that
        already read the table does not read it twice. A missing or unparseable row
        falls back to this module's value and is recorded as `code_default` — an
        absent limit must not silently become a permissive one.
        """
        vals: dict[str, float] = {}
        for row in rows or []:
            name = row.get("param_name")
            if not name:
                continue
            try:
                vals[name] = float(row["value"])
            except (KeyError, TypeError, ValueError):
                # A malformed row is a missing row. It must not become a limit.
                continue

        kwargs: dict[str, Any] = {}
        sources: dict[str, Source] = {}
        for attr, key in CONFIG_KEYS.items():
            if key in vals:
                kwargs[attr] = vals[key]
                sources[attr] = "scoring_config"

        return cls(**kwargs, sources=sources)

    def to_dict(self) -> dict[str, Any]:
        """Serialisable form, provenance included.

        Consumed by the mandate panel and by the MCP `size_book` tool. Provenance
        travels WITH the value because a limit whose origin a reader cannot name is
        a naked number (design goal 1).
        """
        fields = (
            "total_capital", "max_single_name", "max_sector", "max_geo",
            "max_gross", "max_complex", "crowded_multiplier",
            "max_longs", "max_shorts", "lens",
        )
        return {
            "values": {name: getattr(self, name) for name in fields},
            "sources": {name: self.source_of(name) for name in fields},
            "config_keys": dict(CONFIG_KEYS),
        }


# The mandate the nightly run ships when `scoring_config` is unreachable. Named
# rather than constructed inline so a caller cannot mistake it for a live read.
DEFAULT_MANDATE = Mandate()
