# ADR-0080 — A gate that collects nothing is not a gate

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0076](0076-a-guard-reports-every-failure.md), [0055](0055-an-acceptance-battery-for-the-model-that-writes-the-book.md), [0023](0023-data-provenance-and-fabrication-guard.md)

## Context

`ci.yml` ran three Python steps, each ending in `|| true`:

```yaml
- run: ruff check scripts/  || true
- run: mypy scripts/        || true
- run: pytest scripts/      || true
```

The `|| true` was deliberate and the file said so: a comment on the `l5-eval` job called it
*"the only job here that can actually fail … deliberate while the repo carries pre-existing
lint debt."* That reasoning is sound **for lint**. It was silently extended to `pytest`,
where it does not apply — a test suite is not lint debt, and this repo's tests pass.

Worse, the argument was moot. **`pytest scripts/` collected zero tests.** Every one of the 44
test files lives in `tests/backend/`. The step exited 0 because there was nothing to run, and
the `|| true` meant even that zero was never visible. CI had reported green over a suite it had
never once executed — 594 tests, including `test_risk_engine`, `test_book_metrics`,
`test_q1_agent` and the citation-guardrail tests, none of them ever gating anything.

This is the same failure as [ADR-0076](0076-a-guard-reports-every-failure.md) seen from the
other side. There, a guard reported one defect and read as *"one defect"* rather than *"one
defect that we know of."* Here, a green check read as *"the tests pass"* rather than *"no test
was asked to run."* Both are a check whose **output shape cannot express what it did not
examine** — and in both cases the ambiguity survived precisely because the reassuring reading
was the plausible one.

A second defect fell out of fixing it. The `backend` job set dummy credentials:

```yaml
REDDIT_CLIENT_ID: ci
REDDIT_CLIENT_SECRET: ci
```

`reddit_client` treats a *present* credential as "use the live PRAW path", which then fails
against `ci`/`ci` and returns `[]`. That dummy env defeats all 13 tests in
`TestFetchPostsForThemeNoCredentials` — the no-credentials branch those tests exist to cover.
The env block was breaking the only tests that would have caught it, and the `|| true` on
`pytest` is why nobody found out.

## Decision

**`pytest` is a gate. `ruff` and `mypy` stay reports.** The distinction is measured, not assumed:

| step | scope | gate? | why |
|---|---|---|---|
| `pytest` | `tests/backend/` | **yes** | 594 pass today. There is no debt to grandfather. |
| `ruff` | `backend/ scripts/` | no | **217 errors.** Gating today blocks every push. |
| `mypy` | `backend/ scripts/` | no | same debt, not yet counted |

Three supporting choices:

- **`test_theme_discovery.py` is excluded from the gate.** `scripts/theme_discovery.py` imports
  `gensim`, `sentence_transformers`, `umap` and `hdbscan` at module scope, so collecting its 14
  tests means installing **torch on every push**. This is the same trade the `l5-eval` job
  already documents for the same reason. The exclusion is named in the workflow, not implicit
  in a dependency list.
- **The install list is explicit, not `backend/requirements.txt`** — for that same reason.
- **`REDDIT_CLIENT_ID`/`SECRET` are removed** and the workflow records why, so the next person
  tempted to "make the env complete" does not silently re-break 13 tests.

Lint and type scope widened from `scripts/` to `backend/ scripts/` in the same change: `backend/`
holds every service the book is computed from and had **never** been linted or type-checked.

## Consequences

- **594 tests now block a push.** This is the second real gate in the file, after `l5-eval`.
- **The exclusion is a hole, and a known one.** `theme_discovery` is covered only by the monthly
  workflow actually running it. If that script breaks, CI will not say so — the failure surfaces
  on the 1st of a month. Worth revisiting if theme discovery moves onto the daily path.
- **Lint remains unpoliced.** 217 errors is now a *number* rather than a vague "debt", which is
  the precondition for paying it down; until then a `ruff`-clean `backend/` is not implied by a
  green CI run.
- **This does not mean the book is correct.** The gate proves the code does what its tests say,
  and [ADR-0055](0055-an-acceptance-battery-for-the-model-that-writes-the-book.md)'s battery
  proves the L5 harness and guardrail are intact against a canned agent. Neither asks whether
  today's published book is *right* — that remains the job of reading rendered output and
  cross-checking two numbers, which is how every defect in ADRs 0071–0077 was actually found.
- **The generalisable lesson:** a check that passes should be read as a claim about *what it
  examined*, and a step that cannot fail is not evidence. When adding a CI step, assert that it
  collected something — `pytest` exits 0 on an empty selection, and so will the next tool.
