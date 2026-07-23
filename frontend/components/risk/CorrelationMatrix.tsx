// frontend/components/risk/CorrelationMatrix.tsx
//
// Only pairs above |rho| >= HIGH_CORR_THRESHOLD are persisted, so the grid below
// is a sparse view of a flagged subset — never a full correlation matrix. Cells
// with no persisted pair are rendered as unknown, not as zero: inventing a 0.00
// where the backend stored nothing is exactly the kind of fabricated number this
// page exists to eliminate.

"use client";
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
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";

function relationshipBadge(pair: CorrelationPair) {
  const inverse = pair.relationship
    ? pair.relationship === "inverse"
    : pair.corr < 0;
  return (
    <span className={`badge ${inverse ? "badge-long" : "badge-short"}`}>
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

export function CorrelationMatrix({
  state,
}: {
  state: AnalyticsState<CorrelationPair[]>;
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
  const sameDirection = pairs.filter((p) =>
    p.relationship ? p.relationship === "same-direction" : p.corr > 0,
  ).length;

  return (
    <section className="card mb-6" aria-labelledby="risk-corr-heading">
      <div className="card-header">
        <h2 id="risk-corr-heading" className="card-title m-0">
          Correlation — flagged pairs
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {state.status === "ok"
            ? `${pairs.length} flagged · ${sameDirection} same-direction${
                threshold !== null ? ` · |ρ| ≥ ${threshold.toFixed(2)}` : ""
              }`
            : "252d lookback"}
        </span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={200} />
      ) : gap ? (
        <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
      ) : (
        <>
          <p className="m-0 px-[18px] pt-3.5 text-[12px] text-text-secondary leading-[1.6] max-w-[86ch]">
            Same-direction pairs above the{" "}
            {threshold !== null ? threshold.toFixed(2) : "flagging"} threshold mean the
            book is doubling a bet, not diversifying: two lines of risk that will draw
            down together and size like one position. Inverse pairs are the opposite —
            one leg is hedging the other, which caps the upside as well as the loss.
            Either can be intentional; neither should be accidental.
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
                      className={`px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-y border-border bg-bg-elevated ${
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
                      <td className="px-[18px] py-2.5 border-b border-border num">
                        {p.asset_a} <span className="text-text-tertiary">×</span> {p.asset_b}
                      </td>
                      <td
                        className={`px-[14px] py-2.5 border-b border-border text-right num ${
                          p.corr >= 0 ? "text-short" : "text-long"
                        }`}
                      >
                        {fmtSignedBeta(p.corr)}
                      </td>
                      <td className="px-[14px] py-2.5 border-b border-border text-right">
                        {relationshipBadge(p)}
                      </td>
                      <td className="px-[18px] py-2.5 border-b border-border text-right num text-text-tertiary">
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
    </section>
  );
}
