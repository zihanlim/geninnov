---
title: Andromeda Full-System Review and Remediation
date: 2026-07-22
status: approved
type: design
owner: zihan
---

# Andromeda Full-System Review and Remediation

## Purpose

A correctness-first, gated review and remediation of the Andromeda platform
covering financial accounting, provenance, data contracts, frontend
truthfulness, operations, and verification. The goal is to ensure that every
number and advisory text shown to investors is sourced, computed, or
explicitly labeled as unavailable, and to make the platform operationally
defensible.

## Confirmed product policies (from brainstorming)

- **Signed weights** are the authoritative convention. Long positions are
  positive, shorts are negative. Daily return contribution is
  `signed_weight × asset_return`.
- **Cumulative performance** is compounded from the first valid published
  run, with the inception date and as-of date visible.
- **Numeric fields** remain visible when authoritative data is unavailable,
  but only as labeled estimates that include method, freshness, and
  uncertainty/confidence metadata.
- **Advisory / thesis text** follows strict provenance: if the
  evidence-backed L5 path is not available or its citations are not
  verified, the field is `unavailable` rather than rendered as a
  model-generated thesis.
- **Incomplete items remain visible**; nothing is silently hidden.
- **Production read-only** is permitted (deployed Vercel, deployed
  Supabase read-only). External systems are not mutated.
- **Security findings are report-only**: if tracked secrets exist, they are
  documented with a precise rotation procedure; no rotation is performed.

## Review architecture and execution order

### Gate 0 — Baseline and safety

Read-only inspection of:

- Repository state and recent commits.
- Production Vercel deployment and live frontend.
- Production Supabase schema, advisors, logs, and representative records.
- Configured migrations and runtime entry points.
- Tracked environment / configuration files.

Outputs:

- Test results baseline.
- Deployed version and observed route behavior.
- Migration ↔ deployed schema diff.
- Daily-refresh entry points and cron assumptions.
- Page-level data dependencies.
- Known stale / empty / error behaviors.

### Gate 1 — Investor truthfulness and financial correctness

Fix or hide incorrect investor-facing outputs first:

- Signed long/short returns.
- Since-inception compounding.
- Fabricated or reconstructed frontend metrics.
- Provenance and freshness enforcement.
- Strict thesis/citation behavior for advisory text.

Output: a **data-lineage matrix** for `/`, `/trades`, `/research`, and
`/portfolio` mapping every displayed field to source table/record, producing
function, units, freshness, missing-data behavior, and UI label.

### Gate 2 — Runtime and contract truth

Trace the actual L0–L6 execution graph and reconcile with migrations,
deployed schema, frontend Supabase queries, active and orphaned
research-agent implementations, persisted L5 output, and operational
scripts.

Output: one documented active path and an explicit list of retained or
orphaned paths.

### Gate 3 — Domain remediation (bounded workstreams)

- Portfolio accounting and risk.
- Signal / scoring / regime semantics.
- Provenance / read-model seam.
- Asset taxonomy and lens membership.
- Frontend resilience, accessibility, responsive behavior.
- Pipeline reliability and idempotency.
- Security/configuration findings (report only).
- Canonical L5 consolidation only after Gate 2.

Each change ships with at least one unit, invariant, or contract test.

### Gate 4 — Release-readiness verification

- Backend unit and invariant tests.
- Persistence / schema contract tests.
- Controlled pipeline tests using fixtures / adapters.
- Playwright desktop and mobile workflows.
- Browser console and failed-query checks.
- Accessibility checks (axe).
- Stale / empty / error / unclassified state coverage.
- Final documentation synchronization.

## Backend calculation and data-contract design

### Calculation boundaries

Each calculation documents: input schema, output schema, units, valid
ranges, sign convention, missing/stale behavior, numerical edge cases,
and whether the result is exact, estimated, or unavailable.

External inputs are normalized first, calculations are pure and
reproducible, and only the L5 reasoning step invokes an LLM. The
deterministic L0–L4 boundary is preserved.

### Portfolio accounting invariants

- `Σ signed weights = net exposure`.
- `Σ |weights| = gross exposure`.
- Gross exposure, net exposure, and leverage are not confused with capital.
- Long and short contributions are signed correctly.
- Missing asset returns cannot silently become zero.
- Total capital has one authoritative source.
- Dollar P&L and percentage return use consistent units.

### Provenance / read-model seam (approved)

Every investor-facing numeric field is represented as a typed
`NumericDerivation`; every advisory field is a typed `AdvisoryDerivation`.
A central validator enforces status/value consistency, unit enum, method
registration, time ordering, uncertainty band containment, and advisory
evidence requirements. Frontend components render through a shared
module that displays `display_status`, freshness, and uncertainty rather
than reconstructing meaning from raw records.

Heuristic fallbacks may be retained internally for diagnostics, but are
not rendered as investment thesis text and are visibly labeled
`estimated` or `heuristic` when used numerically.

### Configuration and taxonomy

Scoring configuration remains data-driven via `scoring_config`, but
loading validates required keys, ranges, threshold ordering, weight
totals, lookback units, and non-null defaults.

Asset classification has one authoritative interface for sector,
geography, asset class, and lens eligibility. Existing maps and
fallbacks are inventoried before consolidation so that manually supported
tickers are not silently lost.

