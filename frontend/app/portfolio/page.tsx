"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LensSelector, { Lens, lensToAssetClasses } from "@/components/LensSelector";
import { ExposureSummary } from "@/components/portfolio/ExposureSummary";
import { DailyPLHistory } from "@/components/portfolio/DailyPLHistory";
import { CumulativeReturn } from "@/components/portfolio/CumulativeReturn";
import { StatusBadge } from "@/components/status/StatusBadge";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { UncertaintyBand } from "@/components/status/UncertaintyBand";
import type { NumericDerivation } from "@/lib/derivations/numeric";

interface Position {
  id: string;
  theme_id?: string;
  theme?: string;
  asset: string;
  direction: "long" | "short";
  notional: number;
  weight: number;
  hype_score?: number;
  trade_score?: number;
}

interface Risk {
  total_capital: number;
  var_95: number;
  cvar_95: number;
  sharpe: number;
  beta: number;
  concentration_hhi: number;
  run_date?: string;
  updated_at?: string;
}

interface Factor { name: string; beta: number }

const FACTOR_DEFS: { key: string; name: string }[] = [
  { key: "beta_mkt", name: "MKT-RF" },
  { key: "beta_smb", name: "SMB" },
  { key: "beta_hml", name: "HML" },
  { key: "beta_rmw", name: "RMW" },
  { key: "beta_cma", name: "CMA" },
  { key: "beta_umd", name: "UMD" },
];

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

function RiskCard({
  label,
  value,
  derivation,
  color = "text-text-primary",
}: {
  label: string;
  value: string;
  derivation: NumericDerivation;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">{label}</span>
        <StatusBadge status={derivation.display_status} />
      </div>
      <div className={`num text-[22px] font-semibold leading-[1.1] ${color}`}>{value}</div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <FreshnessLabel observed_age_seconds={derivation.freshness.observed_age_seconds} />
        {derivation.uncertainty?.band_low != null && derivation.uncertainty?.band_high != null && (
          <UncertaintyBand
            low={derivation.uncertainty.band_low}
            high={derivation.uncertainty.band_high}
          />
        )}
        {derivation.unavailable_reason && (
          <span className="text-[11px] text-text-tertiary">{derivation.unavailable_reason}</span>
        )}
      </div>
    </div>
  );
}

