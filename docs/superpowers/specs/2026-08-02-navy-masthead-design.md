# Navy Masthead Design

**Date:** 2026-08-02
**Status:** Approved
**Decision record:** [ADR-0223](../adrs/0223-the-navy-is-the-brand-ground.md)

## What this is

The whole 56px sticky `TopBar` (every page, via `frontend/app/layout.tsx`)
becomes a solid navy band in `--logo-plate` (`#161b38`), the mark's own navy,
per the owner's reference. This widens ADR-0113's fence from "the mark only" to
"the brand ground — mark + masthead". ADR-0223 argues the goal-4 narrowing;
this spec is the build recipe.

## Scope

- **In:** `frontend/components/TopBar.tsx`, `frontend/components/RibbonControl.tsx`,
  the token ladder in `frontend/app/globals.css` + `frontend/tailwind.config.ts`,
  the header-ladder block in `frontend/tests/unit/chip-contrast.test.ts`.
- **Out:** portalled panels (Ask popover, Live news window, Data map dock), the
  mark itself (`BrandMark` is unchanged — white figure on navy), `SideRail`,
  all page content. No `--header-*` token is used outside the header.

## The token ladder (both files, kept in step by the palette-integrity test)

| Token | Value | Use | Contrast on `#161b38` |
|---|---|---|---|
| `--header-ink` | `#ffffff` | wordmark, active nav, control labels | ≈ 16.8:1 |
| `--header-muted` | `#b6bbca` | inactive nav, run-state body | ≈ 8.8:1 |
| `--header-tertiary` | `#8d93a3` | descriptor, nav numbers, "Next run" | ≈ 5.5:1 |
| `--header-raised` | `#28304d` | nav active block, run-state group, control bg | surface |
| `--header-border` | `rgba(255,255,255,0.12)` | hairlines / divides | decorative |
| `--header-focus` | `#9ad9e4` | scoped header focus ring | ≈ 10.8:1 |
| `--header-warning` | `#e07a4a` | *stale* freshness dot | ≈ 5.7:1 |

The `--logo-plate` comment in both files updates from *"not a surface"* to
*"mark + masthead"*.

## Changes by file

### `frontend/app/globals.css`
1. Header tokens above added to `:root` (comments quoting the measured
   contrast, and the two sub-3:1 ink tokens — `--warning` 2.5:1 and `--accent`
   2.6:1 on navy — documented as *why* the scoped tokens exist).
2. `header :focus-visible { outline-color: var(--header-focus) }` scoped rule
   (teal ring is 2.6:1 on navy, under the 3:1 non-text floor).
3. Update the `--logo-plate` fence comment to "mark + masthead".
4. Update the `--bg-hover` "appears in exactly five places" comment — the TopBar
   nav hover moves off it.

### `frontend/tailwind.config.ts`
- The seven `header-*` colours, mirroring `:root` (Tailwind compiles to literal
  RGB and never reads the variables — both must move together).
- Update the `logo-plate` comment to the widened role.

### `frontend/components/TopBar.tsx`
- `<header>`: `bg-bg-primary/85 backdrop-blur-md border-border` →
  `bg-logo-plate border-header-border`. Remove `backdrop-blur-md` (inert on
  opaque).
- Wordmark: `text-text-primary` → `text-header-ink`; descriptor
  `text-text-tertiary` → `text-header-tertiary`.
- Nav links: inactive `text-text-secondary hover:text-text-primary
  hover:bg-bg-hover` → `text-header-muted hover:text-header-ink
  hover:bg-header-raised`; active `text-text-primary bg-bg-elevated` →
  `text-header-ink bg-header-raised`. The `<span class="num text-text-tertiary">`
  number → `text-header-tertiary`. Geometry (mask, centering, overflow) untouched.
- Run-state group: `text-text-secondary bg-bg-elevated divide-border
  border-border` → `text-header-muted bg-header-raised divide-header-border
  border-header-border`. Dot: `bg-text-secondary`(live) →
  `bg-header-ink`, `bg-warning`(stale) → `bg-header-warning`,
  `bg-text-tertiary`(unknown) → `bg-header-tertiary`. "Next run"
  `text-text-tertiary` → `text-header-tertiary`.

### `frontend/components/RibbonControl.tsx`
Default button classes flip to the ladder (all three consumers — `AskDock`,
`LiveNewsDock`, `DataMapDock` — render only inside the header):
`active: border-border-strong bg-bg-elevated text-text-primary` →
`border-header-border bg-header-raised text-header-ink`;
inactive: `border-border bg-bg-surface text-text-secondary hover:...` →
`border-header-border bg-transparent text-header-muted hover:text-header-ink
hover:bg-header-raised`.

### `frontend/tests/unit/chip-contrast.test.ts`
New block after the chip list: resolve the header ink tokens against
`#161b38`; assert the ink floor ≥4.5:1, focus-ring and stale-dot ≥3:1, and the
dot-pairing (live/stale/unknown are distinct values). No change to existing
blocks except the `--bg-hover` comment.

## Behaviour that must not change

- Sticky, z-index, grid `grid-cols-[auto_1fr_auto]`, 56px height, mark
  `aria-label`, `scroll-padding-top: 104px` clearing, tooltip portalling.
- The scroll-fade mask on the nav: `scrollFadeMask` returns a black-based
  gradient; black fades work on navy unchanged.
- Ask / Live news / Data map panels stay light — they are portalled cards.

## Verification

1. `npm test` — chip-contrast (new block + existing 43 assertions), scroll-fade,
   next-run, brand-mark (plate literal unchanged), phases, section-nav, and the
   full frontend suite stay green.
2. `tsc --noEmit` clean.
3. Playwright: navigate `/`, `/book`, `/risk`, `/method`; screenshot each at
   1440 and 375; tab through the header (focus rings visible on navy, Ask / Live
   news / Data map reachable); confirm no console errors. Screenshots to
   `docs/captures/2026-08-02/`.
4. `next build` green (mind the shared `.next` caveat — build, then dev, not
   both at once).

## Doc sync

- ADR-0223 (this decision) + `docs/adrs/README.md` index row.
- `PROGRESS.md` dated row under Completed.
- `ARCHITECTURE.md` L6 `SHELL` mermaid node description gains a note that the
  masthead is navy (`--logo-plate`); the Feature Checklist is untouched
  (pipeline wiring, not chrome).
- `CLAUDE.md` Key source files — `TopBar.tsx` line gains the navy-masthead note.
