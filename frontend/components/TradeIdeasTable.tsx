"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TradeDerivationDrawer from "./TradeDerivationDrawer";
import { Citation } from "./CitationList";
import LensSelector, { Lens, lensToAssetClasses } from "./LensSelector";
import { StatusBadge } from "./status/StatusBadge";
import type { NumericDerivation, NumericUnit, NumericStatus } from "@/lib/derivations/numeric";

interface TradeCandidate {
  id: string;
  theme_id: string;
  asset: string;
  direction: "long" | "short";
  trade_score: number;
  hype_score: number;
  entry_thesis?: string;
  notional?: number;
  run_date?: string;
  updated_at?: string;
  themes?: { name: string };
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  citations?: Citation[];
}

type SortKey = "trade_score" | "hype_score" | "asset" | "theme";
type DirectionFilter = "all" | "long" | "short";

// No FALLBACK_THESIS map here. This file used to carry ten hardcoded per-ticker
// investment theses ("Powell signals September cut...") used whenever the real
// `entry_thesis` was absent. They were authored in the frontend, presented in
// the same grammar as pipeline output, and — as it happens — assigned to a
// computed variable that the JSX never rendered. A missing thesis now reads as
// missing.

const TOTAL_NOTIONAL = 100_000_000; // $100M book

// ── Derivation helpers (mirror backend.services.book_metrics / portfolio) ────
// Each row produces four NumericDerivations so every numeric cell has a status
// badge (exact / estimated / stale / unavailable). Status reflects whether the
// underlying column is present in `trade_candidates` — the schema does NOT
// persist weight or asset_return on trade_candidates, so those are derived
// client-side and marked `estimated`. Notional is persisted → `exact`.

