# ADR-0067 — A column must name the subset it measures

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0060](0060-a-share-cannot-exceed-the-whole.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

[ADR-0060](0060-a-share-cannot-exceed-the-whole.md) closed by naming something it did
not fix:

> **Not addressed here, and visible in the same table:** `Avg |ρ| to book` renders `—` on
> all nine rows, because it averages only pairs flagged at ρ ≥ 0.70 and this book has
> none. … a column that can only be empty or partial is a weaker surface than one that
> reports the mean correlation outright.

Reading it again, the label is the sharper problem. **"Avg |ρ| to book"** promises a mean
correlation against the whole book. The value is the mean over the **flagged** pairs only
— those at or above ρ 0.70 in `correlation_pairs`.

The two differ in a way that inverts the reading. A position correlated **0.65 with every
other holding** has no flagged pair, so it renders `—` — which a reader takes as
*uncorrelated*, when it is nearly the opposite. And on a well-diversified book **no** pair
crosses the flag, so the entire column is empty: **the good case, rendered as an
absence**, indistinguishable from missing data.

That is the failure mode this project keeps meeting from a new angle. ADR-0066 was a row
encoding absence as a value; this is a column encoding a *subset* as *the whole*.

## Decision

**Name the subset in the header, and explain the empty column rather than leaving a
bare em-dash.**

- The header reads `Avg |ρ| · flagged ≥ 0.70`, so the number is not mistaken for a
  book-wide mean.
- The per-cell tooltip for an empty value says what the blank means: *no pair involving
  this asset reaches ρ 0.70 — not a measure of how correlated it is, only that nothing
  crossed the flag.*
- When **every** row is empty, a note states it once: nothing here is doubling another
  position, which is the good case, and *"a book where every pair sat at ρ 0.65 would
  look identical."* Saying that is the whole point — it stops the reader inferring
  diversification the number cannot support.
- The threshold is **imported** from `lib/candidateOverlap`, not re-typed. It is the same
  0.70 that `/risk` flags pairs on, that `ClearedNotTaken` calls *"largely already
  held"*, and that `PoolDepth` clusters independent ideas at. One threshold, one meaning
  — and now the header states it instead of leaving it to be inferred.

**The stronger column is deliberately not built.** Reporting a genuine mean |ρ| against
every held position needs a full correlation matrix the page does not have;
`correlation_pairs` is flagged-only by construction. Computing it would mean a backend
change and a new persisted artefact. Inventing a book-wide mean from the flagged subset
would be exactly the proxy [ADR-0045](0045-turnover-on-names-without-a-verdict.md)
refused for turnover — a number that reads stronger than its evidence.

## Consequences

- **The column stops making a claim it cannot support**, and the empty state becomes a
  statement instead of a gap. It is still a weak surface; it is no longer a misleading
  one.
- **Recorded as still open:** a true `Avg |ρ| to book` requires persisting the full
  per-position correlation matrix, not just the flagged pairs. That is a backend change
  with a real cost, and it should be justified by someone wanting the number rather than
  by the column's name implying it exists.
- **The pattern across three ADRs in two days is now explicit.** ADR-0060: do not print a
  share that exceeds the whole. ADR-0066: do not store absence as a value. This one: do
  not label a subset as the whole. All three are the same discipline — **the label and
  the number must agree about what was measured** — and all three were found by reading
  the rendered page rather than by a test.
