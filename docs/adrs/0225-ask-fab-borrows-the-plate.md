# ADR-0225: The bottom-right Ask button borrows the plate

## Context

`/ask` (L8) is the reader-facing "ask the published book" capability. Its
floating access point was a single TopBar control (`AskDock`) that owned the
`open` state and rendered one `AskWindow` (bottom-right, `keepMounted`,
`AskConsole compact`).

The owner asked for a second way to reach Ask: an "Ask" button fixed at the
bottom-right of the screen — the chat-launcher convention. Because
`AskConsole` deliberately keeps no history (ADR-0087) and every turn costs two
LLM calls on the same MiniMax quota the nightly book spends (three when a
first answer fails its citation check), a *second* window would have been a
second place the ADR's refusals could be quietly relaxed. The only correct
shape is **one window, two switches**.

## Decision

- Lift the Ask `open` state into a client `AskProvider` in the root layout.
  `AskDock` (TopBar) and a new bottom-right "Ask" pill both read/write that one
  state; `AskProvider` renders the single `AskWindow`.
- The bottom-right pill is a navy `--logo-plate` (`#161b38`) pill with white ink
  and a message icon, fixed above the live-feed ribbon (`--feed-h`), `z-50`
  (below the floating windows' `Z_BASE = 60`). It carries `aria-expanded` and
  `aria-controls="ask-window-body"`, so it is not state-by-colour alone.
- This is a fourth call site of the plate — the mark, the masthead, the active
  lens chip (ADR-0224), and now the Ask pill. It is a *state/launcher* control,
  not a palette; `--accent` stays teal for links, nav, and action chips.

## Consequences

- Ask is reachable from anywhere, in the corner the chat-widget convention puts
  it, without duplicating a paid-for transcript or a second copy of `AskConsole`.
- The plate fence widens to a fourth surface; the `globals.css`,
  `tailwind.config.ts`, and `design-goals.md` goal-4 comments are amended to
  name the Ask pill as a call site. A fifth proposal must clear the same bar.
- The Ask window and the FAB both live at body level via the root layout, which
  does not remount across client-side navigations, so the window survives route
  changes — the same guarantee `FloatingWindow` already relies on.
