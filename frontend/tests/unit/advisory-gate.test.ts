// Strict-provenance gate for investor-facing advisory prose.
//
// `canRenderAdvisoryBody` is the single authority deciding whether L5 thesis
// text reaches an investor. Playwright cannot exercise these cases because it
// can only assert against whatever data happens to be live; the dangerous
// combinations below have to be constructed directly.

import { describe, it, expect } from "vitest";
import {
  canRenderAdvisoryBody,
  type AdvisoryDerivation,
} from "@/lib/derivations/advisory";

function advisory(overrides: Partial<AdvisoryDerivation> = {}): AdvisoryDerivation {
  return {
    field_id: "trade.thesis.body",
    generated_by: "l5_q1_agent",
    display_status: "verified",
    body: "Long HYG on credit-spread compression.",
    method_id: "l5.q1.reasoning.v3",
    evidence_ids: ["cite:1"],
    citation_status: "all_verified",
    fallback_used: false,
    computed_at: "2026-07-22T02:12:00Z",
    as_of: "2026-07-22T02:00:00Z",
    ...overrides,
  };
}

describe("canRenderAdvisoryBody", () => {
  it("allows a fully verified advisory", () => {
    expect(canRenderAdvisoryBody(advisory())).toBe(true);
  });

  it("allows a partial advisory (some citations failed but retry succeeded)", () => {
    expect(
      canRenderAdvisoryBody(
        advisory({
          display_status: "partial",
          citation_status: "some_failed_retry_ok",
        }),
      ),
    ).toBe(true);
  });

  // The production defect this gate exists to prevent: the L5 run fell back to
  // deterministic prose (verified=false, retries=5) yet still carried a
  // plausible-looking body.
  it("refuses a heuristic fallback even when a body is present", () => {
    expect(
      canRenderAdvisoryBody(
        advisory({
          display_status: "unverified",
          fallback_used: true,
          citation_status: "some_failed_no_retry",
          evidence_ids: [],
        }),
      ),
    ).toBe(false);
  });

  it("refuses fallback prose that claims verified status", () => {
    expect(canRenderAdvisoryBody(advisory({ fallback_used: true }))).toBe(false);
  });

  it("refuses an unverified advisory", () => {
    expect(canRenderAdvisoryBody(advisory({ display_status: "unverified" }))).toBe(false);
  });

  it("refuses an unavailable advisory", () => {
    expect(
      canRenderAdvisoryBody(
        advisory({ display_status: "unavailable", body: null }),
      ),
    ).toBe(false);
  });

  it("refuses an empty body even when verified", () => {
    expect(canRenderAdvisoryBody(advisory({ body: "" }))).toBe(false);
  });

  it("refuses a null body even when verified", () => {
    expect(canRenderAdvisoryBody(advisory({ body: null }))).toBe(false);
  });

  // Legacy rows persisted before the advisory column existed carry no
  // provenance at all, so their body is exactly as untrustworthy as an
  // unverified one. This is the current production state.
  it("refuses a missing advisory (legacy row, column absent)", () => {
    expect(canRenderAdvisoryBody(null)).toBe(false);
    expect(canRenderAdvisoryBody(undefined)).toBe(false);
  });
});
