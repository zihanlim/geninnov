// frontend/components/DisclosureChevron.tsx
//
// The one disclosure caret. Every collapsible surface points here.
//
// Before this, the codebase had two disclosure idioms and a bug spread across
// both. Six components imported `ChevronRight` from lucide directly and styled it
// `className="text-[10px] …"` — which does nothing to an SVG, because lucide sizes
// via `width`/`height` attributes and defaults to 24. So every one of those
// chevrons rendered at 24x24 beside 11px text (measured), roughly double the size
// the author was asking for. Meanwhile two other panels used Unicode glyphs
// (`▸`/`▾`) that a state-driven button toggled by swapping the character.
//
// One component fixes both: an explicit `size`, and rotation that works whether
// the disclosure is a native <details> or React state.
//
// NOT for direction arrows. The `▲`/`▼` glyphs in MarketBar, DeltaChip,
// ScoreDeltaBadge and ThemeDerivationDrawer are DATA — they encode the sign of a
// number and sit inline in tabular-mono text. DeltaChip already carries a comment
// about an arrow that contradicted its own number. Swapping those for SVGs risks
// re-opening that and misaligns them against the digits they annotate, so they
// stay as text.

import { ChevronRight } from "lucide-react";

export function DisclosureChevron({
  open,
  className = "",
}: {
  /**
   * Omit inside a `<details>`: rotation follows the parent's `group-open` state
   * in CSS, so it works before hydration. Pass a boolean when a `useState`
   * drives the disclosure instead, where no such selector exists.
   */
  open?: boolean;
  className?: string;
}) {
  const rotate =
    open === undefined ? "group-open:rotate-90" : open ? "rotate-90" : "";
  return (
    <ChevronRight
      size={14}
      aria-hidden="true"
      className={`shrink-0 transition-transform ${rotate} ${className}`.trim()}
    />
  );
}
