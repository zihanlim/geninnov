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
  CHAPTER_STEPS,
  METHOD_ANCHORS,
  chapterOwns,
  routeForAnchor,
  stepNumber,
} from "@/lib/method/anchors";

const BODY = path.resolve(__dirname, "../../components/method/MethodBody.tsx");
const src = readFileSync(BODY, "utf8");

// Hardcoded on purpose. Deriving this from METHOD_ANCHORS would make the test
// agree with the map no matter what the map said, which is not a test.
const BUILD = ["hypescore", "tradescore", "edgescore", "factors", "signal-validation"];
const EVIDENCE = ["pipeline", "sources", "guardrails", "track-record", "corrections"];

describe("METHOD_ANCHORS", () => {
  it("covers exactly the documented anchors, no more and no fewer", () => {
    expect(Object.keys(METHOD_ANCHORS).sort()).toEqual([...BUILD, ...EVIDENCE].sort());
  });

  // ADR-0169 moved this chapter off bare `/method`, which now renders the process
  // map. The assertion is deliberately still hardcoded to a literal rather than
  // read from CHAPTER_ROUTE: the point is to catch the route CHANGING, which a
  // self-referential expectation cannot do.
  it("routes the build-chapter anchors to /method/build", () => {
    for (const id of BUILD) {
      expect(routeForAnchor(id), `${id} should resolve to /method/build`).toBe(
        "/method/build",
      );
      expect(chapterOwns("build", id)).toBe(true);
      expect(chapterOwns("evidence", id)).toBe(false);
    }
  });

  // The hop in `LegacyAnchorHop` is a no-op when the target equals the current
  // pathname. If a chapter route were ever set back to bare /method, a reader
  // following /method#hypescore would land on the process map — which does not
  // render that section — and stay there silently.
  it("keeps every chapter route off the process map's own route", () => {
    for (const [chapter, route] of Object.entries(CHAPTER_ROUTE)) {
      expect(route, `${chapter} would collide with the process map`).not.toBe(
        "/method",
      );
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

// The step numbers beside the headings. These were hardcoded 01–07 across a body
// that renders BOTH chapters, so each chapter showed a subsequence of them: /method
// opened on "02 HypeScore" with no 01 anywhere on the page, and /method/evidence ran
// 01 and then jumped to 06. A step number is a promise about what precedes it, and
// both chapters were breaking it.
describe("chapter step numbers", () => {
  it("writes no step number by hand in MethodBody", () => {
    // The regression that caused this: a literal survives the chapter split and
    // silently disagrees with its own position.
    expect(src, "MethodBody has a hardcoded index= literal").not.toMatch(
      /index="\d+"/,
    );
  });

  for (const chapter of ["build", "evidence"] as const) {
    it(`numbers ${chapter} from 01 with no gaps`, () => {
      const steps = CHAPTER_STEPS[chapter];
      expect(steps.length, `${chapter} has no numbered steps`).toBeGreaterThan(0);

      const numbers = steps.map((id) => stepNumber(chapter, id));
      expect(numbers[0], `${chapter} does not start at 01`).toBe("01");
      expect(numbers).toEqual(
        steps.map((_, i) => String(i + 1).padStart(2, "0")),
      );
    });

    it(`only numbers sections ${chapter} actually renders`, () => {
      for (const id of CHAPTER_STEPS[chapter]) {
        expect(
          chapterOwns(chapter, id),
          `${chapter} numbers #${id}, which it does not render`,
        ).toBe(true);
      }
    });

    it(`numbers ${chapter}'s steps in the order they appear in the document`, () => {
      // The number a reader sees has to match the order they scroll past, or it is
      // worse than no number. Positions are read from the source itself.
      const positions = CHAPTER_STEPS[chapter].map((id) => ({
        id,
        at: src.indexOf(`id="${id}"`),
      }));
      for (const p of positions) {
        expect(p.at, `#${p.id} is numbered but not found in MethodBody`).toBeGreaterThan(-1);
      }
      const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.id);
      expect(sorted).toEqual([...CHAPTER_STEPS[chapter]]);
    });
  }

  it("gives a non-step section no number rather than an empty one", () => {
    // signal-validation, track-record and corrections render their own headers and
    // carry no step number; asking for one must return null, not "" or "00".
    for (const [chapter, id] of [
      ["build", "signal-validation"],
      ["evidence", "track-record"],
      ["evidence", "corrections"],
    ] as const) {
      expect(chapterOwns(chapter, id)).toBe(true);
      expect(stepNumber(chapter, id)).toBeNull();
    }
  });
});
