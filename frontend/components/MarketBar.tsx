"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FreshnessLabel } from "./status/FreshnessLabel";
import { StatusBadge } from "./status/StatusBadge";
import type { NumericDerivation, NumericStatus } from "@/lib/derivations/numeric";

interface MarketAsset {
  ticker: string;
  name: string;
  current: number;
  prev_close: number;
  pct_change: number;
  as_of?: string;
  updated_at?: string;
}

// Ordered display: equities first, VIX last
const DISPLAY_ORDER = ["^SPX", "^NDX", "^DJI", "^RUT", "^VIX"];
const FRESHNESS_FIELD = "market.index.as_of";
const MAX_AGE_SECONDS = 86400; // market data should be ≤ 24h old

function derive(
  field_id: string,
  value: number | null,
  status: NumericStatus,
  observed_age_seconds: number,
  source_table: string,
  unavailable_reason?: string,
): NumericDerivation {
  return {
    field_id,
    display_status: status,
    value,
    unit: "pct",
    method_id: status === "unavailable" ? "db.unavailable" : "db.market_assets.column",
    source_records: [{ table: source_table, id: field_id, as_of: new Date().toISOString() }],
    computed_at: new Date().toISOString(),
    as_of: new Date().toISOString(),
    freshness: { max_age_seconds: MAX_AGE_SECONDS, observed_age_seconds },
    unavailable_reason,
  };
}

function ageFromDate(d?: string): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

export default function MarketBar() {
  const [assets, setAssets] = useState<MarketAsset[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("market_assets")
        .select("*")
        .order("ticker");
      if (cancelled) return;
      // PGRST…/404-ish errors land in `error`; an empty row set is fine
      // and renders nothing (existing behavior preserved).
      if (error) {
        setUnavailable(true);
        setAssets([]);
        return;
      }
      const list = (data as MarketAsset[]) ?? [];
      const sorted = [...list].sort(
        (a, b) =>
          DISPLAY_ORDER.indexOf(a.ticker) - DISPLAY_ORDER.indexOf(b.ticker)
      );
      setAssets(sorted);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (assets === null) {
    // flex-wrap to match the loaded MarketBar (line ~133): the real tape wraps its
    // indices on a narrow screen. Without it the skeleton's 5 non-wrapping items are
    // ~700px, so on a 375 phone the loading state — not the settled one — flashes a
    // horizontal scroll (body to 841px) for the second before data arrives. The
    // skeleton must obey the same containment as what it stands in for.
    return (
      <div
        className="flex flex-wrap gap-3 px-4 py-2.5 bg-bg-surface border border-border rounded-[8px] mb-6"
        data-testid="market-bar-skeleton"
      >
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

  // ── Explicit unavailable state (e.g. migration 010 not deployed) ─────────
  if (unavailable || assets.length === 0) {
    const d = derive(FRESHNESS_FIELD, null, "unavailable", 0, "market_assets",
      "market_assets table unavailable — run migration 010");
    return (
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 bg-bg-surface border border-border rounded-[8px] mb-6"
        data-testid="market-bar-unavailable"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-semibold">
            Market indices
          </span>
          <StatusBadge status={d.display_status} />
          <span className="text-text-secondary text-[12px]" data-testid="market-bar-unavailable-text">
            Major-index tape unavailable · market_assets not deployed
          </span>
        </div>
      </div>
    );
  }

  // ── Healthy: render tape + freshness for the freshest asset as_of ────────
  const freshestAge = assets.reduce(
    (min, a) => Math.min(min, ageFromDate(a.as_of ?? a.updated_at)),
    Number.POSITIVE_INFINITY
  );
  const freshestDisplay =
    Number.isFinite(freshestAge) ? freshestAge : 0;

  return (
    <div
      className="flex flex-wrap gap-0 bg-bg-surface border border-border rounded-[8px] mb-6 overflow-hidden"
      data-testid="market-bar"
    >
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
      <div className="ml-auto px-4 py-2.5 flex items-center text-text-tertiary text-[11px]">
        <FreshnessLabel observed_age_seconds={freshestDisplay} />
      </div>
    </div>
  );
}
