# 0039 — Scope is chosen by attention; abstention is decided per asset

- **Status:** accepted
- **Date:** 2026-07-24
- **Completes:** [ADR-0038](0038-per-asset-direction.md) — which moved *direction* to
  the asset but left a theme-level gate in front of it.
- **Supersedes (in part):** [ADR-0032](0032-edge-carry-value-abstention-sizing.md) —
  the abstention band still exists, but binds on the asset, not the theme.

## Context

ADR-0038 moved direction from the theme to the asset and the book became two-sided
for the first time — 7 long / 2 short. But only **two themes contributed any
position at all**, and the short side stopped at two. Q1 asks for five long and five
short.

The reason was a gate left standing in front of the new logic. `_select` filtered
themes by `|theme EdgeScore| >= abstain_threshold` before any asset was considered.
That test made sense when direction *was* a theme property. Once direction is
per-asset it is actively harmful, because **a theme's average edge is smallest
exactly when its assets disagree most — which is exactly when it has the most to
offer a long-short book.**

Measured on live 2026-07-24 data, the three themes the gate rejected were the three
richest in shorts:

| theme | hype | theme edge | gate | short-capable assets |
|---|---|---|---|---|
| **US Dollar** | **73.4** — the highest-attention theme of the day | +0.144 | ABSTAIN | **3** |
| China Growth | 40.8 | −0.080 | ABSTAIN | **2** |
| **Inflation** | 28.7 | +0.086 | ABSTAIN | **4 of 4** |

Inflation was **entirely** short-capable and still abstained. Its +0.086 is an
artefact: under ADR-0036 a theme takes carry and value from whichever asset classes
can compute them, so Inflation inherited the *rates* leg's carry (+0.33) and value
(+0.99) while its trend came from the *commodity* basket. The number blends two
different legs and describes **no asset that actually exists** — and it was gating
four genuine shorts.

Scored per asset with every theme in scope, the same universe yields **21 long and 9
short candidates**.

## Decision

**Scope is chosen by attention. Direction and abstention are decided per asset.**

When `asset_edges` is supplied, in-scope themes are the hype-eligible ones ranked by
HypeScore and capped at `top_n`, with the existing `min_side` backfill so the book is
never empty while signal exists. The theme's own `|EdgeScore|` no longer filters
anything.

Every candidate must still clear `|its own edge| >= abstain_threshold` in `_expand`.

## Consequences

**This does not weaken abstention — it stops applying it twice.** The band is
unchanged at 0.15 and every position still has to earn it. What is removed is a
second gate operating on a statistic that is not the decision variable. Gating on
both meant a real asset-level view could be discarded because of an average it was
never measured against.

**The attention premise is untouched, and still binds.** A theme below the hype gate
stays out of the book; a test pins that. Attention decides *what we look at*, the
per-asset EdgeScore decides *what we do about it* — which is the cleaner statement of
the design than the previous arrangement, where attention and direction both filtered
at the theme level and the interaction was opaque.

**`/book`'s abstention roster now describes the wrong unit.** It lists *themes* held
out for weak edge, which was the real filter before this change and is no longer. It
should list held-out **assets** — the names that were in scope and failed their own
band. Recorded as follow-up; the roster is currently accurate about themes but no
longer describes why a position is absent.

**Watch for over-breadth.** 21 long / 9 short candidates is far more than the book
needs, so selection pressure now sits entirely on conviction ranking and the position
limits rather than on the gates. That is the right place for it, but it means a
sloppy conviction estimate has more influence than before.
