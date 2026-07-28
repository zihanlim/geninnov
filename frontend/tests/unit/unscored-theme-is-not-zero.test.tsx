import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThemeHeatmap from "@/components/ThemeHeatmap";
import ConvictionCard, { type ConvictionTheme } from "@/components/ConvictionCard";

/**
 * A theme created between two pipeline runs has NULL across every score column
 * (ADR-0129 created AI Capex at 16:55; the last run was 16:38). NULL is the
 * ABSENCE of a measurement, not a low one — the repo's standing rule.
 *
 * The bug this pins: `t.hype_score !== undefined ? Math.round(t.hype_score) : "—"`
 * checked for `undefined` while Supabase returns `null`, so the guard never
 * fired and `Math.round(null)` printed a confident **0**. The same cell's
 * background passed `?? null` and painted as no-data, so it contradicted itself.
 */

const scored = {
  id: "t1",
  name: "Fed Policy",
  hype_score: 66.26,
  volume_score: 0.79,
  sentiment_score: 0.55,
  corr_score: 0.39,
  momentum_score: 0.96,
};

const unscored = {
  id: "t2",
  name: "AI Capex",
  hype_score: null as unknown as number,
  volume_score: null as unknown as number,
  sentiment_score: null as unknown as number,
  corr_score: null as unknown as number,
  momentum_score: null as unknown as number,
};

/** Text of every <td> in render order. */
function cells(markup: string): string[] {
  return (markup.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map((td) =>
    td.replace(/<[^>]*>/g, "").trim(),
  );
}

describe("an unscored theme is never rendered as zero", () => {
  const markup = renderToStaticMarkup(
    <ThemeHeatmap themes={[scored, unscored] as never} />,
  );

  it("prints an em dash, not 0, for a null HypeScore", () => {
    const texts = cells(markup);
    expect(texts).toContain("—");
    // The precise regression: a standalone "0" cell.
    expect(texts.filter((t) => t === "0")).toEqual([]);
  });

  it("still prints the scored theme's figure", () => {
    expect(cells(markup)).toContain("66");
  });

  it("sorts the unscored theme last rather than ranking it as 0", () => {
    // `?? 0` placed it among the genuinely-low scores, which reads as a measured
    // bottom-of-board placement for a theme nothing has measured.
    const iScored = markup.indexOf("Fed Policy");
    const iUnscored = markup.indexOf("AI Capex");
    expect(iScored).toBeGreaterThanOrEqual(0);
    expect(iUnscored).toBeGreaterThan(iScored);
  });
});

describe("ConvictionCard", () => {
  const theme = {
    ...unscored,
    tier: "anchor",
    delta_1d: null,
  } as unknown as ConvictionTheme;

  it("shows an em dash rather than a confident 0", () => {
    const out = renderToStaticMarkup(<ConvictionCard theme={theme} rank={1} />);
    expect(out).toContain("—");
    expect(out).not.toMatch(/>0</);
  });

  it("does not paint an unscored theme with the below-50 red", () => {
    // Red is a reading. Absence is not a reading.
    const out = renderToStaticMarkup(<ConvictionCard theme={theme} rank={1} />);
    expect(out).not.toContain("var(--short)");
  });
});
