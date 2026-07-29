// frontend/tests/unit/risk-sections.test.ts
//
// The /risk split (ADR-0170).
//
// /risk answered three phases at once — the mandate a book is measured against,
// the scenarios that stress it, and what it actually did. Once navigation became
// one tab per phase, one page could not be marked current for three of them, so
// the body moved to `RiskBody` and is filtered by `phaseShows`.
//
// Two failure modes this guards:
//   1. a section belongs to no phase, or to two, so it renders nowhere or twice;
//   2. a phase route stops gating and renders the whole body, which is how a
//      "split" quietly becomes three copies of the same page.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PHASE_SECTION_NAV,
  RISK_SECTION_PHASE,
  phaseShows,
  type RiskPhase,
} from "@/lib/method/phaseSections";
import { PHASES } from "@/lib/method/phases";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const body = read("components/risk/RiskBody.tsx");

const PHASE_LIST: RiskPhase[] = ["mandate", "scenario", "attribution"];

describe("RISK_SECTION_PHASE", () => {
  it("keeps every section the old page rendered", () => {
    // Hardcoded: the point is to catch a section being LOST in the split, which
    // a derived list could never notice.
    expect(Object.keys(RISK_SECTION_PHASE).sort()).toEqual(
      [
        "attribution",
        "concentration",
        "exposure",
        "limits",
        "mandate",
        "realised",
        "stress",
      ].sort(),
    );
  });

  it("assigns each section to exactly one phase", () => {
    for (const id of Object.keys(RISK_SECTION_PHASE)) {
      const owners = PHASE_LIST.filter((p) => phaseShows(p, id));
      expect(owners, `${id} is rendered by ${owners.length} phases`).toHaveLength(1);
    }
  });

  it("leaves no phase empty", () => {
    for (const p of PHASE_LIST) {
      const owned = Object.keys(RISK_SECTION_PHASE).filter((id) => phaseShows(p, id));
      expect(owned.length, `${p} renders no section`).toBeGreaterThan(0);
    }
  });

  it("navigates only to sections the phase actually renders", () => {
    for (const [phase, items] of Object.entries(PHASE_SECTION_NAV)) {
      for (const item of items) {
        expect(
          phaseShows(phase as RiskPhase, item.id),
          `${phase} nav links to #${item.id}, which ${phase} does not render`,
        ).toBe(true);
      }
    }
  });

  it("navigates to every section the phase renders, so none is unreachable", () => {
    for (const p of PHASE_LIST) {
      const owned = Object.keys(RISK_SECTION_PHASE)
        .filter((id) => phaseShows(p, id))
        .sort();
      const navved = PHASE_SECTION_NAV[p].map((i) => i.id).sort();
      expect(navved, `${p} renders a section its nav never names`).toEqual(owned);
    }
  });
});

describe("RiskBody gates what it renders", () => {
  it("gates every section id in the map", () => {
    for (const id of Object.keys(RISK_SECTION_PHASE)) {
      expect(body, `${id} is in the map but never gated in RiskBody`).toContain(
        `shows("${id}")`,
      );
    }
  });

  it("takes one fetch, not one per phase route", () => {
    // The property ADR-0084 protects and this split had to preserve: three
    // routes with their own useEffects can describe different vintages of the
    // same run. RiskBody keeps ONE.
    expect((body.match(/useEffect\(/g) ?? []).length).toBe(1);
  });

  it("is what each phase route renders, rather than owning a query itself", () => {
    for (const r of ["mandate", "scenario", "attribution"]) {
      const route = read(`app/${r}/page.tsx`);
      expect(route).toContain("RiskBody");
      expect(route, `/${r} fetches on its own`).not.toContain("supabase");
    }
  });
});

describe("the phase routes agree with the phase map", () => {
  it("every risk-derived phase has a route the map points at", () => {
    for (const p of PHASE_LIST) {
      const phase = PHASES.find((x) => x.id === p);
      expect(phase, `no phase named ${p}`).toBeDefined();
      expect(phase!.route).toBe(`/${p}`);
    }
  });

  it("/risk is no longer a phase destination, but still resolves", () => {
    expect(PHASES.some((p) => p.route === "/risk")).toBe(false);
    // It hops by fragment rather than redirecting, because its old anchors now
    // live on three different routes and a server redirect cannot see a hash.
    const legacy = read("app/risk/page.tsx");
    expect(legacy).toContain("RISK_SECTION_PHASE");
    expect(legacy).toContain("router.replace");
  });
});
