# ADR-0078 — A disqualifier you cannot locate is not falsifiable

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0054](0054-a-daily-publication-not-a-scanner.md), [0075](0075-per-pick-betas-are-joined-not-authored.md), [0066](0066-not-computable-must-persist-as-null.md), [0049](0049-the-guardrail-does-not-read-the-prose.md)

## Context

Q1 asks for five long and five short trades **and why**. The `counter_thesis` field is
where the *why* is made falsifiable — the prompt requires *"a specific price/yield/data
level, not a vague concern"* — and on that requirement the model delivers. All ten picks on
the 2026-07-25 book carry one.

But **six of the ten name the same trigger**:

> *"Short PDD is wrong if PDD breaks above its **200-day MA** on sustained basis (3+ daily
> closes)…"*

and nothing anywhere on the page says what that moving average **is**. Compare XLE's, which
names a level:

> *"Long XLE is wrong if **WTI breaks below $80/bbl**…"*

against a macro snapshot showing WTI at **$90.47** — a reader can see there is ~11% of room.
The MA triggers are the same sentence with the ticker swapped and **no number attached**, so
a reviewer asking the one question a disqualifier exists to answer — *how close is this to
being wrong?* — cannot answer it from the page.

Two things are wrong with that, and they compound:

1. **It is not falsifiable in practice.** A trigger whose level is never stated cannot be
   checked, which makes the counter-thesis decorative rather than binding.
2. **Six identical sentences do not differentiate.** `GOAL.md` requires that every per-row
   surface carry distinct information ([ADR-0054](0054-a-daily-publication-not-a-scanner.md));
   this is the prose form of the ten identical factor tilts
   [ADR-0075](0075-per-pick-betas-are-joined-not-authored.md) removed.

And the number is trivially computable. It is a 200-day mean of closes, from the same
yfinance path `compute_correlation_matrix` already walks for every pick.

## Decision

**Compute the distance and print it.**

`moving_average_context(tickers, window=200)` returns `{last, ma, pct_from_ma, window,
observations}` per ticker, attached to each pick in `finalise_book_analytics` and rendered
directly beneath the counter-thesis on `/book`.

Measured on the 2026-07-25 book, the distances are sharply differentiated and they say
something:

| | last | 200d MA | distance |
|---|---|---|---|
| NUE (long) | 247.56 | 187.44 | **+32.1%** |
| UNH (long) | 420.74 | 339.86 | +23.8% |
| SHY (long) | 81.85 | 81.49 | **+0.4%** |
| ARKK (short) | 71.89 | 77.73 | −7.5% |
| NOC (short) | 542.24 | 604.91 | −10.4% |
| PDD (short) | 82.66 | 104.90 | **−21.2%** |

**Every short sits below its trigger and every long above it** — so each trade has between
7% and 21% of room before its own stated disqualifier fires, except SHY, which is 0.4% from
its moving average. That last one is the point: a reader now sees which position is near
its line and which is nowhere near it, which the identical sentences hid.

- **Below 3% the distance is coloured**, because "0.4% away" and "21% away" are different
  facts about a trade and should not read the same.
- **A ticker with fewer than `window` observations is omitted, not averaged.** A 200-day
  mean of 40 days is not a 200-day mean ([ADR-0066](0066-not-computable-must-persist-as-null.md)).
- **Wrapped**, the rule `candidate_correlations` follows: a failed explanatory measurement
  costs a panel, not a run.

## Consequences

- **The counter-thesis becomes checkable**, which is what it was for. A reviewer can now
  test the model's own stated disqualifier against a number the model did not supply.
- **This does not make the trigger a good one.** Six picks choosing "its 200-day MA" is a
  generic answer, and stating the distance makes that visible rather than fixing it —
  the honest next question is whether a trade whose disqualifier is a moving average has a
  thesis at all. That is a prompt/quality question, recorded here, not solved here.
- **The number is joined, not authored** — the fourth field to move that way after sizes,
  exposures and per-pick betas. The pattern is now firm enough to state as a default: if
  the system can compute it, the model should not be typing it.
- **Live without waiting for a run.** `moving_average_context` is a pure function of
  tickers, so the 2026-07-25 picks were recomputed and PATCHed — all ten carry it now.
