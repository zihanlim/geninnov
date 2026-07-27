// The minimum-sample thresholds, and the surfaces that must honour them.
//
// The rule "a statistic below its declared minimum is withheld, not published" existed in
// three places kept in agreement by a COMMENT — MIN_DAYS_FOR_* in risk_engine.py,
// MIN_SESSIONS in riskBoard.ts, minSessions in RiskMetricsGrid.tsx — and in ZERO places on
// the surface that reaches the public: lib/chat/tools.ts, which feeds /ask and, through the
// shared TOOLS registry, the MCP server.
//
// On the 2026-07-25 book that meant a Sharpe of 6.32 computed from THREE return observations
// — against a declared minimum of 60 — was quotable as a cited fact by an external model,
// while the /risk tile suppressed the identical number. The guard lived in a React
// component, so every non-React consumer ignored it.
//
// These tests do two things: pin the thresholds ACROSS the language boundary by parsing the
// Python, and assert the chat tool actually withholds. Same pattern as
// derivation-parity.test.ts — derive the expectation from an artefact rather than restating
// it in a list that itself needs maintaining.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_SESSIONS_BY_FIELD, sampleAdequacy, withheldFields } from "@/lib/risk/sampleAdequacy";
import { MIN_SESSIONS } from "@/lib/risk/riskBoard";

const RISK_ENGINE = readFileSync(
  path.resolve(__dirname, "../../../backend/services/risk_engine.py"),
  "utf8",
);
const GRID = readFileSync(
  path.resolve(__dirname, "../../components/risk/RiskMetricsGrid.tsx"),
  "utf8",
);

const BENCHMARK_COMPARE = readFileSync(
  path.resolve(__dirname, "../../../backend/services/benchmark_compare.py"),
  "utf8",
);

function pyConst(name: string, source: string = RISK_ENGINE): number {
  const m = new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m").exec(source);
  expect(m, `${name} should exist in the parsed Python source`).not.toBeNull();
  return Number(m![1]);
}

