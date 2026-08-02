// frontend/lib/risk/lensScope.ts — which panels on /mandate and /risk can
// follow the lens, and which are the multi-asset published book whatever
// `?lens=` says.
//
// The bug this file exists to catch is not a crash. It is a page that renders
// perfectly while describing two different books under one heading: credit
// stress scenarios beside a multi-asset VaR headline, with nothing on screen
// saying they are different books. That defect has no runtime symptom, so a
// classification table is the only place it can be caught — and a table is
// only worth having if something checks it against the tables it names.
//
// Two of the assertions below are the real work:
//   * no "book"-scoped panel may list a lens-less table (a panel promising to
//     follow the lens while sourcing a table that cannot);
//   * showScopeNote must be false for EVERY panel under multi_asset — the
//     whole map, not a spot check, because the default page is what a live
//     submission is shown from on 2026-08-03.

import { describe, expect, it } from "vitest";
import {
  LENS_KEYED_TABLES,
  LENS_LESS_TABLES,
  LENS_NEUTRAL_TABLES,
  PANEL_SCOPE,
  lensLessPanels,
  panelLabel,
  scopeOf,
  showScopeNote,
} from "@/lib/risk/lensScope";

const PANELS = Object.keys(PANEL_SCOPE);

/**
 * The table a source string names, or null when the source is outside the table
 * checks. Sources are written `table`, `table.column`, or with a leading
 * parenthesised qualifier:
 *
 *   `(static) path`            — not a table at all, a constant module. Lets
 *                                "this panel reads no table" be distinguished
 *                                from "table nobody classified".
 */
function tableOf(source: string): string | null {
  if (source.startsWith("(")) return null;
  return source.split(".")[0];
}

const isLensLess = (table: string) => LENS_LESS_TABLES.includes(table);

describe("PANEL_SCOPE", () => {
  it("classifies a non-trivial number of panels", () => {
    // RiskBody renders roughly thirty instruments across its three phases. If
    // this drops sharply, entries were deleted rather than reclassified — and
    // a deleted entry silently becomes an "unknown" panel, which still gets a
    // note but stops being checked by the two source assertions below.
    expect(PANELS.length).toBeGreaterThanOrEqual(25);
  });

  it("gives every panel at least one named source", () => {
    // A panel with no sources cannot be checked by anything below it: the
    // book/published assertions both iterate `sources`, so an empty list is a
    // classification that asserts nothing and passes everything.
    for (const panel of PANELS) {
      expect(PANEL_SCOPE[panel].sources.length, `${panel} has no sources`)
        .toBeGreaterThan(0);
      for (const source of PANEL_SCOPE[panel].sources) {
        expect(source.trim(), `${panel} has a blank source`).not.toBe("");
      }
    }
  });

  it("names every source as a known table or an explicit static constant", () => {
    // Fails when someone adds a source naming a table this module has never
    // classified. A source must name one of: the lens-keyed tables
    // (research_recommendations, book_holdings, portfolio_positions — the
    // tables that ARE the lens question), a lens-less table, or a lens-neutral
    // one. Anything else is an unclassified table and must be added to the
    // right list here before it can appear in a panel.
    for (const panel of PANELS) {
      for (const source of PANEL_SCOPE[panel].sources) {
        const table = tableOf(source);
        if (table === null) continue;
        const known =
          table === "research_recommendations" ||
          LENS_KEYED_TABLES.includes(table) ||
          isLensLess(table) ||
          LENS_NEUTRAL_TABLES.includes(table);
        expect(known, `${panel} names unclassified table "${table}"`).toBe(true);
      }
    }
  });

  it("every panel's label is non-empty", () => {
    // The banner prints these. A blank one would name a boundary the reader
    // then cannot locate on the page.
    for (const panel of PANELS) {
      expect(panelLabel(panel).trim(), `${panel} has a blank label`).not.toBe("");
    }
  });
});

describe("scopeOf", () => {
  it("returns each panel's declared scope", () => {
    expect(scopeOf("StressScenarios")).toBe("book");
    expect(scopeOf("TrackRecord")).toBe("published");
    expect(scopeOf("RiskLimitBoard")).toBe("mixed");
  });

  it("resolves an UNKNOWN panel to mixed — over-disclose, never under-disclose", () => {
    // A panel someone adds later and forgets to classify must get a marker
    // rather than silently present multi-asset figures under a credit heading.
    // The two defaults are not symmetric: the cost of a wrong "mixed" is one
    // unnecessary note; the cost of a wrong "book" is the defect this whole
    // module exists to prevent, reintroduced by an omission.
    expect(scopeOf("SomePanelNobodyClassified")).toBe("mixed");
    expect(scopeOf("")).toBe("mixed");
  });
});

