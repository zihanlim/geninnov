"use client";
// frontend/components/book/PositionRow.tsx
//
// One sized position in the $100M book: the collapsed 7-column row, and the
// expanded panel carrying thesis, counter-thesis, MA context, catalysts, horizon,
// marginal contribution, EdgeScore decomposition, sizing chain, own factor betas
// and per-scenario stress.
//
// Lifted verbatim out of app/book/page.tsx. The move was not cosmetic: a Next.js
// route file may only export `default` and the framework's own names, so while
// this lived in page.tsx it could not be imported by a test at all — Next's
// generated route types fail with "not assignable to type 'never'" on any extra
// export. tests/unit/book-row-field-coverage.test.tsx renders this component with
// a fully-populated fixture and fails if any field stops reaching the output,
// which is what makes a layout refactor of the grid below safe to merge.

import Link from "next/link";
import CitationList, { Citation } from "@/components/CitationList";
import EdgeBars from "@/components/book/EdgeBars";
import SizingChainView from "@/components/book/SizingChainView";
import PositionMarginalRisk from "@/components/book/PositionMarginalRisk";
import { type IndependentIdeas } from "@/components/book/PoolDepth";
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";
import {
  distinguishPosition,
  positionRationale,
} from "@/lib/positionDistinction";
import {
  positionStability,
  stabilityLabel,
  type ReplicationNames,
} from "@/lib/book/positionStability";
import {
  edgeRationale,
  plainRationale,
  type EdgeWeights,
} from "@/lib/themeSignals";
import {
  buildSizingChain,
  marginalContribution,
  topSibling,
  type BindingGroupCap,
  type CorrelationPairLite,
  type ResolvedEdge,
} from "@/lib/book/positionEdge";
import {
  FACTOR_LABELS,
  SEVERITY_COLOR,
  fmtPct,
  fmtSigned,
  fmtUSD,
} from "@/lib/book/format";
import type { CapRow, Pick, ScenarioResult } from "@/lib/book/types";
import { BOOK_ROW_GRID, BOOK_ROW_MIN_W } from "@/lib/book/grid";

function SubHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2 ${className}`}
    >
      {children}
    </div>
  );
}

export function PositionRow({
  pick,
  rank,
  open,
  onToggle,
  citations,
  advisory,
  cap,
  bindingGroupCaps,
  edge,
  edgeWeights,
  convictionSum,
  allPicks,
  correlationPairs,
  ideas,
  scenarios,
  repl,
  bookRunDate,
}: {
  pick: Pick;
  rank: number;
  open: boolean;
  onToggle: () => void;
  citations?: Citation[];
  advisory: AdvisoryDerivation | null;
  cap?: CapRow;
  bindingGroupCaps?: BindingGroupCap[];
  edge?: ResolvedEdge;
  edgeWeights: EdgeWeights;
  convictionSum: number | null;
  allPicks: { asset: string; direction: "long" | "short"; notional?: number }[];
  correlationPairs: CorrelationPairLite[] | null;
  ideas: IndependentIdeas | null;
  scenarios: ScenarioResult[];
  repl?: ReplicationNames | null;
  bookRunDate?: string | null;
}) {
  const isLong = pick.direction === "long";
  const dirColor = isLong ? "var(--long)" : "var(--short)";
  const showProse = canRenderAdvisoryBody(advisory);
  const themeName = pick.theme_name ?? pick.theme ?? null;

  const hasEdge =
    !!edge &&
    (edge.trend_signal !== null ||
      edge.regime_bias !== null ||
      edge.carry_signal !== null ||
      edge.value_signal !== null);
  const conviction = edge?.conviction ?? null;

  // Always-visible plain-English rationale (never hidden behind expand). The
  // numeric component breakdown (edgeRationale) becomes the hover title and the
  // expanded EdgeScore bars â€” a reader gets the "why" without decoding values.
  //
  // The driver phrase ALONE does not differentiate: trend has the largest raw
  // magnitudes and wins on nearly every name, so the live book rendered two strings
  // across nine rows. It is joined to what the name was taken instead of â€” its
  // independent-idea complex, the same rho 0.70 measurement PoolDepth renders â€” which
  // is the sharpest available answer to "why this ticker". ADR-0054.
  const plain = hasEdge && edge ? plainRationale(edge, edgeWeights) : null;
  // Per-position replication stability (ADR-0057).
  const stability = positionStability(
    pick.direction,
    pick.asset,
    repl,
    bookRunDate,
  );
  const stabilityNote = stabilityLabel(stability, repl?.samples ?? 0);
  const rationale = positionRationale(
    plain,
    distinguishPosition(pick.asset, pick.direction, ideas)
  );
  const rationaleDetail = hasEdge && edge ? edgeRationale(edge) : undefined;

  // The sizing derivation â€” conviction Ã— inverse-vol â†’ cap â†’ notional.
  const sizingChain = buildSizingChain({
    direction: pick.direction,
    edge:
      edge ?? {
        edge_score: null,
        trend_signal: null,
        regime_bias: null,
        carry_signal: null,
        value_signal: null,
        sentiment_signal: null,
        conviction: null,
        vol: null,
        direction: null,
        run_date: null,
        source: "none",
      },
    weight: pick.weight,
    signedWeight: pick.signed_weight,
    notional: pick.notional,
    hypeScore: pick.hype_score,
    cap: cap
      ? {
          weight: cap.weight,
          cap: cap.cap,
          utilisation: cap.utilisation,
          breached: cap.breached,
        }
      : undefined,
    convictionSum,
    bindingGroupCaps,
  });

  const marginal = marginalContribution(
    { asset: pick.asset, direction: pick.direction, notional: pick.notional },
    allPicks
  );
  const sibling = topSibling(pick.asset, correlationPairs);

  // Per-position scenario lines, parsed from the breakdown strings the backend
  // already emits (e.g. "  TLT (long): +8.0% Ã— +4% = +0.32%").
  const perScenario = scenarios
    .map((s) => ({
      label: s.label,
      severity: s.severity,
      line: s.contribution_breakdown.find((b) =>
        b.trim().startsWith(`${pick.asset} (`)
      ),
    }))
    .filter((s) => s.line);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* A div, not a button: the theme name is an <a>, which cannot be nested
          inside a <button>. Keyboard + ARIA are wired by hand to keep the row a
          single toggle target while the inner link stays independently focusable. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        // py-[9px], NOT the py-[7px] used on ordinary table cells. This row is the
        // primary touch target on /book: 9px of padding either side of two lines of
        // 13px text lands it at ~48px, above the 44px WCAG target-size floor.
        // Goal 8 is a floor, so density stops here rather than at the cell value.
        // Open-row marking. The closed state keeps a TRANSPARENT border of the
        // same width so opening a row does not shift its contents 4px sideways.
        // --accent, never --long: the comp this came from marks its open row
        // with its LONG colour, which would mean a long and an open short row
        // read the same (goal 3, ADR-0085). Border-box sizing keeps the 4px
        // inside BOOK_ROW_MIN_W, so the two-pane arithmetic is untouched.
        className={`w-full ${BOOK_ROW_MIN_W} ${BOOK_ROW_GRID} text-left px-4 py-[9px] border-l-4 ${
          open ? "border-accent bg-bg-elevated" : "border-transparent"
        } hover:bg-bg-elevated transition-colors grid items-center gap-3 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
      >
        <span className="num text-text-tertiary text-[12px]">#{rank}</span>
        <span className="flex flex-col min-w-0 gap-0.5">
          <span className="flex items-baseline gap-2 min-w-0">
            <span
              className="num font-semibold text-[14px]"
              style={{ color: dirColor }}
            >
              {pick.asset}
            </span>
            {pick.theme_id && themeName ? (
              <Link
                href={`/?theme=${pick.theme_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-text-secondary text-[12px] truncate hover:text-accent hover:underline"
                title={`Attention trend for ${themeName}`}
              >
                {themeName}
              </Link>
            ) : (
              <span className="text-text-secondary text-[12px] truncate">
                {themeName ?? "â€”"}
              </span>
            )}
          </span>
          {/* Always-visible PLAIN rationale â€” the "why this side". Numeric
              component breakdown is the hover title + the expanded bars. */}
          {/* WRAPS, never truncates. The grid is min-w-[640px] inside a horizontal
              ScrollArea, so this cell is ~150px wide at EVERY viewport below desktop
              â€” measured live at 375px, an ellipsis left exactly 18 characters, which
              is "Long Â· a strong pâ€¦" on all five longs. No ordering of the clauses
              fixes a cell that narrow; the truncation is the defect. Wrapping costs
              row height on mobile and shows the whole line, which is the trade this
              page should always make. At 1440px the cell is wide enough that nothing
              wraps at all (verified: zero wrapped rows). */}
          <span
            className="text-text-secondary text-[11.5px] break-words"
            title={rationaleDetail}
          >
            {rationale ?? "EdgeScore not persisted for this position"}
          </span>
          {/* Did the agent pick THIS name every time it was re-run on identical
              inputs? The replication panel reports 33% long-side churn as an
              aggregate, which taints the names that were in fact unanimous. Per
              position it separates them. Silent when unmeasured â€” a replication
              from another run_date says nothing about today's names. */}
          {stabilityNote && (
            <span
              className="text-[10.5px] num"
              style={{
                color:
                  stability === "coinflip"
                    ? "var(--warning)"
                    : "var(--text-tertiary)",
              }}
              title={
                stability === "coinflip"
                  ? "Re-running the reasoning step on identical inputs did not always produce this position â€” the agent rates several names here equally."
                  : "Re-running the reasoning step on identical inputs produced this position every time."
              }
            >
              {stabilityNote}
            </span>
          )}
        </span>
        <span className="text-right">
          <span className="num text-[13px] font-semibold">
            {fmtPct(pick.weight)}
          </span>
          <span className="text-text-tertiary text-[11px] num ml-1.5">
            {fmtUSD(pick.notional)}
          </span>
        </span>
        {/* EdgeScore â€” the number whose sign is the side. */}
        <span
          className="num text-right text-[12px] font-semibold"
          style={{ color: hasEdge ? dirColor : "var(--text-tertiary)" }}
          title="EdgeScore = 0.35Â·Trend + 0.25Â·Regime + 0.20Â·Carry + 0.20Â·Value"
        >
          {edge && edge.edge_score !== null ? fmtSigned(edge.edge_score) : "â€”"}
        </span>
        {/* Conviction chip â€” |Edge|/vol, always visible. */}
        <span className="text-right">
          {conviction !== null ? (
            <span
              className="num text-[11px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              title="Conviction = |EdgeScore| / vol â€” the inverse-vol sizing weight"
            >
              {conviction.toFixed(1)}Ã—
            </span>
          ) : (
            <span
              className="text-text-tertiary text-[11px]"
              title="No conviction persisted â€” this position was sized by HypeScore"
            >
              hype
            </span>
          )}
        </span>
        <span className="text-right">
          {cap ? (
            <span
              className="num text-[11px]"
              title={`${(cap.weight * 100).toFixed(1)}% of a ${(cap.cap * 100).toFixed(0)}% single-name cap`}
              style={{
                color: cap.breached
                  ? "var(--short)"
                  : cap.utilisation > 0.8
                    ? "var(--warning)"
                    : "var(--text-tertiary)",
              }}
            >
              {(cap.utilisation * 100).toFixed(0)}% cap
            </span>
          ) : (
            <span className="text-text-tertiary text-[11px]">â€”</span>
          )}
        </span>
        <span className="text-text-tertiary text-[12px] text-right">
          {open ? "âˆ’" : "+"}
        </span>
      </div>

      {open && (
        <div className="px-[18px] pb-5 pt-1 bg-bg-elevated/40">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <SubHead>Thesis</SubHead>
              {showProse && pick.thesis ? (
                <CitationList text={pick.thesis} citations={citations} />
              ) : (
                <p className="m-0 text-[12.5px] text-text-tertiary leading-[1.6]">
                  {pick.thesis
                    ? "Withheld â€” this run's thesis did not pass citation verification, so it is not shown."
                    : "No thesis persisted for this position."}
                </p>
              )}

              {showProse && pick.counter_thesis && (
                <>
                  <SubHead className="mt-4">Counter-thesis</SubHead>
                  <div
                    className="rounded-md px-3 py-2.5 text-[12.5px] leading-[1.6] border"
                    style={{
                      background: "rgba(159, 23, 42, 0.06)",
                      borderColor: "rgba(159, 23, 42, 0.3)",
                    }}
                  >
                    {pick.counter_thesis}
                  </div>
                  {/* Six of ten counter-theses name the 200-day MA as the trigger and
                      nothing said what it was, so the reader could not tell how close
                      the trade was to being disqualified. ADR-0078. */}
                  {pick.ma_context && (
                    <p className="text-[11.5px] text-text-tertiary mt-1.5 mb-0">
                      {pick.asset} last{" "}
                      <span className="num">
                        {pick.ma_context.last.toFixed(2)}
                      </span>{" "}
                      Â· {pick.ma_context.window}-day MA{" "}
                      <span className="num">{pick.ma_context.ma.toFixed(2)}</span> Â·{" "}
                      <span
                        className="num"
                        style={{
                          color:
                            Math.abs(pick.ma_context.pct_from_ma) < 0.03
                              ? "var(--warning)"
                              : undefined,
                        }}
                      >
                        {fmtSigned(pick.ma_context.pct_from_ma * 100, 1)}%
                      </span>{" "}
                      {Math.abs(pick.ma_context.pct_from_ma) < 0.03
                        ? "â€” within 3% of the moving average, so an MA-based trigger is close."
                        : "away from it."}
                    </p>
                  )}
                </>
              )}

              {showProse && pick.catalysts && pick.catalysts.length > 0 && (
                <>
                  <SubHead className="mt-4">Catalysts</SubHead>
                  <ul className="m-0 pl-[18px] leading-[1.7] text-[12.5px]">
                    {pick.catalysts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              {pick.time_horizon && (
                <div className="text-[11px] text-text-tertiary mt-3">
                  Horizon:{" "}
                  <span className="num text-text-secondary">
                    {pick.time_horizon}
                  </span>
                </div>
              )}

              {/* P1 â€” marginal contribution to the whole book. */}
              <SubHead className="mt-4">Contribution to book</SubHead>
              <PositionMarginalRisk marginal={marginal} sibling={sibling} />
            </div>

            <div>
              <SubHead>
                Why {isLong ? "long" : "short"} â€” EdgeScore decomposition
              </SubHead>
              {hasEdge && edge ? (
                <div className="mb-4">
                  <EdgeBars
                    edge={edge}
                    weights={edgeWeights}
                    direction={pick.direction}
                  />
                  {edge.source === "theme_latest" && (
                    <p className="m-0 mt-2 text-[10.5px] text-text-tertiary leading-[1.5]">
                      From the theme&apos;s latest{" "}
                      <code className="num">theme_signals_history</code> row â€” the
                      position row carried no edge columns, so this is the theme
                      signal, not necessarily the one that sized this book.
                    </p>
                  )}
                </div>
              ) : (
                <p className="m-0 mb-4 text-[12px] text-text-tertiary leading-[1.6]">
                  Direction is <code className="num">sign(EdgeScore)</code>, where{" "}
                  <code className="num">
                    EdgeScore = 0.35Â·Trend + 0.25Â·Regime + 0.20Â·Carry +
                    0.20Â·Value
                  </code>
                  . No component was persisted for this position or its
                  theme&apos;s latest run. See{" "}
                  <Link href="/method#edgescore" className="text-accent">
                    Method Â§4
                  </Link>
                  .
                </p>
              )}

              <SubHead>Sizing â€” conviction Ã— inverse-vol</SubHead>
              <div className="mb-1">
                <SizingChainView chain={sizingChain} />
              </div>

              {pick.factor_tilts && Object.keys(pick.factor_tilts).length > 0 && (
                <>
                  {/* These are THIS ASSET's own betas, joined from the L2
                      factor_exposures table â€” not the book's. Until ADR-0075 the model
                      was asked to fill this field and copied one aggregate row into all
                      ten positions, so SHY and ARKK printed the same market beta. */}
                  <SubHead className="mt-4">
                    Factor exposure â€” {pick.asset}&rsquo;s own betas
                  </SubHead>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pick.factor_tilts).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[11.5px] num bg-bg-elevated text-text-secondary px-2 py-1 rounded border border-border"
                      >
                        {FACTOR_LABELS[k] ?? k} {fmtSigned(v)}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-text-tertiary mt-1.5 mb-0">
                    FF5 + UMD, 252-day regression against {pick.asset}&rsquo;s own returns.{" "}
                    {typeof pick.factor_r_squared === "number" ? (
                      <>
                        R<sup>2</sup> <span className="num">{pick.factor_r_squared.toFixed(2)}</span>
                        {pick.factor_r_squared < 0.3
                          ? " â€” a weak fit, so read these betas loosely."
                          : "."}
                      </>
                    ) : (
                      <>Fit quality not recorded.</>
                    )}
                  </p>
                </>
              )}

              <SubHead className="mt-4">Under stress</SubHead>
              {perScenario.length > 0 ? (
                <ul className="m-0 pl-0 list-none space-y-1">
                  {perScenario.map((s) => (
                    <li
                      key={s.label}
                      className="text-[12px] num flex justify-between gap-3"
                    >
                      <span className="text-text-secondary">{s.label}</span>
                      <span
                        style={{
                          color:
                            SEVERITY_COLOR[s.severity] ?? "var(--text-secondary)",
                          // The only thing separating `severe` from `high`, both
                          // crimson â€” see SEVERITY_COLOR.
                          fontWeight: s.severity === "severe" ? 600 : undefined,
                        }}
                        title={`${s.severity} severity`}
                      >
                        {s.line?.split("=").pop()?.trim() ?? "â€”"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[12px] text-text-tertiary leading-[1.6]">
                  No per-position stress contribution recorded. Scenario results
                  are written to{" "}
                  <code className="num">
                    research_recommendations.scenario_results
                  </code>
                  ; see <Link href="/risk" className="text-accent">Risk</Link>.
                </p>
              )}

              {showProse && pick.risk && (
                <>
                  <SubHead className="mt-4">Risk</SubHead>
                  <p className="m-0 text-[12.5px] leading-[1.7]">{pick.risk}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
