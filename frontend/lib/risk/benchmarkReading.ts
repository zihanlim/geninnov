// What a down-capture number actually says about this book's claim.
//
// The book's central claim is that it is market-neutral-to-short. Down-capture is the
// falsifiable version of it: the share of the benchmark's fall the book caught over the
// benchmark's DOWN days.
//
//   below 0   the book ROSE while the benchmark fell — the claim holding
//   0 to 1    the book fell, but less — dampening, which is not the same claim
//   1 or more the book fell at least as hard — the opposite of the claim
//
// Extracted from the component because it is the one part of that panel that makes an
// assertion rather than formatting a number, and an assertion belongs somewhere a test can
// reach it. The three readings are genuinely different findings and collapsing the middle
// one into "good" is how a dampened book gets described as a short one.

export type DownCaptureVerdict = "claim_holds" | "dampened" | "claim_contradicted";

export interface DownCaptureReading {
  verdict: DownCaptureVerdict;
  text: string;
}

export function describeDownCapture(
  value: number | null | undefined,
  downDays?: number | null,
): DownCaptureReading | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  // A verdict from one or two down days is a description of those days. The panel still
  // shows the number; this only withholds the CLAIM about it.
  const thin = typeof downDays === "number" && downDays > 0 && downDays < 5;
  const caveat = thin
    ? ` Measured over ${downDays} down ${downDays === 1 ? "day" : "days"}, which describes those days rather than the book.`
    : "";

  if (value < 0) {
    return {
      verdict: "claim_holds",
      text:
        "A negative down-capture is the book's central claim holding: it rose while the " +
        "benchmark fell." + caveat,
    };
  }
  if (value < 1) {
    return {
      verdict: "dampened",
      text:
        "The book fell less than the benchmark on its down days, but it did fall — this is " +
        "dampening, not the negative capture a short book claims." + caveat,
    };
  }
  return {
    verdict: "claim_contradicted",
    text:
      "The book fell at least as hard as the benchmark on its down days, which is the " +
      "opposite of what a market-neutral-to-short book claims." + caveat,
  };
}