describe("showScopeNote — the default-lens invariant", () => {
  it("is FALSE for every panel in the map under multi_asset", () => {
    // The whole map, deliberately, not one panel. /mandate, /risk and
    // /attribution with no `?lens=` in the URL must render exactly as they did
    // before the lens control existed — no banner, no chip, no extra spacing.
    // A single panel leaking a marker onto the default page breaks that, and a
    // spot check would not find it.
    const leaking = PANELS.filter((p) => showScopeNote("multi_asset", p));
    expect(leaking, "these panels would add a marker to the DEFAULT page").toEqual([]);
  });

  it("is FALSE for an unknown panel under multi_asset too", () => {
    // The unknown-panel default is "mixed", which gets a note — but not on the
    // default page. The lens check comes first, and it has to: the fail-loud
    // rule must not be able to put ink on the submission page.
    expect(showScopeNote("multi_asset", "SomePanelNobodyClassified")).toBe(false);
  });

  it("is TRUE under credit for every published and mixed panel", () => {
    const shouldNote = PANELS.filter((p) => scopeOf(p) !== "book");
    expect(shouldNote.length).toBeGreaterThan(0);
    for (const panel of shouldNote) {
      expect(showScopeNote("credit", panel), `${panel} should carry a note`).toBe(true);
    }
  });

  it("is FALSE under credit for every book-scoped panel", () => {
    const followsLens = PANELS.filter((p) => scopeOf(p) === "book");
    expect(followsLens.length).toBeGreaterThan(0);
    for (const panel of followsLens) {
      expect(showScopeNote("credit", panel), `${panel} follows the lens`).toBe(false);
    }
  });

  it("marks an unknown panel under a non-default lens", () => {
    expect(showScopeNote("credit", "SomePanelNobodyClassified")).toBe(true);
  });

  it("treats every non-default lens the same way", () => {
    // Only multi_asset is special. `rates`, `equity` and an unrecognised string
    // all get the disclosure — a lens that resolveLens would have rejected must
    // not be the one that slips through with no marker.
    for (const lens of ["credit", "rates", "equity", "fx", "commodity", "nonsense"]) {
      expect(showScopeNote(lens, "TrackRecord"), lens).toBe(true);
    }
  });
});

describe("source classification agrees with the scope", () => {
  it("every table a PUBLISHED panel names is lens-less", () => {
    // "published" means the panel's figures are the multi-asset published
    // record whatever the lens says. A research_recommendations, book_holdings
    // or portfolio_positions source in one would make the claim false in the
    // direction that misleads: the marker would say "multi-asset book" over a
    // figure that did follow the lens.
    //
    // Lens-NEUTRAL tables are exempt because they are not a third book — one
    // FF5 beta per asset per run is the same fact under every lens.
    for (const panel of PANELS.filter((p) => scopeOf(p) === "published")) {
      for (const source of PANEL_SCOPE[panel].sources) {
        const table = tableOf(source);
        if (table === null) continue;
        if (LENS_NEUTRAL_TABLES.includes(table)) continue;
        expect(
          isLensLess(table),
          `${panel} is "published" but names "${table}", which is not lens-less`,
        ).toBe(true);
      }
    }
  });

  it("no BOOK-scoped panel names a lens-less table", () => {
    // The real bug-catcher. A "book" panel is one the page will render with no
    // marker at all under the credit lens. If it draws on portfolio_risk,
    // portfolio_returns or any of their siblings, the page shows a multi-asset
    // figure under a credit heading with nothing saying so — ADR-0084's "one
    // page, two vintages" failure, in its worst form, since the reader has been
    // given an explicit reason to believe otherwise.
    const offenders: string[] = [];
    for (const panel of PANELS.filter((p) => scopeOf(p) === "book")) {
      for (const source of PANEL_SCOPE[panel].sources) {
        const table = tableOf(source);
        if (table !== null && isLensLess(table)) {
          offenders.push(`${panel} -> ${source}`);
        }
      }
    }
    expect(
      offenders,
      'these panels claim to follow the lens but read a table that cannot (reclassify them "mixed")',
    ).toEqual([]);
  });

  it("every mixed panel really is mixed — it names both kinds of source", () => {
    // Not a formality: a "mixed" panel that reads only lens-less tables should
    // be "published", and one that reads only the analytics row should be
    // "book" and carry no marker at all. Either mistake is over-disclosure
    // rather than under-, which is why it is checked here and not in the
    // fail-loud default above.
    const isLensFollowing = (t: string) =>
      t === "research_recommendations" || LENS_KEYED_TABLES.includes(t);
    for (const panel of PANELS.filter((p) => scopeOf(p) === "mixed")) {
      const tables = PANEL_SCOPE[panel].sources
        .map(tableOf)
        .filter((t): t is string => t !== null);
      expect(
        tables.some(isLensLess),
        `${panel} is "mixed" but names no lens-less table`,
      ).toBe(true);
      expect(
        tables.some(isLensFollowing),
        `${panel} is "mixed" but names no lens-following source`,
      ).toBe(true);
    }
  });
});

describe("lensLessPanels", () => {
  it("returns exactly the panels that cannot follow the lens", () => {
    expect(lensLessPanels().sort()).toEqual(
      PANELS.filter((p) => scopeOf(p) !== "book").sort(),
    );
  });

  it("excludes every book-scoped panel", () => {
    const listed = new Set(lensLessPanels());
    expect(listed.has("StressScenarios")).toBe(false);
    expect(listed.has("CapUtilisation")).toBe(false);
    expect(listed.has("BookFactorTilt")).toBe(false);
  });

  it("includes the panels a reader would most likely misread", () => {
    const listed = new Set(lensLessPanels());
    for (const panel of ["RiskLimitBoard", "RiskMetricsGrid", "DrawdownChart", "TrackRecord"]) {
      expect(listed.has(panel), `${panel} must be disclosed`).toBe(true);
    }
  });

  it("agrees with showScopeNote under a non-default lens", () => {
    // The banner names this list and the chips are placed by showScopeNote. If
    // the two ever disagree, a reader sees a panel named at the top of the page
    // that carries no marker where it renders, or the reverse.
    for (const panel of PANELS) {
      expect(showScopeNote("credit", panel), panel).toBe(lensLessPanels().includes(panel));
    }
  });
});
