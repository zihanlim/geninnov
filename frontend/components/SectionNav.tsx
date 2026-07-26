"use client";
// frontend/components/SectionNav.tsx
//
// In-page section navigation for the long routes. This exists because the four
// pages measured 29 screens of scroll between them and offered no way to jump —
// /method alone was 14.5 screens with zero anchors surfaced in the UI.
//
// Deliberate non-features:
//
//   * It renders NO figure, ever. A count or a score in a nav item is a number a
//     reader cannot trace back to a source (goal 1), and it would go stale
//     against the panel it labels. Labels are nouns. `section-nav.test.tsx`
//     asserts no rendered label matches /\d/.
//   * It does not cage the page. This is a sticky strip over normal document
//     flow, not a viewport shell — full-page scroll, Ctrl+F and deep links all
//     keep working (goal 7).
//   * It introduces no colour. The active/idle class pairs are copied
//     byte-for-byte from TopBar.tsx:95-99.
//
// It sets aria-current="location", NOT "page" — TopBar already owns "page" for
// the route, and two elements claiming to be the current *page* is a lie to a
// screen reader. "location" is the correct value for a position within a page.

import { useEffect, useMemo, useState } from "react";

export type SectionNavItem = { id: string; label: string };

/** Height of TopBar (56) + this nav (44) + 4px of air. Kept in step with the
 *  `html { scroll-padding-top }` rule in globals.css — if these two disagree,
 *  an anchored heading lands underneath one of the two sticky bars. */
const STICKY_OFFSET_PX = 104;

export default function SectionNav({ items }: { items: SectionNavItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  // Callers pass an inline array literal, whose identity changes every render.
  // Keying the effect on the ids themselves stops the observer being torn down
  // and rebuilt on every parent re-render.
  const idKey = useMemo(() => items.map((i) => i.id).join("|"), [items]);

  useEffect(() => {
    const ids = idKey ? idKey.split("|") : [];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const visible = new Set<string>();

    const pick = () => {
      // Bottom-of-page special case. The last section can never win the top band
      // when the page has run out of scroll to bring it there, so without this
      // the final nav item is unreachable as an active state — the reader
      // scrolls to the very end and the nav still highlights the one before.
      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 8;
      if (atBottom) {
        setActive(ids[ids.length - 1] ?? null);
        return;
      }
      // Document order, not intersection-ratio order: when two sections are both
      // in the band the upper one is the one the reader is still in.
      const first = ids.find((id) => visible.has(id));
      if (first) setActive(first);
    };

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pick();
      },
      // Top edge pulled down past both sticky bars, bottom edge pulled up to 30%
      // of the viewport, so "active" means "at the top of what you are reading"
      // rather than "anywhere on screen".
      { rootMargin: `-${STICKY_OFFSET_PX}px 0px -70% 0px` },
    );

    els.forEach((el) => obs.observe(el));
    window.addEventListener("scroll", pick, { passive: true });
    pick();

    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", pick);
    };
  }, [idKey]);

  if (items.length === 0) return null;

  // The -mx/px full-bleed must track the page <main> gutter at EVERY breakpoint.
  // <main> adds wide:px-5 (ADR-0086's narrowed wide gutter); without a matching
  // wide:-mx-5 here the strip kept bleeding lg:-mx-8 (32px) against that 20px
  // gutter and pushed the body 12px wide at >=1424 — a real horizontal scroll on
  // /book, /risk, /method that a headless 1440 pass (no scrollbar) narrowly hid.
  return (
    <nav
      aria-label="Sections"
      className="sticky top-14 z-40 -mx-4 sm:-mx-6 lg:-mx-8 wide:-mx-5 px-4 sm:px-6 lg:px-8 wide:px-5 mb-5 border-b border-border bg-bg-primary/85 backdrop-blur-md"
    >
      {/* scrollbar-none: this is chrome, not a data table — it should still pan
          on a phone but has no business advertising a scrollbar. See globals.css. */}
      <div className="flex gap-1 h-11 items-center overflow-x-auto scrollbar-none">
        {items.map((item) => (
          // A real <a href="#id">, not an onClick handler: copy-link, middle-click
          // and JS-off all have to work, and the browser's own fragment handling
          // is what honours scroll-padding-top.
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active === item.id ? "location" : undefined}
            className={`px-2.5 sm:px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors whitespace-nowrap ${
              active === item.id
                ? "text-text-primary bg-bg-elevated"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
