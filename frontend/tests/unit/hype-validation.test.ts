import { describe, it, expect } from "vitest";
import {
  horizonStatus,
  isValidated,
  isMeasuredThin,
  type HorizonIC,
} from "@/lib/method/hypeValidation";

const H = (o: Partial<HorizonIC>): HorizonIC => ({
  h: 1,
  ic: null,
  nObs: null,
  nDates: null,
  icIr: null,
  ...o,
});

describe("hype validation verdict", () => {
  it("a single-date IC is measured, NOT validated", () => {
    // The live 2026-07-25 state: h1 IC -0.228 from one cross-section, ic_ir undefined.
    // This is the exact trap — a lucky one-day reading must never flip the panel green.
    const thin = H({ ic: -0.228, nObs: 8, nDates: 1, icIr: null });
    expect(horizonStatus(thin)).toBe("measured-thin");
    expect(isValidated([thin])).toBe(false);
    expect(isMeasuredThin([thin])).toBe(true);
  });

  it("an IC with an information ratio across dates is validated", () => {
    const stable = H({ ic: 0.04, nObs: 40, nDates: 5, icIr: 0.6 });
    expect(horizonStatus(stable)).toBe("validated");
    expect(isValidated([stable])).toBe(true);
    expect(isMeasuredThin([stable])).toBe(false);
  });

  it("validates the whole panel if ANY horizon has a stable IC", () => {
    const stats = [
      H({ h: 1, ic: -0.228, nDates: 1, icIr: null }),
      H({ h: 5, ic: 0.05, nObs: 30, nDates: 4, icIr: 0.5 }),
      H({ h: 20, ic: null }),
    ];
    expect(isValidated(stats)).toBe(true);
    expect(isMeasuredThin(stats)).toBe(false);
  });

  it("distinguishes no-window from too-few-names", () => {
    expect(horizonStatus(H({ ic: null, nObs: 0 }))).toBe("no-window");
    expect(horizonStatus(H({ ic: null, nObs: 4 }))).toBe("too-few-names");
  });

  it("is neither validated nor thin when nothing has been measured at all", () => {
    // The pre-2026-07-25 state: all horizons null, n_obs 0 — genuinely no data.
    const empty = [H({ h: 1 }), H({ h: 5 }), H({ h: 20 })];
    expect(isValidated(empty)).toBe(false);
    expect(isMeasuredThin(empty)).toBe(false);
  });

  it("treats ic_ir as the boundary, independent of how many obs one date had", () => {
    // Many observations on a SINGLE date is still one cross-section: n_obs is large,
    // n_dates is 1, ic_ir is null → not validated. Sample breadth is not stability.
    const wide1Date = H({ ic: 0.1, nObs: 500, nDates: 1, icIr: null });
    expect(isValidated([wide1Date])).toBe(false);
    expect(horizonStatus(wide1Date)).toBe("measured-thin");
  });
});
