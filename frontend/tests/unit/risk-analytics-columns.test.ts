// The select list and the row type must agree.
//
// Adding an analytic is four edits: a migration, a writer in the pipeline, a field on
// `ResearchAnalyticsRow`, and the column name in `/risk`'s `ANALYTICS_COLUMNS` select
// string. Miss the fourth and there is NO ERROR ANYWHERE — Supabase returns the row without
// the column, `classify` sees `undefined`, and the panel renders its empty state forever.
// On a page whose empty states are deliberately careful ("not judged", "not retrieved",
// never "no exposure"), that failure is especially quiet: the page confidently tells a
// reader the assessment is unavailable while the value sits in the database.
//
// Both `sanctions_exposure` (migration 045) and `positioning_crowding` (migration 046)
// shipped in the same week and both had to make this edit. Rather than pin the two by name,
// this derives the expectation from the type itself, so the NEXT analytic is covered on the
// day its field lands.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

const ANALYTICS_TS = src("lib/risk/analytics.ts");
// The select list moved with the body when /risk was split across the three
// phase routes (ADR-0170). app/risk/page.tsx is now a fragment-aware hop and
// issues no query at all.
const RISK_PAGE = src("components/risk/RiskBody.tsx");

/** Field names declared on `export interface ResearchAnalyticsRow { ... }`. */
function rowTypeFields(): string[] {
  const start = ANALYTICS_TS.indexOf("export interface ResearchAnalyticsRow {");
  expect(start, "ResearchAnalyticsRow should exist in lib/risk/analytics.ts").toBeGreaterThan(-1);
  const body = ANALYTICS_TS.slice(start, ANALYTICS_TS.indexOf("\n}", start));
  const fields: string[] = [];
  for (const line of body.split("\n").slice(1)) {
    // Field lines only: skip comments, and skip nested braces (there are none today, but a
    // future inline object type must not silently contribute its inner keys).
    const m = /^\s{2}(\w+)\??:/.exec(line);
    if (m) fields.push(m[1]);
  }
  expect(fields.length, "should have parsed some fields").toBeGreaterThan(3);
  return fields;
}

/** The columns `/risk` actually asks Supabase for. */
function selectedColumns(): string[] {
  const m = /const ANALYTICS_COLUMNS =[\s\S]*?"([^"]+)";/.exec(RISK_PAGE);
  expect(m, "ANALYTICS_COLUMNS should be a plain string literal").not.toBeNull();
  return m![1].split(",").map((c) => c.trim()).filter(Boolean);
}

describe("/risk analytics select list", () => {
  it("selects every column its row type declares", () => {
    const selected = new Set(selectedColumns());
    const missing = rowTypeFields().filter((f) => !selected.has(f));
    expect(
      missing,
      `ResearchAnalyticsRow declares ${missing.join(", ")} but ANALYTICS_COLUMNS does not ` +
        `select ${missing.length === 1 ? "it" : "them"}. The panel would render its empty ` +
        `state forever, with no error, while the value sits in the database.`,
    ).toEqual([]);
  });

  it("does not select columns the row type cannot hold", () => {
    const declared = new Set(rowTypeFields());
    const extra = selectedColumns().filter((c) => !declared.has(c));
    expect(
      extra,
      `ANALYTICS_COLUMNS selects ${extra.join(", ")}, which ResearchAnalyticsRow does not ` +
        `declare — either the type is stale or the select is fetching bytes nothing reads.`,
    ).toEqual([]);
  });

  it("covers the two overlays added this week", () => {
    // A named check alongside the derived one: if the parser above ever silently matches
    // nothing, the derived test passes vacuously and this one still fails.
    const selected = selectedColumns();
    expect(selected).toContain("sanctions_exposure");
    expect(selected).toContain("positioning_crowding");
  });
});

describe("/risk held-book read follows the lens (ADR-0222)", () => {
  // portfolio_positions became per-lens in migration 068. The /risk read must
  // filter by the resolved lens — the same `resolved` used for
  // research_recommendations and book_holdings — so the held book the page
  // computes risk on is the book the reader picked. At multi_asset this is a
  // no-op (every row backfills lens='multi_asset'), which is why the assertion
  // is structural rather than visual.
  const RISK_BODY = src("components/risk/RiskBody.tsx");
  const RISK_BOARD = src("lib/risk/riskBoard.ts");

  /** The columns `/risk` asks Supabase for on portfolio_positions. */
  function positionColumns(): string[] {
    const m = /const POSITION_COLUMNS =[\s\S]*?"([^"]+)";/.exec(RISK_BODY);
    expect(m, "POSITION_COLUMNS should be a plain string literal").not.toBeNull();
    return m![1].split(",").map((c) => c.trim()).filter(Boolean);
  }

  /** The field names on `export interface PositionRow { ... }`. */
  function positionRowFields(): string[] {
    const start = RISK_BOARD.indexOf("export interface PositionRow {");
    expect(start, "PositionRow should exist in lib/risk/riskBoard.ts").toBeGreaterThan(-1);
    const body = RISK_BOARD.slice(start, RISK_BOARD.indexOf("\n}", start));
    const fields: string[] = [];
    for (const line of body.split("\n").slice(1)) {
      const m = /^\s{2}(\w+)\??:/.exec(line);
      if (m) fields.push(m[1]);
    }
    expect(fields.length, "should have parsed some fields").toBeGreaterThan(3);
    return fields;
  }

  it("selects every column PositionRow declares", () => {
    const selected = new Set(positionColumns());
    const missing = positionRowFields().filter((f) => !selected.has(f));
    expect(
      missing,
      `PositionRow declares ${missing.join(", ")} but POSITION_COLUMNS does not select ` +
        `${missing.length === 1 ? "it" : "them"}. The scatter would read undefined.`,
    ).toEqual([]);
  });

  it("filters the held-book read by the resolved lens", () => {
    // The read site: the portfolio_positions select inside the Promise.all. It
    // must carry `.eq("lens", resolved)` so the page computes risk on the book
    // it is actually describing, not the multi-asset one.
    const start = RISK_BODY.indexOf('.from("portfolio_positions")');
    expect(start, "portfolio_positions read should exist in RiskBody").toBeGreaterThan(-1);
    const segment = RISK_BODY.slice(start, start + 600);
    expect(segment).toContain('.eq("lens", resolved)');
    // And the row type must carry the field so the cast at the read site is
    // honest about what it received.
    expect(RISK_BOARD).toMatch(/^\s{2}lens: string;/m);
  });

  it("does not select columns the row type cannot hold", () => {
    const declared = new Set(positionRowFields());
    const extra = positionColumns().filter((c) => !declared.has(c));
    expect(
      extra,
      `POSITION_COLUMNS selects ${extra.join(", ")}, which PositionRow does not declare.`,
    ).toEqual([]);
  });
});

describe("empty states distinguish absence from a measured zero", () => {
  // Design goal 2. A null analytics column means the run predates the migration or the
  // source did not answer — it must never render as a finding of "none".
  const panels: Array<[string, string[]]> = [
    ["components/risk/SanctionsExposure.tsx", ["NOT the same as", "has not been judged"]],
    ["components/risk/PositioningCrowding.tsx", ["NOT the same as", "was not retrieved"]],
  ];

  it.each(panels)("%s says what null means", (file, phrases) => {
    const text = src(file);
    for (const phrase of phrases) {
      expect(text.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});
