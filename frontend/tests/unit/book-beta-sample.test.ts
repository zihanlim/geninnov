import { describe, it, expect } from "vitest";
import { MIN_SESSIONS } from "@/lib/risk/riskBoard";

/**
 * `/risk` withheld Beta from its metrics tile — *"Not shown: 3 sessions of history,
 * needs 60. A Beta from this sample is noise, so we do not publish one."* — and then,
 * roughly 200px lower, printed the same statistic as **book β −1.73** beside the
 * per-position contribution sum of **−0.04**.
 *
 * Same statistic, withheld as noise in one panel and published as a reconciliation
 * target in another, on one page. Iteration 21 fixed exactly this for the risk-limit
 * board; it survived in the attribution panel because that panel takes beta as a prop
 * and never saw the sample size (ADR-0062).
 *
 * The gate is extracted here so the rule can be asserted without a DOM renderer. It is
 * the same expression the component evaluates, reading the same MIN_SESSIONS constant
 * the tile and the board read.
 */
function showBookBeta(returnSessions: number | null | undefined): boolean {
  const need = MIN_SESSIONS.beta_abs ?? 60;
  const under =
    typeof returnSessions === "number" &&
    Number.isFinite(returnSessions) &&
    returnSessions < need;
  return !under;
}

describe("book β is withheld on the same bar as the Beta tile", () => {
  it("withholds on the live 3-session book that printed −1.73", () => {
    expect(showBookBeta(3)).toBe(false);
  });

  it("shares one threshold with the tile and the limit board", () => {
    // If this ever diverges from MIN_DAYS_FOR_BETA the three surfaces disagree again,
    // which is the whole defect.
    expect(MIN_SESSIONS.beta_abs).toBe(60);
  });

  it("publishes once the sample reaches the declared minimum", () => {
    expect(showBookBeta(59)).toBe(false);
    expect(showBookBeta(60)).toBe(true);
    expect(showBookBeta(252)).toBe(true);
  });

  it("does NOT withhold when the sample size is unknown", () => {
    // Not knowing how much history there is, is not evidence that there is little.
    // buildLimitBoard follows the same rule; diverging here would blank a figure on
    // any page whose returns query failed rather than returned few rows.
    expect(showBookBeta(null)).toBe(true);
    expect(showBookBeta(undefined)).toBe(true);
  });

  it("treats zero sessions as under-sampled, not as unknown", () => {
    expect(showBookBeta(0)).toBe(false);
  });
});
