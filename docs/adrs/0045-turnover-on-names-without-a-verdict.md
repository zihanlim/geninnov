# ADR-0045 — Turnover is measured on names without a verdict; candidate overlap is signed by both directions

**Date:** 2026-07-24
**Status:** Accepted
**Supersedes:** —

## Context

"Would you get the same answer tomorrow?" is the first question anyone asks of a
systematic book, and until now nothing on the site answered it. The data had been
there the whole time — `research_recommendations` keeps one row per `run_date` — but
no code had ever compared two of them, so the only way to answer was to hand-diff two
days in the database. The question had been deferred four times in favour of work
that explained a *single* book better; nothing explained the book *over time*.

Three decisions had to be made before a number could be shown.

**What counts as a change?** Weights move every run: sizing is a function of
EdgeScore, HypeScore and vol, all of which drift daily. If turnover is measured on
weights, the reading is never zero and never means anything — it is dominated by
second-order size drift.

**What does a high reading mean?** The obvious framing is "low turnover = stable =
good". That framing is wrong. A regime turn *should* churn a book; a book that never
changed through a cycle flip would be broken, not disciplined. Any verdict attached
to this number would be a verdict about the market, dressed as a verdict about the
process.

**Is any two-run comparison meaningful?** On the day this shipped, the answer was no.
The live book holds 8 names (JPM, EWZ, EMB, EWJ, TLT long; GDX, ARKK, NOC short); the
previous run holds **2** (XLE, CL), produced before the universe expanded. Turnover
between them is 100% — arithmetically correct, and about the candidate universe rather
than the market view. This is the exact failure this codebase keeps removing: not a
wrong calculation, but a correct one presented as if it meant something.

## Decision

1. **Measure names, not weights.** Turnover is the Jaccard distance over the held
   name sets: `1 − |A ∩ B| / |A ∪ B|`. A position that survives at a different size is
   the same idea. The union is the denominator, not today's count — closing a name is
   as much a change as opening one, and dividing by today's book alone would hide a
   book that halved.

2. **Attach no verdict.** The panel prints the percentage, the three lists (held
   through / opened / closed) and nothing else. No "stable"/"unstable" label, no
   colour-coded threshold on the headline number. The names are shown so a reader can
   judge the change against what the market did.

3. **State incomparability in the panel, in warning colour.** `comparabilityCaveat`
   returns a sentence whenever the smaller book is under **half** the size of the
   larger, naming both counts and saying plainly that the reading measures how much
   the candidate universe changed rather than how much the view did. Half is the line
   because a book that lost or gained more than half its names between runs did not
   "rotate" — it was rebuilt.

4. **Render nothing when there is no previous run.** No zero, no "n/a" row. An
   unmeasurable turnover is not a turnover of zero — the same rule the
   `ClearedNotTaken` correlation column already follows with its em dash.

## Consequences

- The site now answers the stability question, and the first thing it says is that
  today's answer is not yet trustworthy. That is the honest state and it will clear
  itself: once two consecutive full runs exist, the caveat disappears on its own with
  no code change.
- Weight drift remains unmeasured. It is a real second-order question — a book that
  holds the same eight names but doubles TLT has changed — and it is deliberately out
  of scope here, because folding it in is what makes the primary number unreadable.
- The pure functions live in `frontend/lib/turnover.ts` rather than inside the
  component: the vitest project runs `environment: node` with no JSX loader, so a
  function reachable only through a `.tsx` import cannot be unit-tested. Ten tests pin
  the arithmetic, the symmetry of the caveat, and the empty-book cases.
- `/book` now reads two `research_recommendations` rows instead of one. Both go
  through a shared `parsePicks()` — `picks` arrives as jsonb on most reads and as a
  string on some, and the second row must tolerate exactly what the first does.
- **The measurement immediately cost a prior claim, as every honest measurement in
  this project has.** The 2026-07-23 book holding two names is not something any panel
  had surfaced; the turnover work is what made it visible.

---

## Second decision, same session — candidate overlap must be signed by both directions

### Context

Reading the deployed page after the turnover panel shipped surfaced a defect in the
panel directly below it. `ClearedNotTaken` explains why a screened candidate is not
held by naming its **closest held position over 252 days** and thresholding the
correlation at ρ 0.70. It thresholded the **raw price correlation**, ignoring which
side the book holds each name on.

The 2026-07-24 book is **short ARKK**. Three long candidates sit at ρ +0.77 to +0.80
against ARKK — QQQ, IWM, SPY — and every one was labelled **"largely already held"**.
A long SPY against a short ARKK is not a duplicate of that position; it is close to
its reverse. The column that exists to explain omissions was telling a reader the
opposite of the truth on 3 of its 15 rows.

Correlation between two *prices* says nothing about whether two *positions* express
the same bet. That is the same error `abs(corr)` made inside HypeScore, removed by
[ADR-0042](0042-absolute-hype-subscores.md): discarding a sign that decides the
meaning.

### Decision

`classifyOverlap` (`frontend/lib/candidateOverlap.ts`) signs the correlation by both
positions before applying any threshold:

```
aligned = ρ × sign(candidate direction) × sign(held direction)
```

- `aligned ≥ +0.70` → **"largely already held"** — would add to a bet already on.
- `aligned ≤ −0.70` → **"would net against ‹ticker›"** — would reduce a bet already
  on. This is a *new* category the panel could not previously express.
- between the two → **"independent — passed over"**.
- no correlation, **or no known held side** → **"unmeasured"**. Guessing a side would
  be a verdict wearing a measurement's clothes, the same rule that already forbids
  rendering an unmeasurable correlation as `0.00`.

The held side is now printed beside the ticker in the Closest-held column (`GDX
short +0.82`), because the same ρ reads as a duplicate against one side and a hedge
against the other, and the number should never appear without it.

The backend is unchanged. `candidate_book_correlation` returns an unsigned price
correlation on purpose — it is a measurement, and the two directions belong to the
layer that has them. Its choice of *which* holding is closest is unaffected: signing
cannot change a magnitude, so `max |ρ|` picks the same name either way. Its docstring
now states the contract so the next reader does not repeat the mistake.

### Consequences

- Three rows flip from "largely already held" to "would net against ARKK", and the
  new reason is a **better** one: taking long SPY while short ARKK would net down the
  book's own short, which is a real reason to pass a name over. The page previously
  gave a reason that was not merely vague but inverted.
- The panel can now distinguish a candidate that is redundant from one that is
  actively contradictory. Those are different decisions and had been rendering
  identically.
- Ten tests pin the classifier, including the exact three live rows that were wrong.
- **Found by reading the deployed page against the book above it, not by a test.**
  Every defect of this class in this project has been found the same way: two numbers
  on one page that cannot both be true. No unit test would have caught it — the old
  code computed exactly what it intended to compute.
