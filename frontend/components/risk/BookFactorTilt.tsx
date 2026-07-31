// frontend/components/risk/BookFactorTilt.tsx
//
// The FF5 + UMD tilt of the FINAL SIZED book, as persisted by
// q1_agent.finalise_book_analytics. Diverging bars around zero: negative left in
// --short, positive right in --accent, mirroring the FactorRow treatment on
// /portfolio. Scale is fixed at ±2.00 so bars are comparable between runs.

"use client";
import {
  explainGap,
  fmtPct,
  fmtSignedBeta,
  fmtSignedPct,
  isNum,
  type AnalyticsState,
  type BookMetrics,
  type FactorTilts,
} from "@/lib/risk/analytics";
import { Ident, InlineGap, SectionGap, SectionSkeleton } from "./SectionGap";

const FACTOR_DEFS: { key: keyof FactorTilts; name: string; blurb: string }[] = [
  { key: "beta_mkt", name: "MKT-RF", blurb: "Market excess return" },
  { key: "beta_smb", name: "SMB", blurb: "Small minus big" },
  { key: "beta_hml", name: "HML", blurb: "Value minus growth" },
  { key: "beta_rmw", name: "RMW", blurb: "Robust minus weak profitability" },
  { key: "beta_cma", name: "CMA", blurb: "Conservative minus aggressive investment" },
  { key: "beta_umd", name: "UMD", blurb: "Momentum" },
];

/** Full track spans -2.00 … +2.00; each half is 50% of the track. */
const BETA_SCALE = 2;

function FactorRow({
  name,
  blurb,
  beta,
}: {
  name: string;
  blurb: string;
  beta: number | null;
}) {
  const widthPct =
    beta === null ? 0 : Math.min(Math.abs(beta) / BETA_SCALE, 1) * 50;
  const negative = beta !== null && beta < 0;
  return (
    <div className="grid grid-cols-[92px_1fr_64px] items-center gap-3 text-[12px] mb-2">
      <span className="num text-text-secondary" title={blurb}>
        {name}
      </span>
      <div
        className="h-1.5 bg-border rounded-sm relative overflow-hidden"
        role="img"
        aria-label={
          beta === null
            ? `${name} beta unavailable`
            : `${name} book beta ${fmtSignedBeta(beta)} on a scale of minus two to plus two`
        }
      >
        <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-text-tertiary" />
        {beta !== null && (
          <div
            className={`absolute top-0 bottom-0 h-full ${
              negative ? "bg-short right-1/2 rounded-l-sm" : "bg-accent left-1/2 rounded-r-sm"
            }`}
            style={{ width: `${widthPct}%` }}
          />
        )}
      </div>
      <span
        className={`num text-right ${
          beta === null ? "text-text-tertiary" : negative ? "text-short" : "text-accent"
        }`}
      >
        {beta === null ? "—" : fmtSignedBeta(beta)}
      </span>
    </div>
  );
}

function ExposureStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
        {label}
      </div>
      <div className="num text-[15px] text-text-primary">{value}</div>
    </div>
  );
}

