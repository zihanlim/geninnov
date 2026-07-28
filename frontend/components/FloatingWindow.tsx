"use client";
// frontend/components/FloatingWindow.tsx
//
// A persistent, draggable, collapsible window: the shared behaviour behind the
// `Live news` TV and the `Ask` console.
//
// WHY THESE ARE WINDOWS AND NOT POPOVERS. A popover dismisses on any outside
// `pointerdown` — and every nav link is an outside pointerdown, so the one
// interaction both of these exist for ("leave it open, go read /book") was the
// one interaction that destroyed them. These close only when told to.
//
// WHY THEY SURVIVE NAVIGATION. `TopBar` is rendered by `app/layout.tsx`, and the
// App Router does not remount a layout on a client-side route change — so a
// window mounted from there, its state, and anything inside it persist across
// /book, /risk and /method with no global store. A hard reload resets them; that
// is a page load, not a navigation.
//
// WHY THEY PORTAL TO `document.body`. Not stylistic. `TopBar` carries
// `backdrop-blur-md`, and an element with a `backdrop-filter` becomes the
// CONTAINING BLOCK for `position: fixed` descendants — so rendered inside the
// header a "fixed" window is trapped in a 56px bar. The portal is what makes
// `fixed` mean fixed.
//
// `keepMounted` IS THE ONE REAL DIFFERENCE BETWEEN THE TWO CONSUMERS, and it is a
// deliberate switch rather than an accident of implementation:
//
//   • `Live news` leaves it OFF. Closing or collapsing UNMOUNTS the player, so a
//     collapsed tab is as quiet as a closed panel — that is ADR-0104's "no request
//     to Google until you open it", preserved. A `display:none` iframe would still
//     be a live third-party frame.
//   • `Ask` turns it ON. Its transcript is never written anywhere (ADR-0087: no
//     persistence), and every turn costs two LLM calls on the SAME MiniMax quota
//     the nightly book uses — three when a first answer fails its citation check. Unmounting on close would mean a stray click destroys
//     answers that were paid for. Hidden, not discarded.
//
// So one flag encodes "cheap to rebuild, expensive to keep" versus "expensive to
// rebuild, cheap to keep", which is the actual difference between a broadcast and
// a paid-for answer.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
/** TopBar is `h-14`. A top-anchored window opens just below it. */
const HEADER_H = 56;
/** Above TopBar's z-50. Windows stack from here upward. */
const Z_BASE = 60;

/**
 * Shared stacking counter — the most recently touched window renders on top.
 *
 * This is not polish. Two windows on one screen edge WILL overlap: opposite
 * corners only separate them if both are short, and an expanded TV at top-right
 * is tall enough to reach a bottom-right console on a 900px viewport. Measured,
 * it covered that console's close button outright, so the reader could see a
 * window they could not dismiss — which is the trap goal 8 is about, arrived at
 * from the other direction. Click-to-front is also simply what a window manager
 * does, and both of these are draggable, so a reader can always stack them
 * deliberately.
 */
let zCounter = Z_BASE;

