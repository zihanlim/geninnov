import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MonteCarloDistributionChart,
  PositionRiskScatter,
  RiskContributionWaterfall,
  StressScenarioChart,
  VarHorizonChart,
} from "@/components/risk/RiskCharts";

/** First capture group of every match. exec-loop, not matchAll: this repo's tsc
 *  target rejects spreading a RegExpStringIterator. */
function captures(source: string, pattern: RegExp): string[] {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const out: string[] = [];
  let match = regex.exec(source);
  while (match !== null) {
    out.push(match[1]);
    match = regex.exec(source);
  }
  return out;
}

/** Every <rect> must sit inside the viewBox — a mark drawn past it is clipped. */
function rectsWithinViewBox(markup: string) {
  const viewBox = markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error("no viewBox found");
  const width = Number(viewBox[1]);
  const escapes: Array<{ x: number; right: number }> = [];
  for (const rect of markup.match(/<rect[^>]*>/g) ?? []) {
    const x = Number(rect.match(/\sx="([-\d.]+)"/)?.[1] ?? NaN);
    const w = Number(rect.match(/\swidth="([-\d.]+)"/)?.[1] ?? NaN);
    if (Number.isFinite(x) && Number.isFinite(w) && (x < -0.5 || x + w > width + 0.5)) {
      escapes.push({ x, right: x + w });
    }
  }
  return escapes;
}

