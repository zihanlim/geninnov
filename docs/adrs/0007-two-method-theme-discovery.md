# ADR-0007 — Two-method theme discovery (LDA + embedding clustering)

- Status: accepted
- Date: 2026-07-21
- Tags: data, analytics

## Context

Tier 2 themes (data-driven, discovered) should not be based on a single method — a single method risks finding spurious patterns. Two independent methods agree on a theme → higher confidence it represents a real narrative.

## Decision

Use both LDA topic modeling AND sentence embedding clustering (UMAP + HDBSCAN) to discover themes. Only themes found by **both** methods are added to Tier 2. Themes found by only one method go to Tier 3 for human review.

## Consequences

### Positive
- Agreement between two independent methods reduces spurious theme discovery
- LDA provides interpretable word distributions per topic
- Embedding clustering provides semantic groupings that LDA may miss

### Negative
- Two methods to implement and maintain
- One method may dominate — requires post-prototype validation

### Neutral
- Discovery runs at bootstrap and monthly (not daily) — operational overhead is acceptable

## Alternatives considered

### LDA only
What it was: Topic modeling with Latent Dirichlet Allocation alone.
Why we ruled it out: Requires k (topic count) to be specified upfront. Less robust to noise.

### Embedding clustering only
What it was: Sentence embeddings + UMAP + HDBSCAN without LDA.
Why we ruled it out: Produces semantic clusters without interpretable word distributions.

### Single method
What it was: One method chosen in advance (LDA or clustering).
Why we ruled it out: Less robust to noise; higher risk of spurious themes.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §4.5
