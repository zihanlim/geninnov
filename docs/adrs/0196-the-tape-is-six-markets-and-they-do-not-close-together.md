# ADR-0196: The tape is six markets, and they do not close together

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0062](0062-run-date-is-not-a-write-timestamp.md), [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0191](0191-phrases-belong-to-the-board-themes-belong-to-the-funnel.md)

## Context

The homepage tape (`MarketBar`) was four US indices. The owner asked for
Europe, Asia, currencies, crypto and futures behind a toggle, naming the assets
from a live market site.

Three things had to be settled before any of them could be added.

**Where the tickers live.** The obvious move is to extend `YFINANCE_TICKERS` in
`macro_fetcher.py`, which is the map the daily yfinance batch already walks. It
is also the map `upsert_latest_snapshot` walks into **`macro_indicators`** — the
L0 macro set that `regime_classifier` reads, `/method` renders and the L5 prompt
is constructed from. Adding the Nikkei and Bitcoin there to get them onto a
decorative strip would have made them macro indicators, inherited silently by
every consumer of L0, with no error anywhere.

**Where the ORDER lives.** The frontend held the display list itself:

```
const DISPLAY_ORDER = ["^SPX", "^NDX", "^DJI", "^RUT", "^VIX"];
```

against the backend's `EQUITY_INDICES = ["^SPX", "^NDX", "^DJI", "^RUT"]`. Two
lists that had to agree, with nothing failing when they stopped — and they had
already stopped: **`^VIX` was in the display list and had never been fetched, so
the VIX cell of the tape had never once rendered.** The sort was
`indexOf(a) - indexOf(b)`, so any ticker the backend added scored −1 and led the
tape.

**Whether "today" means one thing.** It does not. Six markets on one strip close
at different hours; FX and crypto do not close at all. Measured on the backfill,
2026-07-31: Asia, currencies and crypto carried **2026-07-31** while the US,
Europe and futures carried **2026-07-30**. The table's only time column was
`updated_at`, which is when the pipeline wrote the row and is therefore
*identical* for Tokyo and New York. A tape that puts "Nikkei ▲4.37%" beside
"S&P ▲1.66%" under one freshness label invites a comparison of two different
sessions — the ADR-0062 defect (a run date is not a write timestamp), one
level up.

## Decision

**A separate `RIBBON_GROUPS` map, and the group travels with the row.**

1. `RIBBON_GROUPS: group → [(ticker, name, unit)]` in `macro_fetcher.py` is the
   single source of tape membership *and* order. `RIBBON_TICKERS` derives the
   flat lookup; `HISTORY_TICKERS` is the macro set ∪ the tape, so tape tickers
   get the price history they need for a `prev_close` and nothing more.
   `upsert_latest_snapshot` still walks `YFINANCE_TICKERS` alone, so **a tape
   ticker never becomes a macro indicator.** `^VIX` and `DX-Y.NYB` are in both
   maps deliberately; history is keyed by `(series_id, trading_date)`, so the
   overlap costs one de-duplicated fetch and keeps each map readable as itself.
2. Migration 063 adds `market_group`, `sort_order` and `as_of` to
   `market_assets`. The frontend sorts on the row, not on a constant. Only the
   *sequence of groups* remains a frontend array, and a group missing from it is
   appended rather than dropped — the failure mode above was a list that could
   silently omit.
3. **`as_of` is the trading date of `current`**, which `fetch_market_assets`
   already had in hand (`vals[0]["date"]`) and was discarding. Nullable, per
   ADR-0066: the four pre-existing rows have no recoverable session date, and
   back-filling them from `updated_at::date` would assert a session the pipeline
   never stored. Freshness is computed over the group **on screen**, and the
   strip names the sessions it is showing.
4. The strip says **"Daily closes"**. The pipeline runs at 21:30 UTC; every
   figure is settled. A tape is the most live-looking element on a page and this
   one is up to a day old.

**FX keeps four decimals.** `round(v, 2)` is right for index points and destroys
a currency: EUR/USD 1.1512 stored as 1.15 is unrecoverable downstream, and a
0.40% move renders as no move at all. The rule is keyed on magnitude (`< 10 →
4dp`), not on the group, so USD/JPY at 160.84 and Bitcoin at 64,131.20 keep 2dp
where more would be false precision on a `REAL` column. Backend and frontend
apply the same rule — the backend so the digits exist, the frontend so they show.

## Consequences

- The tape is 23 tickers in six groups, all resolved against yfinance before
  being written down rather than assumed.
- **Coinbase's COIN 50 is not on it.** It has no Yahoo symbol (`COIN50-USD` →
  "Quote not found"), so the crypto group is BTC/ETH/SOL and claims no fourth.
  This is the one asset from the request that could not be sourced.
- `macro_daily_history` gains 17 series. Purely additive — every existing reader
  selects the `series_id`s it already knows — but the table is now ~2.7× wider
  per day and `backfill_regime.py` reads it.
- The VIX cell renders for the first time.
- `market_assets` was missing from `ARCHITECTURE.md` entirely, in both the
  diagram and the table list. Added with this change.
- Live intraday quotes remain out of scope and would not be a small change:
  the frontend reads Supabase directly, so a ticking tape needs a request-time
  route, a cache and a rate limit — the shape `/ask` needed (ADR-0087), for
  decoration rather than for an answer.

## Alternatives considered

- **Extend `YFINANCE_TICKERS`.** One map, one fetch, no migration — and the
  Nikkei lands in `macro_indicators`, where `regime_classifier` and the L5
  prompt would inherit it silently. The whole point of the separate map is that
  this failure is invisible.
- **Keep the grouping in the frontend** as a `TICKER → group` object beside
  `DISPLAY_ORDER`. No migration, and it recreates exactly the two-list problem
  that had already lost the VIX cell.
- **One tape-wide freshness label.** Simpler, and it advertises Tokyo's age
  above New York's numbers.
- **Show all six groups at once**, no toggle. 23 tickers is four rows of tape
  above the page's own answer row, which is the opposite of what the owner asked
  for and buries the content beneath it.
- **A `group_order` column** so group sequence is data too. Rejected as a column
  that exists to order six strings that change about once a year; the array
  appends unknown groups rather than dropping them, which is the property that
  matters.