describe("risk charts", () => {
  it("illustrates the persisted Monte Carlo histogram and tail markers", () => {
    const markup = renderToStaticMarkup(
      <MonteCarloDistributionChart
        data={{
          horizon_days: 21,
          n_sims: 10000,
          histogram: [
            { mid: -0.08, density: 0.05 },
            { mid: -0.01, density: 0.45 },
            { mid: 0.05, density: 0.5 },
          ],
          bands: [
            { confidence: 0.95, var: 0.04, es: 0.06 },
            { confidence: 0.99, var: 0.07, es: 0.09 },
          ],
        }}
      />,
    );

    expect(markup).toContain("Simulated terminal-return distribution");
    expect(markup).toContain("VaR 95%");
    expect(markup).toContain("ES -6.0%");
    expect(markup.match(/<rect/g)?.length).toBe(3);
    expect(rectsWithinViewBox(markup)).toEqual([]);
  });

  it("staggers the VaR band labels by index so two bands cannot collide", () => {
    const markup = renderToStaticMarkup(
      <MonteCarloDistributionChart
        data={{
          histogram: [
            { mid: -0.05, density: 0.4 },
            { mid: 0.05, density: 0.6 },
          ],
          // Two bands whose VaRs are nearly identical: under the old
          // `confidence / 20` stagger these labels printed 0.2px apart.
          bands: [
            { confidence: 0.95, var: 0.04 },
            { confidence: 0.99, var: 0.041 },
          ],
        }}
      />,
    );
    const ys = captures(markup, /<text[^>]*y="([\d.]+)"[^>]*fill="var\(--warning\)"/g).map(Number);
    expect(ys.length).toBe(2);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(10);
  });

  it("withholds the Monte Carlo chart when histogram bins are absent", () => {
    const markup = renderToStaticMarkup(
      <MonteCarloDistributionChart data={{ bands: [{ confidence: 0.95, var: 0.04 }] }} />,
    );
    expect(markup).toBe("");
  });

  it("labels the horizon fan by quantile and names 21d as the scored horizon", () => {
    const markup = renderToStaticMarkup(
      <VarHorizonChart
        data={{
          bands: [
            { horizon_days: 1, quantiles: { p90: 0.005, p95: 0.008, p99: 0.012 } },
            { horizon_days: 21, quantiles: { p90: 0.02, p95: 0.04, p99: 0.06 } },
            { horizon_days: 63, quantiles: { p90: 0.04, p95: 0.07, p99: 0.1 } },
          ],
        }}
      />,
    );
    expect(markup).toContain("VaR horizon fan");
    expect(markup).toContain("21d");
    // p95 is a CONFIDENCE level; 21d is the scored HORIZON. Conflating them into
    // "p95 · scored horizon" was a category error the legend used to ship.
    expect(markup).not.toContain("p95 · scored horizon");
    expect(markup).toContain("21d — scored horizon");
    // Direct end-labels, so the three lines are identifiable without a colour lookup.
    expect(markup).toContain(">p90<");
    expect(markup).toContain(">p95<");
    expect(markup).toContain(">p99<");
    // And the scored figure itself is printed, not left to be eyeballed off an axis.
    expect(markup).toContain("4.0%");
  });

  it("draws the fan in horizon order even when the payload is not sorted", () => {
    const markup = renderToStaticMarkup(
      <VarHorizonChart
        data={{
          bands: [
            { horizon_days: 63, quantiles: { p95: 0.07 } },
            { horizon_days: 1, quantiles: { p95: 0.008 } },
            { horizon_days: 21, quantiles: { p95: 0.04 } },
          ],
        }}
      />,
    );
    const path = markup.match(/<path d="([^"]+)"/)?.[1] ?? "";
    const xs = captures(path, /[ML]([\d.]+),/g).map(Number);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("keeps stress scenarios as signed, non-probability-weighted bars", () => {
    const markup = renderToStaticMarkup(
      <StressScenarioChart
        scenarios={[
          { scenario_name: "credit", label: "Credit widening", estimated_book_return: -0.08, estimated_dollar_pnl: -8, severity: "high" },
          { scenario_name: "rates", label: "Rates shock", estimated_book_return: 0.02, estimated_dollar_pnl: 2, severity: "low" },
        ]}
      />,
    );
    expect(markup).toContain("Stress return profile");
    expect(markup).toContain("Credit widening");
    expect(markup).toContain("-8.0%");
    expect(markup).toContain("+2.0%");
  });

  it("plots position risk against conviction and preserves hedge signs", () => {
    const markup = renderToStaticMarkup(
      <PositionRiskScatter
        positions={[
          { asset: "AAA", direction: "long", conviction: 4.2 },
          { asset: "BBB", direction: "short", conviction: 2.1 },
        ]}
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: -0.01 },
          ],
        }}
      />,
    );
    expect(markup).toContain("Position risk versus conviction");
    expect(markup).toContain("AAA");
    expect(markup).toContain("BBB");
    expect(markup).toContain("-1.0%");
  });

  it("carries direction on the shape channel, not colour alone", () => {
    // --long vs --short is ΔE 6.1 under deuteranopia, so a chart that encodes
    // direction only in fill is unreadable for those readers. The short mark is a
    // ring: surface fill + coloured stroke.
    const markup = renderToStaticMarkup(
      <PositionRiskScatter
        positions={[
          { asset: "AAA", direction: "long", conviction: 4.2 },
          { asset: "BBB", direction: "short", conviction: 2.1 },
        ]}
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: 0.01 },
          ],
        }}
      />,
    );
    expect(markup).toContain('fill="var(--bg-surface)"');
    expect(markup).toContain('stroke="var(--short)"');
    expect(markup).toContain('fill="var(--long)"');
    expect(markup).toContain(">long<");
    expect(markup).toContain(">short<");
  });

  it("says so when a held name has no decomposition entry to plot", () => {
    const markup = renderToStaticMarkup(
      <PositionRiskScatter
        positions={[
          { asset: "AAA", direction: "long", conviction: 4.2 },
          { asset: "BBB", direction: "short", conviction: 2.1 },
          { asset: "CCC", direction: "long", conviction: 3.0 },
        ]}
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: 0.01 },
          ],
        }}
      />,
    );
    expect(markup).toContain("1 held name absent from the decomposition");
  });

  it("renders a signed contribution waterfall ending at total volatility", () => {
    const markup = renderToStaticMarkup(
      <RiskContributionWaterfall
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: -0.01 },
            { asset: "CCC", contribution_to_vol: 0.02 },
          ],
        }}
      />,
    );
    expect(markup).toContain("Signed risk-contribution waterfall");
    expect(markup).toContain("total");
    expect(markup.match(/<rect/g)?.length).toBe(4);
    // The number the chart exists to communicate is printed, not only drawn.
    expect(markup).toContain("5.00%");
  });

  it("keeps the total bar inside the viewBox at every book size", () => {
    // Regression: slot = plotWidth / (n + 1) put the total bar's CENTRE on the
    // right plot edge, so half of it rendered outside and was clipped. Measured
    // on the live 9-position book as 683.5→724.5 against a 720 viewBox.
    for (const size of [2, 3, 5, 9, 14]) {
      const markup = renderToStaticMarkup(
        <RiskContributionWaterfall
          decomposition={{
            positions: Array.from({ length: size }, (_, index) => ({
              asset: `A${index}`,
              contribution_to_vol: 0.01 + index * 0.001,
            })),
          }}
        />,
      );
      expect(rectsWithinViewBox(markup), `book of ${size} overflows`).toEqual([]);
    }
  });

  it("gives every chart a value axis rather than only a shape", () => {
    const waterfall = renderToStaticMarkup(
      <RiskContributionWaterfall
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: 0.02 },
          ],
        }}
      />,
    );
    const fan = renderToStaticMarkup(
      <VarHorizonChart
        data={{
          bands: [
            { horizon_days: 1, quantiles: { p95: 0.008 } },
            { horizon_days: 21, quantiles: { p95: 0.04 } },
          ],
        }}
      />,
    );
    const scatter = renderToStaticMarkup(
      <PositionRiskScatter
        positions={[
          { asset: "AAA", direction: "long", conviction: 4.2 },
          { asset: "BBB", direction: "short", conviction: 2.1 },
        ]}
        decomposition={{
          positions: [
            { asset: "AAA", contribution_to_vol: 0.04 },
            { asset: "BBB", contribution_to_vol: 0.01 },
          ],
        }}
      />,
    );
    // A tick is a <text> holding a percentage; every one of these used to render
    // with an axis title and no numbers at all.
    for (const [name, markup] of [["waterfall", waterfall], ["fan", fan], ["scatter", scatter]] as const) {
      const ticks = markup.match(/<text[^>]*>[\d.]+%<\/text>/g) ?? [];
      expect(ticks.length, `${name} has no numeric axis ticks`).toBeGreaterThanOrEqual(2);
    }
  });
});
