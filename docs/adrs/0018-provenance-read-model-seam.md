---
status: accepted
date: 2026-07-22
deciders: platform owner
---

# ADR-0018 — Provenance read-model seam between Python and TypeScript

## Context

Every numeric output on `/portfolio`, `/trades`, and `/research` is now expected to carry provenance: *where did this number come from, when was it observed, what is the freshness, what is the uncertainty?* This is the core of the L7 layer.

The data lives on the Python side as frozen dataclasses (`NumericDerivation`, `AdvisoryDerivation` in `backend/derivations/`). The render lives on the TypeScript side as React components (`frontend/components/status/*`, `portfolio/*`, `research/*`).

Until T18 / T19 there were two failure modes:
1. **Free-form fields**: components reached into JSON keys (`row.risk.var_95`) without a shared type, so renaming a column in `portfolio_risk` silently broke the UI.
2. **No freshness/uncertainty on the wire**: L4 metrics rendered as if they were exact, when in fact the L4 risk engine always knows its `max_age_seconds` and `band_low`/`band_high`.

T18 introduced `validate_advisory()` and a strict fallback policy; T19 added the JSONB derivation columns to `portfolio_positions` and `research_recommendations`. We now need a stable read-model that both sides can rely on without coupling to one column at a time.

## Decision

We establish a **provenance read-model seam** — a pair of mirrored, structurally-aligned dataclass families that travel through the system in two places only:

1. **Python side** — `backend/derivations/numeric.py` defines `NumericDerivation`, `SourceRecord`, `Freshness`, `Uncertainty`. `backend/derivations/advisory.py` defines `AdvisoryDerivation`. Both have `validate_*` functions. Both are what L4 and L5 emit; both are what gets JSON-serialized into the `numeric_derivations` / `advisory_derivation` JSONB columns.

2. **TypeScript side** — `frontend/lib/derivations/numeric.ts` and `advisory.ts` mirror those types structurally (TS interfaces, not classes — they are pure read models). `format.ts` provides the small rendering helpers (`formatStatusBadge`, `formatFreshnessLabel`, `formatUncertaintyBand`).

The seam contract is: **the JSONB column is the wire format**; both ends agree on the field names (`field_id`, `display_status`, `source_records[].table`, `freshness.observed_age_seconds`, `uncertainty.band_low`, etc.) by reading the same ADR. A breaking change to a field name requires a new ADR.

`frontend/components/status/StatusBadge.tsx`, `FreshnessLabel.tsx`, and `UncertaintyBand.tsx` consume from this seam only — they never reach into row columns directly. `portfolio/CumulativeReturn.tsx`, `DailyPLHistory.tsx`, `ExposureSummary.tsx`, and `research/ThesisBlock.tsx` likewise.

## Consequences

Positive:
- Renames are caught at the TypeScript compile step (`npx tsc --noEmit`) when the JSONB columns drift from the TS interfaces.
- The seam is asset-class agnostic — it works for any backend producer that emits a `*Derivation` JSONB column. Future numeric provenance for `factor_exposures` or `regime_classifications` plugs into the same seam.
- Validators on the Python side reject malformed derivations at write time; on the TS side, the strict types reject malformed inputs at compile time.

Negative / friction:
- Two files to keep in sync (Python dataclass + TS interface). Mitigation: codegen is overkill for Phase 1; the cost is one PR per breaking change and one ADR.
- `format.ts` becomes the canonical styling surface; any third-party helper that bypasses it must justify the bypass in a follow-up ADR.

Alternatives considered:
- **Free-form JSON passthrough** (status quo pre-T18): rejected because it produced the bugs that T18/T19 had to fix.
- **GraphQL fragment codegen**: rejected as over-engineering for a single-app frontend.
- **Single `Derivation` union type** instead of two types: rejected because `AdvisoryDerivation` has fields (`body`, `fallback_used`, `citation_status`) that are meaningless for numeric metrics.

## References

- `docs/baseline/schema.sql`, `docs/lineage/MATRIX.md` — column-level lineage of the derivation JSONB columns.
- `docs/verification/MATRIX.md` — which UI components consume which derivation fields.
- `docs/runtime/EXECUTION_GRAPH.md` — where in the L0–L7 pipeline each derivation type is emitted.
