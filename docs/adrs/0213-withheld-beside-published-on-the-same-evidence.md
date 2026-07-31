# ADR-0213 — A figure withheld beside a figure published on the same evidence

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0063](0063-one-beta-bar-across-every-surface.md), [0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md), [0094](0094-no-corroboration-gate-over-a-single-source.md), [0082](0082-euler-risk-decomposition-on-the-final-book.md), design-goals.md §1, §2, §3

## Context

`BenchmarkComparison` on `/attribution` answers "versus what?". Read on 2026-08-01 it
showed, in one card and in this order:

```
Tracking error      7 sessions of return history, needs 60. … not published.
Information ratio   7 sessions of return history, needs 60. … not published.
Beta to benchmark   -0.15
Up-capture          -28.9%     over its 4 up days
Down-capture         -8.1%     over its 1 down days
…
GARCH(1,1) 9.64%   …  The GARCH fit did not converge on this sample.
```

Its own header comment read *"Everything is gated by `MIN_SESSIONS_BY_FIELD` like every
other estimate."* Three of the six figures were not gated at all, and the panel's
intro said the sample was **5** while its gates said **7**.

Five defects, and the shape they share is the finding:

1. **GARCH printed the EWMA number.** `garch11` degrades to `ewma_volatility` below
   `MIN_OBS_FOR_GARCH` and returns it with `converged=False` and a warning that reads
   *"returned the EWMA vol, not a GARCH fit"*. **The backend was completely honest.** The
   panel rendered that number under a `GARCH(1,1)` label and footnoted the failure at the
   end of a paragraph — which is why the card showed `EWMA 9.64%` and `GARCH(1,1) 9.64%`,
   the same figure twice, one of them mislabelled. The stated reason was on the payload
   (`garch.warnings`) and was never rendered.
2. **Beta was ungated**, published beside two figures withheld on the same five sessions.
   ADR-0063's consequences predicted this precisely: *"Any fourth surface that renders
   `portfolio_risk.beta` must read `MIN_SESSIONS` too; the recurrence here after iteration
   21 is evidence the constant alone is not enough."* This was the fourth surface.
3. **The gate read the wrong denominator.** A benchmark statistic cannot be better sampled
   than the sessions the two series *share*, but the gates read the book's own `sessions`.
   Hence 5 in the prose and 7 in the gates — two numbers, both called sessions, nothing
   distinguishing them. `benchmark_compare.py` has always computed `sufficient = n >=
   MIN_OBS_FOR_STATISTICS` on the overlap; the frontend ignored it.
4. **The down-capture verdict was caveated rather than withheld.** Over ONE down day it
   read *"A negative down-capture is the book's central claim holding: it rose while the
   benchmark fell."* with the limitation appended after. `benchmarkReading.ts`'s own header
   said the thin case *"withholds the CLAIM"*; the code led with the claim and trailed the
   limitation, which is the order that gets the claim remembered.
5. **The panel narrated only its good news.** Down-capture's below-zero case was explained
   ("Below zero means the book ROSE when the benchmark fell") and up-capture's was not —
   while up-capture read **−28.9%**, meaning the book FELL as the benchmark rose. The
   favourable half got a sentence and a colour; the unfavourable half got neither.

## Decision

**Every figure on this panel is gated on the evidence that actually bounds it, and no
figure is rendered from a fit or a sample that cannot carry it.**

- **The denominator is the overlap.** `n`, falling back to `sessions` only when the row
  predates `n` — an unknown sample does not withhold (`sampleAdequacy`'s rule), so falling
  through to null would *publish* the three figures this panel gates.
- **Beta reads `sampleAdequacy("beta", …)`**, the same 60 the tile, the limit board and
  the attribution footer read.
- **Capture is gated on its OWN denominator** — `up_days` / `down_days`, exported as
  `MIN_CAPTURE_DAYS = 5` so the figure and the claim share one constant. Neither is a
  function of the overlap: a down-capture over one down day is one session described,
  however many sessions the series share.
- **A non-converged GARCH renders `—` plus the backend's own warning.** Design goal 2:
  absence is stated, never filled. The reason was already persisted; it is now shown.
- **`sampleAdequacy` keeps the threshold; this panel words the noun.** Its stock reason
  says "sessions of return history", which is the book's own series. Printing that under a
  heading that just said "the 5 sessions the two series share" invites a reader to think
  they are two different fives. Central number, local noun — ADR-0100's single-source
  property is about the 60, not the sentence.

**Capture moves from two stat rows into a figure.** Its job is polarity — which side of
zero — and a right-aligned `−28.9%` in a list reads as a magnitude with a stray minus. Two
bars diverging from a shared zero, with a 100% reference rule for "matched the benchmark".

**No `--long` / `--short`.** Design goal 3 fences those to book direction and is explicit
that a colour keyed to a **verdict** rather than to a sign is outside the signed-value
exemption. The old code tinted a negative down-capture `--long` — good-news green wearing
the ink that means LONG. The sign is carried by which side of zero the bar sits on, so no
colour has to mean anything, and one `--series-1` mark serves both bars. That is the same
argument the palette's own comment makes about why a narrative may not borrow direction
hues.

## Consequences

- **The panel now publishes one number where it published four.** Active return survives;
  tracking error, IR and beta are withheld, and capture is shown as a figure with its
  verdict withheld. That is the honest state of a five-session overlap, and it reads as a
  much emptier card — correctly.
- **A layout bug surfaced only by rendering it.** The withheld reason was passed into the
  `whitespace-nowrap` VALUE slot, so it refused to wrap and squeezed the `min-w-0` label
  column to nothing: "Tracking error" and "Information ratio" rendered one word per line
  with the reason overlapping them, and had done since the gates were added. Gating beta
  made it three rows and made it visible. A withheld reason is prose about the row, so it
  now renders under the row. **No test would have caught this** — every assertion was on
  text content, which was correct throughout.
- **`MIN_CAPTURE_DAYS` is a judgement, not a derivation.** 5 is inherited from the existing
  thin-sample threshold rather than argued from power analysis. It is now load-bearing for
  a published figure, which is a stronger role than it had.
- **The up/down-capture asymmetry was editorial, not mechanical**, and nothing structural
  prevents it recurring. The fix is that both readings come from one shape in the
  component; a future third capture statistic would need adding to it deliberately.
- **`sampleAdequacy` still has no entry for the capture fields**, on purpose — their
  denominator is not `sessions`, so an entry there would be gated on the wrong number. The
  file's "a field absent from this map is not gated at all" warning therefore remains true
  of them, and the gate lives in the panel. That is a real divergence from ADR-0100's
  one-place rule, accepted because the alternative is a gate that measures the wrong thing.

## Alternatives considered

- **Show the GARCH number with a louder caveat.** Rejected: the number *is* the EWMA
  number. No caveat makes a label true, and goal 1 is about figures tracing to what they
  claim to be.
- **Hide the whole panel on a thin sample.** Rejected on goal 2 — "no comparison yet" and
  "this feature does not exist" must stay distinguishable, and the active return is real.
- **Add `up_capture`/`down_capture` to `MIN_SESSIONS_BY_FIELD`.** Rejected: it is keyed on
  return sessions, and capture is bounded by up/down days. An entry there would gate the
  right field on the wrong evidence, which is defect 3 reintroduced deliberately.
- **Keep capture as stat rows and colour the sign.** Rejected on goal 3, and it is what the
  panel already did.
- **Chart the three volatility figures too.** Rejected: they differ by 0.4pp and one is now
  `—`. Three near-identical bars with a gap communicate less than three numbers.
