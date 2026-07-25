// frontend/tests/unit/worked-example.test.ts
//
// ADR-0081 \u2014 the Worked Example lineage panel is the only thing in the current
// iteration that adds a new UI surface, and the design-goals brief specifically
// warns against "any change that argues the goal down first" without a recorded
// reason. These tests pin the panel's data contract: given the same data the
// /book row already reads, the panel surfaces every field the row surfaces and
// renders an honest gap (em-dash + explainGap) when a column is missing.
//
// The test deliberately asserts on the structured object returned by
// `buildWorkedExample`, not on rendered markup: vitest is configured for Node
// with no jsdom (frontend/vitest.config.ts), so React-component tests are not
// available here. The React wrapper renders this object 1:1, so a shape change
// is the single thing that can break either the panel or the test.

import { describe, expect, it } from "vitest";
import {
  buildWorkedExample,
  pickWorkedExamplePosition,
  type WorkedExamplePick,
} from "@/lib/book/workedExample";

const FULL_PICK: WorkedExamplePick = {
  asset: "TLT",
  direction: "long",
  theme: "Fiscal Dominance / Duration Supply",
  theme_name: "Fiscal Dominance / Duration Supply",
  theme_id: "t-fiscal",
  ma_context: {
    last: 95.42,
    ma: 91.18,
    pct_from_ma: 4.65,
    window: 200,
    observations: 180,
  },
};

const EMPTY_PICK: WorkedExamplePick = {
  asset: "ARKK",
  direction: "short",
  theme_id: null,
  theme: "Disruption Crowding",
};

describe("pickWorkedExamplePosition", () => {
  it("returns null for an empty book", () => {
    expect(pickWorkedExamplePosition([])).toBeNull();
  });

  it("picks the position with the highest |edge_score|", () => {
    const a = { ...FULL_PICK, asset: "A", edge_score: 0.5 };
    const b = { ...FULL_PICK, asset: "B", edge_score: -1.2 };
    const c = { ...FULL_PICK, asset: "C", edge_score: 0.8 };
    const got = pickWorkedExamplePosition([a, b, c]);
    expect(got?.asset).toBe("B"); // |−1.2| > |0.8| > |0.5|
  });

  it("breaks ties in favour of a long over a short", () => {
    const long = { ...FULL_PICK, asset: "LONG", direction: "long" as const, edge_score: 0.4 };
    const short = { ...FULL_PICK, asset: "SHORT", direction: "short" as const, edge_score: -0.4 };
    // |edge| = 0.4 for both. Long wins tie-break per ADR-0081.
    expect(pickWorkedExamplePosition([short, long])?.asset).toBe("LONG");
  });

  it("falls back to the first pick when no EdgeScore is populated", () => {
    const first = { ...FULL_PICK, asset: "FIRST", edge_score: null };
    const second = { ...FULL_PICK, asset: "SECOND", edge_score: null };
    // Both null \u2014 sort leaves source order intact; first is returned.
    const got = pickWorkedExamplePosition([first, second]);
    expect(got?.asset).toBe("FIRST");
  });
});

