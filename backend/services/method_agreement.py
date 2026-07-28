"""
Two-method agreement between the daily tracker and the monthly discovery job.

WHY (ADR-0133)
==============
Two independent methods now propose narratives over the same corpus:

* **frequency** — `narrative_tracker`, daily. Document frequency over n-grams,
  share of voice, robust velocity. Cheap, deterministic, dependency-free.
* **lda ∩ embedding** — `scripts/theme_discovery`, monthly. LDA topics and
  SBERT→UMAP→HDBSCAN clusters, promoted where they agree (ADR-0007).

[ADR-0128](../../docs/adrs/0128-a-theme-we-did-not-name-in-advance.md) noted that
"agreement between them is a stronger signal than either alone" and then said
plainly: *"Wiring that comparison is not done."* This is that wiring.

The claim it supports is narrow and worth stating exactly. Frequency finding a
phrase means the news repeated it. Clustering finding a term set means documents
about it group together in a way two different algorithms both notice. Those are
**different kinds of evidence**, so a narrative carrying both is better supported
than one carrying either — not because two votes beat one, but because the two
methods fail differently. Frequency is fooled by a repeated boilerplate phrase;
clustering is fooled by a topic that is coherent but tiny.

WHAT IT IS NOT
==============
Still shadow. Corroboration raises confidence that a narrative *exists*; it says
nothing about whether it is tradeable, which needs mapped instruments and a
measured price link (ADR-0129). And it is not a fresh second opinion: the
discovery job runs monthly, so today's phrases are compared against a candidate
set that can be up to a month old. `days_stale` travels with every match so a
reader can discount it rather than assume simultaneity.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


#: Minimum shared tokens between a narrative phrase and a discovered candidate's
#: term set before the two count as the same narrative.
#:
#: TWO, chosen against live data rather than picked. Measured over the 2026-07-28
#: narrative signals against the 2026-07-24 discovery run:
#:
#:   * at ``>= 1`` the top matches are "oil", "dollar" and "fxstreet" — a single
#:     word in common, which two methods over one corpus produce constantly by
#:     chance. It matched 18+ pairs, almost all noise.
#:   * at ``>= 2`` the matches are "credit spreads" ↔ *credit / high / spreads*,
#:     "federal reserve" ↔ *federal / rates / reserve*, "china gdp" ↔
#:     *china / chinas / chinese*, "rate hike" ↔ *fed / hike / holds*. Those are
#:     the same narrative found twice.
#:
#: A consequence worth stating: a ONE-TOKEN phrase can never be corroborated,
#: because it cannot share two tokens with anything. That is deliberate and it is
#: the same argument as `anchor_for_phrase`'s single-token rule — one word is too
#: thin to assert that two methods found the same thing.
MIN_TERM_OVERLAP = 2


@dataclass(frozen=True)
class Corroboration:
    """One narrative phrase matched to one discovered candidate."""
    phrase: str
    label: str
    #: 2 = the discovery job's own two methods agreed; 3 = one method only.
    tier: int
    #: Methods that saw this narrative, e.g. ["frequency", "lda", "embedding"].
    methods: list[str]
    #: The tokens the two methods share — the evidence, not just the verdict.
    shared: list[str]
    #: Age of the discovery run this matched against, in days. The discovery job
    #: is MONTHLY, so this is routinely large and must not be mistaken for a
    #: simultaneous second opinion.
    days_stale: int


def _terms_of(candidate: dict) -> set[str]:
    raw = candidate.get("terms") or []
    if isinstance(raw, str):
        raw = [raw]
    return {str(t).strip().lower() for t in raw if str(t).strip()}


def corroborate(
    phrases: list[str],
    candidates: list[dict],
    run_date: date,
    min_overlap: int = MIN_TERM_OVERLAP,
) -> dict[str, Corroboration]:
    """Match narrative phrases to discovered candidates by shared tokens.

    ``candidates`` are `discovered_themes` rows: ``{label, terms, tier, methods,
    run_date}``. Returns a map phrase -> best Corroboration, keyed by phrase so a
    caller can annotate its signals in one pass.

    Where a phrase matches several candidates, the best is the one with the most
    shared tokens; ties break toward the LOWER tier number, because tier 2 means
    the discovery job's own two methods already agreed and is the stronger claim.
    """
    out: dict[str, Corroboration] = {}

    for phrase in phrases:
        tokens = {t for t in phrase.split() if t}
        if len(tokens) < min_overlap:
            # Cannot share `min_overlap` tokens with anything. Skipped explicitly
            # rather than falling out of the loop, so the reason is legible.
            continue

        best: Corroboration | None = None
        for cand in candidates:
            terms = _terms_of(cand)
            shared = sorted(tokens & terms)
            if len(shared) < min_overlap:
                continue

            tier = int(cand.get("tier") or 3)
            methods = ["frequency"] + [
                m for m in (cand.get("methods") or []) if m not in ("frequency",)
            ]
            cand_date = cand.get("run_date")
            if isinstance(cand_date, str):
                cand_date = date.fromisoformat(cand_date[:10])
            days_stale = (run_date - cand_date).days if cand_date else 0

            found = Corroboration(
                phrase=phrase,
                label=str(cand.get("label") or ""),
                tier=tier,
                methods=methods,
                shared=shared,
                days_stale=days_stale,
            )
            if best is None or (len(found.shared), -found.tier) > (len(best.shared), -best.tier):
                best = found

        if best is not None:
            out[phrase] = best

    return out


def apply_corroboration(signals: list, matches: dict[str, Corroboration]) -> list:
    """Return signals with `methods` widened where a match exists.

    Rebuilds each matched `NarrativeSignal` rather than mutating it — the dataclass
    is frozen, and a frozen record that some code path mutates anyway is worse than
    one that is simply copied.

    An unmatched signal is returned **unchanged and identical**, so wiring this in
    cannot move a number on a narrative that was not corroborated. That is the
    same property `crowding_caps` holds for sizing (ADR-0110) and it is what makes
    the feature safe to add to a live board.
    """
    import dataclasses

    out = []
    for s in signals:
        match = matches.get(getattr(s, "phrase", None))
        if match is None:
            out.append(s)
            continue
        out.append(dataclasses.replace(s, methods=list(match.methods)))
    return out


def load_discovered(sb, run_date: date, max_age_days: int = 120) -> list[dict]:
    """Recent `discovered_themes` rows, newest run only.

    Scoped to ONE run date — the newest within `max_age_days` — rather than every
    row in the window. Unioning several monthly runs would let a candidate that
    was dropped by a later run keep corroborating today's narratives, which
    silently resurrects a rejected hypothesis.
    """
    from datetime import timedelta

    cutoff = (run_date - timedelta(days=max_age_days)).isoformat()
    try:
        rows = (
            sb.table("discovered_themes")
            .select("run_date, label, terms, tier, methods, status")
            .gte("run_date", cutoff)
            .order("run_date", desc=True)
            .limit(500)
            .execute()
            .data
        ) or []
    except Exception as exc:
        print(f"[method_agreement] discovered_themes read failed "
              f"({exc.__class__.__name__}); no corroboration this run.")
        return []

    if not rows:
        return []
    latest = max(str(r.get("run_date"))[:10] for r in rows)
    return [r for r in rows if str(r.get("run_date"))[:10] == latest
            and (r.get("status") or "shadow") != "rejected"]
