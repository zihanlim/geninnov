# ADR-0051 — The interface is a daily research publication, not a scanner

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0038](0038-direction-per-asset.md), [0040](0040-one-portfolio-everywhere.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0048](0048-count-independent-ideas-not-candidates.md)

## Context

The question was put directly: Trade Ideas markets itself on the distinction between a
**screener** (you set filters, hit run, read a static list, repeat — "manually refresh
and click constantly") and a **scanner** (real-time, automated, the machine watches and
the results come to you). *Does Andromeda work like that?*

It does not, and the difference is not a gap to close. It is worth writing down, because
the temptation to bolt streaming quotes and alert rules onto this app will recur, and
every hour spent there is an hour not spent on what it is actually judged on.

**What Andromeda actually is, mechanically.** One GitHub Actions job at 21:30 UTC runs
L0–L5 end to end, writes one book to Supabase, and stops. The frontend holds no
subscription, no poll, no `setInterval`, no revalidation timer — verified: the only user
inputs in the entire app are `LensSelector` and the `/risk` what-if slider. There is no
filter box anywhere. A reader cannot query it, and is not meant to.

**The three models, and where each puts the work:**

| | screener | scanner | Andromeda |
|---|---|---|---|
| who forms the query | the user | the user, once | **nobody — there is no query** |
| what arrives | rows matching filters | rows matching filters, pushed | **a finished position with a reason** |
| cadence | on click | continuous | **once daily, after the close** |
| the unit of value | a list | a faster list | **a decision and its defence** |
| what the user does next | filter again | react | **interrogate it** |

Both the screener and the scanner deliver **candidates**; they differ only in how fast
and how automatically. Andromeda delivers **conclusions** — nine sized positions out of
a thirty-name pool — and spends the rest of its surface area defending them: pool depth,
cleared-the-screen-not-taken, the abstention roster, the screening funnel, turnover
vs previous run, per-position derivation. That apparatus would be meaningless on a
scanner, where the user does the deciding and the tool only supplies rows.

**The cadence follows from the signal, not from engineering convenience.** HypeScore is
built on daily news volume, Reddit sentiment, 252-day correlations and FF5 factor betas
refreshed from Ken French. None of those inputs move intraday in a way that would change
a $100M thematic book. Streaming a number that only changes once a day would be a lie
told at 60fps.

**What the scanner critique gets right, and does apply here.** The quote's real claim is
about **time-to-insight**: the user should not be the one hunting. That standard binds
Andromeda too, and it is failed at exactly one place — the scannable layer of `/book`.
The `ASSET · THEME · RATIONALE` column calls `plainRationale`, which names the dominant
EdgeScore component. Trend carries the largest raw magnitudes, so it dominates almost
every name, and on the live 2026-07-25 book **all five longs read "Long · a strong price
uptrend" and all four shorts read "Short · a price downtrend"** — nine positions, two
distinct strings. The function is correct and does precisely what its docstring says; its
output is degenerate across a book. The comment above the call site states the intent —
*"a reader gets the 'why' without decoding values"* — and the rendered column defeats it.

This is the same failure this project keeps finding: **a correct calculation presented as
if it meant something.** It matters more than the others because Q1 is literally *"what
are your top five long and short trades, **and why**"*, and the why-column at a glance
says the same thing nine times. The differentiated reasoning does exist — in the thesis
paragraph and behind each row's expander — so this is a surfacing defect, not a missing
capability, which is this repo's most common shape of bug.

## Decision

**Andromeda is a daily research publication. It is not a scanner and will not become
one.** No streaming quotes, no alert rules, no user-defined filters, no intraday refresh.

Three things are taken from the scanner model, because they are about time-to-insight
rather than about ticks:

1. **The machine does the hunting.** The user never composes a query. Already true.
2. **Change is shown, not searched for.** What moved since the last run must be visible
   without the reader diffing anything by hand — `ScoreDeltaBadge`, the Δ1D column, the
   watchlist deltas and the turnover panel already do this. Extending it is in scope;
   making it real-time is not.
3. **The top-level layer must differentiate.** Anything a reader scans without clicking
   has to carry distinct information per row. A column that renders one of two strings
   across nine positions fails this, and a rationale line is held to it specifically.

**Staleness is honesty, not a defect to engineer away.** [Iteration 24](../GOAL.md)'s
business-day staleness banner is the correct treatment of a daily cadence: say plainly
when the book is not today's book, rather than implying freshness the pipeline cannot
deliver.

## Consequences

- **Rejected work, explicitly:** WebSocket/Supabase-realtime subscriptions, polling
  timers, price tickers, alert-rule builders, saved screens, filter panels. If one of
  these is proposed later, this ADR is the reason it was not built — reopen it with an
  argument rather than adding the feature.
- **`plainRationale` is now a known defect on `/book`**, recorded in `GOAL.md` as the
  next step. The fix is to differentiate the scannable line per position, not to widen
  the phrase vocabulary — a second templated string is the same bug with more words.
- **The nav's `SECONDARY_NAV` (`/trades`, `/portfolio`, `/research`) is legacy**, marked
  as redirects in `TopBar.tsx`, and shows the reader this project's migration state for
  no user benefit. Consolidation under [ADR-0040](0040-one-portfolio-everywhere.md) is
  complete; the links are the residue. Removing them is cheap and in scope.
- **The comparison is useful in the deliverable itself.** A reviewer asking "how is this
  different from a screener?" gets a sharper answer than the app's feature list: a
  screener hands you candidates and a scanner hands them to you faster, while this hands
  you a position, a size, and the reason it is not one of the other thirty names.
