// frontend/tests/unit/chapter-tabs.test.tsx
//
// /method has three surfaces. This asserts a reader can reach all three from
// any of them.
//
// The regression it exists for: ADR-0169 gave bare /method to the process map
// and moved the detailed build chapter to /method/build. The two-tab switch that
// let a reader move between chapters lived INSIDE MethodBody, which the process
// map does not render — so /method's only routes onward were two links inside a
// paragraph of prose. The detailed method page was reported as gone. It was one
// click away, named only in a sentence.
//
// A sibling route mentioned only in running text is a route a reader has to READ
// to find. These tests fail if that happens again.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ChapterTabs, { METHOD_TABS } from "@/components/method/ChapterTabs";
import { CHAPTER_ROUTE } from "@/lib/method/anchors";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("METHOD_TABS", () => {
  it("names every /method surface, and the process map first", () => {
    expect(METHOD_TABS.map((t) => t.href)).toEqual([
      "/method",
      "/method/build",
      "/method/evidence",
    ]);
  });

  it("takes the chapter paths from CHAPTER_ROUTE rather than repeating them", () => {
    // The last move is what stranded this nav. Derived paths move with it.
    const hrefs = METHOD_TABS.map((t) => t.href);
    expect(hrefs).toContain(CHAPTER_ROUTE.build);
    expect(hrefs).toContain(CHAPTER_ROUTE.evidence);
  });

  it("gives every tab a label a reader can act on", () => {
    for (const t of METHOD_TABS) {
      expect(t.label.length, `${t.href} has no label`).toBeGreaterThan(3);
    }
  });
});

describe("ChapterTabs", () => {
  it("marks exactly one tab current, and only the matching one", () => {
    for (const tab of METHOD_TABS) {
      const out = renderToStaticMarkup(<ChapterTabs current={tab.href} />);
      expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1);
      // Attribute ORDER is React's business, not this test's — it emits
      // aria-current before href. Pull the marked anchor out whole, then ask
      // which href it carries.
      const marked = (out.match(/<a[^>]*>/g) ?? []).filter((a) =>
        a.includes('aria-current="page"'),
      );
      expect(marked).toHaveLength(1);
      expect(marked[0], `current=${tab.href} marked the wrong tab`).toContain(
        `href="${tab.href}"`,
      );
    }
  });

  it("renders a real link to every other surface", () => {
    const out = renderToStaticMarkup(<ChapterTabs current="/method" />);
    for (const t of METHOD_TABS) {
      expect(out, `no link to ${t.href}`).toContain(`href="${t.href}"`);
    }
  });
});

describe("every /method surface renders the tabs", () => {
  // Source-level, because the process map is a server component and MethodBody
  // needs a Supabase round trip before it renders its header at all.
  it("the process map does", () => {
    expect(read("components/method/ProcessMap.tsx")).toMatch(/<ChapterTabs\s/);
  });

  it("both MethodBody chapters do", () => {
    const src = read("components/method/MethodBody.tsx");
    expect(src).toMatch(/<ChapterTabs\s/);
    // And not by re-implementing it: a second copy is a second place a surface
    // can go missing from the switch.
    expect(src).not.toMatch(/aria-label="Method chapters"/);
  });
});
