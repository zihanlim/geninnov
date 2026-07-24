# ADR-0055 — An acceptance battery for the model that writes the book

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0012](0012-citation-guardrail-llm-defense.md), [0013](0013-deterministic-stochastic-split.md), [0014](0014-candidate-set-hard-filter.md), [0026](0026-gemini-third-l5-provider.md), [0027](0027-citation-value-grounding.md), [0048](0048-count-independent-ideas-not-candidates.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

Three defences stand between the L5 model and a published book, and none of them
asks whether the book is any good.

**The citation guardrail** ([ADR-0012](0012-citation-guardrail-llm-defense.md),
[0019](0019-citation-value-reconciliation.md),
[0027](0027-citation-value-grounding.md)) reconciles every cited number against the
frozen L0–L4 inputs. It is a fabrication detector, and a strict one. It also reads
the citation array and nothing else — [ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)
records a thesis that miscounted the pool *in prose*, was never contradicted by a
citation, and reached the reader wearing a VERIFIED badge.

**The candidate hard-filter** ([ADR-0014](0014-candidate-set-hard-filter.md)) stops
the model naming an asset the pipeline never screened. It says nothing about which
of the screened names it should have chosen.

**The replication harness** ([ADR-0050](0050-separate-agent-churn-from-market-churn.md))
runs `reason_picks` N times on one frozen state and reports how much the book moves.
That is variance. A model that returns the same wrong book three times scores
perfectly.

Meanwhile the identity of the model is ambient. `q1_agent._select_provider` resolves
to whichever of MiniMax, Anthropic or Gemini has a key present, at import time, with
`LLM_PROVIDER=auto` as the default. That behaviour is right for a daily job whose
job is to produce a book — [ADR-0026](0026-gemini-third-l5-provider.md) added the
third provider precisely so a single vendor outage cannot stop publication. The cost
is that a missing `MINIMAX_API_KEY`, a deprecated model id, or a prompt edit changes
who writes the book with no signal anywhere. The guardrail still runs, so the output
still looks verified. It is simply someone else's reasoning.

im-Jarvis hit the same gap from the other direction and named it in
`docs/adr/0033-ai-model-strategy.md`: a per-tier acceptance eval is *"the gate that
prevents 'I switched providers and the answers got worse' from being a silent
failure."* Andromeda already has the provider abstraction that ADR only proposes.
It does not have the gate.

## Decision

Add `backend/eval` — a battery of frozen L0–L4 states whose right answer is written
down alongside them, and a scorer that checks a book against it.

**The fixtures are written, not computed.** Each is a plain dict that `reason_picks`
consumes directly: no Supabase, no network, no clock. `replication_test.py` freezes
its prefix by *running* the deterministic nodes once; that is correct for measuring
variance against today's live pool, and wrong here, because an expected answer
cannot be written down for inputs that change daily. The two harnesses answer
adjacent questions and reach the frozen state by opposite routes on purpose.

**Expectations divide into structural and directional, and only one half can gate.**

*Structural* checks encode constraints the system already promises: picks lie inside
the candidate pool with the direction the pool assigned them
([ADR-0014](0014-candidate-set-hard-filter.md),
[ADR-0038](0038-per-asset-direction.md)); at most five per side; at most one name per
correlated complex ([ADR-0048](0048-count-independent-ideas-not-candidates.md));
every pick cited; the real `verify_citations` accepts the book; and a number the
prose attributes to a metric matches the snapshot — the
[ADR-0049](0049-the-guardrail-does-not-read-the-prose.md) surface. A failure is a
defect.

*Directional* checks encode a curated prior: a fixture is built so that one answer
is clearly better **on the numbers given** — every short candidate carrying stronger
conviction than every long — and the check asserts the agent finds it. These are the
more valuable half and the less certain half. They are reported and never gate.

**The citation check delegates to production rather than reimplementing it.**
`CitationsVerify` calls `q1_agent.verify_citations`. A battery that passes while
production rejects the same book is worse than no battery.

**Three agent functions share one scorer.** `canned_agent_fn` assembles a compliant
book mechanically from the fixture and calls no model; `drifting_agent_fn` damages it
in four named ways; `llm_agent_fn` calls the real node. CI runs the first two, costs
nothing, and proves the scorer both accepts correct books and rejects broken ones — a
check that never fires is indistinguishable from one that always passes.
`scripts/run_eval.py` runs the third, against a pinned `--provider`, and is what you
run before and after changing a model id or the prompt.

**CI gains one job that can actually fail.** Every existing step in `ci.yml` ends in
`|| true`, and the `pytest` step points at `scripts/`, which contains no tests. The
new `l5-eval` job installs a narrow dependency set — `backend.eval` reaches
`q1_agent`, which needs supabase, pandas, numpy and yfinance and nothing heavier —
and runs the battery without a mask.

## Consequences

### What this buys

- A provider or prompt change is now a measurement, not a hope. Two runs and a diff:
  `run_eval --provider minimax --json` against `--provider gemini --json`.
- The prose surface has a check for the first time. `ProseNumber` reads the thesis
  text that `verify_citations` never opens.
- The structural half is cheap enough to gate on every push, because it never calls a
  model.
- A provider that dies mid-battery is recorded as a failed case rather than an
  aborted run, so four results are not thrown away to report one timeout.

### What it does not buy

- **The directional expectations are judgment, and they are mine.** Each fixture is
  Claude-curated with the signal deliberately stacked so the intended answer is
  defensible on the inputs — but a model that disagrees may be right and the fixture
  wrong. They are excluded from the exit code for exactly this reason, and they want
  a human review before anyone treats a red one as a bug. im-Jarvis's battery carries
  the same caveat in the same words.
- **Five fixtures is not coverage.** They cover risk-off, risk-on, a thin correlated
  pool, a one-sided pool and a crisis tape. Nothing covers the lens parameter
  ([ADR-0015](0015-lens-mode-asset-class.md)), a stale-input day, or a pool with no
  candidates at all.
- **Synthetic inputs are not live inputs.** A fixture is internally consistent by
  construction; a live L0–L4 state on a bad data day is not. Tests pin the
  consistency so a case tests reasoning rather than tolerance for contradiction, but
  that also means the battery cannot tell you how the agent behaves when its inputs
  disagree with each other.
- **The prose check tolerates unit conversion.** 835 bps restated as 8.35% is correct
  finance, so the comparison is tried at 1x, 100x and 1/100x. A claim wrong by
  exactly two orders of magnitude therefore reads as right. That is a deliberate
  trade against routinely flagging good prose.
- **It does not run on a schedule.** The live battery costs tokens and is invoked
  deliberately. Nothing yet runs it against the daily book.

### Also true

- The rest of the test suite still does not run in CI. `pytest scripts/` was already
  wrong before this change and remains so; running `tests/backend` needs
  `backend/requirements.txt`, which pulls sentence-transformers and torch for
  `theme_discovery` alone. That is a CI-cost decision, and it is left open rather
  than folded into this one.