describe("buildWorkedExample \u2014 every field the row carries is surfaced", () => {
  // The panel reads the same data the row above already reads. ADR-0081 promises
  // no information loss: every field the row has must appear in the panel, either
  // rendered or rendered as an em-dash + explainGap.
  const full = buildWorkedExample({
    pick: FULL_PICK,
    maContext: FULL_PICK.ma_context,
    themeScore: 0.94,
    sizing: { display: "0.066 (6.6%)", convictionBased: true },
    primaryScenario: {
      label: "VIX Spike (+15pts)",
      contribution: "+0.32%",
    },
  });

  it("returns four steps in pipeline order", () => {
    expect(full.steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it("names the table.column each step traces to", () => {
    expect(full.steps[0].sourceColumn).toMatch(/^filings\.xbrl_facts/);
    expect(full.steps[1].sourceColumn).toMatch(/^research_recommendations\.theme_edges/);
    expect(full.steps[2].sourceColumn).toMatch(/^portfolio_positions\.weight$/);
    expect(full.steps[3].sourceColumn).toMatch(/^research_recommendations\.scenario_results/);
  });

  it("renders the ma_context figure in step 1 when present", () => {
    // The lineage trail is not yet persisted (step 1 source column reports
    // sourcePersisted: false), but the ma_context row is a real, persisted figure
    // for the position and the panel renders it with the honest explainGap.
    expect(full.steps[0].formula).toMatch(/last = 95\.42/);
    expect(full.steps[0].formula).toMatch(/200d MA/);
    expect(full.steps[0].sourcePersisted).toBe(false);
    expect(full.steps[0].sourceGap).toMatch(/Lineage trail is not yet persisted/);
  });

  it("renders the theme score in step 2", () => {
    expect(full.steps[1].formula).toBe("Theme_Score = 0.94");
    expect(full.steps[1].sourcePersisted).toBe(true);
    expect(full.steps[1].sourceGap).toBeUndefined();
  });

  it("renders the sizing display in step 3 and marks it conviction-based", () => {
    expect(full.steps[2].formula).toBe("0.066 (6.6%)");
    expect(full.steps[2].sourcePersisted).toBe(true);
    expect(full.steps[2].prose).toMatch(/Conviction \u00d7 inverse-vol/);
  });

  it("renders the primary scenario contribution in step 4", () => {
    expect(full.steps[3].formula).toBe("+0.32%");
    expect(full.steps[3].sourcePersisted).toBe(true);
  });

  it("records the position's asset, direction and theme", () => {
    expect(full.position.asset).toBe("TLT");
    expect(full.position.direction).toBe("long");
    expect(full.position.theme).toBe("Fiscal Dominance / Duration Supply");
  });
});

describe("buildWorkedExample \u2014 absence renders as em-dash + explainGap (ADR-0066)", () => {
  it("step 1 falls back to em-dash with explainGap when ma_context is missing", () => {
    const out = buildWorkedExample({
      pick: EMPTY_PICK,
      maContext: null,
      themeScore: 0.5,
      sizing: { display: "\u2014", convictionBased: false },
      primaryScenario: null,
    });
    expect(out.steps[0].formula).toBe("\u2014");
    expect(out.steps[0].formulaGap).toMatch(/ma_context/);
    // Source column is fixed (the lineage trail is not yet persisted); what
    // changes is whether the gap is shown, and it is.
    expect(out.steps[0].sourcePersisted).toBe(false);
    expect(out.steps[0].sourceGap).toMatch(/Lineage trail/);
  });

  it("step 2 falls back to em-dash + explainGap when theme_score is null", () => {
    const out = buildWorkedExample({
      pick: FULL_PICK,
      maContext: FULL_PICK.ma_context,
      themeScore: null,
      sizing: { display: "0.05 (5.0%)", convictionBased: true },
      primaryScenario: null,
    });
    expect(out.steps[1].formula).toBe("\u2014");
    expect(out.steps[1].formulaGap).toMatch(/theme_edges has no row/);
    expect(out.steps[1].sourcePersisted).toBe(false);
  });

  it("step 3 prose names the hype-sized fallback so the lineage is honest", () => {
    const out = buildWorkedExample({
      pick: FULL_PICK,
      maContext: FULL_PICK.ma_context,
      themeScore: 0.5,
      sizing: { display: "5.0%", convictionBased: false },
      primaryScenario: null,
    });
    expect(out.steps[2].prose).toMatch(/HypeScore rank fallback/);
    expect(out.steps[2].formulaGap).toMatch(/hype-sized/);
  });

  it("step 4 falls back to em-dash + explainGap when the position is not in any scenario breakdown", () => {
    const out = buildWorkedExample({
      pick: FULL_PICK,
      maContext: FULL_PICK.ma_context,
      themeScore: 0.5,
      sizing: { display: "0.05 (5.0%)", convictionBased: true },
      primaryScenario: null,
    });
    expect(out.steps[3].formula).toBe("\u2014");
    expect(out.steps[3].formulaGap).toMatch(/contribution_breakdown/);
    expect(out.steps[3].sourcePersisted).toBe(false);
  });
});

describe("buildWorkedExample \u2014 no fabricated citations", () => {
  it("never invents a source column for a missing value", () => {
    const out = buildWorkedExample({
      pick: FULL_PICK,
      maContext: null,
      themeScore: null,
      sizing: { display: "\u2014", convictionBased: false },
      primaryScenario: null,
    });
    for (const s of out.steps) {
      // The source column strings are deliberately stable so the test catches a
      // accidental retype (e.g. swapping `theme_edges.score` for the fictional
      // `l5_agent.theme_score` the model used to fill in).
      expect(s.sourceColumn).not.toMatch(/l5_agent/);
      expect(s.sourceColumn).not.toMatch(/CIK_/);
    }
  });
});
