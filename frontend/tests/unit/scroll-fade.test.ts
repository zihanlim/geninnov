// frontend/tests/unit/scroll-fade.test.ts
//
// The fade at the ends of the phase strip.
//
// The strip became six items at ADR-0170 and stops fitting well before `wide`:
// at 900px two phases sit outside the track with nothing to indicate it, which
// reads as a nav that HAS four items rather than one showing four of six.
//
// The failure mode this guards is the tempting version of the fix — a STATIC
// right-edge fade. At every width where all six already fit, that dims
// `06 Attribution` permanently, which reads as disabled rather than as
// continued: worse than the problem it set out to solve. So the mask is a
// function of actual overflow and scroll position, and returns null when nothing
// is clipped.

import { describe, expect, it } from "vitest";
import { scrollFadeMask } from "@/components/TopBar";

describe("scrollFadeMask", () => {
  it("returns no mask when the strip fits", () => {
    // The whole point. A fade here would dim the last tab for no reason.
    expect(scrollFadeMask(0, 600, 600)).toBeNull();
    expect(scrollFadeMask(0, 900, 480)).toBeNull();
  });

  it("ignores sub-pixel overflow", () => {
    // Fractional layout widths make scrollWidth exceed clientWidth by a fraction
    // on a strip that visually fits; fading there is a mask over nothing.
    expect(scrollFadeMask(0, 600, 600.4)).toBeNull();
    expect(scrollFadeMask(0, 600, 601)).toBeNull();
  });

  it("fades only the right end when scrolled hard left", () => {
    const m = scrollFadeMask(0, 600, 900);
    expect(m).not.toBeNull();
    expect(m).toContain("black 0");
    expect(m).toContain("transparent 100%");
    // Nothing is hidden to the left, so the left edge must stay opaque.
    expect(m).not.toMatch(/^linear-gradient\(to right, transparent 0/);
  });

  it("fades only the left end when scrolled hard right", () => {
    const m = scrollFadeMask(300, 600, 900);
    expect(m).not.toBeNull();
    expect(m).toContain("transparent 0");
    expect(m).toContain("black 100%");
    expect(m).not.toContain("transparent 100%");
  });

  it("fades both ends mid-scroll", () => {
    const m = scrollFadeMask(120, 600, 900);
    expect(m).toContain("transparent 0");
    expect(m).toContain("transparent 100%");
  });

  it("treats a 1px shortfall at either end as arrived", () => {
    // Browsers report fractional scrollLeft, so requiring exact equality leaves a
    // permanent 1px fade a reader cannot scroll away.
    expect(scrollFadeMask(1, 600, 900)).not.toContain("transparent 0");
    expect(scrollFadeMask(299, 600, 900)).not.toContain("transparent 100%");
  });

  it("is a valid single linear-gradient in every masked case", () => {
    for (const [sl, cw, sw] of [
      [0, 600, 900],
      [150, 600, 900],
      [300, 600, 900],
    ] as const) {
      const m = scrollFadeMask(sl, cw, sw)!;
      expect(m).toMatch(/^linear-gradient\(to right, .+\)$/);
      expect((m.match(/linear-gradient/g) ?? []).length).toBe(1);
    }
  });
});
