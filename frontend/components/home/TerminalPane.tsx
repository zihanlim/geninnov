"use client";
import { useEffect, useRef } from "react";

/**
 * One pane of the `/` terminal (ADR-0103).
 *
 * WHY THIS IS A COMPONENT AND NOT A CLASSNAME. ADR-0103 bought its viewport lock with
 * four constraints, and two of them are properties of every pane rather than of the page:
 * the inner scroller must exist ONLY at `lg` and above, and every pane must be
 * addressable by hash. Written at each call site they would drift apart within a week —
 * a pane with a bare `overflow-y-auto` would trap mobile in a 200px scroller, which is
 * the failure the `lg:` prefix exists to prevent and the one nobody would notice on a
 * desktop screenshot. Encoded here, there is one place to get it right and one place to
 * test it.
 *
 * THE SCROLLER IS `lg:` GATED, DELIBERATELY. Below 1024px this renders as ordinary
 * content in ordinary page flow: no fixed height, no inner scroll. `tests/unit/
 * terminal-pane.test.tsx` asserts the gate is present and that no ungated
 * `overflow-y-auto` survives, because that single missing prefix is the whole difference
 * between "terminal on desktop" and "broken on mobile".
 *
 * `min-h-0` IS LOad-BEARING. A flex or grid child defaults to `min-height: auto`, which
 * refuses to shrink below its content — so without it the pane grows to fit its rows and
 * pushes the locked shell taller than the viewport, and the inner scroller never
 * engages. It is on both the pane and the scroll body.
 */

export interface TerminalPaneProps {
  /** Stable hash target. ADR-0103 constraint 3 — deep links were half the cost of the lock. */
  id: string;
  title: string;
  /** Right-aligned figure or count. Kept mono; it is a value, not prose (design goal 6). */
  meta?: React.ReactNode;
  /** Grid placement, e.g. "lg:col-span-2". Layout belongs to the caller, chrome does not. */
  className?: string;
  /**
   * The child already renders its own `card` + `card-header`.
   *
   * Every component this page panes — `ThemeHeatmap`, `NewsFeed`, `PredictionMarkets`,
   * `DiscoveredThemes` — is a self-contained card with its own heading and its own
   * metadata (run date, source, dimension count). Wrapping one in this component's chrome
   * produced **two headers per pane**, the second restating the first, costing ~40px each
   * of the one resource a locked shell has none of. It was invisible in every assertion
   * and obvious in the first screenshot.
   *
   * In `bare` mode this contributes only what the grid needs — sizing, the hash target,
   * and the `lg:`-gated scroller — and lets the child be the card. `title` is still
   * required: it becomes the accessible name, which the child's visual heading does not
   * supply to assistive tech at the section level.
   */
  bare?: boolean;
  children: React.ReactNode;
}

export default function TerminalPane({
  id,
  title,
  meta,
  className = "",
  bare = false,
  children,
}: TerminalPaneProps) {
  const ref = useRef<HTMLElement | null>(null);

  // Honour `#pane` on load and on hashchange. At lg the pane is a grid cell and already
  // on screen, so this is a no-op there; below lg, where the page scrolls normally, it is
  // what makes a deep link land. `block: "nearest"` rather than "start" so it never
  // scrolls a pane that is already fully visible.
  useEffect(() => {
    const focusIfTargeted = () => {
      if (typeof window === "undefined") return;
      if (window.location.hash !== `#${id}`) return;
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    focusIfTargeted();
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, [id]);

  if (bare) {
    return (
      <section
        ref={ref}
        id={id}
        aria-label={title}
        // No `lg:overflow-y-auto` any more. A pane that scrolls inside a locked
        // shell has to guess a height for its content, and every guess was wrong:
        // the regime pane clipped "FACTOR TILT OF BOO" and rendered its factor
        // values as "+0"/"-0" with BOTH a vertical and a horizontal scrollbar.
        // Panes now size to their content and the PAGE scrolls, so nothing is
        // truncated and there is one scroll context instead of six.
        className={`flex flex-col mb-4 lg:mb-0 ${className}`}
      >
        {children}
      </section>
    );
  }

  return (
    <section
      ref={ref}
      id={id}
      aria-label={title}
      className={`card flex flex-col mb-4 lg:mb-0 target:ring-1 target:ring-accent ${className}`}
    >
      <div className="card-header shrink-0 flex-wrap gap-2">
        <span className="card-title">{title}</span>
        {meta ? (
          <span className="num text-[11px] text-text-tertiary">{meta}</span>
        ) : null}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}
