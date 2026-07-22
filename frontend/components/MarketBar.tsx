"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface MarketAsset {
  ticker: string;
  name: string;
  current: number;
  prev_close: number;
  pct_change: number;
}

// Ordered display: equities first, VIX last
const DISPLAY_ORDER = ["^SPX", "^NDX", "^DJI", "^RUT", "^VIX"];

export default function MarketBar() {
  const [assets, setAssets] = useState<MarketAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("market_assets")
      .select("*")
      .order("ticker")
      .then(({ data, error }) => {
        if (!error && data) {
          // Sort by display order
          const sorted = [...(data as MarketAsset[])].sort(
            (a, b) =>
              DISPLAY_ORDER.indexOf(a.ticker) - DISPLAY_ORDER.indexOf(b.ticker)
          );
          setAssets(sorted);
        }
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex gap-3 px-4 py-2.5 bg-bg-surface border border-border rounded-[8px] mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="skeleton h-3 w-8 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-0 bg-bg-surface border border-border rounded-[8px] mb-6 overflow-hidden">
      {assets.map((a, i) => {
        const isPos = a.pct_change >= 0;
        const isNeg = a.pct_change < 0;
        const isVix = a.ticker === "^VIX";
        // VIX: high is bad (red), low is good (green)
        const changeColor = isVix
          ? isPos
            ? "var(--short)"
            : "var(--long)"
          : isPos
            ? "var(--long)"
            : "var(--short)";

        return (
          <div key={a.ticker} className="flex items-center gap-2.5 px-4 py-2.5">
            {i > 0 && (
              <div className="w-px h-5 bg-border self-center" />
            )}
            <div className="flex flex-col">
              <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-[0.1em] leading-none mb-0.5">
                {a.name}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-[13px] font-semibold text-text-primary leading-none">
                  {a.current.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span
                  className="num text-[11.5px] font-semibold leading-none"
                  style={{ color: changeColor }}
                >
                  {isPos ? "▲" : "▼"}{" "}
                  {Math.abs(a.pct_change).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
