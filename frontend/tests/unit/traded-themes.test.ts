import { describe, it, expect } from "vitest";
import { abstainedThemes, type ThemeEdge } from "@/lib/themeSignals";

/**
 * The abstention roster answers "which themes were scored and not traded?".
 * Getting `tradedThemeIds` from the wrong table made it answer confidently and
 * wrongly for the several minutes L5 takes each day — see book/page.tsx.
 */
const edge = (v: number): ThemeEdge =>
  ({
    edge_score: v,
    trend_signal: 0,
    regime_bias: 0,
    carry_signal: 0,
    value_signal: 0,
    sentiment_signal: 0,
  }) as ThemeEdge;

describe("abstention roster membership", () => {
  const byTheme = { infl: edge(0.117), china: edge(-0.254), fed: edge(0.298) };
  const names = { infl: "Inflation", china: "China Growth", fed: "Fed Policy" };

  it("holds out a theme below the band that put nothing in the book", () => {
    // Live 2026-07-25: Inflation +0.117 against a 0.15 band, no Inflation name held.
    const r = abstainedThemes(byTheme, names, 0.15, new Set(["fed"]));
    expect(r.map((t) => t.name)).toEqual(["Inflation"]);
  });

  it("excludes a theme that actually traded, however flat its average edge", () => {
    // ADR-0039: a theme's average edge is smallest exactly when its assets
    // disagree — which is when it contributes most.
    const r = abstainedThemes(byTheme, names, 0.15, new Set(["infl", "fed"]));
    expect(r).toEqual([]);
  });

  it("is empty only when every sub-band theme genuinely traded", () => {
    // The regression: sourcing tradedThemeIds from the provisional L1 position set
    // marked all themes traded, emptying the roster and producing the claim that
    // every scored theme had cleared the bar.
    const all = new Set(["infl", "china", "fed"]);
    expect(abstainedThemes(byTheme, names, 0.15, all)).toEqual([]);
    expect(abstainedThemes(byTheme, names, 0.15, new Set()).map((t) => t.name)).toEqual([
      "Inflation",
    ]);
  });
});

describe("empty-roster wording", () => {
  // The two counts the empty state has to keep apart. "Nothing was held out" and
  // "every theme cleared the bar" are different claims; conflating them is what the
  // panel did on 2026-07-25.
  const cleared = (byTheme: Record<string, ThemeEdge>, bar: number) =>
    Object.values(byTheme).filter(
      (e) => e.edge_score !== null && Math.abs(e.edge_score) >= bar,
    ).length;
  const belowBarButTraded = (
    byTheme: Record<string, ThemeEdge>,
    bar: number,
    traded: Set<string>,
  ) =>
    Object.entries(byTheme)
      .filter(
        ([id, e]) =>
          e.edge_score !== null && Math.abs(e.edge_score) < bar && traded.has(id),
      )
      .map(([id]) => id);

  const byTheme = { infl: edge(0.117), china: edge(-0.254), fed: edge(0.298) };

  it("counts a sub-band theme that traded as NOT having cleared the bar", () => {
    expect(cleared(byTheme, 0.15)).toBe(2);
    expect(belowBarButTraded(byTheme, 0.15, new Set(["infl", "fed"]))).toEqual([
      "infl",
    ]);
    // ...and the roster is still empty, which is the case that used to lie.
    expect(abstainedThemes(byTheme, {}, 0.15, new Set(["infl", "fed"]))).toEqual([]);
  });

  it("names nothing when every theme genuinely cleared the bar", () => {
    const strong = { a: edge(0.4), b: edge(-0.3) };
    expect(cleared(strong, 0.15)).toBe(2);
    expect(belowBarButTraded(strong, 0.15, new Set(["a", "b"]))).toEqual([]);
  });
});
