// frontend/components/risk/StressScenarios.tsx
//
// The headline section of /risk: what the sized book loses under each of the
// calibrated shocks the L5 agent runs (scenario_analysis.SCENARIOS — six as of
// ADR-0088; the count is read off the data, never hardcoded here).
// Sorted worst-first, because the first question about a book is "how bad does
// this get", not "what is scenario S1".

"use client";
import { Fragment, useState } from "react";
import {
  explainGap,
  fmtSignedMillions,
  fmtSignedPct,
  isNum,
  severityChipClass,
  sortWorstFirst,
  type AnalyticsState,
  type ScenarioResult,
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";
import { StressScenarioChart } from "@/components/risk/RiskCharts";

// A scenario states its shocks in one or both of two vocabularies: factor betas
// (S1-S5) and sector dependency (S6, ADR-0088). Rendering only the first left the
// sector-transmitted scenario with an empty chip row under a material P&L — the
// number on the page with its cause left off, which design goal 1 forbids.
function ShockChips({
  factorShocks,
  sectorShocks,
}: {
  factorShocks: Record<string, number>;
  sectorShocks: Record<string, number>;
}) {
  const factors = Object.entries(factorShocks).filter(([, v]) => isNum(v));
  const sectors = Object.entries(sectorShocks).filter(([, v]) => isNum(v));
  if (factors.length === 0 && sectors.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2.5">
      {factors.map(([factor, shock]) => (
        <span
          key={`f-${factor}`}
          className="badge badge-neutral num"
          title={`${factor} factor shocked by ${fmtSignedPct(shock)}`}
        >
          {factor.toUpperCase()} {fmtSignedPct(shock)}
        </span>
      ))}
      {sectors.map(([sector, shock]) => (
        <span
          key={`s-${sector}`}
          className="badge badge-neutral num"
          title={`Every position in the ${sector} sector shocked by ${fmtSignedPct(shock)}`}
        >
          {sector} {fmtSignedPct(shock)}
        </span>
      ))}
    </div>
  );
}

// Auto table layout hands surplus width to the column with the widest content,
// which here is `Scenario` — and its content is capped at 62ch for measure, so
// at 1440 that column took half the table and parked ~380px of nothing between
// a scenario's name and its own return. The value columns are pinned to their
// content and the trailing action column absorbs the surplus, which keeps a
// label and the figures describing it in one scannable block and moves the slack
// to the one place a row can carry it: ahead of a right-aligned button, where a
// trailing action sits anyway.
//
// It needs FIXED layout to work, which is the part that took two measured
// attempts. Under auto layout a `w-full` absorber on the trailing column wins
// outright — the browser resolves the percentage first and starves every other
// column to min-content, including ones with a specified width. Measured at
// 1440: Scenario asked for 34rem and got 179px, the description wrapped to
// ~143px, and every row grew to eight lines. Several times worse than the gap it
// was meant to close, and identical to eye whether the width was declared or
// not, which is why it was measured rather than looked at.
//
// Under `table-fixed` the declared widths are honoured and the ONE column
// without a width takes the remainder — so the absorber is the absence of a
// class, not `w-full`.
//
// All of it gated at `wide` (1424px). Below that there is no surplus to park —
// the table is at its 720px floor and scrolling — and pinning would only raise
// the floor, making a phone scroll further to reach the same numbers.
// In `compact` mode the table uses auto layout, so the fixed column widths are
// omitted and the trailing column still absorbs surplus (a column without a
// width takes the remainder under `table-fixed`, and under auto layout the
// `Scenario` content cap does the same job).
const COLUMNS = (compact: boolean) => [
  { label: "Scenario", width: compact ? "" : "wide:w-[34rem]" },
  { label: "Book return", width: compact ? "" : "wide:w-[8.5rem]" },
  { label: "P&L ($M)", width: compact ? "" : "wide:w-[8.5rem]" },
  // 8rem, not 7: under `table-fixed` a column cannot grow for its content, and
  // the vocabulary is low / moderate / high / severe — the live book is all LOW,
  // so a column sized by eye today would clip the first MODERATE run.
  { label: "Severity", width: compact ? "" : "wide:w-[8rem]" },
  { label: "", width: "" },
];

function ScenarioRow({
  scenario,
  index,
  open,
  onToggle,
}: {
  scenario: ScenarioResult;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = `scenario-detail-${index}`;
  const ret = scenario.estimated_book_return;
  const pnl = scenario.estimated_dollar_pnl;
  const retColor = !isNum(ret)
    ? "text-text-tertiary"
    : ret < 0
      ? "text-short"
      : ret > 0
        ? "text-long"
        : "text-text-secondary";
  const breakdown = (scenario.contribution_breakdown ?? []).filter(
    (line) => typeof line === "string" && line.trim().length > 0,
  );
  const factorShocks = scenario.factor_shocks ?? {};
  const sectorShocks = scenario.sector_shocks ?? {};

  return (
    <Fragment>
      <tr className="hover:bg-bg-elevated align-top">
        <td className="px-[18px] py-3 border-b border-border">
          <div className="font-medium text-text-primary">{scenario.label}</div>
          <div className="text-[11px] text-text-tertiary num mt-0.5">
            {scenario.scenario_name}
          </div>
          {scenario.description ? (
            <p className="m-0 mt-1 text-[12px] text-text-secondary leading-[1.55] max-w-[62ch]">
              {scenario.description}
            </p>
          ) : null}
        </td>
        <td className={`px-[14px] py-3 border-b border-border text-right num ${retColor}`}>
          {fmtSignedPct(ret)}
        </td>
        <td className={`px-[14px] py-3 border-b border-border text-right num ${retColor}`}>
          {fmtSignedMillions(pnl)}
        </td>
        <td className="px-[14px] py-3 border-b border-border text-right">
          <span
            className={`badge ${severityChipClass(scenario.severity)}`}
            aria-label={`Severity ${scenario.severity}`}
          >
            {(scenario.severity ?? "unknown").toUpperCase()}
          </span>
        </td>
        <td className="px-[18px] py-3 border-b border-border text-right">
          <button
            type="button"
            className="filter-btn"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={`${open ? "Hide" : "Show"} contribution breakdown for ${scenario.label}`}
          >
            {open ? "Hide" : "Breakdown"}
          </button>
        </td>
      </tr>
      {open && (
        <tr id={detailId}>
          <td colSpan={5} className="px-[18px] py-4 border-b border-border-strong bg-bg-elevated/60">
            <ShockChips factorShocks={factorShocks} sectorShocks={sectorShocks} />
            {breakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <pre className="num m-0 text-[12px] leading-[1.7] text-text-secondary whitespace-pre">
                  {breakdown.join("\n")}
                </pre>
              </div>
            ) : (
              <p className="m-0 text-[12px] text-text-tertiary max-w-[70ch]">
                No per-position contributions for this scenario.{" "}
                <Ident>contribution_breakdown</Ident> is empty on this record — the
                backend emits it only when the sized book has positions to attribute
                the shock to.
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function StressScenarios({
  state,
  compact = false,
}: {
  state: AnalyticsState<ScenarioResult[]>;
  /**
   * Renders the table in auto layout, for a card in a narrow (3/4) column.
   * The full-width form uses `wide:table-fixed` with fixed column widths tuned
   * to ~1344px; at ~1000px (3/4) those widths overflow by ~48px and the card
   * would scroll left-right, which the layout directive forbids. Auto layout
   * sizes the columns to content within the available width instead.
   */
  compact?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const gap = explainGap(state, {
    column: "scenario_results",
    emptyMeaning:
      "The array is [] — the L5 agent ran but had no sized positions to stress, so every scenario " +
      "would have returned a trivially zero P&L and none were persisted. Check the screening funnel " +
      "for why the candidate pool emptied, then re-run the pipeline.",
  });

  const rows = state.status === "ok" ? sortWorstFirst(state.value) : [];
  const worst = rows.length > 0 ? rows[0] : null;

  return (
    <section className="card mb-6" aria-labelledby="risk-stress-heading">
      <div className="card-header">
        <h2 id="risk-stress-heading" className="card-title m-0">
          Stress scenarios
        </h2>
        <span className="text-[11px] text-text-tertiary">
          {state.status === "ok"
            ? `${rows.length} calibrated shock${rows.length === 1 ? "" : "s"} · worst first`
            : "Factor + direct-shock estimates"}
        </span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={220} />
      ) : gap ? (
        <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
      ) : (
        <>
          {worst && (
            <div className="px-[18px] py-3 border-b border-border text-[13px]">
              <span className="text-text-tertiary uppercase tracking-[0.1em] text-[11px] mr-2">
                Worst case
              </span>
              <span className="text-text-primary font-medium">{worst.label}</span>
              <span className="text-text-tertiary mx-1.5">at</span>
              <span
                className={`num font-semibold ${
                  isNum(worst.estimated_book_return) && worst.estimated_book_return < 0
                    ? "text-short"
                    : "text-text-primary"
                }`}
              >
                {fmtSignedPct(worst.estimated_book_return)}
              </span>
              <span className="text-text-secondary num ml-1.5">
                ({fmtSignedMillions(worst.estimated_dollar_pnl)})
              </span>
            </div>
          )}
          {/* Stated before the table, because the omission is only visible to a
              reader who already knows to look for it. Six scenarios ranked by
              severity, with a "worst case" called out above, reads like a tail
              distribution — and a reader can reasonably start averaging them or
              treating the worst as an expected loss. Nothing in L0–L5 produces a
              probability: `scenario_results` persists a severity label and an
              estimated return, and weighting them here would fabricate the one
              number the page does not have (goal 1). */}
          {/* `.card` carries no padding — every child insets itself by 18px: the
              worst-case strip above, the table cells below, the footnote, and
              SectionGap / SectionSkeleton on the other two branches. These two
              were the exception, sitting flush against the card border while
              everything around them was inset, so the section read as two
              different cards stacked. The inset also pulls ChartFrame's own
              border-t off the card edge, which is what distinguishes it from the
              structural full-bleed rules either side of it. */}
          <div className="px-[18px] pt-3 pb-4">
            <p className="m-0 mb-2 text-[11.5px] leading-[1.6] text-text-tertiary max-w-[95ch]">
              These scenarios are <strong>not probability-weighted</strong>. Each is
              an independent what-if, not a draw from a distribution, so they do not
              sum and the worst is not an expected loss — it is the largest of{" "}
              {/* `rows.length`, not a literal. This said "six", which is the
                  MULTI-ASSET book's scenario count: the credit book carries seven,
                  because S7_fallen_angel (ADR-0192) exists only where credit betas
                  clear their standard error. So the sentence excluded the one
                  scenario that exists BECAUSE this is the credit book, three lines
                  under a card header already reading "7 calibrated shocks" — which
                  this file's own header promises is "read off the data, never
                  hardcoded here". True of the header, false of this footnote. */}
              {rows.length} hypothetical{rows.length === 1 ? "" : "s"}.{" "}
              <Ident>research_recommendations.scenario_results</Ident> persists a
              severity label and an estimated return, and no likelihood.
            </p>
            <StressScenarioChart scenarios={rows} />
          </div>
          <div className="overflow-x-auto">
            <table
              className={`w-full border-collapse text-[13px] min-w-[720px] ${
                compact ? "" : "wide:table-fixed"
              }`}
            >
              <caption className="sr-only">
                Estimated book return and P&amp;L under each stress scenario, sorted
                worst first. Each row expands to the per-position contribution
                breakdown.
              </caption>
              <thead>
                <tr>
                  {COLUMNS(compact).map((col, i) => (
                    <th
                      key={col.label || `col-${i}`}
                      scope="col"
                      className={`px-[18px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                        i === 0 ? "text-left" : "text-right"
                      } ${col.width}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((scenario, i) => (
                  <ScenarioRow
                    key={`${scenario.scenario_name}-${i}`}
                    scenario={scenario}
                    index={i}
                    open={openIndex === i}
                    onToggle={() => setOpenIndex(openIndex === i ? null : i)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
            Estimates combine a factor path (signed weight × beta × factor shock) with
            direct shocks where the scenario calibrates one — per asset, or inherited
            from the position&rsquo;s sector when the scenario transmits through sector
            dependency rather than through market beta. A breakdown row reading{" "}
            <Ident>via Energy</Ident> took its shock from the sector map. They are
            model estimates from historical regressions, not forecasts. Source:{" "}
            <Ident>research_recommendations.scenario_results</Ident>.
          </p>
        </>
      )}
    </section>
  );
}
