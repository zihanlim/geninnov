# ADR-0164: The accent and the SHORT ink were the same colour, for about 6% of readers

**Status:** Accepted
**Date:** 2026-07-29

## Context

`--accent` carries every link, every active nav item, every focus ring, the
`badge-tier-anchor` chip and the source tags in `lib/sourceTokens.ts` — 116 call
sites. It has been crimson-pink since the Ledger theme landed, and it had been
darkened twice for contrast: `#e11048` → `#d40e43` (2026-07-24) → `#c50c3e`
(2026-07-25), each step bought because `badge-tier-anchor` renders the accent over
its own 10% tint, where the lighter shades measured 4.08:1 and 4.34:1.

The comment justifying the second darkening flagged the cost, in its own words:

> Deliberately the MINIMAL darkening: the accent is only 8° of hue from `--short`,
> so what keeps "interactive" distinct from "short" is the lightness gap, and every
> further shade spent on contrast margin narrows it.

Two floors were converging on one token. That was recorded as a tension to watch and
never measured, because the guard that exists — `tests/unit/chip-contrast.test.ts` —
enforces a **contrast** floor. Contrast between a foreground and its background is a
different question from **separation** between two foregrounds that mean different
things, and nothing in the repo measured the second.

Meanwhile `docs/design-goals.md` goal 3 states the rule the tension threatens:

> A proposal that colours `LONG` the same as a hyperlink has destroyed a semantic to
> gain nothing — this is the single most common failure mode in outside mockups.

That is written as a warning about *incoming mockups*. Nobody had pointed it at the
palette already shipping.

The occasion to measure was the fourth Stitch archive
([ADR-0161](0161-a-corpus-the-board-could-not-see.md),
[ADR-0163](0163-a-comparison-surface-over-one-fetch.md)), whose "Systematic Alabaster"
token set proposes a teal `#00687a`. That accent was refused in the first triage as
part of a blanket cyan/teal rejection, and the refusal was **corrected in the second**,
which measured the teal properly and found it clears AA. That correction settled that
the teal is *permissible*. It did not establish a reason to move.

## Decision

**`--accent` becomes teal `#00687a`, and the reason is separation, not contrast.**

Contrast was never the deciding axis. Both colours clear AA on every pairing the app
renders, measured as worst-of the three surfaces a chip can land on
(`--bg-primary` / `--bg-surface` / `--bg-elevated`):

| Pairing | Call site | Floor | `#c50c3e` | `#00687a` |
|---|---|---|---|---|
| accent as plain text | 60 sites | 4.5 | 5.43 | **5.83** |
| accent over its own 10% tint | `badge-tier-anchor`, `sourceTokens` | 4.5 | 4.58 | **5.04** |
| `#fff` on solid accent | `AskConsole` avatar | 4.5 | 6.01 | **6.44** |
| paper on solid accent | `LensSelector` active segment | 4.5 | 5.73 | **6.14** |
| ring against surface | `focus-visible` | 3.0 | 5.43 | **5.83** |

The last row is **not** covered by `chip-contrast.test.ts` and was measured
separately: a focus ring is a non-text indicator under WCAG 1.4.11, floored at 3:1,
and it is not a chip. The test's `SURFACES` list and chip enumeration are correct for
what they claim to cover; this simply falls outside it.

The deciding axis is perceptual separation from the direction inks, simulated with
Machado et al. 2009 at severity 1.0:

| Accent | vs `--short` | | | vs `--long` | | |
|---|---|---|---|---|---|---|
| | normal | protan | deutan | normal | protan | deutan |
| `#c50c3e` (was) | 14.9 | **7.7** | **8.6** | 100.4 | **11.4** | 27.8 |
| `#00687a` (is) | 84.5 | 32.1 | 51.8 | 28.8 | 26.2 | 25.3 |

Below ΔE ≈ 10 two colours stop being reliably separable. Protanopia and deuteranopia
together are roughly **6% of males**. So for that population the accent *was* the
SHORT ink — and, at 11.4 protan, close to the LONG ink as well. Goal 3 was being
violated by the palette it was written to defend, against `--short` rather than the
`--long` the goal names.

Teal clears 25 against both inks under both common deficiencies.

**Not pushed bluer.** `#0f6490` (200°) scores better against `--long` — protan 40.2,
deutan 39.1 — and matches the teal on every contrast row. It was rejected because the
accent's distance to `--series-1 #2a78d6`, the blue in the ADR-0128 categorical
palette, falls **48.4 → 31.3 → 20.7** as the accent goes bluer. The trends board
renders series ink with direct end-labels while the page around it renders accent
links, so that is a real adjacency. Going bluer does not remove a collision; it moves
it. `#00687a` holds ≥48 from every series slot.

**Two token sites, both or neither.** Tailwind compiles colours to literal RGB at
build time and never reads the `:root` variable, so `app/globals.css` and
`tailwind.config.ts` must move together — `palette integrity` in
`chip-contrast.test.ts` asserts exactly this. `accent-dim` was re-derived to
`rgba(0,104,122,0.10)` so the `*-dim` tint-drift assertion holds.

## Consequences

**One regression, accepted and recorded.** Under **tritanopia** the teal sits ΔE
**4.6** from `--long`, where crimson-pink sat at 110.7. This trades a collision
affecting ~6% of males for one affecting ~0.01% of everyone. It is survivable only
because [ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md) already requires
every direction to carry a ▲/▼ glyph or a `LONG`/`SHORT` wordmark, with hue merely
reinforcing. If that rule is ever relaxed, this ADR's arithmetic stops holding — the
two decisions are coupled, and this is the coupling.

**Goal 3 gains a measurement it did not have.** It was enforceable only against
incoming proposals, by eye. The numbers above are reproducible, and the same method
applies to any future accent, warning or series colour. This ADR does **not** add a
test: a separation floor would need a considered threshold and a decision about which
pairs are adjacent enough to matter, and asserting one now would pin a number nobody
has argued for. That is deliberately left open.

**What did not change.** No surface, no direction ink, no warning ramp, no series
slot. `--logo-plate` is untouched and still fenced to the mark
([ADR-0113](0113-the-mark-is-the-artwork-and-the-plate-is-fenced.md)). The crimson
family survives where it always meant something: `--short` is still `#9f172a`.

**Verification.** 875 frontend tests green, including all 71 in `chip-contrast`;
`next build` exit 0. Captures in `docs/captures/2026-07-29/` were taken against a
server verified to be serving this build — the shared `.next` had been corrupted by a
concurrent session's dev server, so the served CSS was checked for `00687a` and zero
`c50c3e` before shooting rather than assumed. A matched before/after was produced by
building `HEAD~1` in a detached worktree rather than by overriding CSS, so the "before"
is a real build.

**The derivation script is not in the repo.** It duplicates the compositing and
luminance maths that `chip-contrast.test.ts` already owns as private functions, and a
second copy of that arithmetic is precisely the drift that file's own header warns
about. The method is recorded here; the numbers are reproducible from it.
