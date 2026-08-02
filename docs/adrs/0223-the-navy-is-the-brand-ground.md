# ADR-0223: The navy is the brand ground, and the masthead is its second call site

**Status:** Accepted
**Date:** 2026-08-02
**Amends:** [ADR-0113](0113-the-mark-is-the-artwork-and-the-plate-is-fenced.md) §3 (the fence), and with it the goal-4 clause that cited it in `docs/design-goals.md`
**Related:** [ADR-0113](0113-the-mark-is-the-artwork-and-the-plate-is-fenced.md), [ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md), [ADR-0164](0164-the-accent-and-the-short-ink-were-the-same-colour.md), `docs/design-goals.md` goal 4 (warm paper) and goal 8 (AA floor)

## Context

The masthead ribbon is the top band of every page — `TopBar.tsx` in the root
layout, a 56px sticky bar. It currently renders as translucent cool paper
(`bg-bg-primary/85 backdrop-blur-md`) with dark ink, matching the page surface.
The owner supplied a reference: **the entire masthead as a solid navy band**,
the exact navy of the logo artwork.

ADR-0113 fenced `--logo-plate: #161b38` to the mark alone. Its §3 said it is
*"not a surface, not a chip, not an ink"* and that *"a second dark ground
borrowed for a panel is precisely how a light product acquires a dark dashboard
by increments."* The design-goals goal-4 clause that cites it repeats the
warning. Painting the header navy is therefore not a colour swap — it is a
widening of the fence, and it has to argue the goal down.

It does, narrowly, and on the ground the goal itself already conceded. Goal 4's
own text says the adoption of the mark *"put a dark ground in a light
product… recorded rather than absorbed."* The navy was never excluded from the
identity; it was fenced to the mark so it could not *spread*. The reference
moves the boundary: the navy becomes the **brand ground** — the mark AND the
masthead it sits in — rather than a second independent dark surface. That is a
different thing from "a navy panel on /risk". One surface widens the fence; a
drift of dark panels would be what the goal objects to, and this ADR draws the
line at the masthead.

## Decision

**1. The masthead is solid `--logo-plate`, and `--logo-plate` is the brand ground.**

`TopBar`'s header swaps `bg-bg-primary/85 backdrop-blur-md` for `bg-logo-plate`,
solid, no blur (the blur is inert on an opaque bar and would only tax the paint
pipeline). The bottom hairline `border-border` becomes a light-on-navy rule
`border-header-border` (white @12%) so the bar still reads as sitting above the
page rather than as a floating block.

**2. A light-on-navy token ladder, in both `globals.css` `:root` and
`tailwind.config.ts` `colors`, kept in step by the existing palette-integrity
test.** Every header element that currently uses a paper-ink token moves to the
ladder, and no element outside the header uses a `--header-*` token.

| Token | Value | Use | Contrast on `#161b38` |
|---|---|---|---|
| `--header-ink` | `#ffffff` | wordmark, active nav, control labels | ≈ 17:1 (16.83) |
| `--header-muted` | `#b6bbca` | inactive nav, run-state body | ≈ 8.8:1 |
| `--header-tertiary` | `#8d93a3` | descriptor, nav numbers, "Next run" | ≈ 5.5:1 |
| `--header-raised` | `#1f2740` | nav active block, run-state group, control bg | surface only (tertiary on it 4.80:1, muted 7.70:1 — a lighter raised would fail the AA floor) |
| `--header-border` | `rgba(255,255,255,0.12)` | hairlines / divides | decorative |
| `--header-focus` | `#9ad9e4` | scoped focus ring on navy | ≈ 10.8:1 |
| `--header-warning` | `#e07a4a` | the *stale* freshness dot | ≈ 5.7:1 |

**3. The header scopes its own focus ring.** The global `:focus-visible`
outline is teal `--accent`, which measures **2.6:1 on navy** — under the 3:1
non-text floor (goal 8, WCAG 1.4.11). A scoped
`header :focus-visible { outline-color: var(--header-focus) }` lives in
`globals.css`, so the header keeps visible focus without weakening the ring
everywhere else.

