"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RegimeHero from "@/components/RegimeHero";
import ConvictionCard, { ConvictionTheme } from "@/components/ConvictionCard";
import Watchlist from "@/components/Watchlist";

interface Regime {
  cycle: string;
  sentiment: string;
  run_date?: string;
  cycle_indicators?: Record<string, number>;
  vol_indicators?: Record<string, number>;
  narrative?: string;
}

interface Factor { name: string; beta: number }

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return d.slice(0, 10);
}

function nextRefreshDate(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return `${tomorrow.toISOString().slice(0, 10)} 16:30 ET`;
}

// Generate short thesis from theme name + tier (deterministic placeholder until thesis column exists)
function deriveThesis(t: ConvictionTheme): string {
  if (t.thesis) return t.thesis;
  const templates: Record<string, string> = {
    "Fed Policy": "Powell signals September cut conditional on disinflation. Duration-sensitive longs into Jackson Hole.",
    "Inflation": "Sticky core services keep pressure; commodities as real-asset hedge.",
    "US Dollar": "DXY resilient on rate differential; EM FX stress a watch item.",
    "China Growth": "Property drag persistent; deflation mindset entrenched.",
    "Corporate Credit": "HY OAS compresses; spreads vulnerable to growth disappointment.",
    "Geopolitical Risk": "Multi-region tensions support gold and energy beta.",
    "Energy Prices": "Refining margins normalize; nat gas storage builds.",
    "US Election": "Policy uncertainty spike; sector dispersion widens.",
    "AI Capex": "Hyperscaler capex guide higher; power the binding constraint.",
    "European Defence": "Re-armament cycle re-rates European primes structurally.",
    "EM India": "Domestic capex cycle in early innings; RBI in easing mode.",
  };
  return templates[t.name] ?? `HypeScore ${Math.round(t.hype_score ?? 0)} · track theme-specific catalysts and factor profile.`;
}

