// frontend/tests/unit/derivation-format.test.ts
//
// The `≈` marker on estimated figures has NO on-screen exercise: the live book
// currently publishes 2 Exact and 4 Unavailable metrics on /risk and nothing
// marked `estimated`, so a regression here would not show up in a screenshot or
// a manual pass. That is precisely why the rule was extracted out of
// RiskMetricsGrid's JSX and into lib/ — tests run in a `node` environment with
// no jsdom and no testing-library, so a ternary inside a component cannot be
// asserted on at all.

import { describe, expect, it } from "vitest";
import { markEstimated } from "@/lib/derivations/format";
import type { NumericStatus } from "@/lib/derivations/numeric";

const APPROX = "≈";

describe("markEstimated", () => {
  it("prefixes an estimated figure", () => {
    expect(markEstimated("1.23", "estimated")).toBe(`${APPROX}1.23`);
  });

  it("leaves an exact figure exactly as rendered", () => {
    expect(markEstimated("1.23", "exact")).toBe("1.23");
  });

  it("marks ONLY estimated — stale and unverified are different claims", () => {
    // `stale` is about freshness and `unverified` about provenance. Neither
    // means "approximately", and marking them would tell a reader the number is
    // imprecise when what is actually wrong is its age or its sourcing.
    const unmarked: NumericStatus[] = ["exact", "stale", "unavailable", "unverified"];
    for (const status of unmarked) {
      expect(markEstimated("42", status), `${status} must not be marked`).toBe("42");
    }
  });

  it("does not double-mark a value that already carries the glyph", () => {
    // Defensive: if a caller ever pre-formats with the marker, the result must
    // still read as one estimate, not two.
    expect(markEstimated(`${APPROX}5`, "estimated")).toBe(`${APPROX}5`);
  });

  it("preserves the rendered string verbatim, units and signs included", () => {
    expect(markEstimated("-$2.0M", "estimated")).toBe(`${APPROX}-$2.0M`);
    expect(markEstimated("+1.36", "estimated")).toBe(`${APPROX}+1.36`);
    expect(markEstimated("59.33%", "estimated")).toBe(`${APPROX}59.33%`);
    expect(markEstimated("—", "estimated")).toBe(`${APPROX}—`);
  });

  it("uses U+2248, not a lookalike", () => {
    // ~ (U+007E) and ∼ (U+223C) both read as "approximately" and neither is the
    // glyph. This also fails loudly if the source file is ever re-encoded, which
    // has happened twice in this repo.
    const out = markEstimated("1", "estimated");
    expect(out.codePointAt(0)).toBe(0x2248);
  });
});
