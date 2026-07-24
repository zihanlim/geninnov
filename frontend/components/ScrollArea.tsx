"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A horizontally-scrollable container that TELLS you it scrolls.
 *
 * Every wide table on this site already lived in a bare `overflow-x-auto` div, so
 * nothing ever leaked horizontal scroll to the body — but on a 375px phone that
 * clipped the right-hand columns with no indication they existed at all. On /book
 * the hidden columns were EDGE, CONV. and CAP: the entire "why" of each position.
 * A reader on a phone saw a ticker and a notional and reasonably concluded that
 * was the whole row.
 *
 * Clipping silently is the same failure as a chart with no axis — the number is
 * there, the reader just can't know to look. So: fade the clipped edge, and say
 * "swipe" the first time there is something to swipe to. Both are driven by
 * measured scroll state, so they never claim scrollability that isn't there.
 */
export function ScrollArea({
  children,
  className = "",
  frameClassName = "",
  hint = true,
}: {
  children: ReactNode;
  /** Extra classes for the scrolling element itself. */
  className?: string;
  /**
   * Extra classes for the outer positioned wrapper. Pass the same rounding as
   * the inner frame (e.g. "rounded-[10px]" alongside a `card`) so the edge fades
   * are clipped to the corners instead of painting over them.
   */
  frameClassName?: string;
  /** Show the one-time "swipe" affordance. Off for small/among-many tables. */
  hint?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 2px slack: sub-pixel layout leaves scrollWidth a hair over clientWidth on
    // tables that fit exactly, which would otherwise show a permanent fade.
    const canScroll = el.scrollWidth > el.clientWidth + 2;
    setOverflows(canScroll);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    // ResizeObserver catches both viewport changes and late-arriving table rows
    // (every one of these tables renders empty first, then fills from Supabase).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const showHint = hint && overflows && atStart;

  return (
    <div className={`relative min-w-0 overflow-hidden ${frameClassName}`}>
      <div
        ref={ref}
        onScroll={measure}
        className={`overflow-x-auto min-w-0 ${className}`}
      >
        {children}
      </div>

      {/* Edge fades — pointer-events-none so they never eat a tap or a drag. */}
      {overflows && !atStart ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg-surface to-transparent"
        />
      ) : null}
      {overflows && !atEnd ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg-surface to-transparent"
        />
      ) : null}

      {showHint ? (
        <div
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1
                     rounded-full bg-bg-primary/95 border border-border px-1.5 py-0.5
                     text-[9px] uppercase tracking-[0.1em] text-text-tertiary shadow-sm"
        >
          swipe <span className="text-[10px] leading-none">→</span>
        </div>
      ) : null}
    </div>
  );
}