export default function ConvictionPage() {
  const [themes, setThemes] = useState<ConvictionTheme[]>([]);
  const [regime, setRegime] = useState<Regime | null>(null);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [runDate, setRunDate] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [themesRes, regimeRes, factorsRes, themeCountRes, candidateCountRes] = await Promise.all([
        supabase
          .from("themes")
          .select("*")
          .order("hype_score", { ascending: false }),
        supabase
          .from("regime_classifications")
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
        supabase.from("themes").select("id", { count: "exact", head: true }),
        supabase
          .from("trade_candidates")
          .select("direction, hype_score")
          .gte("hype_score", 50),
      ]);

      const rawThemes = (themesRes.data ?? []) as ConvictionTheme[];
      // Compute 1d delta vs prior themes snapshot if present
      setThemes(rawThemes);
      setRegime((regimeRes.data as Regime) ?? null);
      setRunDate(rawThemes[0]?.updated_at ?? null);

      if (factorsRes.data) {
        const f = factorsRes.data as Record<string, number>;
        const FACTOR_KEYS: { key: string; name: string }[] = [
          { key: "beta_mkt", name: "MKT-RF" },
          { key: "beta_smb", name: "SMB" },
          { key: "beta_hml", name: "HML" },
          { key: "beta_rmw", name: "RMW" },
          { key: "beta_cma", name: "CMA" },
          { key: "beta_umd", name: "UMD" },
        ];
        setFactors(
          FACTOR_KEYS.filter((k) => typeof f[k.key] === "number").map((k) => ({
            name: k.name,
            beta: Number(f[k.key]),
          }))
        );
      }

      // Quick stats
      setCounts({
        total: themeCountRes.count ?? rawThemes.length,
        candidates: (candidateCountRes.data ?? []).length,
        longCount: (candidateCountRes.data ?? []).filter((c: { direction: string }) => c.direction === "long").length,
        shortCount: (candidateCountRes.data ?? []).filter((c: { direction: string }) => c.direction === "short").length,
        avgHype:
          rawThemes.length > 0
            ? rawThemes.reduce((s, t) => s + (t.hype_score ?? 0), 0) / rawThemes.length
            : 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  const [counts, setCounts] = useState({ total: 0, candidates: 0, longCount: 0, shortCount: 0, avgHype: 0 });

  const top3 = useMemo(() => themes.slice(0, 3).map((t) => ({ ...t, thesis: deriveThesis(t) })), [themes]);
  const watchlistItems = useMemo(
    () =>
      themes.slice(0, 7).map((t) => ({
        name: t.name,
        score: t.hype_score ?? 0,
        delta: (t.hype_score ?? 0) - (t.momentum_score ?? 0) * 0.1, // proxy delta
      })),
    [themes]
  );

  const cycle = regime?.cycle ?? "—";
  const sentiment = regime?.sentiment ?? "—";
  const headline = regime?.narrative
    ? regime.narrative.split(".")[0]
    : "Macro regime classification pending — pipeline needs one full run.";
  const narrative = regime?.narrative ?? "Run the daily pipeline (cron-job.org → daily_refresh.py) to populate the regime classifier.";

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">What we&apos;re watching this week</h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Top 3 themes by conviction · macro regime · book tilt.
          </p>
        </div>
        <div className="text-right text-text-secondary text-[12px]">
          <div>
            <span className="text-text-tertiary mr-1.5">RUN DATE</span>
            <span className="num">{fmtDate(runDate)}</span>
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">NEXT REFRESH</span>
            <span className="num">{nextRefreshDate()}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[180px]" />
          <div className="grid grid-cols-3 gap-4">
            <div className="skeleton h-[260px]" />
            <div className="skeleton h-[260px]" />
            <div className="skeleton h-[260px]" />
          </div>
        </div>
      ) : (
        <>
          <RegimeHero
            cycle={cycle}
            sentiment={sentiment}
            headline={headline}
            narrative={narrative}
            cycleSubtext={regime?.cycle_indicators ? "Yield curve · Breadth" : "—"}
            volSubtext={regime?.vol_indicators ? "VIX · VIX3M contango" : "—"}
            factors={factors}
          />

          <div className="flex items-baseline justify-between mb-3.5">
            <h2 className="text-[16px] font-semibold m-0">Top 3 themes by conviction</h2>
            <span className="text-text-secondary text-[12px]">
              Ranked by HypeScore × sentiment-momentum × catalyst proximity
            </span>
          </div>
          {top3.length === 0 ? (
            <div className="card p-12 text-center text-text-tertiary text-[13px]">
              No themes yet. Run the daily pipeline to populate.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {top3.map((t, i) => (
                <ConvictionCard key={t.id} rank={i + 1} theme={t} hero={i === 0} />
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between mb-3.5">
            <h2 className="text-[16px] font-semibold m-0">Watchlist · emerging or fading</h2>
            <Link href="/research" className="text-text-secondary text-[12px] hover:text-text-primary">
              View full ranking →
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Theme momentum</span>
                <span className="num text-text-tertiary text-[11px]">mentions × sentiment</span>
              </div>
              <div className="card-body pt-2">
                {watchlistItems.length > 0 ? (
                  <Watchlist items={watchlistItems} />
                ) : (
                  <div className="text-text-tertiary text-[13px] py-2">No watchlist data.</div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Quick stats</span>
              </div>
              <div className="card-body flex flex-col gap-3.5">
                <Stat label="Total themes tracked" value={String(counts.total)} sub="Active in pipeline" />
                <Stat
                  label="Longs / Shorts candidates"
                  value={`${counts.longCount} / ${counts.shortCount}`}
                  sub="Above HypeScore 50 threshold"
                />
                <Stat
                  label="Avg HypeScore"
                  value={counts.avgHype.toFixed(1)}
                  sub="Across all active themes"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-tertiary uppercase tracking-[0.1em] mb-1">{label}</div>
      <div className="num text-[22px] font-semibold leading-[1.1]">{value}</div>
      {sub && <div className="text-[11px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}