export function BookFactorTilt({
  state,
}: {
  state: AnalyticsState<BookMetrics>;
}) {
  const gap = explainGap(state, {
    column: "book_metrics",
    emptyMeaning:
      "The object is present but carries no measured tilt — either computed is false, or factor_tilts " +
      "holds no numeric beta. compute_book_metrics returns an all-zero record with computed=false when " +
      "the sized book is empty or when factor_exposures has no usable regression for any held asset. " +
      "Those zeros are placeholders, not measured exposures, so they are not charted.",
  });

  const bm = state.status === "ok" ? state.value : null;
  const tilts = bm?.factor_tilts ?? null;
  const rows = FACTOR_DEFS.map((d) => ({
    ...d,
    beta: tilts && isNum(tilts[d.key]) ? (tilts[d.key] as number) : null,
  }));
  const measured = rows.filter((r) => r.beta !== null);

  /**
   * What share of the book's gross these tilts actually describe (ADR-0212).
   *
   * `compute_book_metrics` skips any holding whose regression fails `r² >= 0.10`, so
   * the denominator it divides by is the gross of the COVERED sleeve, not the book.
   * This panel said "sized book" in its header, "value-weighted over the sized
   * positions" in its footnote, and "6 of 6 factors measured" in its summary — three
   * statements a reader adds up to complete coverage, while the tilt could be
   * describing a fraction of the book. Factors measured and POSITIONS covered are
   * different counts, and only one of them was on screen.
   *
   * Null when the run predates `factor_covered_gross`, in which case nothing is
   * claimed and the panel reads exactly as it did before.
   */
  const coverage =
    isNum(bm?.factor_covered_gross) &&
    isNum(bm?.gross_exposure) &&
    (bm!.gross_exposure as number) > 0
      ? (bm!.factor_covered_gross as number) / (bm!.gross_exposure as number)
      : null;
  // Float division on two persisted decimals lands at 0.9999… on a fully covered
  // book, so "covers 99.99% of gross" would be a rounding artefact reported as a gap.
  const fullyCovered = coverage !== null && coverage >= 0.9995;
  const dominant = [...measured]
    .filter((r) => Math.abs(r.beta as number) > 0.2)
    .sort((a, b) => Math.abs(b.beta as number) - Math.abs(a.beta as number));

  return (
    <section className="card mb-6" aria-labelledby="risk-tilt-heading">
      <div className="card-header">
        <h2 id="risk-tilt-heading" className="card-title m-0">
          Book factor tilt
        </h2>
        <span className="text-[11px] text-text-tertiary">
          FF5 + UMD · sized book · scale ±{BETA_SCALE.toFixed(2)}
        </span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={220} />
      ) : gap || !bm ? (
        gap ? (
          <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
        ) : null
      ) : (
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5 pb-4 border-b border-border">
            <ExposureStat label="Gross" value={fmtPct(bm.gross_exposure)} />
            <ExposureStat label="Net" value={fmtSignedPct(bm.net_exposure)} />
            <ExposureStat label="Long weight" value={fmtPct(bm.long_weight)} />
            <ExposureStat label="Short weight" value={fmtPct(bm.short_weight)} />
          </div>

          <div className="grid grid-cols-[92px_1fr_64px] items-center gap-3 text-[11px] mb-2.5 text-text-tertiary">
            <span>Factor</span>
            <span className="flex justify-between">
              <span className="num">-{BETA_SCALE.toFixed(2)}</span>
              <span className="num">0</span>
              <span className="num">+{BETA_SCALE.toFixed(2)}</span>
            </span>
            <span className="text-right">Beta</span>
          </div>

          {rows.map((r) => (
            <FactorRow key={r.name} name={r.name} blurb={r.blurb} beta={r.beta} />
          ))}

          <div className="mt-4 pt-3.5 border-t border-border text-[12px] text-text-secondary leading-[1.6]">
            {measured.length === 0 ? (
              <InlineGap>
                No numeric betas in <Ident>book_metrics.factor_tilts</Ident>. All six
                factors are shown as unavailable rather than zero.
              </InlineGap>
            ) : dominant.length === 0 ? (
              <>
                <strong className="text-text-primary">Book tilt:</strong> no factor
                exceeds ±0.20 — the book is close to factor-neutral on the{" "}
                {measured.length} measured exposure{measured.length === 1 ? "" : "s"}.
              </>
            ) : (
              <>
                <strong className="text-text-primary">Book tilt:</strong>{" "}
                <span className="num">
                  {dominant
                    .map((r) => `${fmtSignedBeta(r.beta as number)} ${r.name}`)
                    .join(", ")}
                </span>
                . {measured.length} of {FACTOR_DEFS.length} factors measured.
              </>
            )}
            {/* Positions covered, beside factors measured — the two counts a reader
                was previously invited to conflate. Only rendered when the run carries
                the denominator (ADR-0212); silent otherwise. */}
            {coverage !== null && !fullyCovered && (
              <span data-testid="tilt-coverage">
                {" "}
                Measured over{" "}
                <span className="num text-text-primary">
                  {(coverage * 100).toFixed(0)}%
                </span>{" "}
                of gross — the rest of the book holds no regression clearing r²
                ≥ 0.10 and is absent from these betas, not neutral in them.
              </span>
            )}
            {fullyCovered && (
              <span data-testid="tilt-coverage">
                {" "}
                Every sized position carries a usable regression, so these betas cover
                the whole book.
              </span>
            )}
          </div>

          <p className="m-0 mt-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
            {/* "the sized positions" was the claim this panel could not support: the
                weighting runs over the positions whose regression clears r² >= 0.10,
                which is a subset it never named. */}
            Value-weighted over the sized positions whose own regression clears{" "}
            <span className="num">r² ≥ 0.10</span>, computed by{" "}
            <Ident>book_metrics.compute_book_metrics</Ident> and persisted to{" "}
            <Ident>research_recommendations.book_metrics</Ident>. A factor with no
            usable regression contributes nothing and is shown as{" "}
            <span className="num">—</span>, not as zero.
            {coverage === null && (
              <>
                {" "}
                This run does not record how much of the book cleared that bar, so the
                share these betas describe is unknown here.
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