function nowMinus(runDateIso?: string): number {
  // Observed age of the pick in seconds. Uses run_date when available, else
  // updated_at, else assumes "fresh" (just rendered).
  const ts = runDateIso ? new Date(runDateIso).getTime() : Date.now();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function derive(
  field_id: string,
  value: number | null,
  unit: NumericUnit,
  status: NumericStatus,
  runDateIso?: string,
): NumericDerivation {
  return {
    field_id,
    display_status: status,
    value,
    unit,
    method_id:
      status === "exact"
        ? "db.trade_candidates.column"
        : status === "estimated"
          ? "frontend.derivation"
          : status === "stale"
            ? "db.trade_candidates.column.stale"
            : "db.unavailable",
    source_records: runDateIso
      ? [{ table: "trade_candidates", id: field_id, as_of: runDateIso }]
      : [],
    computed_at: new Date().toISOString(),
    as_of: runDateIso ?? new Date().toISOString(),
    freshness: { max_age_seconds: 86400, observed_age_seconds: nowMinus(runDateIso) },
    unavailable_reason:
      status === "unavailable" ? "missing column on trade_candidates" : undefined,
  };
}

function fmtSignedWeight(d: NumericDerivation): string {
  if (d.value === null) return "—";
  const v = d.value * 100;
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

function fmtUsd(d: NumericDerivation): string {
  if (d.value === null) return "—";
  return `$${(d.value / 1_000_000).toFixed(1)}M`;
}

export default function TradeIdeasTable({ initialLens }: { initialLens?: Lens } = {}) {
  const [rows, setRows] = useState<TradeCandidate[]>([]);
  const [filter, setFilter] = useState<DirectionFilter>("all");
  const [sort, setSort] = useState<SortKey>("trade_score");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [openPick, setOpenPick] = useState<TradeCandidate | null>(null);
  const [lens, setLens] = useState<Lens>(initialLens ?? "multi_asset");
  // Map of ticker → asset_class (from theme_assets, migration 009)
  const [assetClassMap, setAssetClassMap] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      supabase
        .from("trade_candidates")
        .select("*, themes(name)")
        .order("trade_score", { ascending: false }),
      supabase.from("theme_assets").select("ticker, asset_class"),
    ]).then(([rowsRes, assetRes]) => {
      setRows(rowsRes.data ?? []);
      const map: Record<string, string> = {};
      for (const row of assetRes.data ?? []) {
        if (row.ticker && row.asset_class) map[row.ticker] = row.asset_class;
      }
      setAssetClassMap(map);
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
    // Apply lens filter (ADR-0015)
    const allowed = lensToAssetClasses(lens);
    if (allowed !== null) {
      r = r.filter((c) => {
        const cls = assetClassMap[c.asset] ?? "other";
        return allowed.includes(cls);
      });
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
  }, [rows, filter, sort, query, lens, assetClassMap]);

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
          <div className="w-px h-5 bg-border mx-1" />
          <LensSelector value={lens} onChange={setLens} />
          <div className="flex-1" />
          <label htmlFor="trade-search" className="sr-only">
            Filter by ticker or theme
          </label>
          <input
            id="trade-search"
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
            <caption className="sr-only">
              Trade candidates ranked by TradeScore · showing top 5 long and top 5 short
              {lens !== "multi_asset" ? ` · ${lens} lens` : ""}.
            </caption>
            <thead>
              <tr>
                <th className="text-left px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated" style={{ width: 90 }}>Direction</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Ticker</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Theme</th>
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">HypeScore</th>
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">TradeScore</th>
                {/* `Asset Return` and `Contribution` used to sit here. Neither
                    is persisted on trade_candidates, so both rendered "—" for
                    every row of every book, forever. A column that can never
                    populate is not a column. */}
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Signed Weight</th>
                <th className="text-right px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Notional</th>
                <th className="text-left px-[14px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const isLong = c.direction === "long";
                const runDateIso = c.run_date ?? c.updated_at;
                // ── Per-row derivations ────────────────────────────────────
                // Signed weight: schema has no `weight` on trade_candidates,
                // so derive as notional / TOTAL_NOTIONAL, signed by direction.
                // Marked `estimated` when notional is missing.
                const weight = c.notional && c.notional > 0 ? c.notional / TOTAL_NOTIONAL : null;
                const signedWeight =
                  weight !== null ? (isLong ? weight : -weight) : null;
                const swStatus: NumericStatus =
                  signedWeight !== null ? "estimated" : "unavailable";

                // Notional: read straight from the row; the column is
                // backfilled by daily_refresh via portfolio_positions join.
                const notionalStatus: NumericStatus =
                  c.notional && c.notional > 0 ? "exact" : "unavailable";

                const notionalDer = derive(
                  `trade.${c.asset}.notional`,
                  c.notional ?? null,
                  "usd_m",
                  notionalStatus,
                  runDateIso
                );
                const swDer = derive(
                  `trade.${c.asset}.signed_weight`,
                  signedWeight,
                  "ratio",
                  swStatus,
                  runDateIso
                );
                // Worst status drives the row badge.
                const rowStatus: NumericStatus = [
                  swStatus,
                  notionalStatus,
                ].reduce<NumericStatus>(
                  (worst, cur) => (severity(cur) > severity(worst) ? cur : worst),
                  "exact"
                );
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-bg-elevated cursor-pointer"
                    onClick={() => setOpenPick(c)}
                    data-testid="trade-row"
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
                    <td
                      className="px-[14px] py-3.5 border-b border-border text-right num"
                      data-testid="cell-signed-weight"
                      style={{
                        color:
                          signedWeight === null
                            ? "var(--text-tertiary)"
                            : isLong
                              ? "var(--long)"
                              : "var(--short)",
                      }}
                    >
                      {fmtSignedWeight(swDer)}
                    </td>
                    <td
                      className="px-[14px] py-3.5 border-b border-border text-right num"
                      data-testid="cell-notional"
                    >
                      {fmtUsd(notionalDer)}
                    </td>
                    <td className="px-[14px] py-3.5 border-b border-border">
                      <div data-testid="status-badge">
                        <StatusBadge status={rowStatus} />
                      </div>
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
            {filtered.filter((c) => c.direction === "short").length} short candidates
            {lens !== "multi_asset" && (
              <> · <span className="text-accent">{lens} lens</span></>
            )}
            {" "}· <span className="text-text-tertiary">click any row for derivation →</span>
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

// Higher number = worse provenance.
function severity(s: NumericStatus): number {
  switch (s) {
    case "exact":
      return 0;
    case "estimated":
      return 1;
    case "stale":
      return 2;
    case "unverified":
      return 3;
    case "unavailable":
      return 4;
    default:
      return 5;
  }
}
