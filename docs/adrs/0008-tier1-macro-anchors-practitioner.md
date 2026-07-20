# ADR-0008 — Tier 1 macro anchors defined by practitioner judgment

- Status: accepted
- Date: 2026-07-21
- Tags: data, analytics

## Context

The theme taxonomy has three tiers: Tier 1 (fixed macro anchors), Tier 2 (discovered), Tier 3 (review). A purely data-driven approach could miss obvious macro themes that drive markets — or surface noise themes with high recent correlation but no fundamental basis.

## Decision

Eight macro themes are fixed as Tier 1 anchors and are always tracked: Fed Policy, Inflation, China Growth, US Dollar, Geopolitical Risk, Corporate Credit, Energy Prices, US Election. They are defined by practitioner judgment, not discovered. Data-driven discovery supplements, does not replace, this list.

## Consequences

### Positive
- Always-track list ensures obvious macro drivers are never missed
- Separates practitioner knowledge from data-driven signals
- Clean boundary between "known" and "discovered"

### Negative
- Practitioner bias can exclude emerging themes
- Requires human review to add or remove Tier 1 themes

### Neutral
- Tier 1 list is reviewed quarterly

## Alternatives considered

### All themes discovered
What it was: No fixed Tier 1; all themes emerge from data.
Why we ruled it out: Risks missing obvious macro drivers that do not generate enough news/social volume to surface statistically.

### All themes practitioner-defined
What it was: A fixed list of themes maintained by hand.
Why we ruled it out: Misses emergent narratives that are not yet on the practitioner's radar.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §4.4
