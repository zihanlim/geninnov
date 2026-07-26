"use client";
// frontend/components/live/LiveNewsDock.tsx
//
// Live news as a floating window, opened from an icon at the top right.
//
// WHY IT LEFT THE GRID. As a pane it occupied a full cell for something that is
// explicitly NOT a source this book is built on — no figure on the site traces
// to a stream and /ask cannot quote one. A permanent cell is the layout saying
// "this is one of the things we publish", which is the opposite of true. A
// toggle says what it is: available, off to the side, and off by default.
//
// Closed by default and it renders NOTHING while closed — the player is a
// third-party frame, so a closed dock makes no request to YouTube at all. That
// is the same property the pane advertised, kept rather than lost in the move.

import { useEffect, useRef, useState } from "react";
import LiveNews from "./LiveNews";

export default function LiveNewsDock({ runDate }: { runDate?: string | null }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes and returns focus to the control that opened it — a floating
  // panel a keyboard cannot dismiss is a trap (goal 8).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A click outside closes it. Pointerdown rather than click so it fires before
  // the target's own handler, and the button is excluded so its toggle is not
  // cancelled by its own event.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="live-news-dock"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-[11px] uppercase tracking-[0.1em] text-text-secondary hover:text-accent hover:border-border-strong transition-colors whitespace-nowrap"
      >
        {/* Decorative: the word beside it already names the control, so a second
            announcement would just be noise. */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect
            x="0.75"
            y="1.75"
            width="10.5"
            height="8.5"
            rx="1.25"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M4.75 4.5L8 6L4.75 7.5V4.5Z" fill="currentColor" />
        </svg>
        Live news
      </button>

      {open && (
        <div
          ref={panelRef}
          id="live-news-dock"
          role="dialog"
          aria-modal="false"
          aria-label="Live news broadcasts"
          // Right-anchored so it opens inward from the top-right control and
          // cannot push the page sideways. max-h + overflow keeps a long channel
          // list inside the panel instead of off the bottom of the screen — this
          // is a floating window, which is the one place an inner scroller is the
          // correct answer rather than a workaround.
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(92vw,460px)] max-h-[min(70vh,560px)] overflow-y-auto card shadow-lg p-0"
        >
          <LiveNews runDate={runDate} />
        </div>
      )}
    </div>
  );
}
