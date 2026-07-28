# ADR-0143: The price-link gate, and what it refuses to say

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0059](0059-a-single-date-ic-is-not-validation.md), [ADR-0064](0064-one-formula-one-place.md), [ADR-0066](0066-absent-is-not-zero.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md), [ADR-0142](0142-frequency-cannot-tell-a-narrative-from-a-register.md)

## Context

[ADR-0142](0142-frequency-cannot-tell-a-narrative-from-a-register.md) concluded that separating a narrative from the register of financial writing is not a linguistics problem. The brief defines a market theme as *"a narrative driving cross-asset moves"* — a testable claim about prices. `earnings` is the loudest phrase in the corpus at 27.6% and should move nothing in particular; `ai capex` should co-move with the semiconductor and power complex.

That ADR also said the gate "needs the same accumulated mention history, so it cannot be built earlier either." **That was wrong**, and checking rather than assuming is what found it: `market_news` carries `published_date`, and its 295 rows span **8 distinct publication dates**. A daily mention series is reconstructable from stored headlines today, without waiting.

## Decision

**Build it — as the same statistic the anchor themes already face.**

`assess_price_link` is [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md)'s cross-asset correlation pointed at a phrase's mention series instead of a theme's: `correlation_with_mentions` per ticker, `per_class_corr` to collapse to one signed reading per asset class, `cross_asset_corr_subscore` for magnitude-and-breadth, `corr_breadth` for the literal *n of m* claim. Nothing new is computed — [ADR-0064](0064-one-formula-one-place.md)'s one-formula-one-place — and a phrase is therefore judged by exactly the test the nine live themes are judged by, which is what makes them comparable.

The series is **share of voice per publication date**, not a raw count. Collection volume swings hard across the window (13 documents on the Saturday, 80 on the Monday), so raw counts would correlate with the news cycle's volume and make every phrase correlate with every other.

### The live run rewrote the verdict logic

The first run against real data returned **`linked` for all fourteen phrases tested** — scores 0.84 to 1.00, 4–5 of 5 asset classes "material". `earnings`, `wall`, `q2` and `analysts` all appeared to move the entire book.

The cause is `sessions = 5`. Eight publication days across a weekend is five overlapping trading sessions, and at n=5 a Pearson correlation sits near ±1 by chance. **The gate was measuring its own sample size.**

The original design computed that, returned `linked`, and exposed a separate `provisional` flag. That is precisely the shape of [ADR-0059](0059-a-single-date-ic-is-not-validation.md)'s failure — a validation panel that would have flipped green on a single date's IC — because it puts the true answer behind an opt-in the caller must remember to check, and [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md) is the standing lesson that a guard one consumer can skip guards one consumer.

So **`insufficient_history` is now the verdict itself**, outranking every other answer below `MIN_SESSIONS_FOR_VERDICT = 20` sessions. Two floors, deliberately distinct:

- **5 sessions** — `correlation_with_mentions` will not *compute* below this.
- **20 sessions** — this will not *believe* it below this. About a trading month; at n=20 an |r| of 0.44 clears p<0.05, which is a bar a real relationship can reach and noise mostly cannot.

The raw `subscore`, `corr_by_class` and `sessions` all stay on the record. Refusing a verdict is not hiding a measurement — a reader can see that `earnings` scored 0.93 on five sessions and judge it themselves.

## Consequences

- **The gate is built, tested (19 tests) and currently returns `insufficient_history` for everything.** That is the correct output, not a failure: five sessions cannot distinguish `earnings` from `ai capex`, and saying so is the whole point. It becomes useful around 2026-08-17, once `market_news` has accumulated twenty trading days.
- **It gates nothing yet, by construction.** Wiring it into promotion or the board while every verdict is `insufficient_history` would either pass everything or block everything; both are noise. The consumer comes when the verdict does.
- **`unmeasurable` now means something narrower** — enough sessions existed and no asset class could still be measured. Distinct from "not enough sessions", and worth telling apart.
- **Correlation is not causation and this cannot tell them apart.** Prices moving may be what generates the coverage. The claim it supports is the weaker sufficient one: this phrase's attention has *something* to do with a tradeable asset, versus being ambient vocabulary. Ambient is what it exists to exclude, and ambient is most of the board.
- **The 8-day window is one fetch's view of the past week, not eight daily collections.** Search ranking favours recency, so a story that mattered on the 22nd is probably under-represented today relative to what a fetch on the 22nd would have seen. The accumulating daily corpus fixes this on its own; until then the series is a reconstruction, not a recording.
- **`rank_by_link` exists and is unused.** It is the ordering the board should adopt in place of share — linked before ambient, breadth before magnitude — and it deliberately sinks `insufficient_history` to the bottom, so adopting it today would empty the board rather than mislead.
