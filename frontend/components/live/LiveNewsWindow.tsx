"use client";
// frontend/components/live/LiveNewsWindow.tsx
//
// The live news TV, as a persistent floating window. Everything about being a
// window — drag, collapse, clamp, portal, persisted position — lives in
// `FloatingWindow`; this file is the two decisions specific to a broadcast.
//
// 1. `keepMounted` IS OFF, deliberately. Closing or collapsing UNMOUNTS the
//    player, so a collapsed tab is as quiet as a closed panel: no third-party
//    frame, no cookie, no referrer. That is ADR-0104's guarantee ("nothing loads
//    until you open it") kept, and on phones — which open collapsed by default —
//    the private state is also the default one. Hiding the iframe with
//    `display:none` instead would leave a live frame running behind a hidden box,
//    which spends the guarantee while appearing to honour it.
//
// 2. IT OPENS TOP-RIGHT, at the owner's direction, because `Ask` takes the
//    bottom-right corner and two windows defaulting to one corner would land on
//    top of each other. Both are draggable and remember where they were put, so
//    this only decides where they start.

import FloatingWindow from "@/components/FloatingWindow";
import LiveNews from "./LiveNews";

export default function LiveNewsWindow({
  open,
  onClose,
  runDate,
}: {
  open: boolean;
  onClose: () => void;
  runDate?: string | null;
}) {
  return (
    <FloatingWindow
      id="live-news"
      title="Live news"
      open={open}
      onClose={onClose}
      corner="top-right"
      widthClass="w-[min(94vw,440px)]"
      bodyClass="max-h-[70vh]"
      icon={
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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
    >
      <LiveNews runDate={runDate} windowed />
    </FloatingWindow>
  );
}