interface Pos {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Height of the fixed pipeline-status ribbon (`LiveFeed`) along the bottom edge.
 * Read from the `--feed-h` custom property rather than hardcoded, for the reason
 * globals.css gives where it declares it: pages already pad themselves with
 * `pb-[var(--feed-h)]`, so the number cannot drift out of sync. Without this a
 * bottom-anchored window sits ON the ribbon — measured, at both 1440 and 375.
 */
function feedInset(): number {
  if (typeof window === "undefined") return 30;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--feed-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 30;
}

export interface FloatingWindowProps {
  /** Storage namespace and test id. Must be unique per window. */
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onClose: () => void;
  /** Where it sits before the reader drags it. Dragging overrides this for good. */
  corner?: "bottom-right" | "top-right";
  /** Expanded width utilities. */
  widthClass?: string;
  /** Body height utilities. */
  bodyClass?: string;
  /** Keep children mounted (hidden) when closed or collapsed. See the note above. */
  keepMounted?: boolean;
  children: React.ReactNode;
}

export default function FloatingWindow({
  id,
  title,
  icon,
  open,
  onClose,
  corner = "bottom-right",
  widthClass = "w-[min(94vw,440px)]",
  bodyClass = "max-h-[70vh]",
  keepMounted = false,
  children,
}: FloatingWindowProps) {
  const POS_KEY = `andromeda.win.${id}.pos`;
  const COLLAPSED_KEY = `andromeda.win.${id}.collapsed`;

  // Portals need a DOM. Rendering nothing on the server and on the first client
  // pass keeps hydration identical on both sides; storage is read in an effect
  // for the same reason.
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 0 = never raised yet; renders at Z_BASE until it is. */
  const [z, setZ] = useState(0);
  const zRef = useRef(0);
  const boxRef = useRef<HTMLElement | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  /** Has this open-cycle already chosen a default collapse state? */
  const decided = useRef(false);
  /**
   * The reader's own collapse preference, or null if they have never expressed
   * one. Read ONCE on mount and written ONLY by the toggle — never by an effect
   * on `collapsed`. An effect was the first implementation and it was wrong: it
   * fired on mount with the initial `false` and overwrote the stored value before
   * the open handler could read it, so "no preference yet" was unreachable and
   * the phone default below could never fire.
   */
  const storedCollapsed = useRef<string | null>(null);

  useEffect(() => {
    try {
      storedCollapsed.current = window.localStorage.getItem(COLLAPSED_KEY);
      const raw = window.localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Pos;
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(p);
      }
    } catch {
      /* a corrupt or blocked store just means the defaults */
    }
    setMounted(true);
  }, [POS_KEY, COLLAPSED_KEY]);

  // On each open, decide the default collapse state. Phones open COLLAPSED: a
  // full window is most of a 375px screen, and a window that buries the page is
  // not a window a reader keeps.
  useEffect(() => {
    if (!open) {
      decided.current = false;
      return;
    }
    if (decided.current) return;
    decided.current = true;
    const stored = storedCollapsed.current;
    setCollapsed(stored !== null ? stored === "1" : window.innerWidth < 640);
  }, [open]);

  /**
   * Raise above every other window. Called on open and on any pointer touch.
   *
   * The first version guarded with `current === zCounter ? current : ++zCounter`
   * and was a permanent no-op: both windows START at the counter's value, so the
   * guard was true immediately, the counter never advanced, and BOTH sat at the
   * same z — leaving DOM order to decide, which is precisely what this exists to
   * override. Starting at 0 ("never raised") makes the first raise real.
   *
   * The counter is bumped outside the state updater deliberately: React invokes
   * updaters twice under StrictMode, and a mutation in there would double-count.
   */
  const bringToFront = useCallback(() => {
    if (zRef.current === zCounter) return; // already on top
    zCounter += 1;
    zRef.current = zCounter;
    setZ(zCounter);
  }, []);

