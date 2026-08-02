# ADR-0224: The active lens chip borrows the plate

## Context

The lens selector (multi-asset / credit / rates / equity / fx / commodity) is the
reader-facing control that answers "which asset-class book am I reading?" It is the
affirmative, book-wide state selector on `/book`, `/mandate`, `/risk`, and the
trades pages. Its active chip was painted teal `--accent` (`#00687a`), the same
interactive teal as links and the active nav tab.

The brand's blue — the navy plate `#161b38` — is the single most recognizable
colour in the project: it is the logo artwork's ground and, since ADR-0223, the
solid 56px masthead on every page. The user asked that the active lens chip be
painted the logo's blue instead of the teal.

ADR-0113 fenced `--logo-plate` to the mark; ADR-0223 widened that fence to the
brand ground (mark + masthead). Both records and the `globals.css` token comment
said explicitly: the plate is "not a chip, not a panel, not an ink." Painting a
UI chip with it is therefore a widening of the fence, not a routine token swap —
and it must be recorded and bounded, or the fence becomes a suggestion.

## Decision

`--logo-plate` (`#161b38`) is the fill for the **active** chip of `LensSelector`,
with white (`#fff`, 16.83:1 on the plate) as its ink. The plate's call sites are
now: the mark (`BrandMark` + the two generated icons, drift-tested), the 56px
masthead (`TopBar`), and the active lens chip (`LensSelector`).

The widening is deliberately narrow:

- **Only the active chip.** Hover, idle, and inactive lens buttons keep the paper
  palette (`--bg-elevated`, `--text-secondary`, `--bg-hover`).
- **Only `LensSelector`.** No other control — no `.filter-btn`, no status chip,
  no focus ring, no card — may reach for the plate. Those stay teal.
- **The chip is a "selected state", not a palette.** It inherits the plate's
  *meaning* (brand ground: "this is the Andromeda book's active asset class"),
  not its *darkness* (it does not signal a dark surface).

## Consequences

- The active lens chip now reads as the brand's ground and is visually distinct
  from links and the active nav tab (which stay teal), so the state selector no
  longer masquerades as an interactive link.
- `aria-pressed="true"` remains on the active button, so the state is not
  conveyed by colour alone — the accessibility contract of the control is
  unchanged (asserted by `lens-selector.test.tsx`).
- The brand-ground fence comment in `globals.css` and `tailwind.config.ts` is
  amended to name the lens chip as a third call site. A future proposal that
  wants the plate for a *fourth* surface must clear the same bar this ADR did:
  record the widening, or be rejected.
- `--accent` remains the interactive/emphasis teal for links, nav, and chips
  that are actions; the lens chip's teal is replaced only where the state, not
  an action, is shown.
