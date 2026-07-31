"use client";
// frontend/components/book/PositionDrawer.tsx
//
// One position's detail, as a fixed overlay beside the book.
//
// WHY NOT INLINE. The detail panel is ~1200px tall. Opened inside the table it
// pushed every row below it down the page, and the full-width variant that
// preceded this made the OTHER side's table jump to a new row — the reader
// clicked one thing and the whole page rearranged around them. `position: fixed`
// is the only version where nothing below moves at all, which is the property
// this exists for.
//
// WHY A DRAWER AND NOT A CENTRED MODAL. Both avoid the reflow. A right-hand
// drawer additionally leaves the book itself on screen, so a reader can read one
// position against the row above it — which is the comparison /book is for, and
// the thing a centred box covering the table takes away.
//
// WHAT A MODAL WOULD HAVE COST, and what this keeps instead:
//   - DEEP LINK. The open position lives in the URL as `?position=TICKER`, so
//     /book?lens=credit&position=EMB opens the book AND the position. That is
//     new: inline expansion kept the open row in component state only, so it
//     could never be sent to anyone. router.REPLACE, not push, so nine clicks
//     do not become nine back-button steps.
//   - CTRL-F. The page behind stays rendered and is not marked inert, so a
//     browser find still reaches the table.
//   - SCROLL POSITION. No body-scroll lock. Locking would collapse the
//     scrollbar and shift the page underneath by its width, which is the exact
//     movement this component exists to avoid.

import { useEffect, useRef } from "react";

export default function PositionDrawer({
  open,
  title,
  subtitle,
  accent,
  onClose,
  children,
}: {
  open: boolean;
  /** The ticker. Announced, and shown as the drawer's heading. */
  title: string;
  /** Direction + theme, e.g. "Short · Geopolitical Risk". */
  subtitle?: string;
  /** `var(--long)` or `var(--short)` — the same ink the row uses. */
  accent?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when the drawer opened, so it can be given back. Without
  // this a keyboard reader is returned to the top of the document on close and
  // has to walk back down to the row they were reading.
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Only restore if focus is still inside the drawer — if the reader has
      // clicked somewhere else entirely, yanking them back is worse.
      if (panelRef.current?.contains(document.activeElement)) {
        restoreTo.current?.focus?.();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim. Dims the book without hiding it — the reader can still see which
          row they came from. Click closes; `aria-hidden` because the close
          button below is the accessible control. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/25"
        data-testid="position-drawer-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={`${title} — position detail`}
        data-testid="position-drawer"
        // `w-[min(920px,94vw)]`: wide enough that the paired cards inside
        // (thesis / counter-thesis, EdgeScore / sizing) sit side by side rather
        // than stacking — the measurement that made the inline half-width
        // version 1484px tall. At 1440 this leaves ~460px of book visible.
        className="fixed right-0 top-0 bottom-0 z-50 w-[min(920px,94vw)] bg-bg-primary border-l border-border shadow-2xl flex flex-col"
      >
        <div
          className="flex items-baseline gap-3 px-5 py-3 border-b border-border shrink-0"
          style={{ borderTopColor: accent }}
        >
          <span
            className="text-[15px] font-semibold num"
            style={{ color: accent }}
          >
            {title}
          </span>
          {subtitle && (
            <span className="text-[12px] text-text-secondary truncate">{subtitle}</span>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 text-[12px] text-text-tertiary hover:text-text-primary border border-border rounded px-2 py-1"
          >
            Close <span aria-hidden="true">esc</span>
          </button>
        </div>
        {/* The panel scrolls, not the page. */}
        <div className="overflow-y-auto grow">{children}</div>
      </div>
    </>
  );
}
