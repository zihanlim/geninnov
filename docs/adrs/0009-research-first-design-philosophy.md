# ADR-0009 — Research-first design philosophy (vs Bloomberg-terminal aesthetic)

- Status: accepted
- Date: 2026-07-21
- Tags: ux, design, frontend

## Context

The original frontend design was structured around a Bloomberg-terminal aesthetic: dark mode, dense panels, monospace data font, semantic green/red/blue accent colors. This was the obvious reference — it's the dominant visual language in finance, and a quant review panel would recognize it immediately.

But the platform is not a trading terminal. The system produces:
- A ranked list of trending themes (Q2)
- A top 5 long / top 5 short book with thesis (Q1)
- A regime classification + factor exposure snapshot
- A risk dashboard

These are **conviction outputs**, not tick-level execution data. The audience reads the output on a daily cadence (or a single review session), not at 100ms tick latency. The terminal aesthetic optimizes for the wrong constraint.

The Bloomberg reference also carries a category mistake risk: the platform's review panel will see "yet another dark finance dashboard" and pattern-match it to dozens of similar tools. The actual differentiator — the *rigor* of the derivation — needs to be visible, not the visual fidelity to a Bloomberg clone.

## Decision

Adopt a **research-first design philosophy**. The frontend's primary job is to communicate the *reasoning* behind each output, not just display the output.

Concretely:

1. **Conviction-first hierarchy on the landing page.** Macro regime hero dominates the fold. Top 3 themes get a card with thesis sentence, sparkline, sub-score bars, catalyst, crowding, and 1-day delta — not a list of numbers.
2. **Every numeric claim is auditable.** Click any score → see the derivation (raw signals → normalization → weights → final). No number is naked.
3. **Q1 thesis is the primary deliverable.** The `/research` page is the most important page, not an afterthought. Book view (central scenario, net exposure, factor tilt) comes before per-pick writeups.
4. **Narrative over density.** Prefer 3 well-explained cards over 20 dense rows. The user reads the system, not scans it.
5. **Dark mode retained** — it suits the data — but the aesthetic is closer to "Linear meets a research dashboard" than "Bloomberg clone."

Visual reference points:
- Perplexity Finance for citation/source provenance
- Linear's information density and motion design
- Stripe Dashboard for narrative + data integration

## Consequences

### Positive
- The thesis is the differentiator, and the design puts the thesis front and center
- Every claim is auditable — addresses the "trust me" problem with quantitative outputs
- The aesthetic is recognizable as "research tool" not "yet another finance dashboard"
- The review panel sees a coherent system, not a Bloomberg imitation

### Negative
- Trading-floor aesthetic purists may find it less "professional" than a Bloomberg clone
- Less information density per screen — more scrolling required
- Requires more careful information architecture work per page

### Neutral
- Dark mode is retained (terminal-adjacent but not terminal-clone)
- Recharts still used for visualizations; no new charting library

## Alternatives considered

### Bloomberg-terminal aesthetic (status quo before this ADR)
What it was: 30-pane dashboard, keyboard-first, dense numerical tables, monospace data.
Why we rejected: wrong paradigm for a research/conviction system; audience reads at minutes-to-hours cadence, not 100ms ticks. Makes the framework's rigor less visible, not more.

### Notion-style document/blocks
What it was: each pick as a long-form block; book view as a running document.
Why we rejected: too document-y; loses the comparison-table view that the Q1 deliverable needs. Bad for the filterable Trade Ideas page.

### Mobile-first morning briefing
What it was: single-column, card stack, designed for phone.
Why we rejected: quantitative work needs screen real estate for comparison tables and factor exposure visualizations. Mobile-first degrades the analytical surfaces.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §8
- Related: [ADR-0010](0010-citation-footnotes-everywhere.md), [ADR-0011](0011-theme-derivation-drawer.md)
- Implementation: `docs/design/redesign/index.html` (high-fidelity mockup)
