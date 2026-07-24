// frontend/components/risk/RiskMetricsGrid.tsx
//
// Unlike /portfolio, this grid is NOT gated behind a truthy risk row. A risk
// panel that vanishes when the data is missing reads as "no risk"; a panel that
// says "unavailable, because X" reads as what it is. The five cards always
// render.

"use client";
import { StatusBadge } from "@/components/status/StatusBadge";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { UncertaintyBand } from "@/components/status/UncertaintyBand";
import type {
  NumericDerivation,
  NumericStatus,
  NumericUnit,
} from "@/lib/derivations/numeric";
import {
  fmtRatio,
  fmtUsdAsMillions,
  isNum,
  type QueryFailure,
  type RiskRow,
} from "@/lib/risk/analytics";
import type { MetricDelta } from "@/lib/risk/riskBoard";
import { DeltaChip } from "./DeltaChip";
import { Ident } from "./SectionGap";

/** Keys into the deltas map, matching computeRiskDeltas output. */
type DeltaKey = "var_95" | "cvar_95" | "sharpe" | "beta" | "concentration_hhi";

const STATUSES: NumericStatus[] = [
  "exact",
  "estimated",
  "stale",
  "unavailable",
  "unverified",
];

/**
 * Narrow an untyped JSONB blob to a NumericDerivation. Anything that fails the
 * shape check is treated as absent rather than coerced — a half-parsed
 * provenance record is worse than none.
 */
function asNumericDerivation(raw: unknown): NumericDerivation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const status = r.display_status;
  if (typeof status !== "string" || !STATUSES.includes(status as NumericStatus)) {
    return null;
  }
  const freshness = r.freshness as Record<string, unknown> | undefined;
  if (
    typeof freshness !== "object" ||
    freshness === null ||
    !isNum(freshness.observed_age_seconds)
  ) {
    return null;
  }
  return raw as unknown as NumericDerivation;
}

interface MetricDef {
  /** Key inside portfolio_risk.numeric_derivations, as written by risk_engine. */
  derivationKey: string;
  /** Fully-qualified field_id, used as a secondary lookup. */
  fieldId: string;
  column: keyof RiskRow;
  label: string;
  unit: NumericUnit;
  methodId: string;
  format: (v: number) => string;
  color?: string;
  /** Which prior-run delta applies to this card, if any. */
  deltaKey?: DeltaKey;
  /** For the delta chip: whether an increase in this metric is bad. */
  deltaHigherIsWorse?: boolean;
  /** Formats a raw delta magnitude for the chip (may differ from `format`). */
  deltaFormat?: (v: number) => string;
  /**
   * Sessions of return history this statistic needs to mean anything — the
   * MIN_DAYS_FOR_* constants in backend/services/risk_engine.py.
   *
   * compute_risk deliberately emits a value from as few as 2 observations and
   * labels it "estimated" (T9 brief), so the number renders regardless. That is
   * fine for VaR's parametric form but badly misleading for an ANNUALISED
   * Sharpe: on this book it read −8.23, then +3.77 after a single upstream
   * correction. Below this threshold we say the sample is too small, in the same
   * place the number is read, rather than letting it pass as a real estimate.
   */
  minSessions?: number;
}

const signedUsdM = (v: number): string =>
  `${v >= 0 ? "+" : "−"}$${Math.abs(v / 1_000_000).toFixed(1)}M`;
