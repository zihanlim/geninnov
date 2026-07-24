// frontend/components/book/AbstentionRoster.tsx
//
// The abstention roster — the themes the engine SCORED but declined to trade
// because |EdgeScore| < abstain_threshold. Computed every run and never surfaced
// before this. Showing it is what separates "we found no signal" from "we found
// a weak or conflicting signal and chose not to bet", which is the difference an
// IC cares about.
//
// Each row shows the theme, |EdgeScore| against the live threshold, the four
// components, and a one-line "why" that names the specific conflict (e.g. carry
// and value pulling opposite ways, or every signal simply near zero).

"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { abstainedThemes, type ThemeEdge } from "@/lib/themeSignals";
import { ScrollArea } from "@/components/ScrollArea";

const fmtSigned = (v: number | null, dp = 2): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? "n/a"
    : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

/**
 * The reason a theme was held out, in plain terms. Prefers naming an actual
 * sign conflict between components (the interesting case) over "all weak".
 */
function abstainReason(e: ThemeEdge): string {
  const comps: Array<[string, number | null]> = [
    ["trend", e.trend_signal],
    ["regime", e.regime_bias],
    ["carry", e.carry_signal],
    ["value", e.value_signal],
    ["sentiment", e.sentiment_signal],
  ];
  const present = comps.filter(([, v]) => v !== null && Math.abs(v) > 0.05) as Array<
    [string, number]
  >;
  const pos = present.filter(([, v]) => v > 0);
  const neg = present.filter(([, v]) => v < 0);

  if (pos.length > 0 && neg.length > 0) {
    const up = pos.map(([k]) => k).join("/");
    const down = neg.map(([k]) => k).join("/");
    return `${up} (long) vs ${down} (short) cancel — no net edge`;
  }
  if (present.length === 0) {
    return "every component near zero — no directional signal";
  }
  const side = pos.length > 0 ? "long" : "short";
  return `weak ${side} lean, below the conviction bar to trade`;
}

export default function AbstentionRoster({
  edgeByTheme,
  themeNames,
  abstainThreshold,
  thresholdIsLive,
  focusThemeId = null,
  tradedThemeIds,
}: {
  edgeByTheme: Record<string, ThemeEdge>;
  themeNames: Record<string, string>;
  abstainThreshold: number;
  thresholdIsLive: boolean;
  /** When set (a held-out theme deep-linked from "positions →"), that row is
   *  highlighted and scrolled into view. */
  focusThemeId?: string | null;
  /** Themes that actually put a position in today's book. Excluded from the
   *  roster no matter how flat their average edge looks — see abstainedThemes. */
  tradedThemeIds?: Set<string>;
}) {
  const roster = abstainedThemes(edgeByTheme, themeNames, abstainThreshold, tradedThemeIds);
  const scored = Object.values(edgeByTheme).filter(
    (e) => e.edge_score !== null,
  ).length;

  // Scroll the focused (held-out) theme's row into view once it renders.
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (focusThemeId && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusThemeId, roster.length]);

  return (
    <section
      id="abstention-roster"
      className="card mb-6 scroll-mt-20"
      aria-labelledby="abstention-heading"
    >
      <div className="card-header">
        <h2 id="abstention-heading" className="card-title m-0">
          Abstention roster — scored, not traded
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {roster.length} held out ·{" "}
          <span title="From scoring_config.edge_abstain_threshold">
            |Edge| &lt; {abstainThreshold.toFixed(2)}
          </span>
          {!thresholdIsLive && (
            <span
              className="text-warning ml-1"
              title="scoring_config.edge_abstain_threshold was not readable; using the migration-024 default."
            >
              (default)
            </span>
          )}
        </span>
      </div>

      {scored === 0 ? (
        <div className="p-[18px] text-[12.5px] text-text-tertiary leading-[1.6]">
          No theme carries a computed EdgeScore yet, so there is nothing to hold
          out. EdgeScore components are written to{" "}
          <code className="num">theme_signals_history</code> from migration 023
          onward — this database has no scored rows.
        </div>
      ) : roster.length === 0 ? (
        <div className="p-[18px] text-[12.5px] text-text-secondary leading-[1.6]">
          Every scored theme cleared the{" "}
          <span className="num">|Edge| ≥ {abstainThreshold.toFixed(2)}</span>{" "}
          conviction bar — none were held out this run. That is unusual: it means
          the engine took a directional view on all {scored} themes it scored.
        </div>
      ) : (
        <ScrollArea>
          <table className="w-full border-collapse text-[12.5px]">
            <caption className="sr-only">
              Themes scored but not traded because |EdgeScore| fell below the
              abstain threshold, closest-to-a-trade first.
            </caption>
            <thead>
              <tr>
                {[
                  "Theme",
                  "|Edge|",
                  "Trend",
                  "Regime",
                  "Carry",
                  "Value",
                  "Why held out",
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-[14px] py-2.5 text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                      i === 0 || i === 6 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => {
                const focused = e.theme_id === focusThemeId;
                return (
                <tr
                  key={e.theme_id}
                  ref={focused ? focusRowRef : undefined}
                  className={
                    focused
                      ? "bg-brand-dim ring-1 ring-inset ring-brand"
                      : "hover:bg-bg-elevated"
                  }
                >
                  <td className="px-[14px] py-2.5 border-b border-border">
                    <Link
                      href={`/?theme=${e.theme_id}`}
                      className={`hover:text-accent hover:underline ${focused ? "text-brand font-semibold" : "text-text-primary"}`}
                    >
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-right num font-semibold">
                    {e.edge_score === null
                      ? "—"
                      : Math.abs(e.edge_score).toFixed(3)}
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.trend_signal)}
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.regime_bias)}
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.carry_signal)}
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.value_signal)}
                  </td>
                  <td className="px-[14px] py-2.5 border-b border-border text-text-secondary text-[11.5px] leading-[1.5]">
                    {abstainReason(e)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </section>
  );
}
