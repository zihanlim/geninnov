# ADR-0220 — L5 cites structured_facts and computable_macro, with provenance

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0010](0010-citation-footnotes-everywhere.md), [0012](0012-citation-guardrail-llm-defense.md), [0019](0019-citation-value-reconciliation.md), [0027](0027-grouding-not-rejection-when-cited-values-match-anywhere.md), [0049](0049-thesis-position-claims-must-reference-the-book.md), [0091](0091-absence-blocks-the-claim-not-defaults-it.md), [0217](0217-computable-macro-analytics.md), [0218](0218-structured-facts-layer.md), design-goals.md §1, §3, §7

## Context

The L5 reasoning agent cites numbers from training data when it should cite numbers from a stored layer. The Q2 test rewards a system whose every numeric claim traces to a row the system can defend.

Two new layers have landed:

- **`structured_facts`** (m066, ADR-0218): 50 hand-curated rows covering hyperscaler capex, Chinese AI model releases, FOMC probabilities, and external research findings.
- **`computable_macro`** (m065, ADR-0217): a JSONB column on `regime_classifications` carrying the three derived analytics (ERP, equity-bond correlation, NDX seasonality).

Both layers need to:

1. Be visible in the L5 prompt, so the model can cite them.
2. Be citable with a token format the citation guardrail (`verify_citations`) can parse.
3. Pass the same value-grounding discipline as the existing `macro_indicators` and `regime:*` citations (ADR-0019, ADR-0027).
4. Honour the same absence semantics (ADR-0091, ADR-0098): a fact the system does not have is "unknown", not zero.

The existing citation guardrail builds a `source_map` from `macro_snapshot`, `theme_scores`, `risk_metrics`, and `regime`, then checks each citation against that map (with value-grounding as a fallback for qualitative citations). The two new layers need the same treatment.

## Decision

**The L5 prompt gains two new sections, "STRUCTURED FACTS (L4b)" and "COMPUTABLE MACRO (L4c)", formatted as one-row-per-fact tables the model reads verbatim. The citation guardrail's `source_map` is extended with the new key formats:**

- `[structured_facts:<entity>:<metric>]` — registered in `source_map` per (entity, metric) pair from the loaded `structured_facts` rows. The L5 prompt's `_format_structured_facts` renders the exact (entity, metric) pair as a column the model copies.
- `[regime_classifications:computable_macro:<metric>]` and `[regime_classifications:computable_macro:<metric>:<inner_key>]` — registered from the `computable_macro` JSONB. A citation that names a key the JSONB doesn't carry is rejected (same discipline as a hallucinated macro_indicators row).

**Two new helper functions** (`_format_structured_facts` and `_format_computable_macro`) render the rows to a markdown-ish table the L5 reads verbatim. The formatting matters more than usual: a typo in the entity or metric column would silently fail the citation guardrail, so the table is built from the same `get_fact()` / `get_facts_by_category()` calls the L5 will make — the table is the same data the citation guardrail sees, in the same shape.

**The two new layers flow through `aggregate_context` (Node 1).** This is the right place because the L5 prompt's "frozen input snapshot" already includes L0-L4 there; adding L4b and L4c keeps the audit trail complete and means a re-run of the same node on a stale state can never disagree with itself.

**`verify_citations` builds the new source_map entries from the loaded `structured_facts` and `computable_macro` lists, not from a re-fetch.** The state the guardrail checks is the state the prompt was built from. A re-fetch would be a different state and would invite a class of bug where a re-loaded row disagrees with what the L5 was shown.

**Two new eval fixtures** at `backend/eval/l5_fixtures/`:
- `structured_facts_required.json` — a fixture where the L5's thesis MUST cite at least one `[structured_facts:...]` row, with a known good answer. Asserts: a thesis with no structured_facts cite is rejected; a thesis with a valid cite is accepted.
- `absence_honored.json` — a fixture where the L5 is asked about a metric the system does NOT have, and the expected response is to say "unknown" rather than hallucinate. Asserts: a thesis with a fabricated cite is rejected; a thesis that says "the system has no data on X" is accepted.

**The fallback path is unchanged.** A failed citation triggers `verify_citations` rejection → retry `reason_picks` → `fallback_picks` (deterministic). The new tools come BEFORE the fallback, not as a replacement for it. The fallback still produces a book; the L5 is just better-defended when it succeeds.

## Consequences

- **Positive**: every numeric claim in an L5 thesis can now be traced to either `macro_indicators`, `regime:*`, `theme:*`, `risk:*`, `structured_facts:*`, or `regime_classifications:computable_macro:*`. Six citation namespaces, one guardrail, one source of truth per claim.
- **Positive**: the prompt's structured-facts table is sorted by category and (entity, metric), with the cite token rendered as a column. The L5 cannot misread the entity/metric and emit a malformed cite — the table is the contract.
- **Positive**: the L5's frozen input snapshot now includes `structured_facts_count` and `computable_macro_status`, so a reviewer auditing a thesis can see at a glance whether the system had data on the questions the thesis answers.
- **Negative**: the prompt is longer. The L5 reads more tokens; cost goes up by ~10-15% per L5 call. Accepted: a 10% cost increase is a reasonable price for a 100% audit trail.
- **Negative**: the citation guardrail's source_map now has ~80 entries (up from ~30). Lookups are O(1) hash, so the guardrail is still fast, but the surface area for false positives grew. Mitigated by the eval fixtures, which pin behaviour on the new keys.
- **Negative**: a future L4d layer would have to extend the guardrail again. A generic citation token (`[table:row:col]`) would scale better, but at the cost of giving up the discipline of having one team review every new namespace. Deferred until a fourth layer lands.

## Refused alternatives

- **A free-form `[any_table:any_row]` citation token**: rejected. The discipline of having one team own the citation namespaces (and the guardrail) is more valuable than the schema flexibility. The L5 prompt is the contract; the contract is finite.
- **Building the new source_map entries from a re-fetch**: rejected. A re-fetch is a different state; the guardrail must check what the L5 was shown, not what is in the DB right now. ADR-0013's "L0-L4 frozen at graph entry" applies to the new layers too.
- **Adding the structured_facts rows to `macro_snapshot`**: rejected. The two have different shapes: macro_snapshot is `{series_id: {name, value, unit}}`, structured_facts is a list of `{entity, metric, value, unit, as_of, source, ...}`. Flattening them loses the source/confidence and breaks the prompt's table.
- **A separate `_verify_structured_facts_citation` function**: rejected. The guardrail is one function; splitting it into per-layer verify functions would let one path accept a cite another path rejects. One source_map, one ground truth.
- **A lenient cite that accepts `[structured_facts:MSFT]` (entity only, no metric)**: rejected. The metric is the unique key; an entity alone is ambiguous when two metrics for the same entity are in the table. The L5 prompt's table makes the metric column unmissable.