const signedRatio = (v: number): string =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const signedHhi = (v: number): string =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v) > 1 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(3)}`;

const METRICS: MetricDef[] = [
  {
    derivationKey: "var_95",
    fieldId: "risk.var_95",
    column: "var_95",
    label: "VaR (95%)",
    unit: "usd",
    methodId: "risk.var.parametric.v1",
    format: (v) => fmtUsdAsMillions(v),
    color: "text-short",
    deltaKey: "var_95",
    deltaHigherIsWorse: true,
    deltaFormat: signedUsdM,
    minSessions: 30,   // MIN_DAYS_FOR_VAR
  },
  {
    derivationKey: "cvar_95",
    fieldId: "risk.cvar_95",
    column: "cvar_95",
    label: "CVaR (95%)",
    unit: "usd",
    methodId: "risk.cvar.parametric.v1",
    format: (v) => fmtUsdAsMillions(v),
    color: "text-short",
    deltaKey: "cvar_95",
    deltaHigherIsWorse: true,
    deltaFormat: signedUsdM,
    minSessions: 30,   // MIN_DAYS_FOR_VAR
  },
  {
    derivationKey: "sharpe",
    fieldId: "risk.sharpe",
    column: "sharpe",
    label: "Sharpe (252d)",
    unit: "ratio",
    methodId: "risk.sharpe.v1",
    format: (v) => fmtRatio(v),
    deltaKey: "sharpe",
    deltaHigherIsWorse: false,
    deltaFormat: signedRatio,
    minSessions: 60,   // MIN_DAYS_FOR_SHARPE
  },
  {
    derivationKey: "beta",
    fieldId: "risk.beta",
    column: "beta",
    label: "Beta (vs SPX)",
    unit: "ratio",
    methodId: "risk.beta.v1",
    format: (v) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}`,
    color: "text-accent",
    deltaKey: "beta",
    // Beta drift in either direction is undesirable for a market-neutral book,
    // but we colour the raw signed change: up = red (more market exposure).
    deltaHigherIsWorse: true,
    deltaFormat: signedRatio,
    minSessions: 60,   // MIN_DAYS_FOR_BETA
  },
  {
    derivationKey: "hhi",
    fieldId: "risk.hhi",
    column: "concentration_hhi",
    label: "HHI concentration",
    unit: "ratio",
    methodId: "risk.hhi.v1",
    format: (v) => (v > 1 ? v.toFixed(0) : v.toFixed(3)),
    deltaKey: "concentration_hhi",
    deltaHigherIsWorse: true,
    deltaFormat: signedHhi,
  },
];

