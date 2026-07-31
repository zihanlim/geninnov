import { describe, expect, it } from "vitest";
import { describeDownCapture, MIN_CAPTURE_DAYS } from "@/lib/risk/benchmarkReading";

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

  it("WITHHOLDS the verdict on very few down days rather than caveating it", () => {
    // CHANGED, and the change is the point. This used to return `claim_holds` with
    // " Measured over 2 down days, which describes those days rather than the book."
    // appended — leading with "the book's central claim holding" and trailing the
    // limitation, which is the order that gets the claim remembered and the caveat
    // skimmed. The module header always said the thin case "withholds the CLAIM"; now
    // it does.
    const thin = describeDownCapture(-0.5, 2)!;
    expect(thin.verdict).toBe("too_thin");
    expect(thin.text).toContain("2 down days");
    expect(thin.text).not.toContain("central claim holding");
    expect(thin.text).not.toContain("rose while the benchmark fell");
  });

  it("withholds on a thin sample whatever the value would have said", () => {
    // Not just the flattering direction. A book that fell HARDER than the benchmark
    // over one day must not be convicted on that day either — the sample bound is
    // about the sample, not about which answer it gives.
    for (const v of [-0.5, 0.4, 1.3]) {
      expect(describeDownCapture(v, 1)!.verdict, `value ${v}`).toBe("too_thin");
    }
  });

  it("publishes a verdict once the sample clears the floor", () => {
    expect(describeDownCapture(-0.5, MIN_CAPTURE_DAYS)!.verdict).toBe("claim_holds");
    expect(describeDownCapture(-0.5, MIN_CAPTURE_DAYS - 1)!.verdict).toBe("too_thin");
  });

  it("singularises one down day", () => {
    const r = describeDownCapture(0.5, 1)!;
    expect(r.text).toContain("1 down day is");
    expect(r.text).not.toContain("1 down days");
  });

  it("returns null rather than a verdict when there is no number", () => {
    expect(describeDownCapture(null)).toBeNull();
    expect(describeDownCapture(undefined)).toBeNull();
    expect(describeDownCapture(Number.NaN)).toBeNull();
  });
});
