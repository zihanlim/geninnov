# ADR-0072 — Persist the book's correlation structure, not just its flagged tail

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0067](0067-a-column-must-name-the-subset-it-measures.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0071](0071-pool-metrics-are-not-book-metrics.md)

## Context

`correlation_pairs` keeps only pairs at or above `HIGH_CORR_THRESHOLD` (ρ 0.70). On a
well-diversified book that list is **empty**, and every surface reading it can then say
only *"nothing crossed the flag"* — an absence, indistinguishable from missing data.
[ADR-0067](0067-a-column-must-name-the-subset-it-measures.md) named this and deferred the
fix as *"needs a full correlation matrix the page does not have."*

**It does not need one. It needs the filter turned off once.** Measured on the live
2026-07-25 book, every held pair over 252 days:

| pair | ρ |
|---|---|
| BABA / PDD | **+0.4753** |
| JPM / SVXY | +0.4559 |
| JPM / NUE | +0.3611 |

Nine positions is **36 pairs**, and `compute_correlation_matrix(..., threshold=0.0)`
already returns all of them in seconds. Only the threshold threw them away.

**The cost of not storing them showed up in the thesis.** Asked to justify a China-policy
risk to both BABA and PDD, `book_risks` argued from *"the MCHI/KWEB intra-cluster
correlation is +0.92"* — **two names the book does not hold** — when the pair the sentence
is about is **+0.4753**, roughly half. That is not carelessness: the agent is shown only
pairs above the flag, so for a held pair below it there is no figure to cite and it
reaches for the nearest one it was given. **A number was substituted because the right one
was never computed into anything the model could see.**

## Decision

**Summarise every pair, and store it with the book metrics.**

`correlation_summary(pairs)` reduces the unfiltered pair list to what a reader needs:

| field | meaning |
|---|---|
| `max_abs_pair` | the most correlated pair in the book, **signed**, with both names |
| `mean_abs_corr` | mean \|ρ\| across every pair |
| `pair_count`, `flag_threshold` | sample size and the line the flagged list uses |

so a page can say *"the highest pair in this book is BABA/PDD +0.48"* — a measurement —
rather than reporting that nothing crossed a line.

- **Stored inside `book_metrics`, not a new column.** These *are* book metrics, the JSONB
  column already exists, and this needs **no migration**.
- **`correlation_pairs` is untouched.** It remains the flagged list every existing
  consumer reads, so nothing downstream changes meaning underneath it — the drift
  [ADR-0058](0058-explanations-are-owed-per-empty-slot.md) and
  [ADR-0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) were both
  about.
- **The extreme is by magnitude, not sign.** A −0.85 hedge is the most correlated pair in
  a book; ranking by signed value would report a weaker positive pair as the extreme and
  hide the strongest relationship present.
- **The mean is of absolute values.** +0.8 and −0.8 average to 0.0 signed, which would
  describe a strongly-coupled book as uncorrelated — the same sign-destroying error
  [ADR-0042](0042-absolute-hype-subscores.md) removed from HypeScore and
  [ADR-0045](0045-turnover-on-names-without-a-verdict.md) from candidate overlap.
- **An empty pair list returns `{}`, not zeros.** A one-position book has no pairs, which
  is not a correlation of zero — absence is not a value, the rule
  [ADR-0066](0066-not-computable-must-persist-as-null.md) established.
- **Wrapped so it can never break the book**, the rule `candidate_correlations` follows: a
  failed explanatory measurement costs a panel, not a run.

## Consequences

- **`/risk` can finally complete ADR-0067's deferred column.** With `mean_abs_corr`
  persisted, *"Avg |ρ|"* can be a genuine book-wide mean instead of an average over the
  flagged subset, and the empty-column note can carry the actual highest pair.
- **The agent can be shown its book's real correlation structure**, which is the honest
  route to the MCHI/KWEB substitution not recurring. Not wired into the prompt here:
  `compute_book_metrics_node` runs *before* selection, so the book's own pairs do not
  exist at prompt time — the same ordering constraint ADR-0071 records as open.
- **Populates on the next run.** The change landed after the current pipeline started, so
  `book_metrics.correlation_summary` is absent on the 2026-07-25 row and consumers must
  treat it as optional — which they must anyway, for every row written before today.
