import { describe, it, expect } from "vitest";
import { buildLimitBoard, type LimitBoardInputs } from "@/lib/risk/riskBoard";

/**
 * The board must not stamp OK on a statistic whose sample cannot support it.
 *
 * Observed live on 2026-07-24: the risk-limit board read "VaR (95%) — 1.7% of a 6.0%
 * limit — OK" while the metrics tile on the SAME page read "Not shown: 2 sessions of
 * history, needs 30. A VaR from this sample is noise, so we do not publish one."
 * Same number, same page, opposite claims — and the OK is the more dangerous of the
 * two, because a green stamp against a governing limit reads as a risk check that
 * passed.
 */

const base: LimitBoardInputs = {
  config: new Map(),
  totalCapital: 100_000_000,
  var95Usd: 1_700_000,
  cvar95Usd: 2_100_000,
  beta: 0.12,
  hhi: 362,
  grossExposure: 0.487,
  netExposure: 0.006,
  maxDrawdown: 0,
  singleNameWeight: 0.137,
  sectorWeight: 0.137,
  geoWeight: 0.35,
};

const rowFor = (rows: ReturnType<typeof buildLimitBoard>, key: string) =>
  rows.find((r) => r.key === key)!;

describe("risk-limit board — sample sufficiency", () => {
  it("withholds VaR, CVaR and beta when the sample is below their minimum", () => {
    const rows = buildLimitBoard({ ...base, returnSessions: 2 });
    for (const key of ["var_95", "cvar_95", "beta"]) {
      const r = rowFor(rows, key);
      expect(r.value, `${key} value`).toBeNull();
      expect(r.status, `${key} status`).toBe("unknown");
    }
  });

  it("still shows the ROW, so a limit stays visible even when unmeasurable", () => {
    const rows = buildLimitBoard({ ...base, returnSessions: 2 });
    // A limit a PM cannot see is a limit they cannot manage — withholding the
    // value must not drop the row.
    expect(rowFor(rows, "var_95").limit).toBeGreaterThan(0);
  });

  it("scores them normally once the sample is long enough", () => {
    const rows = buildLimitBoard({ ...base, returnSessions: 260 });
    expect(rowFor(rows, "var_95").value).toBeCloseTo(0.017, 4);
    expect(rowFor(rows, "var_95").status).toBe("ok");
    expect(rowFor(rows, "beta").value).toBeCloseTo(0.12, 4);
  });

  it("does not withhold statistics that need no return history", () => {
    // HHI and the cap/exposure rows come from today's weights. Gating those would
    // replace a real number with a blank.
    const rows = buildLimitBoard({ ...base, returnSessions: 2 });
    expect(rowFor(rows, "hhi").value).toBe(362);
    expect(rowFor(rows, "single_name_cap").value).toBeCloseTo(0.137, 4);
    expect(rowFor(rows, "gross_exposure").value).toBeCloseTo(0.487, 4);
  });

  it("does not withhold when the sample size is unknown", () => {
    // An absent count is not evidence of a short sample; withholding then would
    // blank the board for callers that do not pass it.
    const rows = buildLimitBoard({ ...base, returnSessions: null });
    expect(rowFor(rows, "var_95").value).toBeCloseTo(0.017, 4);
  });
});
