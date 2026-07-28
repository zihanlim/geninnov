# ADR-0113: The mark is the artwork, and its navy is fenced to the mark

**Status:** Accepted
**Date:** 2026-07-27
**Completes:** decision §3 of [ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md) (`--brand` is deleted), whose last call site survived until now
**Related:** [ADR-0086](0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md), `docs/design-goals.md` goal 4 (warm/cool paper, not the interchangeable dark dashboard) and goal 8 (the AA floor)

## Context

The masthead carried a 22px rounded square with the letter `A` in it, filled with
a gradient running `--accent → --brand`. It was a placeholder for a logo, and it
had two costs beyond looking like one.

**It kept a deleted token alive.** ADR-0085 §3 decided `--brand` is deleted,
because it is byte-identical to `--short` (`#9f172a`) and anything painted with it
therefore renders in exactly the colour of a short position. The call sites that
made that a live defect — `AbstentionRoster`'s focus ring, `ConvictionCard`'s
emphasis gradient — moved to `--accent`. The masthead tile did not, so the token
stayed in `globals.css` and `tailwind.config.ts` with a comment explaining that it
survives in one place and must not be reached for. A fenced token that still exists
is a token someone will use.

**Below 640px it had no accessible name.** The wordmark is `hidden sm:inline`, so on
a phone the home link was a coloured square containing a letter, inside an `<a>` with
no `aria-label`. Nothing announced it.

The owner supplied the real mark: 892×896, a white figure standing on a horizon
curve. 717,750 of its 799,232 pixels are exactly `#161b38` and the figure is exactly
`#ffffff` — a two-colour silhouette, not a photograph. It arrived at the repo root,
where `.gitignore`'s `/*.png` would have kept it untracked; it is now
`docs/brand/andromeda-mark-source.png`, because a generated asset whose source is
untracked cannot be regenerated.

## Decision

**1. The mark is the supplied artwork, traced to a vector, and it is drawn once.**

The PNG is traced to a single `<path>` (pixel-edge boundary loops, Douglas–Peucker
simplified at 1.2 source pixels, `fill-rule="evenodd"` because the gaps under the
arms and between the legs are separate loops). The path lives in `lib/brand.ts`. It
is rendered by three things:

| Renderer | Why it cannot import the path |
|---|---|
| `components/BrandMark.tsx` | — it does import it |
| `app/icon.svg` | a favicon is fetched outside the document; no module graph, no CSS variables |
| `app/apple-icon.png` | Safari ignores an SVG touch icon, so this one is a raster |

The last two are build outputs, so `tests/unit/brand-mark.test.ts` asserts the icon's
path data is byte-identical to `MARK_PATH` and that its plate literal matches
`--logo-plate`. This is the same shape of guard as the `globals.css` ↔
`tailwind.config.ts` drift test: two files that must agree about a value neither can
read from the other. Nobody looks at a favicon on purpose, so nothing else would
catch it.

**2. The mark renders at 26px, not 22px.**

Measured: at 22px the legs, the ponytail and the horizon arc merge into one blob.
This artwork is a thin-limbed silhouette rather than a letterform and it does not
survive the size a letter did. 26px of a 56px bar keeps it balanced against the
wordmark. The test asserts `MARK_SIZE_PX >= 24` so a later tidy-up cannot quietly
take it back down.

**3. `--brand` and `--brand-dim` are deleted. `--logo-plate: #161b38` replaces them,
and it is fenced to the mark.**

The plate is a token — rather than a hex inside `BrandMark.tsx` — for one reason:
so the one navy in this project is a thing the palette test can see. It is *not*
an invitation. It is not a surface, not a chip, not an ink. Goal 4 is cool paper,
and a second dark ground borrowed for a panel is precisely how a light product
acquires a dark dashboard by increments. Its only call sites are `BrandMark.tsx`
and the two generated icons.

**4. The home link carries an unconditional `aria-label`.**

Not conditional on the wordmark's breakpoint. The name should not depend on the
viewport.

## Consequences

**The palette gains a colour it did not have.** That is a real widening of goal 4
and is stated rather than absorbed: this project's identity is cool paper with
crimson semantics, and there is now a navy in it. What bounds it is the fence in
§3 plus the fact that no Tailwind utility consumes it — `BrandMark` reads
`var(--logo-plate)` directly, so writing `bg-logo-plate` gets you nothing and
there is no accidental path to a navy panel.

**Goal 8 is unaffected.** The AA floor is about text, and the mark carries none:
white on `#161b38` measures **16.83:1** (plate relative luminance 0.01240), and the
accessible name lives on the link rather than in the artwork.

**At 16px the figure does not resolve, and that is accepted.** A tab favicon is
16 CSS pixels; a standing figure on a horizon becomes a light shape on a navy tile
at that size. The alternative — a simplified glyph for small sizes — means two
marks that can disagree, which is the drift this ADR spends a test preventing.
The tile is distinctive enough to find in a tab strip, which is what a favicon at
16px is actually for.

**What was NOT done.** No `opengraph-image`. A social card is a layout with type
in it, not a mark, and inventing one is a different decision from adopting a logo.
`/book` links currently share as plain text; that stays true.

**Regenerating.** `frontend/scripts/trace-brand-mark.mjs <source.png>` re-emits both
icons and prints the path to paste into `MARK_PATH`. It is deterministic — re-running
it on the current source reproduces the shipped path byte for byte, which is how the
tracer itself was verified. It reads the plate colour off the artwork's frame rather
than assuming `#161b38`, so a re-export on a different ground still traces; if that
ever happens, `--logo-plate` and the test's `PLATE` constant move with it. If the
artwork is replaced and only one of the three renderings is updated,
`brand-mark.test.ts` fails — which is the point.
