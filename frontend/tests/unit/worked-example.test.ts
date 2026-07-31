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

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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
    // ADR-0198 — every one of these is the table the figure ABOVE it is read
    // from, verified against the module that reads it. Three of the four used to
    // name the stitch comp's invented schema instead.
    expect(full.steps[0].sourceColumn).toBe(
      "research_recommendations.picks[].ma_context"
    );
    expect(full.steps[1].sourceColumn).toBe("theme_signals_history.edge_score");
    expect(full.steps[2].sourceColumn).toBe(
      "research_recommendations.picks[].notional"
    );
    expect(full.steps[3].sourceColumn).toMatch(/^research_recommendations\.scenario_results/);
  });

  it("renders the ma_context figure in step 1 and counts it as persisted", () => {
    // ma_context IS persisted, on the pick — `finalise_book_analytics` writes it.
    // The step used to report sourcePersisted: false while rendering it, because
    // it was citing a filings table that does not exist in any migration.
    expect(full.steps[0].formula).toMatch(/last = 95\.42/);
    expect(full.steps[0].formula).toMatch(/200d MA/);
    expect(full.steps[0].sourcePersisted).toBe(true);
    expect(full.steps[0].sourceGap).toBeUndefined();
  });

  it("renders the theme EdgeScore in step 2 without claiming an LLM produced it", () => {
    expect(full.steps[1].formula).toBe("EdgeScore = 0.94");
    expect(full.steps[1].sourcePersisted).toBe(true);
    expect(full.steps[1].sourceGap).toBeUndefined();
    // The number is deterministic (ADR-0036) and signed. Both were misstated.
    expect(full.steps[1].prose).not.toMatch(/LLM/i);
    expect(full.steps[1].prose).not.toMatch(/\[0, 1\]/);
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
    // The column is the same either way; what changes is whether THIS position
    // has a value in it, and the gap names why it might not.
    expect(out.steps[0].sourcePersisted).toBe(false);
    expect(out.steps[0].sourceGap).toMatch(/finalise_book_analytics/);
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
    expect(out.steps[1].formulaGap).toMatch(/theme_signals_history carries no row/);
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

describe("buildWorkedExample \u2014 no fabricated citations (ADR-0198)", () => {
  // This block used to be a two-string denylist: `l5_agent` and `CIK_`, the two
  // fabrications someone had already noticed. It passed for four months while
  // three of the four steps cited `filings.xbrl_facts`, `theme_edges` and a
  // portfolio_positions column the figure was not read from \u2014 a denylist can
  // only catch the invention you thought of first.
  //
  // So: derive the allowed set from the schema itself. Same move as
  // risk-thresholds.test.ts parsing risk_engine.py \u2014 an expectation read off an
  // artefact cannot drift from it silently.
  // TABLE, AND ITS COLUMN. A table-only check would have passed the fabrication
  // that prompted this: `research_recommendations.theme_edges.score` hides an
  // invented sub-object under a table that does exist. The first segment after
  // the table is checked against that table's real columns; anything deeper is a
  // path INSIDE a jsonb column (`picks[].ma_context`) and is not verifiable from
  // the DDL — stated here rather than silently skipped.
  const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
  const SCHEMA = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .join("\n");

  // Words that open a table-constraint line rather than name a column.
  const NOT_A_COLUMN = new Set([
    "primary",
    "unique",
    "foreign",
    "constraint",
    "check",
    "exclude",
    "like",
  ]);
  // Array.from, not spread: tsconfig targets below es2015 here, and spreading a
  // matchAll iterator is a TS2802 the vitest run would not have caught.
  const matches = (re: RegExp, s: string) => Array.from(s.matchAll(re));

  const COLUMNS = new Map<string, Set<string>>();
  const table = (t: string): Set<string> => {
    const k = t.toLowerCase();
    if (!COLUMNS.has(k)) COLUMNS.set(k, new Set());
    return COLUMNS.get(k)!;
  };

  for (const m of matches(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\);/gi,
    SCHEMA
  )) {
    const cols = table(m[1]);
    for (const line of m[2].split("\n")) {
      // `<name> <type>` — a column definition, as against `PRIMARY KEY (…)`.
      const col = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
      if (col && !NOT_A_COLUMN.has(col[1].toLowerCase()))
        cols.add(col[1].toLowerCase());
    }
  }
  // ADD COLUMN runs, which is how most of this schema grew after 001.
  for (const m of matches(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)([\s\S]*?);/gi,
    SCHEMA
  )) {
    const cols = table(m[1]);
    for (const c of matches(
      /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      m[2]
    ))
      cols.add(c[1].toLowerCase());
  }
  // Migration 008 renamed the two L5 tables in place; their columns were declared
  // under the old name, so carry them over or every L5 citation fails.
  for (const m of matches(
    /alter\s+table\s+(?:public\.)?([a-z_]+)\s+rename\s+to\s+([a-z_]+)/gi,
    SCHEMA
  )) {
    const from = COLUMNS.get(m[1].toLowerCase());
    if (from) for (const c of Array.from(from)) table(m[2]).add(c);
  }

  it("reads a non-trivial schema out of the migrations", () => {
    // Guards the guard: a bad path or a changed regex would empty COLUMNS and
    // turn every assertion below into a vacuous pass.
    expect(COLUMNS.size).toBeGreaterThan(20);
    expect(COLUMNS.get("research_recommendations")?.has("picks")).toBe(true);
    expect(COLUMNS.get("theme_signals_history")?.has("edge_score")).toBe(true);
    expect(COLUMNS.has("filings")).toBe(false);
    // The exact fabrication this ADR removed, as a column of the real table it
    // was hiding under.
    expect(COLUMNS.get("research_recommendations")?.has("theme_edges")).toBe(
      false
    );
  });

  it("cites only tables and columns that exist in the migrations", () => {
    for (const inputs of [
      {
        maContext: FULL_PICK.ma_context,
        themeScore: 0.94,
        sizing: { display: "$8.8M", convictionBased: true },
        primaryScenario: { label: "VIX Spike (+15pts)", contribution: "+0.32%" },
      },
      // The gap path too: a step that cannot render its figure still prints its
      // source line, so an invented table is just as public when the value is null.
      {
        maContext: null,
        themeScore: null,
        sizing: { display: "\u2014", convictionBased: false },
        primaryScenario: null,
      },
    ]) {
      const out = buildWorkedExample({ pick: FULL_PICK, ...inputs });
      for (const s of out.steps) {
        const [cited, field] = s.sourceColumn.split(".");
        const cols = COLUMNS.get(cited);
        expect(
          cols,
          `step ${s.number} cites "${s.sourceColumn}" \u2014 no migration creates a table named "${cited}"`
        ).toBeDefined();
        const column = (field ?? "").replace(/\[\]$/, "");
        expect(
          cols?.has(column),
          `step ${s.number} cites "${s.sourceColumn}" \u2014 "${cited}" has no column "${column}"`
        ).toBe(true);
      }
    }
  });
});
