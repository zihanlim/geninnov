"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import TradeIdeasTable from "@/components/TradeIdeasTable";
import LensSelector, { Lens } from "@/components/LensSelector";
import { supabase } from "@/lib/supabase";

export default function TradesPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <TradesPageInner />
    </Suspense>
  );
}

function TradesPageInner() {
  const searchParams = useSearchParams();
  const rawLens = searchParams?.get("lens");
  const validLenses: Lens[] = [
    "multi_asset",
    "credit",
    "rates",
    "equity",
    "fx",
    "commodity",
  ];
  const lens: Lens = (validLenses as string[]).includes(rawLens ?? "")
    ? (rawLens as Lens)
    : "multi_asset";

  // Real universe counts. The header previously read "12 themes · 32 tickers"
  // and "HYPE THRESHOLD ≥ 50" as hardcoded strings; both were wrong (8 themes,
  // 29 mapped tickers) and neither would have followed a config change.
  const [universe, setUniverse] = useState<{
    themes: number | null;
    tickers: number | null;
    threshold: number | null;
  }>({ themes: null, tickers: null, threshold: null });

  useEffect(() => {
    Promise.all([
      supabase.from("themes").select("id", { count: "exact", head: true }),
      supabase.from("theme_assets").select("ticker"),
      supabase.from("scoring_config").select("param_name, value"),
    ]).then(([themeRes, assetRes, cfgRes]) => {
      const cfg = Object.fromEntries(
        ((cfgRes.data ?? []) as { param_name: string; value: string }[]).map(
          (r) => [r.param_name, Number(r.value)]
        )
      );
      setUniverse({
        themes: themeRes.count ?? null,
        tickers: assetRes.error
          ? null
          : new Set(
              (assetRes.data ?? []).map((r: { ticker: string }) => r.ticker)
            ).size,
        threshold: Number.isFinite(cfg.hype_score_threshold)
          ? cfg.hype_score_threshold
          : null,
      });
    });
  }, []);

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-4 flex-wrap">
        <div className="min-w-[280px]">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            Trade Ideas
          </h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Ranked by TradeScore · top 5 longs and top 5 shorts. Click any row
            for its derivation.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <LensSelector value={lens} onChange={() => undefined} />
          <div className="text-right text-text-secondary text-[12px] shrink-0">
            <div>
              <span className="text-text-tertiary mr-1.5">UNIVERSE</span>
              <span className="num">
                {universe.themes ?? "—"} themes ·{" "}
                {universe.tickers ?? "—"} tickers
              </span>
            </div>
            <div className="mt-1">
              <span className="text-text-tertiary mr-1.5">HYPE THRESHOLD</span>
              <span className="num">
                {universe.threshold === null ? "—" : `≥ ${universe.threshold}`}
              </span>
            </div>
          </div>
        </div>
      </div>
      <TradeIdeasTable initialLens={lens} />
    </main>
  );
}
