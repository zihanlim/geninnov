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

/**
 * Down days below which a capture ratio describes those days rather than the book.
 *
 * Exported so the panel gates the FIGURE on the same number the reading gates the
 * CLAIM. They were two decisions before, and the figure had no gate at all — a
 * down-capture over a single day rendered as a published statistic, and the
 * sentence beneath it called that day the book's central claim holding.
 */
export const MIN_CAPTURE_DAYS = 5;

export type DownCaptureVerdict =
  | "claim_holds"
  | "dampened"
  | "claim_contradicted"
  /** Too few down days to read as anything about the book. */
  | "too_thin";

export interface DownCaptureReading {
  verdict: DownCaptureVerdict;
  text: string;
}

export function describeDownCapture(
  value: number | null | undefined,
  downDays?: number | null,
): DownCaptureReading | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  // WITHHOLD THE CLAIM, do not caveat it.
  //
  // This block used to append " Measured over N down days, which describes those
  // days rather than the book." to the END of a sentence that had already asserted
  // "the book's central claim holding". The module header said the thin case
  // "withholds the CLAIM"; it did not — it led with the claim and trailed the
  // limitation, which is the order that gets the claim remembered. Over ONE down
  // day the honest reading is that there is no reading.
  const thin =
    typeof downDays === "number" && downDays > 0 && downDays < MIN_CAPTURE_DAYS;
  if (thin) {
    const d = downDays as number;
    const days = `${d} down ${d === 1 ? "day" : "days"}`;
    return {
      verdict: "too_thin",
      text:
        `${days} ${d === 1 ? "is" : "are"} not a measurement of the book. The capture ` +
        `ratio is computed from ${d === 1 ? "that session" : "those sessions"} and shown ` +
        `above without a verdict — reading the market-neutral-to-short claim needs at ` +
        `least ${MIN_CAPTURE_DAYS} down days.`,
    };
  }

  if (value < 0) {
    return {
      verdict: "claim_holds",
      text:
        "A negative down-capture is the book's central claim holding: it rose while the " +
        "benchmark fell.",
    };
  }
  if (value < 1) {
    return {
      verdict: "dampened",
      text:
        "The book fell less than the benchmark on its down days, but it did fall — this is " +
        "dampening, not the negative capture a short book claims.",
    };
  }
  return {
    verdict: "claim_contradicted",
    text:
      "The book fell at least as hard as the benchmark on its down days, which is the " +
      "opposite of what a market-neutral-to-short book claims.",
  };
}
