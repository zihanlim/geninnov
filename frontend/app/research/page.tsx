"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Pick {
  direction: "long" | "short";
  asset: string;
  theme_id: string;
  thesis: string;
  catalysts: string[];
  risk: string;
  factor_tilts: Record<string, number>;
  notional?: number;
  hype_score?: number;
}

interface Q1Recommendation {
  run_date: string;
  picks: Pick[];
  book_view: string;
  book_risks: string[];
}

function PickCard({ pick, rank }: { pick: Pick; rank: number }) {
  const isLong = pick.direction === "long";
  const tagColor = isLong ? "text-emerald-400" : "text-red-400";
  const borderColor = isLong ? "border-emerald-500/30" : "border-red-500/30";
  const bgColor = isLong ? "bg-emerald-950/20" : "bg-red-950/20";

  const notional = pick.notional
    ? `$${(pick.notional / 1_000_000).toFixed(1)}M`
    : null;

  return (
    <div className={`border ${borderColor} ${bgColor} rounded-lg p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isLong ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
            {isLong ? "LONG" : "SHORT"} #{rank}
          </span>
          <span className="text-lg font-mono font-bold text-[#e6edf3]">{pick.asset}</span>
        </div>
        <div className="text-right">
          {notional && <div className="text-sm font-mono text-[#8b949e]">{notional}</div>}
          {pick.hype_score != null && (
            <div className="text-xs font-mono text-[#58a6ff]">HypeScore {pick.hype_score.toFixed(1)}</div>
          )}
        </div>
      </div>

      <p className="text-sm text-[#c9d1d9] leading-relaxed mb-4">{pick.thesis}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {pick.catalysts && pick.catalysts.length > 0 && (
          <div>
            <div className="text-xs font-mono text-[#58a6ff] uppercase tracking-widest mb-1">Catalysts</div>
            <ul className="text-xs text-[#8b949e] space-y-0.5">
              {pick.catalysts.map((c, i) => (
                <li key={i} className="flex gap-1">
                  <span className="text-emerald-500">+</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pick.risk && (
          <div>
            <div className="text-xs font-mono text-red-400 uppercase tracking-widest mb-1">Risk</div>
            <p className="text-xs text-[#8b949e]">{pick.risk}</p>
          </div>
        )}
      </div>

      {pick.factor_tilts && Object.keys(pick.factor_tilts).length > 0 && (
        <div>
          <div className="text-xs font-mono text-[#58a6ff] uppercase tracking-widest mb-1">Factor Tilts</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(pick.factor_tilts).map(([k, v]) => (
              <span key={k} className="text-xs font-mono bg-[#21262d] text-[#8b949e] px-2 py-0.5 rounded">
                {k}: {typeof v === "number" ? v.toFixed(2) : v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RegimeBadge({ cycle, sentiment }: { cycle: string; sentiment: string }) {
  const cycleColor =
    cycle === "early" ? "text-amber-400" :
    cycle === "late" ? "text-orange-400" :
    cycle === "recession" ? "text-red-400" : "text-blue-400";

  const sentColor =
    sentiment === "risk-on" ? "text-emerald-400" :
    sentiment === "risk-off" ? "text-red-400" : "text-yellow-400";

  return (
    <div className="flex items-center gap-4 text-sm font-mono">
      <span className={cycleColor}>Cycle: {cycle}</span>
      <span className="text-[#30363d]">|</span>
      <span className={sentColor}>Sentiment: {sentiment}</span>
    </div>
  );
}

export default function ResearchPage() {
  const [rec, setRec] = useState<Q1Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regime, setRegime] = useState<{ cycle: string; sentiment: string } | null>(null);

  useEffect(() => {
    async function load() {
      // Fetch latest Q1 recommendation
      const { data: recs } = await supabase
        .from("q1_recommendations")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest regime
      const { data: regimes } = await supabase
        .from("regime_classifications")
        .select("cycle, sentiment")
        .order("run_date", { ascending: false })
        .limit(1)
        .single();

      setRec(recs ?? null);
      setRegime(regimes ?? null);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
        <div className="animate-pulse space-y-4 max-w-4xl">
          <div className="h-8 bg-[#21262d] rounded w-48" />
          <div className="h-4 bg-[#21262d] rounded w-96" />
          <div className="h-48 bg-[#21262d] rounded" />
        </div>
      </main>
    );
  }

  const longs = (rec?.picks ?? []).filter((p) => p.direction === "long").slice(0, 5);
  const shorts = (rec?.picks ?? []).filter((p) => p.direction === "short").slice(0, 5);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-mono font-bold">Q1 Research — Top 5 Long / Short</h1>
          {rec?.run_date && (
            <p className="text-sm text-[#8b949e] font-mono mt-1">Run: {rec.run_date}</p>
          )}
        </div>
        {regime && <RegimeBadge cycle={regime.cycle} sentiment={regime.sentiment} />}
      </div>

      {!rec && (
        <div className="border border-[#30363d] rounded-lg p-12 text-center">
          <p className="text-[#8b949e] font-mono text-sm">
            No Q1 recommendations yet. Run the daily pipeline to generate.
          </p>
        </div>
      )}

      {/* Book View */}
      {rec?.book_view && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mb-8">
          <h2 className="text-xs font-mono text-[#58a6ff] uppercase tracking-widest mb-3">Book View</h2>
          <p className="text-sm leading-relaxed text-[#c9d1d9]">{rec.book_view}</p>
        </div>
      )}

      {/* Longs */}
      {longs.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-mono text-emerald-400 uppercase tracking-widest mb-4">
            Top {longs.length} Longs
          </h2>
          <div className="space-y-4">
            {longs.map((p, i) => (
              <PickCard key={`long-${i}`} pick={p} rank={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* Shorts */}
      {shorts.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-mono text-red-400 uppercase tracking-widest mb-4">
            Top {shorts.length} Shorts
          </h2>
          <div className="space-y-4">
            {shorts.map((p, i) => (
              <PickCard key={`short-${i}`} pick={p} rank={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* Book Risks */}
      {rec?.book_risks && rec.book_risks.length > 0 && (
        <div className="bg-[#161b22] border border-red-900/40 rounded-lg p-6">
          <h2 className="text-xs font-mono text-red-400 uppercase tracking-widest mb-3">Cross-Cutting Risks</h2>
          <ul className="space-y-2">
            {rec.book_risks.map((r, i) => (
              <li key={i} className="text-sm text-[#c9d1d9] flex gap-2">
                <span className="text-red-500 mt-0.5">!</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
