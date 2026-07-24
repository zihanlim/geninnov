import { describe, it, expect } from "vitest";
import { netShareIsMeaningful } from "@/lib/risk/riskBoard";

/**
 * `/risk`'s per-position attribution divided each signed weight by the book's NET
 * exposure and guarded only against a literal zero. A long-short book is BUILT to run
 * near market-neutral, so that denominator is near zero by design.
 *
 * The live 2026-07-25 book — net +0.90% on 59.6% gross — rendered a "Net share"
 * column reading -1071.4%, -1019.0%, +975.7%, +711.9%, +686.6%. Arithmetically what
 * the formula says; meaningless as a share, and alarming to read (ADR-0060).
 */

/** The live 2026-07-25 book, signed weights as rendered on /risk. */
const LIVE_BOOK = [-0.096, -0.091, 0.043, 0.062, 0.064, -0.059, 0.047, 0.088, -0.047];

describe("netShareIsMeaningful", () => {
  it("rejects the live market-neutral book that produced ±1000% shares", () => {
    const net = LIVE_BOOK.reduce((s, w) => s + w, 0);
    // Sanity-check the fixture is the near-neutral book, not a typo.
    expect(Math.abs(net)).toBeLessThan(0.02);
    expect(netShareIsMeaningful(LIVE_BOOK)).toBe(false);
  });

  it("accepts a genuinely directional book", () => {
    // Net 50%, largest position 15% — every share lands under 100%, so the
    // decomposition means something.
    const directional = [0.15, 0.12, 0.1, 0.08, 0.05];
    expect(netShareIsMeaningful(directional)).toBe(true);
  });

  it("turns on exactly where a share would first exceed the whole", () => {
    // Largest position equals net -> the biggest share is exactly 100%: still a
    // share. One basis point more and it is not.
    expect(netShareIsMeaningful([0.1, 0.05, -0.05])).toBe(true); // net 0.10, max 0.10
    expect(netShareIsMeaningful([0.1, 0.05, -0.06])).toBe(false); // net 0.09, max 0.10
  });

  it("rejects a perfectly hedged book rather than dividing by zero", () => {
    expect(netShareIsMeaningful([0.1, -0.1])).toBe(false);
    expect(netShareIsMeaningful([])).toBe(false);
  });

  it("is sign-agnostic — a net-SHORT book decomposes just as well", () => {
    const netShort = [-0.15, -0.12, -0.1, -0.08, 0.05];
    expect(netShareIsMeaningful(netShort)).toBe(true);
  });

  it("treats a null weight as absent, not as zero risk", () => {
    // A position whose weight could not be read must not silently shrink the max and
    // let an unreadable book qualify.
    expect(netShareIsMeaningful([null, 0.1, 0.05, -0.05])).toBe(true);
    expect(netShareIsMeaningful([null, null])).toBe(false);
  });
});
