"use client";
// frontend/components/live/LiveNewsDock.tsx
//
// The TopBar control that opens the live news window.
//
// IT IS NOT A POPOVER. A popover is a thing you dismiss by looking away, and
// every nav link is an outside `pointerdown` — so "leave it running and go read
// /book", the one reason to have a TV at all, was the one thing that closed it.
// It opens `LiveNewsWindow`: persistent, draggable, collapsible, closed only when
// told to. `Ask` reached the same conclusion for a different reason (an unsaved
// transcript that cost real LLM quota), so the popover has no consumers left and
// was deleted rather than kept as dead scaffolding.
//
// The two controls share `RibbonControl` for their LOOK, so they read as the same
// kind of thing side by side, and `FloatingWindow` for their behaviour.
//
// `open` lives here rather than in the window because this component is inside
// `TopBar`, which `app/layout.tsx` renders — and the App Router does not remount a
// layout across client-side navigation. So the state, and the playing iframe,
// survive a route change for free.

import { useState } from "react";
import RibbonControl from "@/components/RibbonControl";
import LiveNewsWindow from "./LiveNewsWindow";

export default function LiveNewsDock({ runDate }: { runDate?: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RibbonControl
        label="Live news"
        active={open}
        aria-expanded={open}
        aria-controls="live-news-window-body"
        onClick={() => setOpen((o) => !o)}
        icon={
          // Decorative: the control's `aria-label` already names it.
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
        }
      />
      <LiveNewsWindow open={open} onClose={() => setOpen(false)} runDate={runDate} />
    </>
  );
}
