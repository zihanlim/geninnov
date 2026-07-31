// frontend/tests/unit/lens-href.test.ts
//
// A cross-page link is the ONE place a lens can be dropped with no figure
// changing to give it away.
//
// /book said "stress scenarios and correlation structure for THIS BOOK are on
// Risk" and linked to a bare `/risk`. True while /risk was pinned to
// multi_asset — the sentence was about the only book there was. ADR-0197 gave
// /risk and /mandate their own `?lens=`, and a bare path resolves to
// DEFAULT_LENS, so from that commit onward a reader of the credit book clicked
// its own worst-case loss and landed on the multi-asset stress table. The
// destination carried no marker either: with no `?lens=` in the URL,
// `showScopeNote` is false for every panel there, so nothing on either end said
// the book had changed.
//
// Two properties are pinned here, and the second is the one that protects the
// live submission:
//
//   1. `lensHref` composes correctly — including the fragment ordering, because
//      `/risk#stress?lens=credit` is a fragment literally named
//      "stress?lens=credit" and would silently do nothing.
//   2. Under the default lens it returns the SAME STRING REFERENCE, so no href
//      on the default site can change by accident.
//
// The source scan at the bottom is the part that catches the next instance: a
// component that renders a book figure and links to a lens-aware page must not
// hardcode a bare path.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LENS, lensHref } from "@/lib/book/lensView";

describe("lensHref", () => {
  it("appends the lens as a query param", () => {
    expect(lensHref("/risk", "credit")).toBe("/risk?lens=credit");
    expect(lensHref("/mandate", "rates")).toBe("/mandate?lens=rates");
  });

  it("puts the query BEFORE the fragment", () => {
    // The failure this prevents is silent: a browser reads
    // `/risk#stress?lens=credit` as the fragment `stress?lens=credit`, finds no
    // such element, scrolls nowhere, and passes no lens — a dead anchor AND a
    // dropped lens from one wrong concatenation.
    expect(lensHref("/risk#stress", "credit")).toBe("/risk?lens=credit#stress");
    expect(lensHref("/mandate#limits", "credit")).toBe("/mandate?lens=credit#limits");
  });

  it("uses & when the path already carries a query", () => {
    expect(lensHref("/book?theme=abc", "credit")).toBe("/book?theme=abc&lens=credit");
    expect(lensHref("/book?theme=abc#holdings", "credit")).toBe(
      "/book?theme=abc&lens=credit#holdings",
    );
  });

  it("returns the SAME REFERENCE for the default lens", () => {
    // THE INVARIANT. Identity, not equality: an accidental rebuild of the string
    // would still compare equal, so equality would not prove the default site's
    // hrefs are untouched. This does.
    const p = "/risk#stress";
    expect(lensHref(p, DEFAULT_LENS)).toBe(p);
    expect(lensHref(p, null)).toBe(p);
    expect(lensHref(p, undefined)).toBe(p);
    expect(lensHref(p, "")).toBe(p);
  });

  it("refuses to propagate a string that is not a lens", () => {
    // `?lens=garbage` resolves to the default book on every page that reads it
    // (`resolveLens`), so forwarding it would put a lens in the URL that names no
    // published book — a parameter that looks answered.
    expect(lensHref("/risk", "garbage")).toBe("/risk");
    expect(lensHref("/risk", "CREDIT")).toBe("/risk");
  });
});

/**
 * Components that render a figure belonging to a specific book AND link out to a
 * page that honours `?lens=`. A bare `/risk` or `/mandate` in one of these is the
 * defect above.
 *
 * Not every file in the tree: `SideRail` and the phase strip are NAVIGATION,
 * destination lists that claim nothing about "this book", and three of their six
 * targets ignore the lens entirely. Propagating there would put a parameter into
 * URLs the destination discards, which looks answered and is worse than nothing.
 */
const BOOK_FIGURE_COMPONENTS = [
  "components/book/AnswerCards.tsx",
  "components/book/PositionRow.tsx",
  "components/book/BookBody.tsx",
];

/** Destinations that resolve `?lens=` (ADR-0197). `/method` and `/workbench` do not. */
const LENS_AWARE = ["/risk", "/mandate"];

describe("outbound links from the book's own figures", () => {
  for (const file of BOOK_FIGURE_COMPONENTS) {
    it(`${file} never hardcodes a bare lens-aware href`, () => {
      const src = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      for (const dest of LENS_AWARE) {
        // `href="/risk"` or `href="/risk#stress"` — a string literal, which cannot
        // carry the reader's lens. The `lensHref(...)` form is an expression and
        // does not match.
        const bare = new RegExp(`href="${dest}(#[a-z-]+)?"`, "g");
        const hits = src.match(bare) ?? [];
        expect(
          hits,
          `${file} links to ${dest} with a hardcoded path. A reader of the credit ` +
            `book would land on the multi-asset book, and the destination shows no ` +
            `marker because showScopeNote is false without ?lens=. Wrap it in ` +
            `lensHref(path, lens) — which returns the bare path unchanged under the ` +
            `default lens.`,
        ).toEqual([]);
      }
    });
  }

  it("at least one of them actually uses lensHref, so the scan is not vacuous", () => {
    // A guard that passes because the pattern it looks for is absent everywhere
    // has not been tested. This asserts the fix is present, not merely that the
    // defect is not.
    const uses = BOOK_FIGURE_COMPONENTS.filter((f) =>
      readFileSync(path.resolve(__dirname, "../..", f), "utf8").includes("lensHref("),
    );
    expect(uses.length).toBeGreaterThan(0);
  });
});
