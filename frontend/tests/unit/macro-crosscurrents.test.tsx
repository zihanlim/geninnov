// MacroCrossCurrents — the ADR-0139/0140 readings, and the refusals that make
// them honest.
//
// What is pinned here is not layout but contract: a NULL composite must render
// as an absence that NAMES its missing input (ADR-0091 — "we cannot say" and
// "zero" are different claims); a NULL posture must never read as "neutral";
// the pivot's two absences ("no prior posture" vs "no pivot") must not merge;
// and the posture ink must reuse the directional vocabulary (dovish = --long,
// hawkish = --short, ADR-0140) with the WORD always printed beside the colour.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import MacroCrossCurrents, { type CrossCurrents } from "@/components/MacroCrossCurrents";

const LIVE: CrossCurrents = {
  // The first live shadow row, 2026-07-28.
  debasement_pressure: 7.7,
  debasement_real_yield_comp: 0.0,
  debasement_dxy_decline_comp: 0.0203,
  debasement_gold_rise_comp: 0.0,
  debasement_comovement_comp: 0.3599,
  debasement_lookback_weeks: 26,
  fed_posture: "hawkish",
  fed_pivot_delta: null,
  fed_rate_change_13w_bps: -1,
  fed_curve_change_13w_bps: -16,
  fed_curve_steepness_bps: 36,
  fed_posture_evidence: {
    inputs: { dff_pct: 4.33, dgs2_pct: 3.64, dgs10_pct: 4.0 },
    prior_posture: null,
  },
};

// SSR inserts `<!-- -->` between adjacent text segments; strip them so the
// assertions read the text a browser shows, not the hydration markers.
const render = (cc: CrossCurrents | null, cycle: string | null = "late") =>
  renderToString(<MacroCrossCurrents cycle={cycle} cc={cc} />).replace(/<!-- -->/g, "");

describe("MacroCrossCurrents — debasement card", () => {
  it("renders the composite with its band and the four components with anchors", () => {
    const html = render(LIVE);
    expect(html).toContain("7.7");
    expect(html).toContain("LOW");
    expect(html).toContain("Real yield vs −2%");
    expect(html).toContain("Gold 26w return vs +20%");
    expect(html).toContain("26-week window");
  });

  it("a NULL composite names the missing input rather than showing zero", () => {
    const html = render({ ...LIVE, debasement_pressure: null, debasement_comovement_comp: null });
    expect(html).not.toContain("0.0/100");
    expect(html).toContain("Not computable");
    expect(html).toContain("60 paired daily observations");
    expect(html).toContain("Absence is not zero");
  });

  it("stacked-bar bands are the weighted contribution, not the raw component", () => {
    // comovement 0.3599 × weight 20 → 7.198% of the 100-point track.
    const html = render(LIVE);
    expect(html).toContain("width:7.198%");
  });
});

describe("MacroCrossCurrents — posture card", () => {
  it("prints the posture WORD in the directional ink — colour is never the only channel", () => {
    const html = render(LIVE);
    expect(html).toContain("HAWKISH");
    expect(html).toContain("text-short");
    const dovish = render({ ...LIVE, fed_posture: "dovish" });
    expect(dovish).toContain("DOVISH");
    expect(dovish).toContain("text-long");
  });

  it("a NULL posture never reads as neutral", () => {
    const html = render({ ...LIVE, fed_posture: null });
    expect(html).toContain("Never defaulted to neutral");
    expect(html).not.toContain("NEUTRAL");
  });

  it("keeps the two absences distinct: no prior posture is not no pivot", () => {
    const html = render(LIVE); // pivot null, prior null, posture present
    expect(html).toContain("no posture on record 13 weeks back");
  });

  it("a real pivot renders from → to with its signed delta", () => {
    const html = render({
      ...LIVE,
      fed_pivot_delta: -2,
      fed_posture_evidence: { ...LIVE.fed_posture_evidence, prior_posture: "dovish" },
    });
    expect(html).toContain("Pivot -2");
    expect(html).toContain("Dovish → Hawkish");
  });

  it("shows the raw inputs in percent — levels are percent, spreads are bps (ADR-0137)", () => {
    const html = render(LIVE);
    expect(html).toContain("DFF 4.33%");
    expect(html).toContain("bp / 13w");
  });
});

describe("MacroCrossCurrents — cycle × posture", () => {
  it("states the pair explicitly and marks the current cell of each row", () => {
    const html = render(LIVE);
    expect(html).toContain("late × hawkish");
    // All four cycle stages and all three postures are printed, so the reader
    // sees the vocabulary, not just today's value.
    for (const w of ["early", "mid", "late", "recession", "dovish", "neutral", "hawkish"]) {
      expect(html).toContain(w);
    }
  });
});
