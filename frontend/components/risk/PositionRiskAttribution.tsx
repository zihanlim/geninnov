// frontend/components/risk/PositionRiskAttribution.tsx
//
// "Which trade do I cut?" — decomposed per position. Marginal contribution to
// book beta (signed_weight × β_mkt), share of gross and net, and the average
// correlation to the rest of the book from the flagged pairs. Sorted by the size
// of the beta contribution, because the position that moves the book most is the
// one the question is about. A position with no factor regression shows "—" for
// beta, never a zero that would understate its risk.

"use client";
import { netShareIsMeaningful, type PositionAttribution } from "@/lib/risk/riskBoard";
import { isNum } from "@/lib/risk/analytics";
import { Ident, SectionSkeleton } from "./SectionGap";

const fmtSignedPct = (v: number | null): string =>
  isNum(v) ? `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}%` : "—";
const fmtSignedBeta = (v: number | null): string =>
  isNum(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}` : "—";
const fmtPct = (v: number | null): string =>
  isNum(v) ? `${(v * 100).toFixed(0)}%` : "—";
const fmtCorr = (v: number | null): string => (isNum(v) ? v.toFixed(2) : "—");

/** A diverging bar for a signed contribution, scaled to the row max. */
function ContribBar({
  value,
  max,
  positiveIsRisk,
}: {
  value: number | null;
  max: number;
  /** true → positive renders red (adds directional risk); false → accent. */
  positiveIsRisk?: boolean;
}) {
  if (!isNum(value) || max <= 0) {
    return <div className="h-1.5 w-full bg-border rounded-sm" aria-hidden="true" />;
  }
  const widthPct = Math.min(Math.abs(value) / max, 1) * 50;
  const negative = value < 0;
  const posColor = positiveIsRisk ? "bg-short" : "bg-accent";
  const negColor = positiveIsRisk ? "bg-long" : "bg-short";
  return (
    <div className="h-1.5 bg-border rounded-sm relative overflow-hidden">
      <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-text-tertiary" />
      <div
        className={`absolute top-0 bottom-0 h-full ${
          negative ? `${negColor} right-1/2 rounded-l-sm` : `${posColor} left-1/2 rounded-r-sm`
        }`}
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
}

export function PositionRiskAttribution({
  loading,
  rows,
  bookBeta,
  positionsFailure,
  factorsFailure,
  hasPositions,
}: {
  loading: boolean;
  rows: PositionAttribution[];
  /** Value-weighted book beta, for the "sum of contributions" reconciliation. */
  bookBeta: number | null;
  positionsFailure: string | null;
  factorsFailure: string | null;
  hasPositions: boolean;
}) {
  const maxBeta = rows.reduce(
    (m, r) => Math.max(m, isNum(r.betaContribution) ? Math.abs(r.betaContribution) : 0),
    0,
  );
  const sumBeta = rows.reduce(
    (s, r) => s + (isNum(r.betaContribution) ? r.betaContribution : 0),
    0,
  );
  const measuredBeta = rows.filter((r) => isNum(r.betaContribution)).length;
  const missingBeta = rows.filter(
    (r) => isNum(r.signedWeight) && !isNum(r.betaContribution),
  );

  // Whether "net share" is a share for this book. The predicate is imported rather
  // than re-derived here so the column and the note explaining its absence cannot
  // disagree — the drift ADR-0058 hit when a verdict was recomputed at the render
  // layer. The two figures below are only for the explanation's wording.
  const signedWeights = rows.map((r) => r.signedWeight);
  const netShareMeaningful = netShareIsMeaningful(signedWeights);
  const netExposure = signedWeights.reduce<number>((s, w) => s + (w ?? 0), 0);
  const maxAbsWeight = signedWeights.reduce<number>(
    (m, w) => Math.max(m, w === null ? 0 : Math.abs(w)),
    0,
  );

  return (
    <section className="card mb-6" aria-labelledby="risk-attrib-heading">
      <div className="card-header">
        <h2 id="risk-attrib-heading" className="card-title m-0">
          Per-position risk attribution
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {loading ? "…" : `${rows.length} position${rows.length === 1 ? "" : "s"} · β-contribution first`}
        </span>
      </div>

      {loading ? (
        <SectionSkeleton height={240} />
      ) : positionsFailure ? (
        <div className="px-[18px] py-6 text-[13px]" role="alert">
          <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--short)" }}>
            <p className="m-0 mb-1.5 font-medium text-text-primary">
              portfolio_positions could not be read
            </p>
            <p className="m-0 text-text-secondary leading-[1.6]">
              {positionsFailure}. The attribution below is blank because of the failed
              read, not because the book carries no risk.
            </p>
          </div>
        </div>
      ) : !hasPositions ? (
        <div className="px-[18px] py-6 text-[13px]">
          <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--border-strong)" }}>
            <p className="m-0 mb-1.5 font-medium text-text-primary">No positions to attribute</p>
            <p className="m-0 text-text-secondary leading-[1.6]">
              <Ident>portfolio_positions</Ident> returned no rows for the latest run, so
              there is nothing to decompose. The pipeline sizes a book only from themes
              that clear the EdgeScore abstain threshold; re-run{" "}
              <code className="num text-accent">python -m scripts.daily_refresh</code>{" "}
              once candidates qualify.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="m-0 px-[18px] pt-3.5 text-[12px] text-text-secondary leading-[1.6] max-w-[92ch]">
            Each position&apos;s marginal contribution to book market-beta is its signed
            weight × its own β<sub>mkt</sub> (from <Ident>factor_exposures</Ident>). The
            contributions sum to the book beta, so a large red bar is a position pulling
            the whole book directional — the first candidate to cut. Gross and net shares
            show how much of the book&apos;s leverage and directional tilt the name owns;
            avg |ρ| is its mean flagged correlation to the rest of the book.
          </p>

          {!netShareMeaningful && (
            <p
              className="m-0 px-[18px] pt-2 text-[12px] leading-[1.6] max-w-[92ch]"
              style={{ color: "var(--warning)" }}
              role="note"
            >
              <strong>Net share is withheld for this book.</strong> Net exposure is{" "}
              <span className="num">{fmtSignedPct(netExposure)}</span> against a largest
              single position of <span className="num">{fmtPct(maxAbsWeight)}</span>, so
              a &ldquo;share of net&rdquo; would exceed 100% — and a share cannot exceed
              the whole it is a share of. A long-short book is built to run close to
              market-neutral, so this is the normal state, not a fault: the directional
              tilt is too small to decompose. Gross share is unaffected and is the
              column to read.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[860px]">
              <caption className="sr-only">
                Per-position contribution to book beta, gross and net exposure, and
                average correlation to the book, sorted by beta contribution.
              </caption>
              <thead>
                <tr>
                  {[
                    "Asset",
                    "Dir",
                    "Signed wt",
                    "β mkt",
                    "β contribution",
                    "Gross share",
                    "Net share",
                    "Avg |ρ| to book",
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-y border-border bg-bg-elevated ${
                        i <= 1 ? "text-left" : i === 4 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-elevated">
                    <td className="px-[14px] py-2.5 border-b border-border num text-text-primary">
                      {r.asset}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border">
                      <span
                        className={`dir-pill ${
                          r.direction === "long" ? "dir-pill-long" : "dir-pill-short"
                        } text-[10px] px-1.5 py-px rounded`}
                      >
                        {r.direction === "long" ? "L" : "S"}
                      </span>
                    </td>
                    <td
                      className={`px-[14px] py-2.5 border-b border-border text-right num ${
                        r.direction === "long" ? "text-long" : "text-short"
                      }`}
                    >
                      {fmtSignedPct(r.signedWeight)}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                      {fmtSignedBeta(r.betaMkt)}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-[80px]">
                          <ContribBar value={r.betaContribution} max={maxBeta} positiveIsRisk />
                        </div>
                        <span
                          className={`num text-[12px] w-[52px] text-right ${
                            !isNum(r.betaContribution)
                              ? "text-text-tertiary"
                              : r.betaContribution >= 0
                                ? "text-short"
                                : "text-long"
                          }`}
                        >
                          {fmtSignedBeta(r.betaContribution)}
                        </span>
                      </div>
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                      {fmtPct(r.grossShare)}
                    </td>
                    <td
                      className={`px-[14px] py-2.5 border-b border-border text-right num ${
                        !isNum(r.netShare)
                          ? "text-text-tertiary"
                          : r.netShare >= 0
                            ? "text-long"
                            : "text-short"
                      }`}
                    >
                      {fmtSignedPct(r.netShare)}
                    </td>
                    <td
                      className={`px-[14px] py-2.5 border-b border-border text-right num ${
                        r.avgCorr === null ? "text-text-tertiary" : "text-text-primary"
                      }`}
                      title={
                        r.avgCorr === null
                          ? "No flagged correlation pair involves this asset"
                          : `${r.corrPairCount} flagged pair${r.corrPairCount === 1 ? "" : "s"}`
                      }
                    >
                      {fmtCorr(r.avgCorr)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-[14px] py-2.5 text-right num text-[11px] text-text-tertiary">
                    Σ β contribution ({measuredBeta} of {rows.length} measured)
                  </td>
                  <td className="px-[14px] py-2.5 text-left num text-[12px] text-text-primary">
                    {fmtSignedBeta(sumBeta)}
                    {isNum(bookBeta) && (
                      <span className="text-text-tertiary">
                        {" "}
                        · book β {fmtSignedBeta(bookBeta)}
                      </span>
                    )}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            {factorsFailure ? (
              <>
                <span className="text-short">factor_exposures read failed:</span>{" "}
                {factorsFailure}. Beta contributions are blank because the regressions
                could not be read.{" "}
              </>
            ) : missingBeta.length > 0 ? (
              <>
                {missingBeta.length} position
                {missingBeta.length === 1 ? " has" : "s have"} no usable regression in{" "}
                <Ident>factor_exposures</Ident> (
                <span className="num">
                  {missingBeta.map((r) => r.asset).join(", ")}
                </span>
                ) — their β contribution is shown as <span className="num">—</span>, not
                zero, so the Σ above is a partial reconciliation.{" "}
              </>
            ) : null}
            β contribution = signed weight × β<sub>mkt</sub>. Correlation is the mean of
            |ρ| over the flagged pairs the asset appears in; assets in no flagged pair
            show <span className="num">—</span>. Sources:{" "}
            <Ident>portfolio_positions</Ident>, <Ident>factor_exposures</Ident>,{" "}
            <Ident>research_recommendations.correlation_pairs</Ident>.
          </p>
        </>
      )}
    </section>
  );
}
