// frontend/tests/unit/method-anchors.test.ts
//
// The /method chapter split (ADR-0084) moved three section anchors onto a second
// route. Every one of those ids is linked from outside the app — ADRs,
// PROGRESS.md rows and the design spec all point at /method#<id> — so the map
// that drives the client-side hop is load-bearing for inbound links.
//
// These assertions exist to catch the two ways it rots:
//   1. a section is renamed or deleted and the map is not updated, so a
//      documented link hops to a chapter that no longer contains its target;
//   2. a section is ADDED to MethodBody with no entry in the map, so it renders
//      on both chapters or neither.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CHAPTER_NAV,
  CHAPTER_ROUTE,
  METHOD_ANCHORS,
  chapterOwns,
  routeForAnchor,
} from "@/lib/method/anchors";

const BODY = path.resolve(__dirname, "../../components/method/MethodBody.tsx");
const src = readFileSync(BODY, "utf8");

// Hardcoded on purpose. Deriving this from METHOD_ANCHORS would make the test
// agree with the map no matter what the map said, which is not a test.
const BUILD = ["hypescore", "tradescore", "edgescore", "factors", "signal-validation"];
const EVIDENCE = ["pipeline", "sources", "guardrails"];

describe("METHOD_ANCHORS", () => {
  it("covers exactly the documented anchors, no more and no fewer", () => {
    expect(Object.keys(METHOD_ANCHORS).sort()).toEqual([...BUILD, ...EVIDENCE].sort());
  });

  it("routes the build-chapter anchors to /method", () => {
    for (const id of BUILD) {
      expect(routeForAnchor(id), `${id} should resolve to /method`).toBe("/method");
      expect(chapterOwns("build", id)).toBe(true);
      expect(chapterOwns("evidence", id)).toBe(false);
    }
  });

  it("routes the evidence-chapter anchors to /method/evidence", () => {
    for (const id of EVIDENCE) {
      expect(routeForAnchor(id), `${id} should resolve to /method/evidence`).toBe(
        "/method/evidence",
      );
      expect(chapterOwns("evidence", id)).toBe(true);
      expect(chapterOwns("build", id)).toBe(false);
    }
  });

  it("leaves an unknown fragment alone rather than guessing", () => {
    // Sending a reader to an arbitrary chapter is worse than leaving them where
    // the link put them.
    expect(routeForAnchor("not-a-real-section")).toBeNull();
    expect(routeForAnchor("")).toBeNull();
  });

  it("points every chapter at a route file that exists", () => {
    for (const route of Object.values(CHAPTER_ROUTE)) {
      const file = path.resolve(__dirname, "../../app", route.replace(/^\//, ""), "page.tsx");
      expect(existsSync(file), `${route} has no page.tsx at ${file}`).toBe(true);
    }
  });
});

describe("MethodBody agrees with the map", () => {
  it("gates every <Section id> it renders", () => {
    // String.match with /g rather than matchAll + spread: tsconfig targets below
    // es2015 here, so spreading a RegExpStringIterator needs --downlevelIteration.
    const rendered = (src.match(/id="[a-z-]+"/g) ?? [])
      .map((m) => m.slice(4, -1))
      .filter((id) => Object.prototype.hasOwnProperty.call(METHOD_ANCHORS, id));
    // Every section id found in the body must be gated by chapterOwns, or it
    // would render on both chapters.
    for (const id of rendered) {
      expect(
        src,
        `<Section id="${id}"> is rendered but never gated by chapterOwns`,
      ).toContain(`chapterOwns(chapter, "${id}")`);
    }
  });

  it("gates every anchor in the map, so none renders on both chapters", () => {
    for (const id of Object.keys(METHOD_ANCHORS)) {
      expect(src, `${id} is in METHOD_ANCHORS but not gated in MethodBody`).toContain(
        `chapterOwns(chapter, "${id}")`,
      );
    }
  });

  it("keeps the two chapters disjoint", () => {
    const build = new Set(CHAPTER_NAV.build.map((i) => i.id));
    for (const item of CHAPTER_NAV.evidence) {
      expect(build.has(item.id), `${item.id} appears in both chapter navs`).toBe(false);
    }
  });

  it("navigates only to anchors the chapter actually renders", () => {
    // A nav item pointing at a section the chapter does not render is a link to
    // nowhere — it scrolls to the top and looks like a broken page.
    for (const [chapter, items] of Object.entries(CHAPTER_NAV)) {
      for (const item of items) {
        expect(
          chapterOwns(chapter as "build" | "evidence", item.id),
          `${chapter} nav links to #${item.id}, which ${chapter} does not render`,
        ).toBe(true);
      }
    }
  });
});
