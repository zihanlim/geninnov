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
  // Themes that sit BELOW the bar and traded anyway, on a decisive asset. The
  // roster excludes them (correctly — they are not "scored, not traded"), which is
  // why the empty state has to name them rather than imply they cleared.
  const tradedBelowBar = Object.entries(edgeByTheme)
    .filter(
      ([theme_id, e]) =>
        e.edge_score !== null &&
        Math.abs(e.edge_score) < abstainThreshold &&
        tradedThemeIds?.has(theme_id),
    )
    .map(([theme_id, e]) => ({
      theme_id,
      name: themeNames[theme_id] ?? theme_id,
      edge_score: e.edge_score,
    }))
    .sort((a, b) => Math.abs(b.edge_score ?? 0) - Math.abs(a.edge_score ?? 0));
  const clearedBar = Object.values(edgeByTheme).filter(
    (e) => e.edge_score !== null && Math.abs(e.edge_score) >= abstainThreshold,
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
      className="card mb-5"
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
          {/* "Nothing was held out" and "every theme cleared the bar" are NOT the
              same statement, and this panel used to print the second while meaning
              the first. They diverge exactly when a theme below the band trades
              anyway on one decisive asset — which ADR-0039 made possible and
              ADR-0046 made common. Live on 2026-07-25 it claimed all 8 themes had
              cleared a 0.15 bar while /method showed Inflation at +0.117. */}
          No theme was held out this run.{" "}
          <span className="num">{clearedBar}</span> of{" "}
          <span className="num">{scored}</span> scored themes cleared the{" "}
          <span className="num">|Edge| ≥ {abstainThreshold.toFixed(2)}</span>{" "}
          conviction bar
          {tradedBelowBar.length > 0 ? (
            <>
              , and{" "}
              {tradedBelowBar.map((t, i) => (
                <span key={t.theme_id}>
                  {i > 0 ? ", " : ""}
                  <span className="text-text-primary">{t.name}</span>{" "}
                  <span className="num">({fmtSigned(t.edge_score)})</span>
                </span>
              ))}{" "}
              {tradedBelowBar.length === 1 ? "sits" : "sit"} below it and still
              traded — direction and abstention are decided per <em>asset</em>, and a
              theme&apos;s average edge is smallest exactly when its assets disagree
              (ADR-0039).
            </>
          ) : (
            <>. Every scored theme carried a directional view.</>
          )}
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
                    className={`px-[14px] py-[7px] text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
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
                  <td className="px-[14px] py-[7px] border-b border-border">
                    <Link
                      href={`/?theme=${e.theme_id}`}
                      className={`hover:text-accent hover:underline ${focused ? "text-brand font-semibold" : "text-text-primary"}`}
                    >
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num font-semibold">
                    {e.edge_score === null
                      ? "—"
                      : Math.abs(e.edge_score).toFixed(3)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.trend_signal)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.regime_bias)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.carry_signal)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtSigned(e.value_signal)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-text-secondary text-[11.5px] leading-[1.5]">
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
