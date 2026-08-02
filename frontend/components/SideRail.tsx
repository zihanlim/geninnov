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
// ICON *AND* LABEL, never icon alone. The non-goal this amends objects to
// UNLABELLED glyph rails — an icon is fine, an icon INSTEAD OF a word is not.
// Both together is redundant encoding, which is the same principle ADR-0085
// applied to direction: the word carries, the glyph reinforces, and a reader
// who does not recognise a radar dish still knows it says Themes.
//
// A full-height rail holding four items has ~700px of vertical slack, so the
// stacked icon+label costs nothing that matters. lucide-react is already a
// dependency (DisclosureChevron), so this adds no weight either.
//
// The rail is hidden below `wide`. Below that breakpoint there is no two-pane
// layout to protect, but there is also not enough width to spend on chrome —
// and TopBar's nav is shown instead, so navigation never disappears.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Ban, BookOpen, FileText, Hexagon, PanelLeftClose, PanelLeftOpen, Radar, Scale, ShieldAlert, Sigma } from "lucide-react";
import { PHASES } from "@/lib/method/phases";
import ResumeWindow from "@/components/ResumeWindow";

// ADR-0170: the rail mirrors the nav, and the nav is now the six phases. Order,
// routes and labels are read from PHASES so the rail cannot drift from the
// strip; only the ICON is chosen here, because an icon is a rendering decision
// and has no business in the phase model.
//
// Scale: the constraints a book is measured against. Radar: what the engine is
// detecting. ShieldAlert: what could hurt it. BookOpen: the published book.
// Ban: the phase this system does not perform. Sigma: what it added up to.
const ICONS: Record<string, typeof Radar> = {
  mandate: Scale,
  alpha: Radar,
  risk: ShieldAlert,
  construction: BookOpen,
  execution: Ban,
  attribution: Sigma,
};

const DESTINATIONS = PHASES.map((p) => ({
  href: p.route as string,
  // `short`, not `tab`: see the note on Phase.short — 56px of rail is ~nine
  // characters at 10px, and `Construction` clips.
  label: p.short,
  full: p.name,
  Icon: ICONS[p.id],
}));

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

  // The resume window's open state. Owned here (not in the window) because the
  // rail lives in the layout and is not remounted on a client-side navigation,
  // so the window — and the fact that it was open — survives a route change.
  const [resumeOpen, setResumeOpen] = useState(false);

  // pb-[var(--feed-h)] below is NOT a shorter h-[]. The rail runs the full
  // viewport height on purpose — its right border and ground have to meet the
  // bottom of the window, or the column stops in mid-air above the LiveFeed
  // ribbon and leaves a 30px notch in the page's only vertical rule. So the box
  // stays full height and the PADDING holds the ribbon's space: `mt-auto` on
  // the toggle then bottoms out above the bar instead of under it. Without it
  // the button's lower 21px were covered and the ribbon intercepted its click —
  // the rail could not be collapsed by mouse at all.
  return (
    <nav
      aria-label="Sections of the product"
      className={`hidden wide:flex flex-col shrink-0 border-r border-border bg-bg-primary sticky top-14 h-[calc(100vh-56px)] pb-[var(--feed-h)] transition-[width] duration-150 ${
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
                // The visible short label is the accessible name; `title` carries
                // the full phase name for a reader who wants it, without spending
                // rail width on it.
                title={d.full}
                className={`flex rounded-md font-medium transition-colors ${
                  expanded
                    ? "flex-row items-center gap-2.5 px-3 py-2 text-[13px]"
                    : "flex-col items-center gap-1 px-1 py-2 text-[10px]"
                } ${
                  active
                    ? "text-text-primary bg-bg-elevated"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                }`}
              >
                {/* aria-hidden: the label beside it is the accessible name, so
                    the glyph must not be announced twice. */}
                <d.Icon size={expanded ? 15 : 17} aria-hidden strokeWidth={1.75} />
                <span>{d.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The bottom group — the author card, then the rail toggle. `mt-auto`
          lives on the GROUP (not on the toggle), so the author card sits just
          above the Narrow button and both bottom out above the feed ribbon. */}
      <div className="mt-auto flex flex-col gap-1 p-2">
        {/* Author attribution — compact text stack. */}
        {!expanded ? (
          /* Collapsed: hexagon icon, opens resume on click */
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={() => setResumeOpen((o) => !o)}
              aria-label="Open Lim Zi Han's resume"
              className="rounded-full p-2 hover:bg-bg-hover transition-colors"
            >
              <Hexagon size={22} strokeWidth={1.75} className="text-text-tertiary" />
            </button>
          </div>
        ) : (
          /* Expanded: stacked name / byline / resume button */
          <div className="rounded-md border border-border bg-bg-elevated flex flex-col items-center gap-1 px-2 py-3">
            {/* Built by */}
            <span className="text-[10px] text-text-tertiary text-center leading-tight">
              Built by
            </span>
            {/* Name */}
            <span className="text-[13px] font-semibold text-text-primary text-center leading-tight">
              Lim Zi Han
            </span>
            {/* Brand */}
            <span className="text-[10px] text-text-tertiary text-center leading-tight">
              Andromeda <span className="font-bold text-orange-500">{'//'}</span> Analytics
            </span>
            {/* Resume button */}
            <button
              type="button"
              onClick={() => setResumeOpen((o) => !o)}
              aria-expanded={resumeOpen}
              aria-controls="resume-window-body"
              aria-label="Open Lim Zi Han's resume"
              className="mt-0.5 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors w-full justify-center"
            >
              <FileText size={12} aria-hidden strokeWidth={1.75} />
              <span>Resume</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="px-2 py-2 rounded-md border border-border text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors flex items-center justify-center gap-1.5"
        >
          {/* The sr-only text names the CONSEQUENCE, not just the direction,
              because expanding costs the two-pane layout below a 1,568px viewport
              (ADR-0086) and a reader should not discover that by watching the
              page reflow. */}
          {expanded ? (
            <>
              <PanelLeftClose size={14} aria-hidden strokeWidth={1.75} />
              Narrow
            </>
          ) : (
            <PanelLeftOpen size={15} aria-hidden strokeWidth={1.75} />
          )}
          <span className="sr-only">
            {expanded
              ? "Collapse the rail to 56 pixels, which restores the side-by-side position tables"
              : "Expand the rail to 200 pixels, which stacks the position tables on narrower screens"}
          </span>
        </button>
      </div>

      <ResumeWindow open={resumeOpen} onClose={() => setResumeOpen(false)} />
    </nav>
  );
}
