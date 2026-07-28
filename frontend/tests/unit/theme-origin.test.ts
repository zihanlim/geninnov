import { describe, expect, it } from "vitest";
import {
  BASIS_COPY,
  evidenceExpected,
  orderingCaveat,
  originSummary,
  type ThemeOrigin,
} from "@/lib/themeOrigin";

/**
 * ADR-0134. Before migration 051 all nine themes read `practitioner` with a null
 * `discovered_at`, so a theme created on evidence was indistinguishable from one
 * assumed in migration 001.
 */

const AI_CAPEX: ThemeOrigin = {
  promotion_basis: "operator_directed",
  promoted_on: "2026-07-28",
  promotion_evidence: {
    at_promotion: { method: "frequency", doc_count: 2, corpus_size: 455 },
    retrospective: { method: "lda", result: "AI/capex in 4 of 8 LDA topics" },
    ordering_caveat: "The measurement followed the decision.",
  },
};

const FED_POLICY: ThemeOrigin = {
  promotion_basis: "practitioner_prior",
  promoted_on: null,
  promotion_evidence: null,
};

describe("a prior and a discovery are different claims", () => {
  it("only measured_discovery claims the system found the theme", () => {
    const claiming = Object.entries(BASIS_COPY)
      .filter(([, c]) => c.claimsDiscovery)
      .map(([k]) => k);
    expect(claiming).toEqual(["measured_discovery"]);
  });

  it("an operator-directed theme does NOT claim discovery", () => {
    // AI Capex was named by a person. The LDA measurement came after, and
    // recording it as measured_discovery would defeat the column's purpose.
    expect(BASIS_COPY.operator_directed.claimsDiscovery).toBe(false);
  });

  it("distinguishes the two themes that used to look identical", () => {
    expect(originSummary(AI_CAPEX)).toBe("Operator-directed · promoted 2026-07-28");
    expect(originSummary(FED_POLICY)).toBe("Practitioner prior");
    expect(originSummary(AI_CAPEX)).not.toBe(originSummary(FED_POLICY));
  });
});

describe("absent evidence on a prior is not a gap", () => {
  it("does not expect evidence from a practitioner prior", () => {
    // A prior has no evidence by definition. Treating its null payload as
    // "not recorded" would manufacture a defect out of an honest label.
    expect(evidenceExpected("practitioner_prior")).toBe(false);
  });

  it("does expect evidence where a decision claimed some", () => {
    expect(evidenceExpected("operator_directed")).toBe(true);
    expect(evidenceExpected("measured_discovery")).toBe(true);
  });

  it("treats unrecorded as an answer, not an absence", () => {
    expect(evidenceExpected("unrecorded")).toBe(false);
    expect(BASIS_COPY.unrecorded.detail).toContain("nobody wrote down why");
  });
});

describe("the ordering caveat is derived, not asserted", () => {
  it("surfaces that the measurement followed the decision", () => {
    expect(orderingCaveat(AI_CAPEX)).toBe("The measurement followed the decision.");
  });

  it("infers the caveat from the payload shape when none is written", () => {
    // A retrospective block on a non-measured_discovery basis IS the caveat,
    // whether or not anyone remembered to spell it out.
    const inferred: ThemeOrigin = {
      promotion_basis: "operator_directed",
      promoted_on: "2026-07-28",
      promotion_evidence: { retrospective: { method: "lda" } },
    };
    expect(orderingCaveat(inferred)).toContain("followed the decision");
  });

  it("does not caveat a genuine measured discovery", () => {
    const measured: ThemeOrigin = {
      promotion_basis: "measured_discovery",
      promoted_on: "2026-08-01",
      promotion_evidence: { retrospective: { method: "lda" } },
    };
    expect(orderingCaveat(measured)).toBeNull();
  });

  it("has nothing to caveat when there is no evidence", () => {
    expect(orderingCaveat(FED_POLICY)).toBeNull();
  });
});

describe("an unknown basis degrades to unrecorded rather than throwing", () => {
  it("handles a null basis", () => {
    const unknown: ThemeOrigin = {
      promotion_basis: null,
      promoted_on: null,
      promotion_evidence: null,
    };
    expect(originSummary(unknown)).toBe("Unrecorded");
  });
});
