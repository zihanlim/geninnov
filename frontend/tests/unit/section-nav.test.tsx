// frontend/tests/unit/section-nav.test.tsx
//
// SectionNav's contract, pinned at the SSR markup level. vitest runs with
// environment: "node", so effects (the IntersectionObserver scroll-spy, the
// active state, the bottom-of-page case) are NOT exercised here — those are
// Playwright's job. What IS pinnable is everything the server emits, which is
// where the accessibility and no-fabrication guarantees live.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import SectionNav from "@/components/SectionNav";

const ITEMS = [
  { id: "holdings", label: "Holdings" },
  { id: "solidity", label: "How solid" },
  { id: "not-taken", label: "Not taken" },
  { id: "audit", label: "Audit" },
];

const html = (items = ITEMS) => renderToString(<SectionNav items={items} />);

describe("SectionNav", () => {
  it("emits a real anchor per item, not an onClick-only control", () => {
    const out = html();
    for (const item of ITEMS) {
      expect(out).toContain(`href="#${item.id}"`);
    }
    // A real href is what makes copy-link, middle-click-to-new-tab, JS-off and
    // the browser's own scroll-padding-top handling all work. A button with a
    // click handler would look identical and silently lose all four.
    expect(out).toContain("<a ");
  });

  it("labels the landmark so it is distinguishable from the primary nav", () => {
    expect(html()).toContain('aria-label="Sections"');
  });

  it("emits no aria-current on the server", () => {
    // The active section is a scroll position — unknowable at render time.
    // Emitting one server-side would assert a location the reader is not at,
    // and would hydrate to a different value.
    expect(html()).not.toContain("aria-current");
  });

  it("renders nothing when given no items", () => {
    expect(html([])).toBe("");
  });

  it("carries no figure in any label", () => {
    // Goal 1 — no naked numbers. A count in a nav item is a number a reader
    // cannot trace to a source, and it goes stale against the panel it labels.
    // This is the assertion that stops someone "helpfully" adding "Longs (5)".
    for (const item of ITEMS) {
      expect(
        item.label,
        `SectionNav label "${item.label}" contains a digit — nav labels are nouns, not figures`,
      ).not.toMatch(/\d/);
    }
    // And the rendered output carries no digit outside the href fragments.
    const rendered = html().replace(/href="#[^"]*"/g, "");
    expect(rendered).not.toMatch(/>\s*[^<]*\d[^<]*</);
  });

  it("uses aria-current=location, never page, when active", () => {
    // TopBar already owns aria-current="page" for the route. Two elements each
    // claiming to be the current *page* is a lie to a screen reader; "location"
    // is the correct value for a position within a page. The active state is
    // client-only, so this asserts the source rather than the SSR output.
    const src = require("node:fs").readFileSync(
      new URL("../../components/SectionNav.tsx", import.meta.url),
      "utf8",
    ) as string;
    expect(src).toContain('"location"');
    expect(src).not.toMatch(/aria-current=\{[^}]*"page"/);
  });
});
