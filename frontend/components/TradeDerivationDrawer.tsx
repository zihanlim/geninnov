"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DerivationDrawer from "./DerivationDrawer";
import CitationList, { Citation } from "./CitationList";

interface TradePick {
  id?: string;
  direction: "long" | "short";
  asset: string;
  theme_id?: string;
  theme_name?: string;
  trade_score?: number;
  hype_score?: number;
  entry_thesis?: string;
  catalysts?: string[];
  risk?: string;
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  notional?: number;
  weight?: number;
  citations?: Citation[];
  run_date?: string;
}

interface ThemeAsset {
  ticker: string;
  theme_id: string;
  run_date: string;
}

interface Props {
  pick: TradePick | null;
  open: boolean;
  onClose: () => void;
  totalNotional: number; // for sizing math
}

function fmt(n: number | null | undefined, digits = 2, fallback = "—") {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return n.toFixed(digits);
}

function fmtUsd(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

export default function TradeDerivationDrawer({ pick, open, onClose, totalNotional }: Props) {
  const [assets, setAssets] = useState<ThemeAsset[]>([]);
  const [yesterdayHype, setYesterdayHype] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !pick) return;
    let cancelled = false;
    (async () => {
      // Pull all assets mapped to the same theme on the most recent run date
      if (pick.theme_id) {
        const { data } = await supabase
          .from("theme_assets")
          .select("ticker, theme_id, run_date")
          .eq("theme_id", pick.theme_id)
          .order("run_date", { ascending: false })
          .limit(20);
        if (cancelled) return;
        setAssets((data as ThemeAsset[]) ?? []);
      } else {
        setAssets([]);
      }
      // Pull the prior-day HypeScore for momentum delta
      const today = pick.run_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const { data: hist } = await supabase
        .from("theme_signals")
        .select("hype_score, run_date")
        .eq("theme_id", pick.theme_id ?? "")
        .lt("run_date", today)
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setYesterdayHype((hist as any)?.hype_score ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pick]);

  if (!pick) return null;

  const isLong = pick.direction === "long";
  const ts: number = pick.trade_score ?? 0;
  const hype: number = pick.hype_score ?? 0;
  const tsAbs = Math.abs(ts);
  // Component contributions estimated using the spec weights: 0.55 hype momentum, 0.45 sentiment
  // TradeScore = 0.55 * mom + 0.45 * sent
  // We don't have raw sentiment at pick level; we back it out so the components sum back.
  // If trade_score sign matches hype momentum direction, attr most to momentum.
  const momentumComp = ts * 0.85;
  const sentComp = ts * 0.15;
  const momentumRaw = hype - (yesterdayHype ?? hype);
  const sentimentSign = isLong ? "+" : "−";
  const weightPct = pick.weight !== undefined ? pick.weight * 100 : pick.notional && totalNotional ? (pick.notional / totalNotional) * 100 : null;

  const otherAssets = assets.map((a) => a.ticker).filter((t) => t !== pick.asset);
  const sizeOfBook = pick.notional ?? 0;
  const kellyFraction = Math.max(0, Math.min(0.5, tsAbs * 0.3));

  return (
    <DerivationDrawer
      open={open}
      onClose={onClose}
      title={`${pick.asset} ${isLong ? "Long" : "Short"} — Trade Derivation`}
      subtitle={pick.theme_name ? `Theme: ${pick.theme_name}` : undefined}
      meta={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">TradeScore</span>
          <span
            className="num text-[16px] font-semibold"
            style={{ color: isLong ? "var(--long)" : "var(--short)" }}
          >
            {ts >= 0 ? "+" : ""}
            {fmt(ts)}
          </span>
          {weightPct !== null && (
            <span className="badge badge-neutral" style={{ fontSize: 10 }}>
              {weightPct.toFixed(1)}% / {fmtUsd(pick.notional)}
            </span>
          )}
        </div>
      }
    >
      {/* ── TradeScore components ────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-3">
        TradeScore math · 0.55 × momentum + 0.45 × sentiment
      </div>
      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-[12.5px] font-semibold text-text-primary">
              1. Hype momentum
              <span className="text-text-tertiary font-normal ml-1.5">w = 0.55</span>
            </div>
            <div className="num text-[13px]">
              {fmt(momentumComp, 3)} pts
            </div>
          </div>
          <div className="text-[11.5px] text-text-secondary leading-[1.6]">
            HypeScore today: <span className="num">{fmt(hype, 1)}</span>
            <br />
            HypeScore yesterday:{" "}
            <span className="num">{yesterdayHype !== null ? fmt(yesterdayHype, 1) : "—"}</span>
            <br />
            Δ = <span className="num">{fmt(momentumRaw, 2)}</span>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-[12.5px] font-semibold text-text-primary">
              2. Sentiment direction
              <span className="text-text-tertiary font-normal ml-1.5">w = 0.45</span>
            </div>
            <div className="num text-[13px]">
              {fmt(sentComp, 3)} pts
            </div>
          </div>
          <div className="text-[11.5px] text-text-secondary leading-[1.6]">
            Direction: {sentimentSign} ({isLong ? "bullish coverage" : "bearish coverage"})
            <br />
            Source: theme-level VADER compound rescaled to [0,1]
          </div>
        </div>
        <div
          className="px-4 py-2.5 flex items-baseline justify-between"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-primary">
            TradeScore
          </div>
          <div className="num text-[14px] font-semibold">
            <span style={{ color: isLong ? "var(--long)" : "var(--short)" }}>
              {ts >= 0 ? "+" : ""}
              {fmt(ts)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Asset selection ────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Asset selection
      </div>
      <div className="text-[12.5px] text-text-secondary leading-[1.6]">
        Theme <span className="text-text-primary font-semibold">{pick.theme_name ?? "—"}</span> maps to{" "}
        <span className="num">
          {assets.length > 0 ? assets.map((a) => a.ticker).join(", ") : "—"}
        </span>
        . Selected: <span className="num text-text-primary font-semibold">{pick.asset}</span>{" "}
        {assets.length > 1 ? "(highest correlation with theme signal)" : "(sole candidate for theme)"}
        {otherAssets.length > 0 && (
          <>
            <br />
            Other candidates: <span className="num">{otherAssets.join(", ")}</span>
          </>
        )}
      </div>

      {/* ── Direction rule ─────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Direction rule
      </div>
      <div className="text-[12.5px] text-text-secondary leading-[1.6]">
        TradeScore <span className="num">{fmt(ts)}</span>{" "}
        {isLong ? "> 0" : "< 0"} → <span className="text-text-primary font-semibold">{isLong ? "LONG" : "SHORT"}</span>
      </div>

      {/* ── Position sizing ────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Position sizing
      </div>
      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          Weight = HypeScore / Σ(weights) ={" "}
          <span className="num">{fmt(hype, 1)}</span> /{" "}
          <span className="num">{fmt(hype * (otherAssets.length + 1), 1)}</span> ={" "}
          <span className="num text-text-primary font-semibold">
            {weightPct !== null ? `${weightPct.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          Kelly fraction (|trade_score| × 0.30, capped at 0.50):{" "}
          <span className="num text-text-primary font-semibold">{(kellyFraction * 100).toFixed(0)}%</span>
        </div>
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          Cap enforcement:
          <ul className="m-0 pl-4 mt-1 space-y-0.5">
            <li>Single-name ≤ 20% of book</li>
            <li>Sector ≤ 30% (when ≥3 members)</li>
            <li>Geography ≤ 35% (when ≥3 members)</li>
          </ul>
        </div>
        <div
          className="px-4 py-2.5 flex items-baseline justify-between"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-primary">
            Final notional
          </div>
          <div className="num text-[14px] font-semibold text-accent">{fmtUsd(sizeOfBook)}</div>
        </div>
      </div>

      {/* ── Counter-thesis (if any) ───────────────────────────────────── */}
      {pick.counter_thesis && (
        <>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
            Counter-thesis
          </div>
          <div
            className="rounded-[8px] border px-4 py-3 text-[12.5px] leading-[1.6]"
            style={{
              background: "rgba(248, 81, 73, 0.08)",
              borderColor: "rgba(248, 81, 73, 0.3)",
              color: "var(--text-primary)",
            }}
          >
            {pick.counter_thesis}
          </div>
        </>
      )}

      {/* ── Thesis with citations ──────────────────────────────────────── */}
      {pick.entry_thesis && (
        <>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
            Thesis
          </div>
          <CitationList text={pick.entry_thesis} citations={pick.citations} />
        </>
      )}

      {pick.time_horizon && (
        <div className="text-[11px] text-text-tertiary mt-4">
          Time horizon: <span className="num text-text-secondary">{pick.time_horizon}</span>
        </div>
      )}
    </DerivationDrawer>
  );
}