### Persistence and operational contracts

- Idempotency by date / run identifier.
- Partial publication only when the layer is self-consistent and
  downstream consumers correctly handle partial availability.
- Freshness reflects actual source / pipeline age, not the most recent
  page render.
- Stale data is labeled.
- Stage failures have an explicit retry or publish policy.

## Frontend and verification design

### Page-level goals

- **Dashboard (`/`):** active lens, market state, latest pipeline status
  with computed freshness, daily and inception-to-date performance
  reconciled to backend, top themes by authoritative score, explicit
  stale/unavailable states.
- **Trades (`/trades`):** side, signed weight, asset return, contribution,
  freshness, lens filter. Missing classifications or returns show a
  labeled estimate or unavailable state, never silent zero.
- **Research (`/research`):** only the L5 evidence-backed thesis, with
  citation status visible. Heuristic fallback is not displayed as
  model-generated.
- **Portfolio (`/portfolio`):** signed long/short weights, gross / net
  exposure, leverage, sector / geography allocation, scenario stress,
  risk metrics, and a daily P&L history consistent with backend
  cumulative return. Heatmap and other derived visuals operate on
  derivations.
- **Theme / derivation views:** lineage for each theme with the correct
  correlation sign, per-ticker selection method, and explicit status
  (exact / estimated / stale / unavailable).

### Component and behavior changes

- Shared status / freshness badge system based on `display_status`.
- Lens filter, prediction-market freshness, refresh-time computation, and
  empty / loading / error states consistent across pages.
- Responsive design for mobile and tablet widths; touch-friendly controls;
  semantic lists / tables / captions; keyboard navigation; drawer
  behavior.
- Removal of the magic-capital fallback unless resolved at the backend.
- Accessibility checks (axe) without critical violations.

### Verification strategy

- **Backend:** pure-function unit tests, table-driven invariant tests,
  persistence contract tests, configuration validation tests,
  missing/stale data tests.
- **Integration:** controlled pipeline tests for complete, partial, stale,
  and malformed runs using fixtures / adapters.
- **Browser / Playwright:** for each page, a desktop and a mobile workflow
  covering navigation, key actions, key states, and negative-path
  assertions for empty, stale, error, and unclassified scenarios, plus
  console / failed-query assertions.
- **Production read-only:** schema / advisor checks, sample-record
  reconciliation against documented derivations, and structural diffs
  between documented and observed migrations.

### Verification matrix

A requirements-to-test matrix links each investor-critical invariant to:

- one or more automated tests,
- a hand reconciliation or sample production read,
- a Playwright assertion where applicable.

No invariant is marked "done" without an automated or hand-verified pass.

## Operations, security, and documentation

### Operations and reliability

- The daily pipeline is reviewed for idempotency by date / run identifier.
- Stage-level failure policy is explicit: L0–L4 must succeed before L5;
  partial publication of deterministic layers is allowed only when the
  layer is self-consistent and downstream consumers correctly handle
  partial availability.
- A `pipeline_runs` (or equivalent) table records per-stage success /
  failure, duration, source freshness, and inputs that produced the run.
- Backfill semantics are deterministic: a request to "recompute day X" is
  reproducible.
- Cron and theme discovery are out of critical-path authorship; this
  design only describes the contract and the test that must pass before
  any change to cron / activation.

### Security and configuration

- Read-only inspection verifies RLS posture and whether tracked secrets
  exist.
- Tracked secrets are reported with a precise rotation procedure; no
  rotation is performed.
- Frontend consumes only publishable Supabase credentials.
- LLM and external-provider error logs must not leak secrets.
- Supabase security and performance advisor reports are captured as part
  of the baseline.

### Documentation and release readiness

- `ARCHITECTURE.md` and the mermaid diagram are updated to reflect the
  verified execution graph.
- `PROGRESS.md` is updated for corrections, deferred work, and residual
  risks.
- ADRs are created for: signed-weights accounting, since-inception
  cumulative performance, and the provenance / read-model seam. Other
  ADRs only if the review surfaces a new architecturally significant
  decision.
- The status of `research_agent` variants, migrations 010/011, and any
  `check_*.py` scripts is documented as kept / orphaned / removed.
- A residual-risk report lists proxy breadth, data-provider limitations,
  and knowingly accepted estimates / heuristics.

### Out of scope unless explicitly authorized

- Rotating any credentials.
- Activating, deactivating, or modifying cron or theme-discovery
  production schedules.
- Public deployment of changes; deployments follow the user's normal
  release process.
- Any retroactive edit to tracked production data.

## Deliverables

1. System execution graph showing active modules, tables, and external
   adapters.
2. Data lineage matrix for every investor-facing field.
3. Financial invariant catalog with formulas, signs, units, and
   missing-data rules.
4. Confirmed issue register separated from policy questions and
   unverified suspicions.
5. Architecture decision set for L5 consolidation, taxonomy, provenance,
   and publication policy.
6. Implementation roadmap divided into blocking correctness fixes,
   structural work, and enhancements.
7. Verification matrix linking each risk to automated or manual
   evidence.
8. Operational readiness checklist covering cron, discovery, alerts,
   freshness, backfill, and rollback.
9. Residual-risk report listing accepted limitations.
