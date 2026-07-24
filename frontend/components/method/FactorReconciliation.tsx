"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ScrollArea } from "@/components/ScrollArea";

/**
 * Does the factor model produce betas a practitioner would recognise?
 *
 * L2 regresses each asset's daily excess return on Fama-French 5 + UMD over a
 * 252-day window, and those betas drive the book's factor tilts and the scenario
 * shocks. Nothing checked them. A factor model whose numbers nobody has reconciled
 * is an assertion, and "our betas are right, here is the proof" is a materially
 * different claim from "we computed betas".
 *
 * The check is the one a reviewer would ask for: assets whose market beta is known
 * a priori. SPY IS the market, so its beta must be ~1.00 with R^2 ~1.00 — that is a
 * definitional test and it fails loudly if the regression, the alignment or the
 * excess-return convention is wrong. T-bills must sit at 0. A high-beta growth fund
 * must sit well above 1. If those three brackets hold, the machinery is sound.
 *
 * Bands are deliberately generous: this asserts "not broken", not "matches a vendor
 * to two decimals". Anything tighter would fail on ordinary sample variation and
 * teach the reader to ignore it.
 */

interface FactorRow {
  asset: string;
  beta_mkt: number | null;
  r_squared: number | null;
  lookback_days: number | null;
  run_date: string;
}

/** Assets whose market beta is known before you run anything. */
const BENCHMARKS: {
  asset: string;
  lo: number;
  hi: number;
  why: string;
}[] = [
  { asset: "SPY", lo: 0.9, hi: 1.1, why: "IS the market factor — definitional" },
  { asset: "IWM", lo: 0.8, hi: 1.4, why: "small-cap, at or above market" },
  { asset: "QQQ", lo: 0.9, hi: 1.4, why: "tech-heavy, above market" },
  { asset: "ARKK", lo: 1.1, hi: 2.0, why: "high-beta growth" },
  { asset: "BIL", lo: -0.1, hi: 0.1, why: "T-bills — no equity risk" },
  { asset: "SHY", lo: -0.2, hi: 0.2, why: "short duration — no equity risk" },
  { asset: "TLT", lo: -0.6, hi: 0.4, why: "long duration — rate-driven, not equity" },
  { asset: "GLD", lo: -0.3, hi: 0.5, why: "gold — largely independent of equities" },
];

export default function FactorReconciliation() {
  const [rows, setRows] = useState<FactorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("factor_exposures")
      .select("asset, beta_mkt, r_squared, lookback_days, run_date")
      .order("run_date", { ascending: false })
      .limit(400)
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setRows((data as FactorRow[]) ?? []);
      });
  }, []);

  if (error) {
    return (
      <div className="card p-4 text-[12.5px] text-text-secondary">
        Could not read <code className="num">factor_exposures</code>: {error}
      </div>
    );
  }
  if (!rows) return <div className="skeleton h-[220px]" />;

  // Latest run_date only — older rows would mix vintages in one table.
  const latest = rows.length ? rows[0].run_date : null;
  const byAsset = new Map<string, FactorRow>();
  for (const r of rows) {
    if (r.run_date === latest && !byAsset.has(r.asset)) byAsset.set(r.asset, r);
  }

  const checked = BENCHMARKS.map((b) => {
    const row = byAsset.get(b.asset);
    const beta = row?.beta_mkt ?? null;
    const pass = beta !== null && beta >= b.lo && beta <= b.hi;
    return { ...b, row, beta, pass, present: !!row };
  });
  const present = checked.filter((c) => c.present);
  const passing = present.filter((c) => c.pass).length;
  const allPass = present.length > 0 && passing === present.length;

  if (present.length === 0) {
    return (
      <div className="card p-4 text-[12.5px] text-text-secondary">
        No <code className="num">factor_exposures</code> rows for a benchmark asset
        yet — L2 has not written a run this window. Nothing is asserted here until it
        does.
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Factor-model reconciliation</span>
        <span
          className="num text-[11px]"
          style={{ color: allPass ? "var(--long)" : "var(--warning)" }}
        >
          {passing}/{present.length} within band
          {latest ? ` · ${latest}` : ""}
        </span>
      </div>

      <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
        Market beta for assets whose answer is known before you run anything. SPY{" "}
        <em>is</em> the market factor, so ~1.00 at R&sup2; ~1.00 is definitional — it
        fails loudly if the regression, the date alignment or the excess-return
        convention is wrong. Cash sits at 0 and high-beta growth well above 1. Bands
        are generous on purpose: this says <em>not broken</em>, not{" "}
        <em>matches a vendor to two decimals</em>.
      </p>

      <ScrollArea hint={false}>
        <table className="w-full border-collapse text-[12.5px] min-w-[560px]">
          <caption className="sr-only">
            Market beta of benchmark assets against the expected band.
          </caption>
          <thead>
            <tr className="border-y border-border bg-bg-elevated">
              <th className="text-left font-medium px-[18px] py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Asset
              </th>
              <th className="text-right font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                β mkt
              </th>
              <th className="text-right font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Expected
              </th>
              <th className="text-right font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                R²
              </th>
              <th className="text-left font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Why we know
              </th>
            </tr>
          </thead>
          <tbody>
            {checked.map((c) => (
              <tr key={c.asset} className="border-b border-border last:border-b-0">
                <td className="px-[18px] py-2.5 num font-medium">{c.asset}</td>
                <td
                  className="px-3 py-2.5 num text-right font-medium"
                  style={{
                    color: !c.present
                      ? "var(--text-tertiary)"
                      : c.pass
                        ? "var(--long)"
                        : "var(--short)",
                  }}
                >
                  {c.beta === null ? "—" : c.beta.toFixed(2)}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.lo.toFixed(2)} … {c.hi.toFixed(2)}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.row?.r_squared === null || c.row?.r_squared === undefined
                    ? "—"
                    : c.row.r_squared.toFixed(2)}
                </td>
                <td className="px-3 py-2.5 text-text-secondary">{c.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      <p className="m-0 px-[18px] py-2.5 border-t border-border text-[11px] text-text-tertiary leading-[1.5]">
        From <code className="num">factor_exposures</code>, written by L2 (Ken French
        FF5 + UMD, {present[0]?.row?.lookback_days ?? 252}-day rolling regression).
        These betas are what the book&apos;s factor tilts and the scenario shocks are
        computed from — a tilt is only as good as the beta beneath it. R² is low for
        the non-equity names by construction: the market factor is not what moves
        them, which is the point of holding them.
      </p>
    </div>
  );
}
