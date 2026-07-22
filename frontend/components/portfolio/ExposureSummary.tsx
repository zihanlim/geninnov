// frontend/components/portfolio/ExposureSummary.tsx
// L7: Gross / net exposure summary bound to NumericDerivation objects so
// every claim has provenance (status, freshness, uncertainty).

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { NumericDerivation } from "@/lib/derivations/numeric";
import { StatusBadge } from "@/components/status/StatusBadge";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { UncertaintyBand } from "@/components/status/UncertaintyBand";

interface Position {
  id: string;
  asset: string;
  direction: "long" | "short";
  notional: number;
  weight: number;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

// Build a fully-formed "estimated" NumericDerivation for client-derived values
// (gross/net/leverage). When portfolio_positions.numeric_derivations becomes
// available we hydrate from that instead — for now these are reconstructed
// from positions and labelled estimated.
function makeDerivation(
  field_id: string,
  value: number | null,
  unit: NumericDerivation["unit"],
  computed_at: string,
  as_of: string,
  method_id: string,
  sourceTable: string,
  sourceId: string | number,
): NumericDerivation {
  return {
    field_id,
    display_status: value === null ? "unavailable" : "estimated",
    value,
    unit,
    method_id,
    source_records: [{ table: sourceTable, id: sourceId, as_of }],
    computed_at,
    as_of,
    freshness: {
      max_age_seconds: 86400,
      observed_age_seconds: 0,
    },
  };
}

export function ExposureSummary({
  positions,
  totalCapital,
}: {
  positions: Position[];
  totalCapital: number;
}) {
  const [riskRow, setRiskRow] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    supabase
      .from("portfolio_risk")
      .select("id, run_date, total_capital, numeric_derivations")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((res) => setRiskRow((res.data as Record<string, unknown>) ?? null));
  }, []);

  const longs = positions.filter((p) => p.direction === "long");
  const shorts = positions.filter((p) => p.direction === "short");
  const longNotional = longs.reduce((s, p) => s + (p.notional ?? 0), 0);
  const shortNotional = shorts.reduce((s, p) => s + (p.notional ?? 0), 0);
  const gross = longNotional + shortNotional;
  const cash = Math.max(totalCapital - gross, 0);
  const netLsPct = totalCapital > 0 ? (longNotional - shortNotional) / totalCapital : 0;
  const grossPct = totalCapital > 0 ? gross / totalCapital : 0;
  const leverage = totalCapital > 0 ? gross / totalCapital : 0;

  const computedAt = new Date().toISOString();
  const asOf = (riskRow?.run_date as string | undefined) ?? computedAt.slice(0, 10);
  const sourceId = (riskRow?.id as string | number | undefined) ?? "client";

  // Prefer a persisted NumericDerivation when the column is populated.
  const persisted = (riskRow?.numeric_derivations as Record<string, NumericDerivation> | undefined) ?? {};

  const grossD: NumericDerivation = persisted.gross_exposure
    ? persisted.gross_exposure
    : makeDerivation("portfolio.gross_exposure", grossPct, "pct", computedAt, asOf, "client.gross_exposure", "portfolio_positions", sourceId);

  const netD: NumericDerivation = persisted.net_exposure
    ? persisted.net_exposure
    : makeDerivation("portfolio.net_exposure", netLsPct, "pct", computedAt, asOf, "client.net_exposure", "portfolio_positions", sourceId);

  const leverageD: NumericDerivation = persisted.leverage
    ? persisted.leverage
    : makeDerivation("portfolio.leverage", leverage, "ratio", computedAt, asOf, "client.leverage", "portfolio_positions", sourceId);

  const renderOne = (label: string, d: NumericDerivation, display: string) => {
    if (d.value === null) {
      return (
        <div className="card p-4" data-testid="exposure-card">
          <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-1.5">{label}</div>
          <div className="num text-[22px] font-semibold leading-[1.1] text-text-tertiary">—</div>
          <div className="mt-1.5">
            <StatusBadge status={d.display_status} />
          </div>
          {d.unavailable_reason && (
            <div className="text-[11px] text-text-tertiary mt-1">{d.unavailable_reason}</div>
          )}
        </div>
      );
    }
    return (
      <div className="card p-4" data-testid="exposure-card">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">{label}</span>
          <StatusBadge status={d.display_status} />
        </div>
        <div className="num text-[22px] font-semibold leading-[1.1] text-text-primary">{display}</div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <FreshnessLabel observed_age_seconds={d.freshness.observed_age_seconds} />
          {d.uncertainty && (
            <UncertaintyBand low={d.uncertainty.band_low} high={d.uncertainty.band_high} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="exposure-summary">
      {renderOne("Gross exposure", grossD, `${(grossD.value as number * 100).toFixed(1)}%`)}
      {renderOne("Net exposure", netD, `${(netD.value as number * 100).toFixed(1)}%`)}
      {renderOne("Leverage", leverageD, `${(leverageD.value as number).toFixed(2)}x`)}
      <div className="card p-4" data-testid="exposure-card">
        <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-1.5">Cash</div>
        <div className="num text-[22px] font-semibold leading-[1.1] text-text-primary">
          {fmtUSD(cash)}
        </div>
        <div className="text-[11px] text-text-secondary mt-1.5">
          {fmtPct(totalCapital > 0 ? cash / totalCapital : 0)} undeployed
        </div>
      </div>
      <div className="col-span-2 md:col-span-4 text-[11px] text-text-tertiary">
        Long {fmtUSD(longNotional)} ({positions.length ? fmtPct(longNotional / totalCapital) : "—"}) ·
        Short {fmtUSD(shortNotional)} ({positions.length ? fmtPct(shortNotional / totalCapital) : "—"})
      </div>
    </div>
  );
}
