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
}: {
  state: AnalyticsState<ScenarioResult[]>;
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[720px]">
              <caption className="sr-only">
                Estimated book return and P&amp;L under each stress scenario, sorted
                worst first. Each row expands to the per-position contribution
                breakdown.
              </caption>
              <thead>
                <tr>
                  {["Scenario", "Book return", "P&L ($M)", "Severity", ""].map((h, i) => (
                    <th
                      key={h || `col-${i}`}
                      scope="col"
                      className={`px-[18px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
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
