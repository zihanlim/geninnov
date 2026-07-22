// frontend/components/portfolio/CumulativeReturn.tsx
// L7: Since-inception cumulative return. Prefers the persisted
// portfolio_cumulative_return table (migration 014); falls back to the most
// recent portfolio_returns.cumulative_return value, in which case the field is
// labelled `estimated` per the spec.

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { NumericDerivation } from "@/lib/derivations/numeric";
import { StatusBadge } from "@/components/status/StatusBadge";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { UncertaintyBand } from "@/components/status/UncertaintyBand";

interface CumRow {
  as_of: string;
  inception_date: string;
  cumulative_value: number;
  compounded: boolean;
  daily_returns_count: number;
  computed_at: string;
}

interface ReturnRow {
  run_date: string;
  cumulative_return: number | null;
  portfolio_value: number | null;
  created_at?: string;
}

const fmtPct = (n: number | null) =>
  n === null || Number.isNaN(n) ? "—" : `${(n >= 0 ? "+" : "")}${(n * 100).toFixed(2)}%`;
const fmtNum = (n: number | null) =>
  n === null || Number.isNaN(n) ? "—" : n.toFixed(4);

function deriveFromCum(row: CumRow, now: number): NumericDerivation {
  const cumReturn = row.cumulative_value - 1;
  const ageSec = Math.max(0, Math.floor((now - new Date(row.computed_at).getTime()) / 1000));
  return {
    field_id: "portfolio.cumulative_return",
    display_status: "exact",
    value: cumReturn,
    unit: "pct",
    method_id: "portfolio.compute_cumulative_return",
    source_records: [{ table: "portfolio_cumulative_return", id: row.as_of, as_of: row.as_of }],
    computed_at: row.computed_at,
    as_of: row.as_of,
    freshness: { max_age_seconds: 86400, observed_age_seconds: ageSec },
    uncertainty: undefined,
  };
}

function deriveFromFallback(
  ret: ReturnRow,
  now: number,
  reason: string,
): NumericDerivation {
  const ageSec = ret.created_at
    ? Math.max(0, Math.floor((now - new Date(ret.created_at).getTime()) / 1000))
    : Math.max(0, Math.floor((now - new Date(ret.run_date).getTime()) / 1000));
  const raw = ret.cumulative_return;
  // The fallback takes the difference between the latest portfolio_value and
  // the assumed starting capital of $100M, matching the cumulative_return
  // concept expressed in the legacy table.
  const cumFromValue =
    ret.portfolio_value !== null ? ret.portfolio_value / 100_000_000 - 1 : null;
  const value = cumFromValue ?? raw;
  return {
    field_id: "portfolio.cumulative_return",
    display_status: value === null ? "unavailable" : "estimated",
    value,
    unit: "pct",
    method_id: "client.cumulative_from_returns",
    source_records: [{ table: "portfolio_returns", id: ret.run_date, as_of: ret.run_date }],
    computed_at: new Date().toISOString(),
    as_of: ret.run_date,
    freshness: { max_age_seconds: 86400, observed_age_seconds: ageSec },
    uncertainty:
      value === null
        ? { method: "heuristic" as const }
        : {
            band_low: value * 0.98,
            band_high: value * 1.02,
            method: "heuristic" as const,
            confidence: 0.6,
          },
    unavailable_reason: value === null ? reason : undefined,
  };
}

export function CumulativeReturn() {
  const [derivation, setDerivation] = useState<NumericDerivation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = Date.now();
    (async () => {
      let chosen: NumericDerivation | null = null;
      // Try the authoritative table first.
      const cumRes = await supabase
        .from("portfolio_cumulative_return")
        .select("as_of, inception_date, cumulative_value, compounded, daily_returns_count, computed_at")
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cumRes.data) {
        chosen = deriveFromCum(cumRes.data as CumRow, now);
      } else {
        // Fall back to portfolio_returns.
        const retRes = await supabase
          .from("portfolio_returns")
          .select("run_date, cumulative_return, portfolio_value, created_at")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (retRes.data) {
          chosen = deriveFromFallback(
            retRes.data as ReturnRow,
            now,
            "portfolio_cumulative_return table not deployed; falling back to portfolio_returns",
          );
        }
      }
      setDerivation(chosen);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="card p-4" data-testid="cumulative-return">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">Since inception</span>
        {derivation && <StatusBadge status={derivation.display_status} />}
      </div>
      {loading ? (
        <div className="skeleton h-[36px] w-[180px]" />
      ) : !derivation || derivation.value === null ? (
        <>
          <div className="num text-[28px] font-semibold leading-[1.1] text-text-tertiary">—</div>
          <div className="text-[11px] text-text-tertiary mt-1.5">
            {derivation?.unavailable_reason ?? "No cumulative return available yet."}
          </div>
        </>
      ) : (
        <>
          <div
            className={`num text-[28px] font-semibold leading-[1.1] ${
              (derivation.value as number) >= 0 ? "text-long" : "text-short"
            }`}
          >
            {fmtPct(derivation.value as number)}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[11px] text-text-secondary num">
              cum value {fmtNum((derivation.value as number) + 1)}
            </span>
            <FreshnessLabel observed_age_seconds={derivation.freshness.observed_age_seconds} />
            {derivation.uncertainty?.band_low != null && derivation.uncertainty?.band_high != null && (
              <UncertaintyBand
                low={(derivation.uncertainty.band_low as number) * 100}
                high={(derivation.uncertainty.band_high as number) * 100}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