**4. The stale dot is lightened for the navy ground.** The attention orange
`--warning` is 2.5:1 on navy. The dot's only job is to separate the three
freshness cases (goal 3: the words carry the meaning, the colour only
distinguishes) — so a lightened `--header-warning` carries the *stale* case and
`--header-ink` the *live* case. The page's `--warning` chips are untouched;
this is a second, darker-ground-specific token, not a change to attention ink.

**5. The contents flip, the geometry does not.** Nav active/inactive, the
run-state group and its divides, the wordmark/descriptor, and the three
`RibbonControl` controls (`AskDock`, `LiveNewsDock`, `DataMapDock` — all
header-only consumers) move to the ladder. The mark needs no change: its white
figure stands on `#161b38`, so on a navy header the plate disappears and the
figure reads directly — which is exactly the reference. Portalled panels (Ask
popover, Live news window, Data map) stay light cards; only the in-bar buttons
flip. Scroll-fade mask, `first:ml-auto` centering and the `overflow-x-auto`
containment are untouched.

**6. `chip-contrast.test.ts` gains a header-ladder block.** Goal 8's floor is
machine-enforced; a new surface that is not measured is a hole in that promise.
The block resolves the header tokens against `#161b38` and asserts the ink
floor (≥4.5:1), the focus-ring and stale-dot floors (≥3:1), and the
dot-pairing rules (live ≠ stale ≠ unknown by value). No hex appears in
`TopBar.tsx`/`RibbonControl.tsx`, so the no-hex scan stays green.

## Consequences

**The fence in ADR-0113 §3 is widened, and the goal-4 clause that cited it is
amended to match.** The navy is no longer fenced *to the mark*; it is fenced to
the **brand ground** — the mark and the masthead, and nothing else. The line
that drew it — *"reaching for it for anything but the mark is reaching for the
dark dashboard by increments"* — now reads *"reaching for it for anything but
the mark or the masthead"*. What the goal still protects is intact: no panel,
chip, footer or card may borrow the navy, and the one Tailwind utility that
consumes it is `bg-logo-plate` on the header alone. ADR-0113 itself is not
rewritten — it stays the historical record of the mark adoption; this ADR is
the amendment, as the index will show.

**The product now has a dark band in it, on every page.** That is the point of
the reference and the cost of it. It is bounded — one surface, the bar that
already carried the mark — and it is the *brand's* navy, not a second palette.

**The palette gains seven tokens.** All light-on-navy variants of ink and a
second attention orange. The chip-contrast `SURFACES` list and the `--bg-hover`
"five places" comment update: the TopBar nav hover leaves `bg-bg-hover`, which
is what the comment's count was partly about.

**Goal 3 is unaffected.** No direction chip moves; the header carries no
direction colour, and the freshness dot remains glyph-independent per the goal's
own test.

## Alternatives considered

- **A translucent navy (`bg-logo-plate/90` + blur).** Rejected: light paper
  ghosting through navy/90 reads as grey-blue blends, and the reference is a
  flat band. A masthead that half-reveals its content is chrome, not a mark.
- **A thin navy ribbon above an unchanged light bar.** Rejected on scope: the
  owner chose the whole 56px bar, and a 6px brand strip over a light header is
  a different artefact (a ticker, not a masthead).
- **Renaming `--logo-plate` → `--brand-navy`.** Rejected as churn: the widened
  role is documented in the token comment and this ADR; renaming would move
  `BrandMark`, the `brand-mark.test.ts` `PLATE` constant and the drift test for
  no behavioural gain, and the two-icon literals would not follow anyway.
- **A new header token instead of reusing the plate.** Rejected because it would
  let the header and the mark drift apart, which is exactly what the drift test
  exists to prevent. One navy, two call sites, one value.
