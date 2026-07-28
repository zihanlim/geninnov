"""
Does the thesis describe a book we actually hold? (ADR-0135)

The citation guardrail (ADR-0012, ADR-0019) verifies every cited **number**
against the frozen L0–L4 inputs. It has no notion of a **position**, so a thesis
can assert a trade the book does not contain and pass verification with every
figure correct.

Live on the 2026-07-28 book. VRT's published thesis reads:

    "...the long VRT / short MSFT structure below isolates the
     capex-deployment vs capex-monetization gap."

The book is `BABA, GDX, GEV, JPM, NUE, PDD, UNG, VRT, XLE`. **There is no MSFT
position.** MSFT was a real candidate — the engine put it short at EdgeScore
−0.322 — and it did not survive selection, so the agent reasoned about a pair and
published half of it. Every number in that sentence is accurate; the structure it
describes does not exist.

THE DISTINCTION THIS MODULE EXISTS TO MAKE
==========================================
Naming another asset is not the defect, and a check that flagged every mention
would fire constantly on correct prose. The same run's GDX thesis says:

    "GDX is the strongest expression of the gold-short trade from the
     {GDX, GLD, IAU, NEM, SLV} cluster"

That is a **comparison** — it names the correlation complex and says which member
was chosen, which is [ADR-0116](../../docs/adrs/0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md)
being explained rather than violated. It asserts no position in GLD or SLV.

So: a **position claim** is flagged; a **comparison** is not. The difference is
grammatical and detectable — a direction word attached to the ticker, or a
position noun following it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Words that, immediately before a ticker, assert a side in it.
_DIRECTION_BEFORE = r"(?:long|short|buying|selling|overweight|underweight)"

#: Nouns that, immediately after a ticker, assert it is a held leg.
_POSITION_AFTER = (
    r"(?:leg|position|holding|structure|overlay|hedge|pair|short|long)"
)

#: A braced or bracketed set is a CLUSTER listing, not a set of positions —
#: "{GDX, GLD, IAU, NEM, SLV} cluster". Tickers inside one are never claims.
_CLUSTER_SPAN = re.compile(r"[{\[][^}\]]*[}\]]")


@dataclass(frozen=True)
class PositionClaim:
    """A sentence fragment asserting a position in `ticker`."""
    ticker: str
    #: The matched phrase, so a reader sees the evidence and not just a verdict.
    phrase: str


def _mask_clusters(text: str) -> str:
    """Blank out braced cluster listings, preserving length so offsets hold."""
    return _CLUSTER_SPAN.sub(lambda m: " " * len(m.group(0)), text or "")


def find_position_claims(thesis: str, universe: set[str]) -> list[PositionClaim]:
    """Every position a thesis asserts, for tickers in `universe`.

    Two patterns, both requiring the ticker to be a whole word:

    * ``long MSFT`` / ``short MSFT`` — a direction word attached to it.
    * ``MSFT leg`` / ``MSFT structure`` — a position noun following it.

    A ticker inside a braced cluster listing is skipped: that is the vocabulary
    the optimizer uses to say which instrument it chose from a complex, and
    flagging it would make the check fire on correct prose.

    **One claim per ticker.** "the long VRT / short MSFT structure" matches both
    patterns on MSFT, but it is one assertion, and counting it twice would make
    a single defect read as two. The direction form wins where both match: it is
    the more explicit statement of a side.
    """
    if not thesis or not universe:
        return []

    text = _mask_clusters(thesis)
    claims: list[PositionClaim] = []

    for ticker in sorted(universe):
        t = re.escape(ticker)
        # Direction-first: it states a side explicitly, so it is the better
        # evidence to show when both forms match one assertion.
        for pat in (rf"{_DIRECTION_BEFORE}\s+{t}\b",
                    rf"\b{t}\s+{_POSITION_AFTER}\b"):
            m = re.search(pat, text, flags=re.IGNORECASE)
            if m:
                claims.append(PositionClaim(ticker=ticker, phrase=m.group(0).strip()))
                break
    return claims


def unheld_claims(
    thesis: str,
    held: set[str],
    universe: set[str],
    self_asset: str | None = None,
) -> list[PositionClaim]:
    """Position claims naming an asset the book does **not** hold.

    `self_asset` is excluded: a pick's own thesis says "long VRT" about itself,
    which is the one position claim guaranteed to be true.
    """
    out = []
    for claim in find_position_claims(thesis, universe):
        if self_asset and claim.ticker.upper() == self_asset.upper():
            continue
        if claim.ticker.upper() in {h.upper() for h in held}:
            continue
        out.append(claim)
    return out


def audit_book(picks: list[dict], universe: set[str]) -> list[dict]:
    """Every unheld position claim across a book's theses.

    Returns one record per offending claim: ``{asset, references, phrase}``.
    Empty means every position the prose asserts is one the book holds — the
    property this exists to establish, stated as a result rather than assumed.
    """
    held = {str(p.get("asset")) for p in picks if p.get("asset")}
    findings: list[dict] = []
    for p in picks:
        asset = str(p.get("asset") or "")
        thesis = str(p.get("thesis") or "")
        for claim in unheld_claims(thesis, held, universe, self_asset=asset):
            findings.append({
                "asset": asset,
                "references": claim.ticker,
                "phrase": claim.phrase,
            })
    return findings


#: A repaired thesis must keep at least this share of its original characters.
#: Below it, the offending clause was carrying the argument rather than
#: decorating it, and excising it would leave a stub that misrepresents the
#: reasoning more than the original over-claim did.
MIN_RETAINED_SHARE = 0.55

#: Clause boundaries, in the order a thesis is safest to cut on. Semicolons and
#: sentence stops separate independent statements; commas do not, which is why
#: they are absent — cutting on a comma reliably produces a fragment.
_CLAUSE_SPLIT = re.compile(r"(?<=[.;])\s+")


def repair_thesis(
    thesis: str,
    held: set[str],
    universe: set[str],
    self_asset: str | None = None,
    min_retained: float = MIN_RETAINED_SHARE,
) -> tuple[str, list[str]]:
    """Remove the clauses that assert a position the book does not hold.

    Returns ``(repaired_thesis, removed_clauses)``. ``removed_clauses`` is empty
    when nothing needed removing — and when a repair would be UNSAFE, in which
    case the thesis is returned unchanged for the caller to caveat instead.

    Deterministic, and deliberately not a second LLM call. Re-prompting to fix a
    clause costs a model call on the nightly book's shared quota, reruns a
    stochastic step over an output whose figures are already verified, and can
    introduce new numbers that then need re-verifying. Excision cannot: it only
    ever removes text, so every surviving figure was already checked.

    Splits on sentence and semicolon boundaries only. A comma is not a safe cut
    point — "Vertiv, the picks-and-shovels beneficiary, is long MSFT" would leave
    a fragment — so a claim embedded mid-clause is left for the caveat path.

    The ``min_retained`` guard is the important half. On the live case the
    offending text is a trailing clause and removing it leaves a complete,
    correct thesis. Where the claim instead carries the whole argument, cutting
    it produces a stub that misrepresents the reasoning worse than the original
    over-claim, so the repair declines and the caveat stands.
    """
    original = (thesis or "").strip()
    if not original:
        return original, []

    clauses = [c for c in _CLAUSE_SPLIT.split(original) if c.strip()]
    if len(clauses) < 2:
        # Nothing to cut without destroying the whole thesis.
        return original, []

    kept, removed = [], []
    for clause in clauses:
        if unheld_claims(clause, held, universe, self_asset=self_asset):
            removed.append(clause.strip())
        else:
            kept.append(clause)

    if not removed:
        return original, []

    # Close the seam. Cutting a trailing clause leaves the preceding one ending
    # on its own separator — "...electrical infrastructure;" — which reads as
    # truncated text rather than a finished sentence, and a published thesis that
    # looks broken invites doubt about the figures in it.
    repaired = " ".join(kept).strip()
    repaired = re.sub(r"[;,]\s*$", ".", repaired)

    if not repaired or len(repaired) < min_retained * len(original):
        # The claim was load-bearing. Leave the text alone and let the caveat
        # carry the correction.
        return original, []

    return repaired, removed


def apply_caveats(picks: list[dict], universe: set[str]) -> list[dict]:
    """Annotate every pick whose thesis asserts a position the book lacks.

    Mutates `picks` in place (they are the live payload about to be persisted)
    and returns the findings. A pick with nothing to caveat is left **untouched**
    — no empty `thesis_caveat` key — so the absence of the field means "nothing
    over-claimed" rather than "not checked".

    Extracted from `verify_citations` so the behaviour is testable without
    constructing a passing citation set: the check that a defect is CAUGHT should
    not depend on an unrelated guardrail's fixture.
    """
    findings = audit_book(picks, universe)
    if not findings:
        return []

    by_asset: dict[str, list[str]] = {}
    for f in findings:
        by_asset.setdefault(f["asset"], []).append(f["references"])

    held = {str(p.get("asset")) for p in picks if p.get("asset")}

    for pick in picks:
        asset = str(pick.get("asset") or "")
        refs = by_asset.get(asset)
        if not refs:
            continue
        names = ", ".join(sorted(set(refs)))

        # REPAIR first, caveat second. A thesis that no longer makes the false
        # claim is better than one that makes it with a footnote — but the edit
        # is never silent: ADR-0093's rule that a published figure cannot change
        # without saying so applies to published prose too.
        repaired, removed = repair_thesis(
            str(pick.get("thesis") or ""), held, universe, self_asset=asset
        )
        if removed:
            pick["thesis"] = repaired
            pick["thesis_caveat"] = (
                f"A clause asserting a position in {names} was removed: this book "
                f"does not hold it. Removed text: "
                + " ".join(f'"{r}"' for r in removed)
                + " The remaining figures are unchanged and verified."
            )
        else:
            # Excision would have gutted the argument, or the claim sits
            # mid-clause where there is no safe cut. Say so plainly instead.
            pick["thesis_caveat"] = (
                f"This thesis refers to a position in {names}, which this book "
                f"does not hold. The claim could not be removed without cutting "
                f"the argument it sits in, so the text stands as written; the "
                f"figures themselves are verified."
            )
    return findings
