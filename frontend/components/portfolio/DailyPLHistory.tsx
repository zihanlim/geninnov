// frontend/components/portfolio/DailyPLHistory.tsx
// L7: Tabular summary of portfolio_returns rows ordered by date. Each row carries
// a small status indicator (positive / negative / flat) derived client-side
// and labelled `estimated` because portfolio_returns.daily_return is the
// persisted authoritative field — we just present it.

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { StatusBadge } from "@/components/status/StatusBadge";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";

interface ReturnRow {
  run_date: string;
  daily_return: number | null;
  cumulative_return: number | null;
  portfolio_value: number | null;
}

const fmtPct = (n: number | null) =>
  n === null || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(2)}%`;
const fmtUSD = (n: number | null) =>
  n === null || Number.isNaN(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function statusFor(ret: number | null): "exact" | "estimated" {
  return ret === null ? "estimated" : "exact";
}

export function DailyPLHistory({ limit = 30 }: { limit?: number }) {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("portfolio_returns")
      .select("run_date, daily_return, cumulative_return, portfolio_value")
      .order("run_date", { ascending: false })
      .limit(limit)
      .then((res) => {
        setRows((res.data as ReturnRow[]) ?? []);
        setLoading(false);
      });
  }, [limit]);

  return (
    <div className="card" data-testid="daily-pl-history">
      <div className="card-header">
        <span className="card-title">Daily P&amp;L history</span>
        <span className="text-[11px] text-text-tertiary">Last {limit} sessions</span>
      </div>
      {loading ? (
        <div className="skeleton h-[180px] m-4" />
      ) : rows.length === 0 ? (
        <div className="p-12 text-center text-text-tertiary text-[13px]">
          No daily returns recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto min-w-0">
        <table className="w-full min-w-[440px] border-collapse text-[13px]">
          <thead>
            <tr>
              {["Date", "Daily return", "Cumulative", "Portfolio value"].map((h, i) => (
                <th
                  key={h}
                  className={`px-[18px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ret = r.daily_return;
              const positive = (ret ?? 0) > 0;
              const flat = (ret ?? 0) === 0;
              const color = flat
                ? "text-text-secondary"
                : positive
                  ? "text-long"
                  : "text-short";
              const age = Math.max(0, Math.floor((Date.now() - new Date(r.run_date).getTime()) / 1000));
              return (
                <tr key={r.run_date} className="hover:bg-bg-elevated">
                  <td className="px-[18px] py-[7px] border-b border-border num text-text-secondary">{r.run_date}</td>
                  <td className={`px-[14px] py-[7px] border-b border-border text-right num ${color}`}>
                    {fmtPct(ret)}
                  </td>
                  <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtPct(r.cumulative_return)}
                  </td>
                  <td className="px-[18px] py-[7px] border-b border-border text-right num text-text-secondary">
                    {fmtUSD(r.portfolio_value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      <div className="flex items-center gap-3 px-[18px] py-3 text-[11px] text-text-tertiary">
        <StatusBadge status="exact" />
        <span>Daily return is the L4-authoritative field.</span>
        {rows[0] && (
          <FreshnessLabel
            observed_age_seconds={Math.max(0, Math.floor((Date.now() - new Date(rows[0].run_date).getTime()) / 1000))}
          />
        )}
      </div>
    </div>
  );
}
