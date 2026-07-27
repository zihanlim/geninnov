import { describe, expect, it } from "vitest";
import { describeDownCapture } from "@/lib/risk/benchmarkReading";

describe("describeDownCapture", () => {
  it("reads a negative capture as the claim holding", () => {
    const r = describeDownCapture(-0.26, 20)!;
    expect(r.verdict).toBe("claim_holds");
    expect(r.text).toContain("rose while the benchmark fell");
  });

  it("does NOT read dampening as a short book", () => {
    // The failure this guards: 0.4 means the book fell, just less. Calling that "the claim
    // holding" would describe a long-biased book as market-neutral-to-short.
    const r = describeDownCapture(0.4, 20)!;
    expect(r.verdict).toBe("dampened");
    expect(r.text).toContain("it did fall");
    expect(r.text).not.toContain("rose while");
  });

  it("reads full capture as contradicting the claim", () => {
    expect(describeDownCapture(1.0, 20)!.verdict).toBe("claim_contradicted");
    expect(describeDownCapture(1.3, 20)!.verdict).toBe("claim_contradicted");
  });

  it("boundaries fall on the right side", () => {
    expect(describeDownCapture(0, 20)!.verdict).toBe("dampened");        // fell exactly 0%
    expect(describeDownCapture(-0.0001, 20)!.verdict).toBe("claim_holds");
    expect(describeDownCapture(0.9999, 20)!.verdict).toBe("dampened");
  });

  it("caveats a verdict drawn from very few down days", () => {
    // The number still renders; only the CLAIM about it is qualified.
    const thin = describeDownCapture(-0.5, 2)!;
    expect(thin.verdict).toBe("claim_holds");
    expect(thin.text).toContain("2 down days");
    expect(thin.text).toContain("rather than the book");

    const ample = describeDownCapture(-0.5, 40)!;
    expect(ample.text).not.toContain("rather than the book");
  });

  it("singularises one down day", () => {
    expect(describeDownCapture(0.5, 1)!.text).toContain("1 down day,");
  });

  it("returns null rather than a verdict when there is no number", () => {
    expect(describeDownCapture(null)).toBeNull();
    expect(describeDownCapture(undefined)).toBeNull();
    expect(describeDownCapture(Number.NaN)).toBeNull();
  });
});
