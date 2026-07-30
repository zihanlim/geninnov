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
  PHASES_WITHOUT_SECTION_NAV,
  PHASE_SECTION_NAV,
  RISK_SECTION_PHASE,
  phaseShows,
  type RiskPhase,
} from "@/lib/method/phaseSections";
import { PHASES } from "@/lib/method/phases";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const body = read("components/risk/RiskBody.tsx");

const PHASE_LIST: RiskPhase[] = ["mandate", "risk", "attribution"];

describe("RISK_SECTION_PHASE", () => {
  it("keeps every section the old page rendered", () => {
    // Hardcoded: the point is to catch a section being LOST in the split, which
    // a derived list could never notice. It grew by one deliberately —
    // `var-methods` was carved out of `limits` when ADR-0172 moved the four-way
    // VaR comparison to the risk page, because five instruments in `stress` would
    // have buried the scenario matrix again.
    expect(Object.keys(RISK_SECTION_PHASE).sort()).toEqual(
      [
        "attribution",
        "concentration",
        "exposure",
        "limits",
        "mandate",
        "realised",
        "stress",
        "var-methods",
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
      // A phase whose sections are columns of ONE row is exempt: nothing is out
      // of reach, so a jump strip has nowhere to jump (ADR-0186). The exemption
      // is a list, not a special case buried in the assertion — a phase that
      // grows a second screen has to be taken off it deliberately.
      if (PHASES_WITHOUT_SECTION_NAV.includes(p)) continue;
      const owned = Object.keys(RISK_SECTION_PHASE)
        .filter((id) => phaseShows(p, id))
        .sort();
      const navved = PHASE_SECTION_NAV[p].map((i) => i.id).sort();
      expect(navved, `${p} renders a section its nav never names`).toEqual(owned);
    }
  });

  it("gives an exempt phase no nav at all, rather than a partial one", () => {
    // Half a jump strip is worse than none: it says the sections it omits are
    // somewhere else.
    for (const p of PHASES_WITHOUT_SECTION_NAV) {
      expect(PHASE_SECTION_NAV[p], `${p} is exempt but still renders tabs`).toEqual([]);
    }
  });

  it("still renders the exempt phase's sections, and their ids still exist", () => {
    // The strip went; the anchors did not. /risk hops #mandate and #limits to
    // this phase as fragments, so dropping the ids would break those links.
    for (const p of PHASES_WITHOUT_SECTION_NAV) {
      const owned = Object.keys(RISK_SECTION_PHASE).filter((id) => phaseShows(p, id));
      expect(owned.length, `${p} is exempt AND renders nothing`).toBeGreaterThan(0);
      for (const id of owned) {
        expect(body, `${id} is in the map but never gated in RiskBody`).toContain(
          `shows("${id}")`,
        );
      }
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
    for (const r of ["mandate", "risk", "attribution"]) {
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

  it("/risk is phase 3, and /scenario redirects to it", () => {
    // ADR-0172 gave /risk back to phase 3 — its question always WAS the risk
    // question. ADR-0170 had left this path as a pure fragment hop; that is now
    // a real page.
    const phase3 = PHASES.find((p) => p.n === 3);
    expect(phase3?.id).toBe("risk");
    expect(phase3?.route).toBe("/risk");
    expect(phase3?.tab).toBe("Risk");
    expect(read("app/scenario/page.tsx")).toContain('redirect("/risk")');
  });

  it("hops ONLY the fragments /risk no longer owns", () => {
    // The hop shrank rather than disappearing. #stress / #attribution / #exposure /
    // #concentration are rendered here and must resolve natively — hopping one this
    // page renders would be a redirect loop. #mandate / #limits / #realised moved.
    const src = read("app/risk/page.tsx");
    expect(src).toContain("RISK_SECTION_PHASE");
    expect(src).toContain("router.replace");
    // The guard that makes it a no-op for its own sections.
    expect(src).toMatch(/owner === "risk"/);
    for (const own of ["stress", "attribution", "exposure", "concentration"]) {
      expect(phaseShows("risk", own), `${own} must be rendered by /risk`).toBe(true);
    }
    for (const moved of ["mandate", "limits", "realised"]) {
      expect(phaseShows("risk", moved), `${moved} must NOT be on /risk`).toBe(false);
    }
  });
});
