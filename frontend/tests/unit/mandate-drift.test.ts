// The mandate, pinned across the language boundary.
//
// The caps were declared in `backend/services/book_metrics.py` and mirrored by hand in
// `frontend/lib/risk/riskBoard.ts`, kept in agreement by a COMMENT asking the next
// person to keep them in step. That comment failed twice:
//
//   * the single-name and geo caps shipped TRANSPOSED (0.35 / 0.20), so the risk board
//     judged every position against the wrong ceiling in both directions — understating
//     single-name breaches and overstating geographic ones;
//   * `gross_exposure_pct` read 2.0 (200%) against an optimizer enforcing
//     `max_gross = 1.0`. The board was publishing a limit that permitted leverage the
//     sizer structurally cannot produce (ADR-0123).
//
// Same remedy as `risk-thresholds.test.ts`: derive the expectation from the artefact
// rather than restating it in a second list that itself needs maintaining. This parses
// the Python and fails when the TypeScript disagrees.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOK_SHAPE, DEFAULT_LENS, ENFORCED, LENSES, MONITORED, allLimits } from "@/lib/mandate";

const MANDATE_PY = readFileSync(
  path.resolve(__dirname, "../../../backend/services/mandate.py"),
  "utf8",
);
const OPTIMIZER_PY = readFileSync(
  path.resolve(__dirname, "../../../backend/services/optimizer.py"),
  "utf8",
);
const BOOK_METRICS_PY = readFileSync(
  path.resolve(__dirname, "../../../backend/services/book_metrics.py"),
  "utf8",
);

/** Parse a module-level float/int constant out of Python source. */
function pyNum(name: string, source: string = MANDATE_PY): number {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9_.]+)`, "m").exec(source);
  expect(m, `${name} should exist in the parsed Python source`).not.toBeNull();
  return Number(m![1].replace(/_/g, ""));
}

describe("the mandate agrees across the language boundary", () => {
  it("mirrors every enforced cap in mandate.py", () => {
    expect(ENFORCED.total_capital.value).toBe(pyNum("TOTAL_CAPITAL"));
    expect(ENFORCED.single_name_pct.value).toBe(pyNum("MAX_SINGLE_NAME_WEIGHT"));
    expect(ENFORCED.sector_pct.value).toBe(pyNum("MAX_SECTOR_WEIGHT"));
    expect(ENFORCED.geo_pct.value).toBe(pyNum("MAX_GEO_WEIGHT"));
    expect(ENFORCED.gross_exposure_pct.value).toBe(pyNum("MAX_GROSS"));
    expect(ENFORCED.complex_pct.value).toBe(pyNum("MAX_COMPLEX_WEIGHT"));
    expect(ENFORCED.crowded_multiplier.value).toBe(pyNum("CROWDED_CAP_MULTIPLIER"));
  });

  it("mirrors the book shape and the lens vocabulary", () => {
    expect(BOOK_SHAPE.max_longs).toBe(pyNum("MAX_LONGS"));
    expect(BOOK_SHAPE.max_shorts).toBe(pyNum("MAX_SHORTS"));

    const lensMatch = /^DEFAULT_LENS\s*=\s*"([a-z_]+)"/m.exec(MANDATE_PY);
    expect(lensMatch, "DEFAULT_LENS should exist in mandate.py").not.toBeNull();
    expect(DEFAULT_LENS).toBe(lensMatch![1]);

    const lensesBlock = /^LENSES\s*=\s*\(([^)]*)\)/m.exec(MANDATE_PY);
    expect(lensesBlock, "LENSES should exist in mandate.py").not.toBeNull();
    const pyLenses = [...lensesBlock![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...LENSES]).toEqual(pyLenses);
  });

  it("agrees with the gross budget the optimizer actually enforces", () => {
    // The defect that motivated this file. The board said 200%; the solver says 100%.
    // Parsed from optimizer.py rather than mandate.py so this catches the sizer and the
    // mandate drifting apart, not just the two mirrors of the mandate.
    const solverGross = pyNum("    max_gross: float", OPTIMIZER_PY);
    expect(ENFORCED.gross_exposure_pct.value).toBe(solverGross);
    expect(ENFORCED.gross_exposure_pct.value).toBe(1.0);
  });

  it("keeps book_metrics a re-export, never a second declaration", () => {
    // The caps must not be re-declared here — a second assignment is exactly the drift
    // this file exists to prevent, and it would silently win for every importer.
    expect(BOOK_METRICS_PY).toMatch(/from \.mandate import/);
    for (const name of [
      "MAX_SINGLE_NAME_WEIGHT",
      "MAX_SECTOR_WEIGHT",
      "MAX_GEO_WEIGHT",
    ]) {
      expect(
        BOOK_METRICS_PY,
        `${name} is assigned in book_metrics.py — it must be imported from mandate.py`,
      ).not.toMatch(new RegExp(`^${name}\\s*=\\s*[0-9]`, "m"));
    }
  });

  it("every scoring_config key the frontend reads exists in the Python map", () => {
    // A key the frontend looks up but the backend never writes resolves silently to a
    // fallback — which is how all ten limits came to read "house default" while the
    // lookup looked live.
    const keyBlock = /^CONFIG_KEYS:[^=]*=\s*\{([\s\S]*?)^\}/m.exec(MANDATE_PY);
    expect(keyBlock, "CONFIG_KEYS should exist in mandate.py").not.toBeNull();
    const pyKeys = new Set(
      [...keyBlock![1].matchAll(/"[a-z_]+":\s*"([a-z_]+)"/g)].map((m) => m[1]),
    );
    for (const limit of Object.values(ENFORCED)) {
      expect(
        pyKeys.has(limit.configKey),
        `${limit.configKey} is read by the frontend but absent from mandate.CONFIG_KEYS`,
      ).toBe(true);
    }
  });
});

describe("enforced and monitored stay distinguishable", () => {
  it("labels every limit with which kind it is", () => {
    for (const limit of allLimits()) {
      expect(["enforced", "monitored"]).toContain(limit.kind);
    }
  });

  it("keeps net exposure and beta OUT of the enforced set", () => {
    // Nothing in the backend constrains either. Presenting them beside the caps implied
    // the sizer honours them; it does not. If a net or beta constraint is ever added to
    // optimizer.py, this assertion is the thing that should be re-argued.
    expect(OPTIMIZER_PY).not.toMatch(/max_net|net_exposure\s*<=|beta_abs/);
    expect("net_exposure_pct" in ENFORCED).toBe(false);
    expect("beta_abs" in ENFORCED).toBe(false);
    expect(MONITORED.net_exposure_pct.kind).toBe("monitored");
    expect(MONITORED.beta_abs.kind).toBe("monitored");
  });

  it("gives every limit a scoring_config key so none is unattributable", () => {
    for (const limit of allLimits()) {
      expect(limit.configKey, `${limit.key} has no config key`).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