  // A window that has just been opened should be the one you are looking at,
  // even if the other was raised more recently.
  useEffect(() => {
    if (open) bringToFront();
  }, [open, bringToFront]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      storedCollapsed.current = next ? "1" : "0";
      try {
        window.localStorage.setItem(COLLAPSED_KEY, storedCollapsed.current);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [COLLAPSED_KEY]);

  // Keep it on screen: after a resize, after collapsing (the box changes size
  // under a position pinned for the other one), and after a rotation. Without
  // this, a window dragged to the right edge of a desktop is simply gone on a
  // narrower viewport.
  const clampIntoView = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    setPos((p) => {
      if (!p) return p;
      const maxX = Math.max(MARGIN, window.innerWidth - el.offsetWidth - MARGIN);
      const maxY = Math.max(
        HEADER_H,
        window.innerHeight - el.offsetHeight - MARGIN - feedInset(),
      );
      const next = { x: clamp(p.x, MARGIN, maxX), y: clamp(p.y, HEADER_H, maxY) };
      return next.x === p.x && next.y === p.y ? p : next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    clampIntoView();
    window.addEventListener("resize", clampIntoView);
    return () => window.removeEventListener("resize", clampIntoView);
  }, [open, collapsed, clampIntoView]);

  useEffect(() => {
    if (!mounted || !pos) return;
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos, mounted, POS_KEY]);

  function onPointerDown(e: React.PointerEvent) {
    // Left button / touch only, and never from the buttons in the title bar.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Switch from corner-anchored to absolutely positioned at the CURRENT spot,
    // so the first drag does not make it jump.
    setPos({ x: r.left, y: r.top });
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!grab.current) return;
    const el = boxRef.current;
    if (!el) return;
    const maxX = Math.max(MARGIN, window.innerWidth - el.offsetWidth - MARGIN);
    const maxY = Math.max(
      HEADER_H,
      window.innerHeight - el.offsetHeight - MARGIN - feedInset(),
    );
    setPos({
      x: clamp(e.clientX - grab.current.dx, MARGIN, maxX),
      y: clamp(e.clientY - grab.current.dy, HEADER_H, maxY),
    });
  }

  function endDrag(e: React.PointerEvent) {
    if (!grab.current) return;
    grab.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* the capture may already be gone */
    }
  }

  if (!mounted) return null;
  if (!open && !keepMounted) return null;

  // Corner-anchored until dragged. Expressed inline rather than as classes so the
  // two positioning modes cannot both apply at once.
  const placement: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : corner === "top-right"
      ? { right: MARGIN, top: HEADER_H + MARGIN }
      : { right: MARGIN, bottom: MARGIN + feedInset() };

  const bodyId = `${id}-window-body`;

  return createPortal(
    <aside
      ref={boxRef as React.RefObject<HTMLElement>}
      aria-label={title}
      data-testid={`${id}-window`}
      data-floating-window={id}
      style={{ ...placement, zIndex: z || Z_BASE }}
      hidden={!open}
      // Capture phase: raising must happen even when the pointer lands on a
      // control inside the window, and before the drag handler runs.
      onPointerDownCapture={bringToFront}
      // z-60 clears TopBar (z-50). NOT a modal: it takes no focus, traps nothing,
      // and leaves the page fully usable underneath — so it is an `aside`, not a
      // `dialog`, and Escape is not bound. Close and collapse are ordinary
      // focusable buttons.
      className={`fixed rounded-[10px] border border-border bg-bg-surface shadow-lg overflow-hidden ${
        collapsed ? "w-auto" : widthClass
      } ${dragging ? "select-none" : ""} ${!open ? "pointer-events-none" : ""}`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // `touch-none` so a touch drag moves the window instead of scrolling the
        // page underneath it.
        className={`flex items-center gap-2 px-2.5 py-1.5 bg-bg-elevated border-b border-border touch-none ${
          collapsed ? "border-b-0" : ""
        } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <span aria-hidden className="shrink-0 text-text-tertiary inline-flex">
          {icon}
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.1em] font-semibold text-text-tertiary whitespace-nowrap mr-auto">
          {title}
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          className="shrink-0 rounded px-1.5 py-0.5 text-[13px] leading-none text-text-secondary hover:text-text-primary hover:bg-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          ×
        </button>
      </div>

      {/* `keepMounted` decides whether collapsing HIDES the body or DESTROYS it.
          For the player that distinction is the privacy guarantee; for the Ask
          transcript it is the difference between hiding an answer and binning
          one that cost two or three LLM calls. */}
      {keepMounted ? (
        <div id={bodyId} hidden={collapsed} className={`${bodyClass} overflow-y-auto`}>
          {children}
        </div>
      ) : (
        !collapsed && (
          <div id={bodyId} className={`${bodyClass} overflow-y-auto`}>
            {children}
          </div>
        )
      )}
    </aside>,
    document.body,
  );
}
