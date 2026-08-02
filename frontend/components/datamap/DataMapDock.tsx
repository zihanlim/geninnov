"use client";
// frontend/components/datamap/DataMapDock.tsx
//
// The TopBar control that links to /datamap.
//
// /datamap is a real destination, not a panel — unlike Ask and Live news, the
// click NAVIGATES rather than opens a window. It is a Link wrapping the same
// `RibbonControl` look the other two tools use, so the three controls read as
// one cluster side by side. `aria-current="page"` is set when the route is
// active, so the destination gets the same focus state the TopBar tabs do
// without changing the four-destination nav rule.
//
// Like /method and /facts this entry is not in `lib/method/phases.ts` — it is
// a cross-cutting explanation of the system, not a PM phase. The four-destination
// rule lives in design-goals.md, and adding a fifth tab would claim /datamap is
// a peer of /book, which it is not. A TopBar tool is the right tier: it is
// always visible, costs no nav slot, and links to a real route the reader can
// Ctrl+F and deep-link.

import Link from "next/link";
import { usePathname } from "next/navigation";
import RibbonControl from "@/components/RibbonControl";

export default function DataMapDock() {
  const pathname = usePathname();
  // Active on /datamap itself and any future sub-route the page may grow.
  const active = pathname === "/datamap" || (pathname?.startsWith("/datamap/") ?? false);

  return (
    <Link
      href="/datamap"
      // The Link carries the destination; the RibbonControl is a styled
      // <button> for keyboard semantics on Ask and Live news. Wrapping the
      // button in a Link gives us both the styling and the nav. `aria-label`
      // stays on the control so the icon-only view is still named for screen
      // readers — the icon is decorative.
      aria-label="Data map — system overview"
      aria-current={active ? "page" : undefined}
      className="inline-block"
    >
      <RibbonControl
        label="Data map"
        active={active}
        onClick={() => {
          // No-op — the Link handles the navigation. The handler is here so
          // the control has a single, obvious affordance and TypeScript stops
          // asking us to provide one. Behaviour that wanted to STOP the
          // navigation (e.g. unsaved changes) would go here, but this control
          // has no state to lose.
        }}
        icon={
          // Three small nodes connected by two lines — the diagram this page
          // renders, in the smallest form that reads as a map. Strokes, not
          // fills, so the icon stays a single ink at every zoom.
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="2" cy="2.5" r="1.4" stroke="currentColor" strokeWidth="1" />
            <circle cx="11" cy="2.5" r="1.4" stroke="currentColor" strokeWidth="1" />
            <circle cx="6.5" cy="10.5" r="1.4" stroke="currentColor" strokeWidth="1" />
            <path d="M2.7 3.5L5.8 9.2" stroke="currentColor" strokeWidth="1" />
            <path d="M10.3 3.5L7.2 9.2" stroke="currentColor" strokeWidth="1" />
          </svg>
        }
      />
    </Link>
  );
}