function FactorRow({ name, beta }: Factor) {
  const widthPct = Math.min(Math.abs(beta) / 2, 1) * 25;
  return (
    <div className="grid grid-cols-[80px_1fr_60px] items-center gap-3 text-[12px] mb-1.5">
      <span className="num">{name}</span>
      <div className="h-1.5 bg-border rounded-sm relative overflow-hidden">
        <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-text-tertiary" />
        <div
          className={`absolute top-0 bottom-0 h-full ${
            beta < 0 ? "bg-short right-1/2 rounded-l-sm" : "bg-accent left-1/2 rounded-r-sm"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className={`num text-right ${beta < 0 ? "text-short" : "text-accent"}`}>
        {beta >= 0 ? "+" : ""}
        {beta.toFixed(2)}
      </span>
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20"><div className="skeleton h-[180px]" /></main>}>
      <PortfolioPageInner />
    </Suspense>
  );
}

function PortfolioPageInner() {
  const searchParams = useSearchParams();
  const rawLens = searchParams?.get("lens");
  const validLenses: Lens[] = ["multi_asset", "credit", "rates", "equity", "fx", "commodity"];
  const initialLens: Lens = (validLenses as string[]).includes(rawLens ?? "")
    ? (rawLens as Lens)
    : "multi_asset";
  const [positions, setPositions] = useState<Position[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Lens>(initialLens);
  // Map of ticker → asset_class (from theme_assets, migration 009)
  const [assetClassMap, setAssetClassMap] = useState<Record<string, string>>({});

  // Fetch portfolio + risk + factor exposure + asset class lookup once.
  useEffect(() => {
    Promise.all([
      supabase
        .from("portfolio_positions")
        .select("*")
        .order("notional", { ascending: false }),
      supabase
        .from("portfolio_risk")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("portfolio_factor_exposure")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("theme_assets")
        .select("ticker, asset_class"),
    ]).then(([posRes, riskRes, factorRes, assetRes]) => {
      setPositions(posRes.data ?? []);
      setRisk((riskRes.data as Risk) ?? null);
      const f = (factorRes.data as Record<string, number>) ?? {};
      setFactors(
        FACTOR_DEFS.filter((d) => typeof f[d.key] === "number").map((d) => ({
          name: d.name,
          beta: Number(f[d.key]),
        }))
      );
      const map: Record<string, string> = {};
      for (const row of assetRes.data ?? []) {
        if (row.ticker && row.asset_class) map[row.ticker] = row.asset_class;
      }
      setAssetClassMap(map);
      setLoading(false);
    });
  }, []);

  // Apply the lens filter to positions. ADR-0015.
  const filteredPositions = useMemo(() => {
    const allowed = lensToAssetClasses(lens);
    if (allowed === null) return positions;
    return positions.filter((p) => {
      const cls = assetClassMap[p.asset] ?? "other";
      return allowed.includes(cls);
    });
  }, [positions, assetClassMap, lens]);

  const totalCapital = risk?.total_capital ?? 100_000_000;
  const longs = filteredPositions.filter((p) => p.direction === "long");
  const shorts = filteredPositions.filter((p) => p.direction === "short");
  const longNotional = longs.reduce((s, p) => s + (p.notional ?? 0), 0);
  const shortNotional = shorts.reduce((s, p) => s + (p.notional ?? 0), 0);
  const gross = longNotional + shortNotional;
  const cash = totalCapital - gross;
  const cashPct = totalCapital > 0 ? cash / totalCapital : 0;
  const netLs = shortNotional > 0 ? longNotional / shortNotional : 0;
  const grossPct = totalCapital > 0 ? gross / totalCapital : 0;

  // Build fallback derivations for risk metrics if portfolio_risk.numeric_derivations
  // is not yet populated by the L4 risk_engine migration.
  const riskNumericDerivation = (risk as unknown as { numeric_derivations?: Record<string, NumericDerivation> } | null)?.numeric_derivations;
  const buildRiskDerivation = (
    field_id: string,
    rawValue: number | undefined | null,
    unit: NumericDerivation["unit"],
    method_id: string,
  ): NumericDerivation => {
    const persisted = riskNumericDerivation?.[field_id];
    if (persisted) return persisted;
    const present = typeof rawValue === "number" && !Number.isNaN(rawValue);
    const computedAt = (risk?.updated_at as string | undefined) ?? new Date().toISOString();
    const ageSec = computedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(computedAt).getTime()) / 1000))
      : 0;
    return {
      field_id,
      display_status: present ? "estimated" : "unavailable",
      value: present ? (rawValue as number) : null,
      unit,
      method_id,
      source_records: present ? [{ table: "portfolio_risk", id: "legacy", as_of: (risk?.run_date as string | undefined) ?? computedAt }] : [],
      computed_at: computedAt,
      as_of: (risk?.run_date as string | undefined) ?? computedAt.slice(0, 10),
      freshness: { max_age_seconds: 86400, observed_age_seconds: ageSec },
      uncertainty: undefined,
      unavailable_reason: present ? undefined : "metric not yet produced by risk_engine",
    };
  };

  const varD = buildRiskDerivation("risk.var_95", risk?.var_95, "usd", "risk_engine.value_at_risk");
  const cvarD = buildRiskDerivation("risk.cvar_95", risk?.cvar_95, "usd", "risk_engine.conditional_value_at_risk");
  const sharpeD = buildRiskDerivation("risk.sharpe", risk?.sharpe, "ratio", "risk_engine.sharpe_ratio");
  const betaD = buildRiskDerivation("risk.beta", risk?.beta, "ratio", "risk_engine.beta_to_spx");
  const hhiD = buildRiskDerivation("risk.hhi", risk?.concentration_hhi, "score", "risk_engine.concentration_hhi");

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">$100M Portfolio</h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Long-short book from top candidates · risk-weighted to HypeScore confidence.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <LensSelector value={lens} onChange={setLens} />
        </div>
        <div className="text-right text-text-secondary text-[12px]">
          <div>
            <span className="text-text-tertiary mr-1.5">CAPITAL DEPLOYED</span>
            <span className="num text-text-primary">{fmtUSD(gross)}</span>{" "}
            <span className="num">({(grossPct * 100).toFixed(1)}%)</span>
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">CASH</span>
            <span className="num">{fmtUSD(cash)} ({(cashPct * 100).toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-[88px]" />
            ))}
          </div>
          <div className="skeleton h-[180px]" />
        </div>
      ) : (
        <>
          {/* Exposure summary — bound to NumericDerivation */}
          <ExposureSummary
            positions={filteredPositions.map((p) => ({
              id: p.id,
              asset: p.asset,
              direction: p.direction,
              notional: p.notional ?? 0,
              weight: p.weight ?? 0,
            }))}
            totalCapital={totalCapital}
          />

          {/* Since-inception cumulative return */}
          <div className="mb-6">
            <CumulativeReturn />
          </div>

          {/* Risk grid — bound to NumericDerivation */}
          {risk && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <RiskCard
                label="VaR (95%)"
                value={typeof risk.var_95 === "number" ? fmtUSD(risk.var_95) : "—"}
                derivation={varD}
                color="text-short"
              />
              <RiskCard
                label="CVaR (95%)"
                value={typeof risk.cvar_95 === "number" ? fmtUSD(risk.cvar_95) : "—"}
                derivation={cvarD}
                color="text-short"
              />
              <RiskCard
                label="Sharpe (252d)"
                value={typeof risk.sharpe === "number" ? risk.sharpe.toFixed(2) : "—"}
                derivation={sharpeD}
              />
              <RiskCard
                label="Beta (vs SPX)"
                value={typeof risk.beta === "number" ? risk.beta.toFixed(2) : "—"}
                derivation={betaD}
                color="text-accent"
              />
              <RiskCard
                label="HHI Concentration"
                value={typeof risk.concentration_hhi === "number" ? risk.concentration_hhi.toFixed(0) : "—"}
                derivation={hhiD}
              />
            </div>
          )}

          {/* Allocation bar */}
          <div className="card mb-6">
            <div className="card-header">
              <span className="card-title">Capital allocation · {fmtUSD(gross)} deployed</span>
              <span className="text-[11px] text-text-tertiary num">
                Long {fmtUSD(longNotional)} ({((longNotional / (risk?.total_capital ?? 1)) * 100).toFixed(1)}%) · Short {fmtUSD(shortNotional)} ({((shortNotional / (risk?.total_capital ?? 1)) * 100).toFixed(1)}%) · Net L/S {netLs.toFixed(2)}x · Gross {fmtPct(grossPct)}
              </span>
            </div>
            <div className="card-body">
              {positions.length === 0 ? (
                <div className="text-text-tertiary text-[13px] py-3 text-center">
                  No positions. Run the daily pipeline to construct the book.
                </div>
              ) : (
                <>
                  <div className="flex h-9 rounded-lg overflow-hidden bg-bg-elevated mb-3">
                    {filteredPositions.map((p) => {
                      const w = (p.notional ?? 0) / (risk?.total_capital ?? 1);
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-center text-[11px] font-semibold text-bg-primary ${
                            p.direction === "long" ? "bg-long" : "bg-short"
                          }`}
                          style={{ width: `${w * 100}%` }}
                          title={`${p.asset} ${p.direction} ${(w * 100).toFixed(1)}%`}
                        >
                          {(w * 100) >= 5 && (
                            <span className="truncate px-2">{p.asset}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {filteredPositions.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-1.5 text-[11px] text-text-secondary px-2 py-[3px] bg-bg-elevated border border-border rounded"
                      >
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ background: p.direction === "long" ? "var(--long)" : "var(--short)" }}
                        />
                        {p.asset} — {fmtM(p.notional)} · {p.theme ?? "—"}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Daily P&L history */}
          <div className="mb-6">
            <DailyPLHistory limit={30} />
          </div>

          {/* Factor exposure */}
          <div className="card mb-6">
            <div className="card-header">
              <span className="card-title">Factor exposure vs SPX</span>
              <span className="text-[11px] text-text-tertiary">FF5 + UMD · 252d rolling</span>
            </div>
            <div className="card-body">
              {factors.length === 0 ? (
                <div className="text-text-tertiary text-[13px] py-3 text-center">
                  Awaiting first factor run…
                </div>
              ) : (
                <>
                  <div
                    className="grid items-center text-[12px] mb-3.5 text-text-secondary"
                    style={{ gridTemplateColumns: "80px 1fr 60px" }}
                  >
                    <span>Factor</span>
                    <span className="text-text-tertiary text-[11px] text-center">-2.0</span>
                    <span className="num text-right text-text-secondary">Beta</span>
                  </div>
                  {factors.map((f) => <FactorRow key={f.name} {...f} />)}
                  <div className="mt-4 pt-3.5 border-t border-border text-[12px] text-text-secondary">
                    <strong className="text-text-primary">Book tilt:</strong>{" "}
                    {factors
                      .filter((f) => Math.abs(f.beta) > 0.2)
                      .map((f) => `${f.beta >= 0 ? "+" : ""}${f.beta.toFixed(2)} ${f.name}`)
                      .join(", ")}
                    . Consistent with the current macro regime classification.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Positions table */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Positions · {lens === "multi_asset" ? "all asset classes" : `${lens} lens`}</span>
              <span className="text-[11px] text-text-tertiary">
                {filteredPositions.length} of {positions.length} positions
              </span>
            </div>
            {filteredPositions.length === 0 ? (
              <div className="p-12 text-center text-text-tertiary text-[13px]">
                No positions match the {lens} lens.
              </div>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Portfolio positions · {filteredPositions.length} of {positions.length} shown
                  {lens === "multi_asset" ? " across all asset classes" : ` for the ${lens} lens`}.
                </caption>
                <thead>
                  <tr>
                    {["Theme", "Asset", "Direction", "Notional", "Weight", "HypeScore"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                          i >= 3 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPositions.map((p) => (
                    <tr key={p.id} className="hover:bg-bg-elevated">
                      <td className="px-[18px] py-2.5 border-b border-border">{p.theme ?? "—"}</td>
                      <td className="px-[14px] py-2.5 border-b border-border num">{p.asset}</td>
                      <td
                        className="px-[14px] py-2.5 border-b border-border"
                        style={{ color: p.direction === "long" ? "var(--long)" : "var(--short)" }}
                      >
                        {p.direction.toUpperCase()}
                      </td>
                      <td className="px-[14px] py-2.5 border-b border-border text-right num">{fmtUSD(p.notional)}</td>
                      <td className="px-[14px] py-2.5 border-b border-border text-right num">{fmtPct(p.weight ?? 0)}</td>
                      <td className="px-[18px] py-2.5 border-b border-border text-right num text-text-secondary">
                        {Math.round(p.hype_score ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </main>
  );
}