describe("thresholds agree across the language boundary", () => {
  it("matches MIN_DAYS_FOR_* in risk_engine.py", () => {
    expect(MIN_SESSIONS_BY_FIELD.var_95).toBe(pyConst("MIN_DAYS_FOR_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.cvar_95).toBe(pyConst("MIN_DAYS_FOR_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.sharpe).toBe(pyConst("MIN_DAYS_FOR_SHARPE"));
    expect(MIN_SESSIONS_BY_FIELD.beta).toBe(pyConst("MIN_DAYS_FOR_BETA"));
    // The historical/downside estimators (migration 047). Same parse, same failure mode:
    // a metric with no minimum is not merely unrendered, it is quotable through /ask and
    // the MCP server.
    expect(MIN_SESSIONS_BY_FIELD.var_95_historical).toBe(pyConst("MIN_DAYS_FOR_HISTORICAL_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.es_95_historical).toBe(pyConst("MIN_DAYS_FOR_HISTORICAL_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.sortino).toBe(pyConst("MIN_DAYS_FOR_SORTINO"));
    expect(MIN_SESSIONS_BY_FIELD.max_drawdown).toBe(pyConst("MIN_DAYS_FOR_MAX_DRAWDOWN"));
    expect(MIN_SESSIONS_BY_FIELD.calmar).toBe(pyConst("MIN_DAYS_FOR_CALMAR"));
    // Computed in a DIFFERENT module but stored on the same table. Parsing only
    // risk_engine.py is what let these two ship ungated: the "gates every estimated
    // column" test below reads `compute_risk`, and these never pass through it.
    const te = pyConst("MIN_DAYS_FOR_TRACKING_ERROR", BENCHMARK_COMPARE);
    expect(MIN_SESSIONS_BY_FIELD.tracking_error).toBe(te);
    expect(MIN_SESSIONS_BY_FIELD.information_ratio).toBe(te);
    // And the module's own "thin sample" warning must be the SAME constant, not merely an
    // equal number — otherwise the payload could call a figure sufficient that the page
    // refuses to publish. Asserted as an alias so the two cannot drift apart at all.
    expect(BENCHMARK_COMPARE).toMatch(
      /^MIN_OBS_FOR_STATISTICS\s*=\s*MIN_DAYS_FOR_TRACKING_ERROR\s*$/m,
    );
  });

  it("gates every ESTIMATED column compute_risk emits", () => {
    // Derived from the artefact rather than restated: parse the keys `compute_risk` returns
    // and require a minimum for each one it labels `_estimated`. This is what fails when
    // someone adds a sixth estimator and forgets the threshold — the defect that shipped a
    // Sharpe from three observations to an external model.
    // `match` rather than `matchAll` spread: the repo's tsconfig target predates
    // downlevelIteration, and the surrounding file already uses this form.
    const estimated = (RISK_ENGINE.match(/"[a-z0-9_]+":\s*_estimated\(/g) ?? []).map(
      (s) => /"([a-z0-9_]+)"/.exec(s)![1],
    );
    expect(estimated.length, "compute_risk should emit estimated metrics").toBeGreaterThan(4);
    for (const field of estimated) {
      expect(
        MIN_SESSIONS_BY_FIELD[field],
        `${field} is an estimate with no minimum — it would be quotable unguarded`,
      ).toBeGreaterThan(0);
    }
  });

  it("matches the risk board's own copy", () => {
    expect(MIN_SESSIONS.var_95_pct).toBe(MIN_SESSIONS_BY_FIELD.var_95);
    expect(MIN_SESSIONS.cvar_95_pct).toBe(MIN_SESSIONS_BY_FIELD.cvar_95);
    expect(MIN_SESSIONS.beta_abs).toBe(MIN_SESSIONS_BY_FIELD.beta);
  });

  it("matches the metric tiles' copy", () => {
    // Parsed rather than imported: the tile definitions are module-private to the component.
    const found = [...(GRID.match(/minSessions:\s*(\d+)/g) ?? [])].map((s) =>
      Number(/(\d+)/.exec(s)![1]),
    );
    expect(found.length, "tiles should declare minimums").toBeGreaterThanOrEqual(4);
    for (const n of found) {
      expect(Object.values(MIN_SESSIONS_BY_FIELD)).toContain(n);
    }
  });

  it("gates only estimated statistics, never realised or weight-derived ones", () => {
    // HHI and capital come from today's weights; gating them would blank a real number.
    expect(MIN_SESSIONS_BY_FIELD.concentration_hhi).toBeUndefined();
    expect(MIN_SESSIONS_BY_FIELD.total_capital).toBeUndefined();
  });
});

describe("sampleAdequacy", () => {
  it("withholds below the minimum and states the shortfall", () => {
    const a = sampleAdequacy("sharpe", 3);
    expect(a.ok).toBe(false);
    if (a.ok === false) {
      expect(a.sessions).toBe(3);
      expect(a.needs).toBe(60);
      expect(a.reason).toContain("3 sessions");
      expect(a.reason).toContain("needs 60");
    }
  });

  it("publishes at exactly the minimum — the threshold is inclusive", () => {
    expect(sampleAdequacy("sharpe", 60).ok).toBe(true);
    expect(sampleAdequacy("sharpe", 59).ok).toBe(false);
  });

  it("does NOT withhold when the sample size is unknown", () => {
    // Withholding on ignorance would turn a failed count into a silent blackout — the
    // opposite failure from the one this guards.
    const a = sampleAdequacy("sharpe", null);
    expect(a.ok).toBe(true);
    expect("unjudged" in a && a.unjudged).toBe(true);
  });

  it("never gates a field it has no minimum for", () => {
    expect(sampleAdequacy("concentration_hhi", 1).ok).toBe(true);
    expect(sampleAdequacy("total_capital", 0).ok).toBe(true);
  });

  it("reports the live shortfall: three sessions withholds every estimate", () => {
    // The live series is THREE observations. Measured on it, the ungated figures were
    // Sortino 48.2 and Calmar 376.5 — arithmetically correct, editorially meaningless, and
    // before migration 047's thresholds they had no minimum at all, so they were quotable
    // through /ask and MCP exactly as the Sharpe of 6.32 had been.
    expect(withheldFields(3).sort()).toEqual([
      "beta", "calmar", "cvar_95", "es_95_historical", "information_ratio",
      "max_drawdown", "sharpe", "sortino", "tracking_error", "var_95",
      "var_95_historical",
    ]);
    // VaR/CVaR (30) and max drawdown (30) clear here; the rest need more.
    expect(withheldFields(30).sort()).toEqual([
      "beta", "calmar", "es_95_historical", "information_ratio", "sharpe",
      "sortino", "tracking_error", "var_95_historical",
    ]);
    // Sharpe/Sortino/beta and the benchmark-relative pair clear at 60. The empirical-tail
    // statistics need 100 and Calmar a full year, so a book under a year old still cannot
    // publish them.
    expect(withheldFields(60).sort()).toEqual([
      "calmar", "es_95_historical", "var_95_historical",
    ]);
    expect(withheldFields(252)).toEqual([]);
  });

  it("singularises one session", () => {
    const a = sampleAdequacy("var_95", 1);
    expect(a.ok === false && a.reason).toContain("1 session of");
  });
});

describe("the chat tool honours the thresholds", () => {
  // Reads the source rather than executing the tool: constructing a full ToolContext here
  // would test the fake, not the wiring. What matters is that the tool consults the shared
  // rule at all — the rule's behaviour is covered above.
  const TOOLS_SRC = readFileSync(
    path.resolve(__dirname, "../../lib/chat/tools.ts"),
    "utf8",
  );

  it("imports the shared rule rather than restating a threshold", () => {
    expect(TOOLS_SRC).toContain("sampleAdequacy");
    // A fifth hand-written copy is exactly what this whole file exists to prevent.
    expect(TOOLS_SRC).not.toMatch(/minSessions:\s*\d+/);
    expect(TOOLS_SRC).not.toMatch(/\bMIN_DAYS_FOR_/);
  });

  it("tells the model the figure exists but is not quotable, not that it is missing", () => {
    // "unavailable" and "not published at this sample size" are different claims, and the
    // second is the true one — saying the first would have /ask report no risk figures exist.
    expect(TOOLS_SRC).toContain("not quotable");
    expect(TOOLS_SRC).toContain("do NOT say they are unavailable");
  });
});
