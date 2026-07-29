// frontend/components/method/ChapterTabs.tsx
//
// The switch between /method's three surfaces.
//
// WHY THIS EXISTS AS A COMPONENT.
// A two-chapter version of this nav lived inline in `MethodBody`, which is
// rendered by `build` and `evidence` only. When ADR-0169 gave bare `/method` to
// the process map, that route got NO chapter switch — its only route onward was
// a pair of links inside a paragraph of prose. The detailed method page was one
// click away and read as deleted, which is how it was reported.
//
// That is the whole failure: a destination whose siblings are named only in
// running text is a destination a reader has to READ to escape. Tabs are the
// control that says "there are three of these, you are on one, here are the
// others" without being read.
//
// `current` is passed rather than read from `usePathname`, so this stays a
// server component and `ProcessMap` — which has no other reason to ship JS —
// does not become a client component to render its own nav.

import Link from "next/link";
import { CHAPTER_ROUTE } from "@/lib/method/anchors";

/**
 * Ordered as a reader meets them: what the process IS, then how a number in it
 * is built, then whether it ran. `/method` first because it is the parent route
 * and the other two are its detail.
 *
 * Built from `CHAPTER_ROUTE` rather than repeating the paths, so a chapter that
 * moves again moves here too — the last move is exactly what stranded this nav.
 */
export const METHOD_TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/method", label: "The process" },
  { href: CHAPTER_ROUTE.build, label: "How it is built" },
  { href: CHAPTER_ROUTE.evidence, label: "Evidence it ran" },
];

export default function ChapterTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Method chapters" className="flex flex-wrap gap-1 mt-3">
      {METHOD_TABS.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1.5 rounded-md font-medium text-[12.5px] border transition-colors no-underline ${
              active
                ? "text-text-primary bg-bg-elevated border-border-strong"
                : "text-text-secondary border-border hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
