# ADR-0161: A corpus the board could not see, and a source that feeds nothing

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0105](0105-a-source-board-that-states-what-each-source-can-know.md) added the source
board on `/method/evidence` to answer two questions no page answered: *what is this built
on?* and *which of those is stale?* It catalogues each source, the table its rows land in,
which timestamp roles that table can honestly record, and a verdict.

On 2026-07-29 a fourth Stitch archive
(`stitch_andromeda_systematic_trading_platform.zip`, six screens) was triaged against
`docs/design-goals.md`. It failed the checklist at steps 1–4 like the three archives before
it — `EXECUTE REBALANCE`, fabricated telemetry (`42.4 GB/s`, `1268.4 logs/sec`), scenario
probabilities the six calibrated shocks do not carry, per-position unrealised P/L that
[ADR-0152](0152-a-true-page-nobody-asked-for.md) retired four hours earlier, and green
reused for `CONNECTED`/`CALIBRATED`/`NOMINAL` so the direction hues carry nothing.

Its *data-health* screen asked one question worth keeping: **per news provider, how fresh
is it and is it feeding anything?** Asked of the live product, the answer was that our own
board could not say — because it did not know the corpus existed.

### What was measured

`lib/method/sourceBoard.ts` named six sources. `market_news` was not among them, and three
providers write to it:

```
source        rows   earliest     latest       distinct days
gdelt         2309   2026-06-14   2026-07-29   42
brave_market   667   2026-07-21   2026-07-29    9
rss            405   2024-06-05   2026-07-29   84
```

That is the un-themed L1b corpus behind `NarrativeTrends` on `/` and behind
[ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md)'s price-link gate. The
page whose entire job is to name what the book rests on was silent about all three.

**And the three are not interchangeable.** Brave is a recency *ranking* (48% of a 45-day
window in the last 7 days); GDELT is an *archive* (18%, 40 of 45 days populated) —
[ADR-0144](0144-a-second-provider-that-is-an-archive.md)'s whole finding. `rss` is neither:
it is **shadow**, deliberately absent from `daily_refresh.COMBINED_SOURCES`, collected and
source-tagged and read by no scored corpus, because the corroboration
[ADR-0094](0094-no-corroboration-gate-over-a-single-source.md) asks for cannot be measured
before two providers have run side by side ([ADR-0157](0157-a-corpus-is-defined-by-naming-its-providers.md)).

So a naive fix would have introduced a second, quieter defect. Listing `rss` with 405 fresh
rows and a `CURRENT` verdict asserts it feeds the book. It does not feed anything. `current`
would have been a false claim made by a board that exists to prevent false claims.

## Decision

**1. `market_news` is on the board as three sources, never as one.** Merging them into a
single "news" row would state that the corpus has one shape when it has three. A share is
only comparable to a share of the same corpus
([ADR-0155](0155-a-share-is-only-comparable-to-a-share-of-the-same-corpus.md)), and the
recency/archive asymmetry now travels in each provider's own `cadence` string with its
measured figures — that is what stops a reader reading two news rows as redundancy.

`brave` (themed, `theme_news`) and `brave_market` (un-themed, `market_news`) also stay
separate: the same provider asked a different question into a different corpus is different
evidence.

**2. A sixth verdict, `shadow`.** Collected and stored, read by no scored corpus. It is
checked *before* freshness, because "how old is it" is the wrong first question about a
source nothing reads — but the age still travels in the note, so declaring a source shadow
hides no fact. `shadow` is declared on the spec rather than inferred from the rows: "nothing
reads this" is a decision recorded in `COMBINED_SOURCES`, not a property of the data.

This is [design goal 2](../design-goals.md) applied to an enum rather than a boolean. A
verdict that means both *"feeding the book and fresh"* and *"fresh but feeding nothing"*
needs a third state with a stated cause, the same rule that split `stale` from
`unjudgeable`.

**3. `observabilitySummary` counts what is read, not what exists.** `contributing` excludes
shadow sources and the count is stated separately in the sentence. Counting `rows > 0` would
have let a corpus nothing reads inflate the one figure that answers "what is this book built
on" — 8 of 9 rather than the true 7.

**4. A keyless provider is never reported as `unconfigured`.** GDELT and RSS need no
credential, so zero rows can only mean the fetch failed, and `unconfigured` would send a
reader hunting for a secret that does not exist. Brave demonstrably has a key in this
deployment, so an empty market corpus is a *failed feed* —
[ADR-0156](0156-a-failed-feed-is-not-a-quiet-market.md) requires that be audible rather than
absorbed into a calmer word. All three degrade to `silent`.

## Consequences

- The observability denominator moves **6 → 9** and the published sentence changes with it:
  *"7 of 9 sources contributed rows this book reads. One more is collected and read by
  nothing, held for corroboration rather than counted."* The previous sentence was not wrong
  about the six it described; it was wrong about being a complete list.
- `SourceVerdict` gains a member, so every exhaustive `Record<SourceVerdict, …>` must handle
  it — `VERDICT_COPY` in `SourceBoard.tsx` is the only one, and TypeScript enforces the rest.
- `shadow` renders as tertiary ink **with a ring**, for the reason `StatusBadge`'s `stale`
  took one: `unconfigured` already owns bare tertiary, and two states that render identically
  are two states a reader cannot tell apart. It is deliberately not a warning colour —
  nothing is wrong with a shadow source.
- **Turning RSS on becomes a one-line diff with a visible consequence.** Dropping `shadow`
  from its spec moves it into `contributing` and changes the headline sentence, which is the
  right amount of friction for a decision ADR-0157 wants taken deliberately.
- One new query on `market_news` per render of `/method/evidence`, capped at 4,000 rows and
  run inside the existing `Promise.all`.
- The board is still **not** self-maintaining: a provider added to `market_news` without an
  entry here is invisible again. That is the same class of gap this ADR closes and it is not
  closed in general — `SOURCES` is a hand-kept catalogue, and the test that asserts exactly
  three `market_news` providers is what would fail loudest.

## Alternatives considered

- **One `market_news` row, aggregated.** Simplest, and it destroys the finding: the three
  providers differ in shape and one row asserts they do not. Rejected on ADR-0144/0155.
- **List `rss` as `current`.** It has fresh rows, so this is the reading that requires no new
  state. It also claims a shadow source feeds the book — the precise false claim the board
  exists to prevent. Rejected.
- **Omit `rss` entirely**, on the grounds that a source nothing reads is not a source. This
  reproduces the bug being fixed: a provider writing to a table the board does not name. A
  reader who queried `market_news` would find rows from a provider the site never mentions.
  Rejected.
- **Infer `shadow` from a shared constant with the backend.** `COMBINED_SOURCES` lives in
  Python and the frontend cannot import it. A generated artifact was considered and rejected
  as more machinery than a three-entry catalogue justifies; the unit test pins the list
  instead.
- **Mark `brave_market` unconfigured on zero rows**, mirroring `reddit`. Wrong here: Brave
  has a key in this deployment, so zero rows means the feed broke, and reporting a broken
  feed as an unset credential is ADR-0156's failure mode with a misleading remedy attached.
