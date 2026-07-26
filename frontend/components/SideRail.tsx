"use client";
// frontend/components/SideRail.tsx
//
// The persistent left rail (ADR-0086). Collapsed 56px by default, expandable to
// 200px, choice persisted.
//
// WHY 56px COLLAPSED, and why that is not negotiable: the two-pane layout on
// /book needs 2 x BOOK_ROW_MIN_W + gap = 1,304px of content, which is 91% of a
// 1,425px viewport (a 1440 window after Windows Chrome's classic scrollbar).
// 56px is the widest rail that still leaves room for it. 64px does not fit;
// neither does the comps' own 72px.
//
// NO ICONS, deliberately. The non-goal this amends objects to UNLABELLED glyph
// rails, so the label IS the rail — and our destinations are short enough for
// that to work at 56px where the comps' were not (theirs clipped DASHBOARD and
// INTELLIGENCE to "ASHBOAR" and "NTELLIGENCE"). Adding an icon above a label
// would cost vertical space and a dependency to say the same thing twice.
//
// The rail is hidden below `wide`. Below that breakpoint there is no two-pane
// layout to protect, but there is also not enough width to spend on chrome —
// and TopBar's nav is shown instead, so navigation never disappears.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const DESTINATIONS = [
  { href: "/", label: "Themes" },
  { href: "/book", label: "Book" },
  { href: "/risk", label: "Risk" },
  { href: "/method", label: "Method" },
];

const STORAGE_KEY = "andromeda:rail-expanded";

export default function SideRail() {
  const pathname = usePathname();
  // Collapsed is the SERVER-RENDERED default. Reading localStorage during
  // render would produce one value on the server and another in the browser —
  // the hydration-mismatch class of bug TopBar.tsx already documents for clock
  // values. So the preference is applied in an effect, after mount.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setExpanded(true);
    } catch {
      // Private mode or blocked storage: stay collapsed. A preference that
      // cannot be read is not an error worth surfacing.
    }
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* preference simply will not persist */
      }
      return next;
    });
  };

  return (
    <nav
      aria-label="Sections of the product"
      className={`hidden wide:flex flex-col shrink-0 border-r border-border bg-bg-primary sticky top-14 h-[calc(100vh-56px)] transition-[width] duration-150 ${
        expanded ? "w-[200px]" : "w-[56px]"
      }`}
    >
      <ul className="list-none m-0 p-2 flex flex-col gap-1">
        {DESTINATIONS.map((d) => {
          const active =
            d.href === "/" ? pathname === "/" : pathname?.startsWith(d.href);
          return (
            <li key={d.href}>
              {/* aria-current="page" lives here AND on TopBar's nav, but only one
                  is ever in the accessibility tree: TopBar's list is `wide:hidden`
                  and this rail is `hidden wide:flex`, and display:none removes a
                  subtree from the tree entirely. Two visible elements both
                  claiming to be the current page would be a lie to a screen
                  reader — the same rule SectionNav follows by using "location". */}
              <Link
                href={d.href}
                aria-current={active ? "page" : undefined}
                title={expanded ? undefined : d.label}
                className={`block rounded-md text-[11px] font-medium transition-colors ${
                  expanded ? "px-3 py-2 text-[13px] text-left" : "px-1 py-2 text-center"
                } ${
                  active
                    ? "text-text-primary bg-bg-elevated"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                }`}
              >
                {d.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="mt-auto m-2 px-2 py-2 rounded-md border border-border text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
      >
        {/* Names the CONSEQUENCE, not just the direction, because expanding
            costs the two-pane layout below a 1,568px viewport (ADR-0086) and a
            reader should not discover that by watching the page reflow. */}
        {expanded ? "‹ Narrow" : "›"}
        <span className="sr-only">
          {expanded
            ? "Collapse the rail to 56 pixels, which restores the side-by-side position tables"
            : "Expand the rail to 200 pixels, which stacks the position tables on narrower screens"}
        </span>
      </button>
    </nav>
  );
}