function RiskCard({
  label,
  value,
  derivation,
  color = "text-text-primary",
  delta,
  sampleCaveat,
}: {
  label: string;
  value: string;
  derivation: NumericDerivation;
  color?: string;
  delta?: {
    value: MetricDelta;
    format: (v: number) => string;
    higherIsWorse: boolean;
  };
  /** Set when the return sample is below this statistic's declared minimum. */
  sampleCaveat?: string | null;
}) {
  // A statistic whose sample is below its own stated minimum is SUPPRESSED, not
  // annotated. It used to render the number with the caveat underneath, which was
  // an improvement on silence but still published a figure we simultaneously said
  // was unreadable — "SHARPE 10.77 ▲ +4.56" at 22px above "2 sessions of history —
  // needs 60. Too small to read as a real Sharpe." A reader skims the number, not
  // the footnote, and the delta chip asserted a meaningful IMPROVEMENT in a
  // meaningless statistic.
  //
  // Beta already did the right thing on the same card (value null -> "—" +
  // "insufficient history"), so the page was treating two under-sampled statistics
  // two different ways. This makes them agree, and agree with the standing rule:
  // prefer "unavailable, because X" over a confidently-wrong number. The computed
  // value stays in portfolio_risk for anyone who queries it; the page no longer
  // asserts it.
  const suppressed = Boolean(sampleCaveat);
  const present = derivation.value !== null && !suppressed;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
          {label}
        </span>
        <StatusBadge status={suppressed ? "unavailable" : derivation.display_status} />
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <div
          className={`num text-[22px] font-semibold leading-[1.1] ${
            present ? color : "text-text-tertiary"
          }`}
        >
          {suppressed ? "—" : value}
        </div>
        {present && delta && (
          <DeltaChip
            delta={delta.value}
            format={delta.format}
            higherIsWorse={delta.higherIsWorse}
          />
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {present && (
          <FreshnessLabel
            observed_age_seconds={derivation.freshness.observed_age_seconds}
          />
        )}
        {derivation.uncertainty?.band_low != null &&
          derivation.uncertainty?.band_high != null && (
            <UncertaintyBand
              low={derivation.uncertainty.band_low}
              high={derivation.uncertainty.band_high}
            />
          )}
        {derivation.unavailable_reason && (
          <span className="text-[11px] text-text-tertiary leading-[1.5]">
            {derivation.unavailable_reason}
          </span>
        )}
      </div>
      {sampleCaveat && (
        <div className="mt-1.5 text-[11px] text-warning leading-[1.45]">
          {sampleCaveat}
        </div>
      )}
    </div>
  );
}

export function RiskMetricsGrid({
  loading,
  risk,
  failure,
  orderingNote,
  deltas,
  prevRunDate,
  sessions,
}: {
  loading: boolean;
  risk: RiskRow | null;
  failure: QueryFailure | null;
  /** Set when portfolio_risk had to be read with a fallback ordering. */
  orderingNote?: string | null;
  /** Signed change of each metric vs the previous portfolio_risk run. */
  deltas?: Record<DeltaKey, MetricDelta> | null;
  /** run_date of the previous risk run, for the header note. */
  prevRunDate?: string | null;
  /** Sessions of return history behind these statistics (portfolio_returns rows). */
  sessions?: number | null;
}) {
  const persisted = (risk?.numeric_derivations ?? null) as Record<
    string,
    unknown
  > | null;

  const unavailableReason = (def: MetricDef): string => {
    if (failure) {
      return `read of portfolio_risk failed (${failure.code ?? "error"})`;
    }
    if (!risk) return "no portfolio_risk row";
    return `portfolio_risk.${String(def.column)} is NULL`;
  };

  const buildDerivation = (def: MetricDef): NumericDerivation => {
    const fromDb =
      asNumericDerivation(persisted?.[def.derivationKey]) ??
      asNumericDerivation(persisted?.[def.fieldId]);
    if (fromDb) return fromDb;

    const raw = risk ? (risk[def.column] as unknown) : null;
    const present = isNum(raw);
    const computedAt = risk?.updated_at ?? null;
    const ageSec = computedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(computedAt).getTime()) / 1000))
      : 0;
    const asOf = risk?.run_date ?? computedAt ?? "";
    return {
      field_id: def.fieldId,
      display_status: present ? "estimated" : "unavailable",
      value: present ? raw : null,
      unit: def.unit,
      method_id: def.methodId,
      source_records: present
        ? [{ table: "portfolio_risk", id: asOf || "latest", as_of: asOf }]
        : [],
      computed_at: computedAt ?? "",
      as_of: asOf,
      freshness: { max_age_seconds: 86400, observed_age_seconds: ageSec },
      uncertainty: undefined,
      unavailable_reason: present
        ? "provenance not persisted — portfolio_risk.numeric_derivations has no entry for this field"
        : unavailableReason(def),
    };
  };

  return (
    <section className="mb-6" aria-labelledby="risk-metrics-heading">
      <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
        <h2 id="risk-metrics-heading" className="card-title m-0">
          Risk metrics
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {risk?.run_date
            ? `portfolio_risk · run_date ${risk.run_date}`
            : "portfolio_risk"}
          {isNum(risk?.total_capital)
            ? ` · capital ${fmtUsdAsMillions(risk?.total_capital)}`
            : ""}
          {prevRunDate ? ` · Δ vs ${prevRunDate}` : ""}
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: METRICS.length }).map((_, i) => (
            <div key={i} className="skeleton h-[104px]" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {METRICS.map((def) => {
              const derivation = buildDerivation(def);
              const value =
                derivation.value !== null ? def.format(derivation.value) : "—";
              const delta =
                def.deltaKey && deltas
                  ? {
                      value: deltas[def.deltaKey],
                      format: def.deltaFormat ?? def.format,
                      higherIsWorse: def.deltaHigherIsWorse ?? true,
                    }
                  : undefined;
              // A statistic can be "estimated" and still be noise: compute_risk
              // emits from as few as 2 observations. Say so next to the number.
              const short =
                isNum(sessions) &&
                def.minSessions !== undefined &&
                (sessions as number) < def.minSessions;
              const sampleCaveat = short
                ? `Not shown: ${sessions} session${sessions === 1 ? "" : "s"} of history, needs ${def.minSessions}. A ${def.label.split(" ")[0]} from this sample is noise, so we do not publish one.`
                : null;
              return (
                <RiskCard
                  key={def.derivationKey}
                  label={def.label}
                  value={value}
                  derivation={derivation}
                  color={def.color}
                  delta={delta}
                  sampleCaveat={sampleCaveat}
                />
              );
            })}
          </div>

          {failure && (
            <p className="m-0 mt-3 text-[12px] text-short leading-[1.6] max-w-[90ch]" role="alert">
              <Ident>portfolio_risk</Ident> could not be read:{" "}
              {failure.message}
              {failure.code ? ` (${failure.code})` : ""}. The cards above are blank
              because of the failed read, not because the book carries no risk.
            </p>
          )}
          {!failure && !risk && (
            <p className="m-0 mt-3 text-[12px] text-text-secondary leading-[1.6] max-w-[90ch]">
              No rows in <Ident>portfolio_risk</Ident>. L4 writes one row per run from{" "}
              <Ident>scripts/daily_refresh.py → compute_and_persist_risk</Ident>. Run{" "}
              <code className="num text-accent">python -m scripts.daily_refresh</code>{" "}
              to populate it.
            </p>
          )}
          {orderingNote && (
            <p className="m-0 mt-2 text-[12px] text-warning leading-[1.6] max-w-[90ch]">
              {orderingNote}
            </p>
          )}
        </>
      )}
    </section>
  );
}
