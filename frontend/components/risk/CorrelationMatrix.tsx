// frontend/components/risk/CorrelationMatrix.tsx
//
// Only pairs above |rho| >= HIGH_CORR_THRESHOLD are persisted, so the grid below
// is a sparse view of a flagged subset — never a full correlation matrix. Cells
// with no persisted pair are rendered as unknown, not as zero: inventing a 0.00
// where the backend stored nothing is exactly the kind of fabricated number this
// page exists to eliminate.

"use client";

import { DisclosureChevron } from "@/components/DisclosureChevron";
import {
  assetsFromPairs,
  correlationCellColor,
  correlationLookup,
  explainGap,
  fmtSignedBeta,
  lookupCorr,
  thresholdFromPairs,
  type AnalyticsState,
  type CorrelationPair,
  type CorrelationSummary,
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";

function relationshipBadge(pair: CorrelationPair) {
  const inverse = pair.relationship
    ? pair.relationship === "inverse"
    : pair.corr < 0;
  return (
    <span className={`badge ${inverse ? "badge-neutral" : "badge-warning"}`}>
      {inverse ? "inverse / hedge" : "same-direction"}
    </span>
  );
}

function Heatmap({
  assets,
  lookup,
  threshold,
}: {
  assets: string[];
  lookup: Map<string, number>;
  threshold: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <caption className="sr-only">
          Pairwise correlation heatmap for the {assets.length} assets that appear in
          at least one flagged pair. Cells without a persisted value fall below the
          flagging threshold and are shown as unknown.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 bg-bg-surface px-2 py-1.5 text-left text-text-tertiary font-medium"
            >
              <span className="sr-only">Asset</span>
            </th>
            {assets.map((a) => (
              <th
                key={a}
                scope="col"
                className="px-2 py-1.5 text-text-secondary font-medium num whitespace-nowrap"
              >
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((rowAsset) => (
            <tr key={rowAsset}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-bg-surface px-2 py-1.5 text-left text-text-secondary font-medium num whitespace-nowrap border-r border-border"
              >
                {rowAsset}
              </th>
              {assets.map((colAsset) => {
                if (rowAsset === colAsset) {
                  return (
                    <td
                      key={colAsset}
                      className="px-2 py-1.5 text-center num text-text-tertiary bg-bg-elevated border border-bg-primary"
                      title={`${rowAsset} against itself — 1.00 by definition`}
                    >
                      1.00
                    </td>
                  );
                }
                const corr = lookupCorr(lookup, rowAsset, colAsset);
                if (corr === undefined) {
                  return (
                    <td
                      key={colAsset}
                      className="px-2 py-1.5 text-center num text-text-tertiary border border-bg-primary"
                      title={
                        threshold !== null
                          ? `${rowAsset}/${colAsset}: |ρ| below the ${threshold.toFixed(2)} flagging threshold — not persisted`
                          : `${rowAsset}/${colAsset}: below the flagging threshold — not persisted`
                      }
                    >
                      ·
                    </td>
                  );
                }
                return (
                  <td
                    key={colAsset}
                    className="px-2 py-1.5 text-center num text-text-primary border border-bg-primary"
                    style={{ background: correlationCellColor(corr) }}
                    title={`${rowAsset}/${colAsset}: ρ = ${fmtSignedBeta(corr)}`}
                  >
                    {fmtSignedBeta(corr)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FullHeatmap({
  assets,
  lookup,
}: {
  assets: string[];
  lookup: Map<string, number>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <caption className="sr-only">
          Full pairwise correlation heatmap for all assets with persisted return data.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-bg-surface px-2 py-1.5 text-left text-text-tertiary font-medium">
              <span className="sr-only">Asset</span>
            </th>
            {assets.map((asset) => (
              <th key={asset} scope="col" className="px-2 py-1.5 text-text-secondary font-medium num whitespace-nowrap">
                {asset}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((rowAsset) => (
            <tr key={rowAsset}>
              <th scope="row" className="sticky left-0 z-10 bg-bg-surface px-2 py-1.5 text-left text-text-secondary font-medium num whitespace-nowrap border-r border-border">
                {rowAsset}
              </th>
              {assets.map((colAsset) => {
                if (rowAsset === colAsset) {
                  return <td key={colAsset} className="px-2 py-1.5 text-center num text-text-tertiary bg-bg-elevated border border-bg-primary">1.00</td>;
                }
                const corr = lookupCorr(lookup, rowAsset, colAsset);
                return (
                  <td
                    key={colAsset}
                    className="px-2 py-1.5 text-center num border border-bg-primary"
                    style={corr === undefined ? undefined : { background: correlationCellColor(corr) }}
                    title={corr === undefined ? `${rowAsset}/${colAsset}: correlation unavailable` : `${rowAsset}/${colAsset}: rho = ${fmtSignedBeta(corr)}`}
                  >
                    {corr === undefined ? "-" : fmtSignedBeta(corr)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CorrelationMatrix({
  state,
  summary,
  matrix,
}: {
  state: AnalyticsState<CorrelationPair[]>;
  summary?: CorrelationSummary | null;
  matrix?: CorrelationPair[] | null;
}) {
  const gap = explainGap(state, {
    column: "correlation_pairs",
    emptyMeaning:
      "The array is [] — either the sized book has fewer than two positions to correlate, or no pair " +
      "cleared the flagging threshold over the 252-day lookback. An empty array is a valid clean result " +
      "for a book that exists; it is also what an empty book produces, so check the position count first.",
  });

  const pairs = state.status === "ok" ? state.value : [];
  const threshold = thresholdFromPairs(pairs);
  const assets = assetsFromPairs(pairs);
  const lookup = correlationLookup(pairs);
  const matrixPairs = Array.isArray(matrix) ? matrix : [];
  const matrixAssets = assetsFromPairs(matrixPairs);
  // The header prints two counts side by side, and they MUST share a denominator.
  // Counting "same-direction" over the flagged subset while the first number counts
  // the full matrix reads as "0 of 36 move together" when it means "0 of 0 flagged".
  const hasMatrix = matrixAssets.length >= 2;
  const counted = hasMatrix ? matrixPairs : pairs;
  const sameDirection = counted.filter((p) =>
    p.relationship ? p.relationship === "same-direction" : p.corr > 0,
  ).length;
  const matrixBlock = hasMatrix ? (
    <div className="px-[18px] py-4 border-b border-border">
      <div className="flex items-center justify-between mb-2.5 gap-4 flex-wrap">
        <h3 className="card-title m-0">Heatmap · all measured pairs</h3>
        <span className="text-[11px] text-text-tertiary num">{matrixPairs.length} pairs · 252d returns</span>
      </div>
      <FullHeatmap assets={matrixAssets} lookup={correlationLookup(matrixPairs)} />
      <p className="m-0 mt-2.5 text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
        Complete pairwise correlation structure for the held assets. A dash means that pair
        could not be measured from the shared return window; it is not zero. Source: <Ident>research_recommendations.book_metrics.correlation_matrix</Ident>.
      </p>
    </div>
  ) : null;

  return (
    <details open className="card mb-6 group" aria-labelledby="risk-corr-heading">
      <summary className="card-header cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <h2 id="risk-corr-heading" className="card-title m-0">
          Correlation — flagged pairs
        </h2>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary num">
            {state.status === "ok"
              ? `${counted.length} ${hasMatrix ? "measured" : "flagged"} · ${sameDirection} same-direction${
                  threshold !== null ? ` · flag |ρ| ≥ ${threshold.toFixed(2)}` : ""
                }`
              : "252d lookback"}
          </span>
          <DisclosureChevron className="text-text-tertiary" />
        </span>
      </summary>

      {state.status === "loading" ? (
        <SectionSkeleton height={200} />
      ) : gap ? (
        <>
          {matrixBlock}
          {summary?.max_abs_pair && typeof summary.max_abs_pair.corr === "number" && (
            <div className="px-[18px] pt-3.5">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-text-tertiary">
                <span>
                  Highest pair: <span className="num text-text-secondary">
                    {summary.max_abs_pair.asset_a ?? "—"} × {summary.max_abs_pair.asset_b ?? "—"} {fmtSignedBeta(summary.max_abs_pair.corr)}
                  </span>
                </span>
                {typeof summary.mean_abs_corr === "number" && (
                  <span>Mean |ρ|: <span className="num text-text-secondary">{summary.mean_abs_corr.toFixed(2)}</span></span>
                )}
              </div>
            </div>
          )}
          <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
        </>
      ) : (
        <>
          {matrixBlock}
          <div className="px-[18px] pt-3.5">
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Flagging threshold
              </span>
              <span className="num text-[15px] font-semibold text-text-primary">
                {threshold !== null ? `|ρ| ≥ ${threshold.toFixed(2)}` : "not recorded"}
              </span>
            </div>
            {summary?.max_abs_pair && typeof summary.max_abs_pair.corr === "number" && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-text-tertiary">
                <span>
                  Highest pair: <span className="num text-text-secondary">
                    {summary.max_abs_pair.asset_a ?? "—"} × {summary.max_abs_pair.asset_b ?? "—"} {fmtSignedBeta(summary.max_abs_pair.corr)}
                  </span>
                </span>
                {typeof summary.mean_abs_corr === "number" && (
                  <span>Mean |ρ|: <span className="num text-text-secondary">{summary.mean_abs_corr.toFixed(2)}</span></span>
                )}
              </div>
            )}
            <p className="m-0 mt-1.5 text-[11px] text-text-tertiary leading-[1.6] max-w-[86ch]">
              Only pairs whose 252-day |ρ| clears this threshold are persisted to{" "}
              <Ident>correlation_pairs</Ident>. Every unflagged pair — and every empty
              cell in the heatmap below — was computed and found below the threshold; it
              is unknown-but-small, not zero. This is a sparse view of a flagged subset,
              never the full matrix.
            </p>
          </div>
          <p className="m-0 px-[18px] pt-3 text-[12px] text-text-secondary leading-[1.6] max-w-[86ch]">
            Same-direction pairs above the threshold mean the book is doubling a bet, not
            diversifying: two lines of risk that will draw down together and size like one
            position. Inverse pairs are the opposite — one leg is hedging the other, which
            caps the upside as well as the loss. Either can be intentional; neither should
            be accidental.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[560px]">
              <caption className="sr-only">
                Asset pairs whose 252-day return correlation cleared the flagging
                threshold, strongest first.
              </caption>
              <thead>
                <tr>
                  {["Pair", "ρ (252d)", "Relationship", "Threshold"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`px-[18px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-y border-border-strong bg-bg-elevated ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...pairs]
                  .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
                  .map((p, i) => (
                    <tr key={`${p.asset_a}-${p.asset_b}-${i}`} className="hover:bg-bg-elevated">
                      <td className="px-[18px] py-[7px] border-b border-border num">
                        {p.asset_a} <span className="text-text-tertiary">×</span> {p.asset_b}
                      </td>
                      <td
                        className={`px-[14px] py-[7px] border-b border-border text-right num ${
                          p.corr >= 0 ? "text-short" : "text-long"
                        }`}
                      >
                        {fmtSignedBeta(p.corr)}
                      </td>
                      <td className="px-[14px] py-[7px] border-b border-border text-right">
                        {relationshipBadge(p)}
                      </td>
                      <td className="px-[18px] py-[7px] border-b border-border text-right num text-text-tertiary">
                        {typeof p.threshold === "number" ? p.threshold.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {assets.length >= 2 && (
            <div className="px-[18px] py-4 border-t border-border">
              <div className="flex items-center justify-between mb-2.5 gap-4 flex-wrap">
                <h3 className="card-title m-0">Heatmap · flagged assets</h3>
                <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ background: correlationCellColor(1) }}
                    />
                    positive — doubling a bet
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ background: correlationCellColor(-1) }}
                    />
                    negative — hedge
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm border border-border" />
                    not flagged
                  </span>
                </div>
              </div>
              <Heatmap assets={assets} lookup={lookup} threshold={threshold} />
              <p className="m-0 mt-2.5 text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
                Axes list only the {assets.length} assets that appear in a flagged pair.
                A <span className="num">·</span> cell is unknown, not zero — the backend
                persists a pair only when it clears the threshold, so the correlation
                for that cell was computed and discarded. The diagonal is 1.00 by
                definition. Source: <Ident>research_recommendations.correlation_pairs</Ident>.
              </p>
            </div>
          )}
        </>
      )}
    </details>
  );
}
