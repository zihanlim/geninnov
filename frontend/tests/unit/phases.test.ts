// frontend/tests/unit/phases.test.ts
//
// The phase map (ADR-0169) claims that each of six process steps is performed by
// a named surface. Two consumers read it — the /method process map and the
// PhaseChip eyebrow on every destination header — so a wrong entry is wrong in
// two places at once and looks authoritative in both.
//
// These assertions catch the three ways it rots:
//   1. a phase points at an anchor no component renders, so the link scrolls to
//      the top of a page and reads as broken;
//   2. a phase points at a route with no page.tsx;
//   3. the `absent` phase quietly acquires a destination, or a `live` one
//      quietly loses its own — either of which changes what the map claims the
//      system does.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PHASES, phaseHref, phaseNumber, phasesForRoute } from "@/lib/method/phases";

const COMPONENTS = path.resolve(__dirname, "../../components");

/**
 * Every `id="..."` rendered anywhere under components/, read from source.
 *
 * The lookbehind is load-bearing and was added after this test PASSED on a dead
 * link. A bare /id="…"/ also matches the tail of `data-testid="sizing-provenance"`,
 * so the map was allowed to point phase 4 at an anchor that existed only as a
 * test hook — the browser scrolled to the top of /book and the assertion here was
 * green. Anything ending in `id=` (`data-testid`, `aria-labelledby` variants) is
 * not an element id and must not satisfy a phase link.
 */
function renderedIds(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = readFileSync(full, "utf8");
        for (const m of src.match(/(?<![\w-])id="[a-z][a-z0-9-]*"/g) ?? []) {
          found.add(m.slice(4, -1));
        }
      }
    }
  };
  walk(COMPONENTS);
  return found;
}

describe("PHASES", () => {
  it("numbers 1..6 with no gaps, in order", () => {
    expect(PHASES.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("has no duplicate ids", () => {
    const ids = PHASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every phase a one-line question and a note", () => {
    // A blank note on an `absent` phase is the specific failure the design was
    // meant to prevent: an empty row reads as an unfinished product rather than
    // as a scope boundary.
    for (const p of PHASES) {
      expect(p.question.length, `${p.id} has no question`).toBeGreaterThan(10);
      expect(p.note.length, `${p.id} has no note`).toBeGreaterThan(10);
    }
  });

  it("points every live phase at a route file that exists", () => {
    for (const p of PHASES) {
      if (p.coverage !== "live") continue;
      expect(p.route, `${p.id} is live with no route`).not.toBeNull();
      const rel = p.route === "/" ? "" : p.route!.replace(/^\//, "");
      const file = path.resolve(__dirname, "../../app", rel, "page.tsx");
      expect(existsSync(file), `${p.id} → ${p.route} has no page.tsx`).toBe(true);
    }
  });

  it("points every phase anchor at an id some component renders", () => {
    const ids = renderedIds();
    for (const p of PHASES) {
      if (!p.anchor) continue;
      expect(
        ids.has(p.anchor),
        `phase ${p.id} links to #${p.anchor}, which no component renders`,
      ).toBe(true);
    }
  });

  it("gives the absent phase no destination, and every live phase one", () => {
    for (const p of PHASES) {
      if (p.coverage === "absent") {
        expect(p.route, `${p.id} is absent but has a route`).toBeNull();
        expect(phaseHref(p), `${p.id} is absent but has an href`).toBeNull();
      } else {
        expect(phaseHref(p), `${p.id} is live but has no href`).not.toBeNull();
      }
    }
  });

  it("keeps execution the only absent phase", () => {
    // Not a tautology over `coverage`: this pins WHICH step the system declines
    // to perform, so silently dropping another one fails here.
    expect(PHASES.filter((p) => p.coverage === "absent").map((p) => p.id)).toEqual([
      "execution",
    ]);
  });
});

describe("phasesForRoute", () => {
  it("returns both phases /risk serves", () => {
    // The reason ADR-0169 rejected one tab per phase. If this ever returns one,
    // /risk has been split and the rejection no longer holds.
    expect(phasesForRoute("/risk").map((p) => p.id)).toEqual(["mandate", "scenario"]);
  });

  it("returns nothing for a route that is not a process step", () => {
    // /ask and /workbench are tools for reading the site, not steps. PhaseChip
    // renders null on an empty result rather than an empty rule.
    expect(phasesForRoute("/ask")).toEqual([]);
    expect(phasesForRoute("/workbench")).toEqual([]);
    expect(phasesForRoute("/method")).toEqual([]);
  });
});

describe("phaseNumber", () => {
  it("zero-pads to two digits, matching the chapter step numbers", () => {
    expect(PHASES.map(phaseNumber)).toEqual(["01", "02", "03", "04", "05", "06"]);
  });
});
