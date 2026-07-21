"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TradeDerivationDrawer from "./TradeDerivationDrawer";
import { Citation } from "./CitationList";

interface TradeCandidate {
  id: string;
  theme_id: string;
  asset: string;
  direction: "long" | "short";
  trade_score: number;
  hype_score: number;
  entry_thesis?: string;
  notional?: number;
  themes?: { name: string };
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  citations?: Citation[];
}

type SortKey = "trade_score" | "hype_score" | "asset" | "theme";
type DirectionFilter = "all" | "long" | "short";

const FALLBACK_THESIS: Record<string, string> = {
  TLT: "Powell signals September cut; 2s10s disinverting. Duration overweight into Jackson Hole.",
  NVDA: "Hyperscaler capex revisions; Blackwell ramp on track. Sized smaller due to crowding.",
  VST: "Power is the bottleneck; data-center utilities at 18x P/E vs 25x for hyperscalers.",
  "RHM.DE": "Germany supplementary budget; order book +28% YoY. Multi-year rearmament cycle.",
  INDA: "Domestic capex cycle in early innings; RBI in easing mode; FX stable.",
  KWEB: "Property drag persists; deflation entrenched. Sentiment deteriorating, not stabilizing.",
  ARKK: "Funding-dependent models at risk in late-cycle. Rate pivot bullish for duration, not growth.",
  XHB: "Mortgage rates sticky; affordability at 2007 lows; builder sentiment rolling over.",
  UNG: "Storage builds accelerating; curve in deep contango.",
  SKF: "CRE exposure + deposit beta lag. NIM compression continues 2-3 quarters.",
};

const TOTAL_NOTIONAL = 100_000_000; // $100M book

export default function TradeIdeasTable() {
  const [rows, setRows] = useState<TradeCandidate[]>([]);
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [sort, setSort] = useState<SortKey>("trade_score");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [openPick, setOpenPick] = useState<TradeCandidate | null>(null);

  useEffect(() => {
    supabase
      .from("trade_candidates")
      .select("*, themes(name)")
      .order("trade_score", { ascending: false })
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    let r = rows.slice();
    if (filter !== "all") r = r.filter((c) => c.direction === filter);
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(
        (c) =>
          c.asset.toLowerCase().includes(q) ||
          (c.themes?.name ?? "").toLowerCase().includes(q)
      );
    }
    r.sort((a, b) => {
      const av: number | string =
        sort === "theme" ? (a.themes?.name ?? "") : ((a[sort] as number | string) ?? 0);
      const bv: number | string =
        sort === "theme" ? (b.themes?.name ?? "") : ((b[sort] as number | string) ?? 0);
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return String(bv).localeCompare(String(av));
    });
    return r;
  }, [rows, filter, sort, query]);

  const longs = filtered.filter((c) => c.direction === "long").slice(0, 5);
  const shorts = filtered.filter((c) => c.direction === "short").slice(0, 5);
  const showSplit = filter === "all";
  const list = showSplit ? [...longs, ...shorts] : filtered;

  return (
    <>
      <div className="card">
        <div className="px-[18px] py-3 border-b border-border flex items-center gap-2 flex-wrap">
          {(["all", "long", "short"] as DirectionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`filter-btn ${filter === f ? "filter-btn-active" : ""}`}
            >
              {f === "all" ? "All" : f === "long" ? "▲ Longs only" : "▼ Shorts only"}
            </button>
          ))}
          <div className="flex-1" />
          <input
            className="px-2.5 py-[5px] bg-bg-elevated border border-border rounded-md text-text-primary text-[12px] w-[200px] focus:outline-none focus:border-accent"
            placeholder="Filter by ticker or theme…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="text-[11px] text-text-tertiary ml-2">SORT</span>
          {(["trade_score", "hype_score", "asset"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`filter-btn ${sort === s ? "filter-btn-active" : ""}`}
            >
              {s === "trade_score" ? "TradeScore" : s === "hype_score" ? "HypeScore" : "Ticker"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-[18px] space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-10" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="p-12 text-center text-text-tertiary text-[13px]">
            No candidates match. Adjust filter or run the pipeline.
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="text-left px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated" style={{ width: 90 }}>Direction</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Ticker</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Theme</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated" style={{ maxWidth: 420 }}>Thesis</th>
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">HypeScore</th>
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">TradeScore</th>
                <th className="text-right px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Notional</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const isLong = c.direction === "long";
                const thesis = c.entry_thesis || FALLBACK_THESIS[c.asset] || `${c.asset} — ${c.themes?.name ?? "theme"} ${isLong ? "long" : "short"} candidate.`;
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-bg-elevated cursor-pointer"
                    onClick={() => setOpenPick(c)}
                  >
                    <td className="px-[18px] py-3.5 border-b border-border align-middle">
                      <span className={`dir-pill ${isLong ? "dir-pill-long" : "dir-pill-short"}`}>
                        {isLong ? "▲ LONG" : "▼ SHORT"}
                      </span>
                    </td>
                    <td className="px-[14px] py-3.5 border-b border-border num font-semibold">{c.asset}</td>
                    <td className="px-[14px] py-3.5 border-b border-border text-text-secondary text-[12px]">
                      {c.themes?.name ?? "—"}
                    </td>
                    <td className="px-[14px] py-3.5 border-b border-border text-text-secondary text-[12.5px] leading-[1.5]" style={{ maxWidth: 420 }}>
                      {thesis}
                    </td>
                    <td className="px-[14px] py-3.5 border-b border-border text-right num text-text-secondary">
                      {Math.round(c.hype_score ?? 0)}
                    </td>
                    <td
                      className="px-[14px] py-3.5 border-b border-border text-right num font-semibold"
                      style={{ color: isLong ? "var(--long)" : "var(--short)" }}
                    >
                      {c.trade_score >= 0 ? "+" : ""}
                      {c.trade_score?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-[18px] py-3.5 border-b border-border text-right num">
                      {c.notional ? `$${(c.notional / 1_000_000).toFixed(1)}M` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && showSplit && (
          <div className="text-center text-text-tertiary text-[12px] py-3">
            Showing top 5 of {filtered.filter((c) => c.direction === "long").length} long candidates · top 5 of{" "}
            {filtered.filter((c) => c.direction === "short").length} short candidates ·{" "}
            <span className="text-text-tertiary">click any row for derivation →</span>
          </div>
        )}
      </div>

      <TradeDerivationDrawer
        pick={openPick}
        open={openPick !== null}
        onClose={() => setOpenPick(null)}
        totalNotional={TOTAL_NOTIONAL}
      />
    </>
  );
}
