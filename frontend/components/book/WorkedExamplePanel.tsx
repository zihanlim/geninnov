// frontend/components/book/WorkedExamplePanel.tsx
//
// ADR-0081 \u2014 a `<details>`-collapsed panel on `/book` that renders the
// lineage trail for ONE position per page load. The chosen position is the
// highest-|EdgeScore| pick (first long on tie), per `pickWorkedExamplePosition`.
// The panel is collapsed by default so it does not bloat the page; a reader
// who came for a different fact is not forced past it.
//
// This component is additive: it does not replace the always-visible
// rationale, EdgeBars, SizingChainView, factor_tilts, scenarios, citations or
// any other primitive on the row. It surfaces the same data in a different
// order \u2014 the order the pipeline performed it in.

"use client";

import { useMemo } from "react";
import { DisclosureChevron } from "@/components/DisclosureChevron";
import type { ResolvedEdge } from "@/lib/book/positionEdge";
import type { ThemeEdge } from "@/lib/themeSignals";
import {
  buildWorkedExample,
  pickWorkedExamplePosition,
  type PrimaryScenarioInput,
  type SizingFinalInput,
  type WorkedExamplePick,
} from "@/lib/book/workedExample";
import { StepNumbered } from "@/components/book/StepNumbered";

interface Props {
  picks: WorkedExamplePick[];
  /** Per-asset resolved EdgeScore, for picking by |edge_score|. */
  edgeByAsset: Record<string, ResolvedEdge | undefined>;
  /** Per-theme EdgeScore (from theme_signals_history / fetchThemeEdge). */
  edgeByTheme: Record<string, ThemeEdge | undefined>;
  /** Per-asset ma_context for the chosen position (Step 1). */
  maContextForAsset: (asset: string) => WorkedExamplePick["ma_context"];
  /** Conviction-based sizing final + fallback flag, per asset. */
  sizingForAsset: (asset: string) => SizingFinalInput;
  /** Per-asset primary scenario contribution parsed from contribution_breakdown. */
  primaryScenarioForAsset: (asset: string) => PrimaryScenarioInput | null;
}

export function WorkedExamplePanel({
  picks,
  edgeByAsset,
  edgeByTheme,
  maContextForAsset,
  sizingForAsset,
  primaryScenarioForAsset,
}: Props) {
  const built = useMemo(() => {
    if (picks.length === 0) return null;
    const enriched = picks.map((p) => ({
      ...p,
      edge_score: edgeByAsset[p.asset]?.edge_score ?? null,
    }));
    const chosen = pickWorkedExamplePosition(enriched);
    if (!chosen) return null;
    const themeScore =
      chosen.theme_id && edgeByTheme[chosen.theme_id]
        ? edgeByTheme[chosen.theme_id]?.edge_score ?? null
        : null;
    return buildWorkedExample({
      pick: chosen,
      maContext: maContextForAsset(chosen.asset),
      themeScore,
      sizing: sizingForAsset(chosen.asset),
      primaryScenario: primaryScenarioForAsset(chosen.asset),
    });
  }, [
    picks,
    edgeByAsset,
    edgeByTheme,
    maContextForAsset,
    sizingForAsset,
    primaryScenarioForAsset,
  ]);

  if (!built) return null;

  const { position, steps } = built;
  const sideLabel = position.direction === "long" ? "LONG" : "SHORT";

  return (
    <details
      className="card mb-6 group"
      data-testid="worked-example-panel"
      aria-label={`Worked example lineage for ${position.asset}`}
    >
      <summary className="card-header cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="card-title flex items-baseline gap-2 min-w-0">
          <span className="shrink-0">Worked example lineage</span>
          <span className="normal-case tracking-normal font-normal text-text-tertiary text-[12px] truncate">
            {"\u00b7  "}
            {sideLabel} {position.asset}
            {position.theme ? `  /  ${position.theme}` : ""}
          </span>
        </span>
        <span className="text-[11px] text-text-tertiary flex items-center gap-1.5 shrink-0">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
          <DisclosureChevron />
        </span>
      </summary>
      <div className="card-body">
        <p className="m-0 mb-4 text-[12px] text-text-tertiary leading-[1.55] max-w-[68ch]">
          The same data the row above already shows, in the order the pipeline
          performed it. Each step names the table.column the figure traces to;
          a step whose column is not yet persisted renders{" "}
          <span className="num">{"\u2014"}</span> with the reason.
        </p>
        <ol className="m-0 p-0 list-none space-y-4">
          {steps.map((step) => (
            <li key={step.number}>
              <StepNumbered step={step} />
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
