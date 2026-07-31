// components/risk/BenchmarkComparison.tsx — what the panel refuses to publish.
//
// Three of the four assertions here are about a number NOT appearing. That is the
// panel's whole failure mode: every defect it shipped was a figure rendered from a
// sample (or a fit) that could not support it, sitting beside other figures correctly
// withheld on the same evidence, which is what made each one look deliberate.
//
// Rendered through SSR, the same pattern lens-scope-components.test.tsx uses: this is
// presentational, so the markup IS the behaviour.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BenchmarkComparison from "@/components/risk/BenchmarkComparison";
import type { BenchmarkComparisonRow, ConditionalVolRow } from "@/lib/risk/analytics";

/** The live 2026-07-30 row, which is where every defect below was found. */
const LIVE: BenchmarkComparisonRow = {
  computed: true,
  n: 5,
  as_of: "2026-07-30",
  sufficient: false,
  active_return: -0.0083,
  tracking_error: 0.0412,
  information_ratio: -0.2,
  beta: -0.15,
  up_capture: -0.289,
  down_capture: -0.081,
  up_days: 4,
  down_days: 1,
};

/** The live conditional_vol: GARCH fell back to EWMA and said so. */
const VOL_FALLBACK: ConditionalVolRow = {
  sample_annualised_vol: 0.1002,
  ewma: { annualised_vol: 0.0964 },
  garch: {
    annualised_vol: 0.0964,
    converged: false,
    warnings: ["sample < 30; returned the EWMA vol, not a GARCH fit"],
  },
};

const render = (
  comparison: BenchmarkComparisonRow | null,
  conditionalVol: ConditionalVolRow | null,
  sessions: number | null = 7,
) =>
  renderToStaticMarkup(
    <BenchmarkComparison
      comparison={comparison}
      conditionalVol={conditionalVol}
      sessions={sessions}
    />,
  );

describe("a fit that did not converge publishes no figure", () => {
  const html = render(LIVE, VOL_FALLBACK);

  it("shows an em-dash for GARCH, not the EWMA number wearing a GARCH label", () => {
    // `garch11` degrades to `ewma_volatility` below MIN_OBS_FOR_GARCH and returns it
    // with converged=False. The panel printed that number under "GARCH(1,1)", which
    // is why the live card read EWMA 9.64% and GARCH(1,1) 9.64% — the same figure
    // twice, one of them mislabelled.
    expect(html).toContain("EWMA");
    expect(html).toContain("9.64%");
    // The EWMA figure appears exactly once, so nothing is echoing it.
    expect(html.match(/9\.64%/g)).toHaveLength(1);
    expect(html).toContain("GARCH(1,1)");
  });

  it("states the backend's own reason rather than a generic one", () => {
    // The reason travels in `garch.warnings` and was never rendered.
    expect(html).toContain("not a GARCH fit");
    expect(html).toContain('data-testid="garch-not-converged"');
  });

  it("still prints the GARCH figure when the fit DID converge", () => {
    const converged = render(LIVE, {
      ...VOL_FALLBACK,
      garch: { annualised_vol: 0.1131, converged: true },
    });
    expect(converged).toContain("11.31%");
    expect(converged).not.toContain("garch-not-converged");
  });
});

describe("the sample gate reads the OVERLAP, not the book's own history", () => {
  it("reports n, not sessions, when they disagree", () => {
    // The live card said "Measured over the 5 sessions the two series share" above
    // "7 sessions of return history, needs 60" — two denominators, both called
    // sessions, nothing distinguishing them. A benchmark statistic cannot be better
    // sampled than the overlap, which is what the backend's own `sufficient` uses.
    const html = render(LIVE, null, 7);
    expect(html).toContain("5 overlapping sessions");
    expect(html).not.toContain("7 sessions");
  });

  it("falls back to the book's sessions when the row predates n", () => {
    // An old row is judged as before rather than going unjudged — `sampleAdequacy`
    // treats an unknown sample as "do not withhold", so falling through to null
    // would PUBLISH the three figures this panel is meant to gate.
    const html = render({ ...LIVE, n: null }, null, 7);
    expect(html).toContain("7 overlapping sessions");
    expect(html).not.toContain("-0.15");
  });
});

describe("beta obeys the same bar as every other surface (ADR-0063)", () => {
  it("is withheld on a short sample, like the two figures beside it", () => {
    // The panel published beta −0.15 next to a withheld tracking error and
    // information ratio, on the same five sessions. ADR-0063's consequences named
    // this exact risk: "any fourth surface that renders a beta must read
    // MIN_SESSIONS too".
    const html = render(LIVE, null);
    expect(html).toContain("Beta to benchmark");
    expect(html).not.toContain("-0.15");
    expect(html).not.toContain("−0.15");
  });

  it("publishes it once the overlap clears 60", () => {
    const html = render({ ...LIVE, n: 90, sufficient: true }, null);
    expect(html).toContain("-0.15");
  });
});

describe("the capture figure", () => {
  const html = render(LIVE, null);

  it("draws both captures, with their own day counts", () => {
    expect(html).toContain('data-testid="capture-chart"');
    expect(html).toContain("-28.9%");
    expect(html).toContain("-8.1%");
  });

  it("explains a NEGATIVE up-capture, not only a negative down-capture", () => {
    // The panel narrated its good news and left the bad half to be inferred: the
    // down-capture hint explained its below-zero case and the up-capture hint did
    // not, while up-capture read −28.9% — the book FELL as the benchmark rose.
    expect(html).toContain("the book FELL while the benchmark rose");
    expect(html).toContain("the book ROSE while the benchmark fell");
  });

  it("singularises a one-day count", () => {
    expect(html).toContain("1 day");
    expect(html).not.toContain("1 days");
  });

  it("borrows no direction colour for a verdict (design goal 3)", () => {
    // Down-capture used to be tinted `var(--long)` when negative — a "good news"
    // green wearing the ink that means LONG. Goal 3 is explicit that a colour keyed
    // to a verdict is not covered by the signed-value exemption; the sign is carried
    // by which side of zero the bar sits on instead.
    expect(html).not.toContain("var(--long)");
    expect(html).not.toContain("var(--short)");
  });

  it("withholds the down-capture VERDICT on one down day", () => {
    expect(html).toContain("not a measurement of the book");
    expect(html).not.toContain("central claim holding");
  });

  it("makes the verdict once there are enough down days", () => {
    const ample = render({ ...LIVE, down_days: 20, n: 90 }, null);
    expect(ample).toContain("central claim holding");
  });
});
