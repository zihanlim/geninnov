// Four VaRs on one page, and the ways that goes wrong.
//
// ADR-0082 had to say it when there were two. The failure is not that the numbers differ —
// they should — it is that a reader cannot tell WHY they differ, and most of the spread is
// horizon rather than method.

import { describe, expect, it } from "vitest";
import { fanRows, reconcileExAnte, rescale, varMethods } from "@/lib/risk/varMethods";

const CAPITAL = 100_000_000;

const risk = {
  total_capital: CAPITAL,
  var_95: 1_600_000,             // 1.6% of capital, parametric, 1 day
  var_95_historical: 1_500_000,  // 1.5%, empirical, 1 day
};

const decomposition = { portfolio_var: 0.1379 };  // annualised, z × σ_p
const monteCarlo = {
  horizon_days: 21,
  bands: [{ confidence: 0.95, var: 0.0397 }, { confidence: 0.99, var: 0.0572 }],
};
const forecast = {
  portfolio_volatility_annual: 0.0838,
  bands: [
    { horizon_days: 1, quantiles: { p95: 0.00869 } },
    { horizon_days: 21, quantiles: { p95: 0.0398 } },
    { horizon_days: 63, quantiles: { p95: 0.069 } },
  ],
};

const AMPLE = 300;

describe("varMethods", () => {
  it("carries a horizon on every row — the axis a reader gets wrong", () => {
    const rows = varMethods(risk, decomposition, monteCarlo, forecast, AMPLE, CAPITAL);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.horizonLabel, `${r.key} must state its horizon`).toBeTruthy();
    }
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.parametric.horizonDays).toBe(1);
    expect(by.historical.horizonDays).toBe(1);
    expect(by.euler.horizonDays).toBeNull();          // annualised
    expect(by.euler.horizonLabel).toBe("annualised");
    expect(by.monte_carlo.horizonDays).toBe(21);
  });

  it("separates realised from ex-ante", () => {
    const rows = varMethods(risk, decomposition, monteCarlo, forecast, AMPLE, CAPITAL);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.parametric.basis).toBe("realised");
    expect(by.historical.basis).toBe("realised");
    expect(by.euler.basis).toBe("ex_ante");
    expect(by.monte_carlo.basis).toBe("ex_ante");
  });

  it("gives every row a distinct method id", () => {
    const ids = varMethods(risk, decomposition, monteCarlo, forecast, AMPLE, CAPITAL)
      .map((r) => r.methodId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("converts the realised figures from USD to a share of capital", () => {
    const rows = varMethods(risk, decomposition, monteCarlo, forecast, AMPLE, CAPITAL);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.parametric.value).toBeCloseTo(0.016, 6);
    expect(by.historical.value).toBeCloseTo(0.015, 6);
  });

  it("withholds the realised figures on a thin sample but NOT the ex-ante ones", () => {
    // The whole reason the ex-ante figures exist: they borrow history from the
    // constituents, so a two-day-old book has a meaningful one. Gating them on the book's
    // own age would suppress the only risk numbers it has.
    const rows = varMethods(risk, decomposition, monteCarlo, forecast, 3, CAPITAL);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(by.parametric.value).toBeNull();
    expect(by.parametric.withheld).toContain("3 sessions");
    expect(by.historical.value).toBeNull();
    expect(by.historical.withheld).toBeTruthy();

    expect(by.euler.value).toBeCloseTo(0.1379);
    expect(by.euler.withheld).toBeNull();
    expect(by.monte_carlo.value).toBeCloseTo(0.0397);
    expect(by.monte_carlo.withheld).toBeNull();
  });

  it("distinguishes withheld from absent", () => {
    // Withheld: the number exists and we decline to assert it (ADR-0100).
    // Absent: it was never computed. Collapsing them would tell a reader the pipeline
    // failed when in fact the sample is short, or the reverse.
    const thin = varMethods(risk, null, null, null, 3, CAPITAL);
    const by = Object.fromEntries(thin.map((r) => [r.key, r]));
    expect(by.parametric.withheld).toBeTruthy();
    expect(by.parametric.absent).toBeNull();
    expect(by.euler.withheld).toBeNull();
    expect(by.euler.absent).toContain("migration 038");
    expect(by.monte_carlo.absent).toContain("migration 047");
  });

  it("says so when the covariance could not be estimated", () => {
    const rows = varMethods(risk, { portfolio_var: null }, monteCarlo, forecast, AMPLE, CAPITAL);
    const euler = rows.find((r) => r.key === "euler")!;
    expect(euler.value).toBeNull();
    expect(euler.absent).toContain("60 overlapping sessions");
  });

  it("does not fabricate a share when capital is unknown", () => {
    const rows = varMethods({ var_95: 1_600_000 }, null, null, null, AMPLE, null);
    const parametric = rows.find((r) => r.key === "parametric")!;
    expect(parametric.value).toBeNull();
    expect(parametric.absent).toContain("total capital unknown");
  });
});

describe("reconcileExAnte", () => {
  it("confirms the two ex-ante figures agree, since they share a covariance", () => {
    // 0.00869 × √252 = 0.1379. Same covariance, different horizon — they MUST agree.
    const r = reconcileExAnte(decomposition, forecast)!;
    expect(r.ok).toBe(true);
    expect(r.text).toContain("reconcile");
  });

  it("flags disagreement loudly rather than leaving two numbers to be eyeballed", () => {
    const r = reconcileExAnte({ portfolio_var: 0.30 }, forecast)!;
    expect(r.ok).toBe(false);
    expect(r.text).toContain("DISAGREE");
    expect(r.text).toContain("one of them is wrong");
  });

  it("returns null rather than a verdict when either side is missing", () => {
    expect(reconcileExAnte(null, forecast)).toBeNull();
    expect(reconcileExAnte(decomposition, null)).toBeNull();
    expect(reconcileExAnte({ portfolio_var: 0 }, forecast)).toBeNull();
  });
});

describe("rescale", () => {
  it("is square-root-of-time", () => {
    expect(rescale(0.01, 1, 4)).toBeCloseTo(0.02, 10);
    expect(rescale(0.02, 4, 1)).toBeCloseTo(0.01, 10);
    expect(rescale(0.00869, 1, 252)).toBeCloseTo(0.1379, 3);
  });
});

describe("fanRows", () => {
  it("labels the horizons in the units a reader thinks in", () => {
    const rows = fanRows(forecast);
    expect(rows.map((r) => r.label)).toEqual(["1 day", "1 month", "3 months"]);
  });

  it("drops bands with no usable quantile rather than rendering a gap", () => {
    expect(
      fanRows({ bands: [{ horizon_days: 1 }, { horizon_days: 5, quantiles: { p95: 0.02 } }] }),
    ).toHaveLength(1);
    expect(fanRows(null)).toEqual([]);
  });
});
