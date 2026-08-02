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
  // ADR-0141: 2026-07-29 meeting: 9-3 hold, all three dissents hawkish
  // (Daly, Logan, Kashkari). Score = (3-0) * 10 / 12 = +2.5 -> "hawkish".
  // The card shows posture (market-implied) AND rhetoric (FOMC self-report)
  // side by side, so a reader can see the gap when they disagree.
  fed_rhetoric_score: 2.5,
  fed_rhetoric_label: "hawkish",
  fed_rhetoric_evidence: {
    source: "FOMC press release",
    meeting_date: "2026-07-29",
    vote: { for: 9, against: 3, voting_members: 12 },
    dissents: [
      { voter: "Daly (San Francisco)", direction: "hawkish", preferred_action: "hike 25bp" },
      { voter: "Logan (Dallas)", direction: "hawkish", preferred_action: "hike 25bp" },
      { voter: "Kashkari (Minneapolis)", direction: "hawkish", preferred_action: "hike 25bp" },
    ],
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

describe("MacroCrossCurrents — rhetoric card (ADR-0141)", () => {
  it("prints the rhetoric WORD in the directional ink — same channel discipline as posture", () => {
    const html = render(LIVE);
    // The 2026-07-29 meeting scored +2.5 -> "hawkish" band, not "strongly_hawkish".
    expect(html).toContain("HAWKISH");
    // Strongly-dovish and strongly-hawkish reuse the directional ink of their
    // milder cousins; the qualifier is in the WORD, not the colour.
    const sd = render({ ...LIVE, fed_rhetoric_label: "strongly_dovish", fed_rhetoric_score: -7.5 });
    expect(sd).toContain("STRONGLY DOVISH");
    expect(sd).toContain("text-long");
    const sh = render({ ...LIVE, fed_rhetoric_label: "strongly_hawkish", fed_rhetoric_score: 7.5 });
    expect(sh).toContain("STRONGLY HAWKISH");
    expect(sh).toContain("text-short");
  });

  it("prints the rhetoric score with sign and the dissent count from the evidence", () => {
    const html = render(LIVE);
    // +2.5 with the explicit sign — the negative case is tested below.
    expect(html).toContain("+2.5");
    expect(html).toContain("3 dissents");
    expect(html).toContain("2026-07-29");
  });

  it("a negative score carries the minus sign in front of the number", () => {
    const html = render({
      ...LIVE,
      fed_rhetoric_score: -3.5,
      fed_rhetoric_label: "dovish",
    });
    expect(html).toContain("(-3.5)");
  });

  it("a singular dissent reads 'dissent', not 'dissents'", () => {
    const html = render({
      ...LIVE,
      fed_rhetoric_evidence: {
        source: "FOMC press release",
        meeting_date: "2026-05-15",
        vote: { for: 11, against: 1, voting_members: 12 },
        dissents: [{ voter: "Miran", direction: "dovish", preferred_action: "cut 25bp" }],
      },
    });
    expect(html).toContain("1 dissent");
    expect(html).not.toContain("1 dissents");
  });

  it("a NULL rhetoric never reads as NEUTRAL — 'no meeting on disk' is its own absence", () => {
    // Drop the rhetoric fields entirely. The card should render "—" and
    // name the absence, mirroring how a NULL posture renders "—" with
    // "Never defaulted to neutral" (ADR-0091).
    const { fed_rhetoric_score, fed_rhetoric_label, fed_rhetoric_evidence, ...rest } = LIVE;
    const html = render(rest);
    expect(html).toContain("Rhetoric");
    expect(html).toContain("—");
    expect(html).toContain("no FOMC meeting on disk");
  });

  it("rhetoric is rendered side-by-side with posture, not collapsed into it", () => {
    // The two readings must BOTH be visible on the card so the gap is
    // visible (ADR-0141 §5). A future reader who flattens them to a single
    // label would lose the tradeable signal.
    const html = render(LIVE);
    expect(html).toContain("Rhetoric");
    // Both lines (posture and rhetoric) are in the HTML; we don't pin a
    // specific ordering here because the test file reads only as a
    // contract — the visual ordering is a styling decision.
    expect(html).toMatch(/posture[\s\S]*Rhetoric|Rhetoric[\s\S]*posture/);
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
