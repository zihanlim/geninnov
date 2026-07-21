"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LiveFeed() {
  const [counts, setCounts] = useState({ themes: 0, tickers: 0 });
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("themes").select("id", { count: "exact", head: true }),
      supabase.from("trade_candidates").select("asset").then(({ data }) => {
        const unique = new Set((data ?? []).map((r: { asset: string }) => r.asset));
        setCounts((c) => ({ ...c, tickers: unique.size }));
      }),
    ]).then(([{ count }]) => {
      setCounts((c) => ({ ...c, themes: count ?? 0 }));
    });

    supabase
      .from("themes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastRun(data[0].updated_at);
      });
  }, []);

  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleString();
  };

  return (
    <div className="fixed bottom-0 inset-x-0 bg-bg-surface border-t border-border px-5 py-1.5 flex items-center gap-5 text-[11px] text-text-secondary z-40">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-long shadow-[0_0_6px_var(--long)] animate-[pulseSoft_2s_infinite]" />
        Pipeline healthy
      </span>
      <span className="text-text-tertiary">|</span>
      <span>Last refresh: {fmt(lastRun)}</span>
      <span className="text-text-tertiary">|</span>
      <span>Next refresh: 2026-07-22 16:30 ET</span>
      <span className="text-text-tertiary">|</span>
      <span>Themes: {counts.themes} active</span>
      <span className="text-text-tertiary">|</span>
      <span>Tracked tickers: {counts.tickers}</span>
      <span className="ml-auto text-text-tertiary">Andromeda v0.4.1</span>
    </div>
  );
}
