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

function pyConst(name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m").exec(RISK_ENGINE);
  expect(m, `${name} should exist in risk_engine.py`).not.toBeNull();
  return Number(m![1]);
}

describe("thresholds agree across the language boundary", () => {
  it("matches MIN_DAYS_FOR_* in risk_engine.py", () => {
    expect(MIN_SESSIONS_BY_FIELD.var_95).toBe(pyConst("MIN_DAYS_FOR_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.cvar_95).toBe(pyConst("MIN_DAYS_FOR_VAR"));
    expect(MIN_SESSIONS_BY_FIELD.sharpe).toBe(pyConst("MIN_DAYS_FOR_SHARPE"));
    expect(MIN_SESSIONS_BY_FIELD.beta).toBe(pyConst("MIN_DAYS_FOR_BETA"));
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

  it("reports the live 2026-07-25 shortfall: three sessions withholds all four", () => {
    expect(withheldFields(3).sort()).toEqual(["beta", "cvar_95", "sharpe", "var_95"]);
    expect(withheldFields(30).sort()).toEqual(["beta", "sharpe"]);  // VaR/CVaR clear at 30
    expect(withheldFields(60)).toEqual([]);
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
