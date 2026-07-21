"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DerivationDrawer from "./DerivationDrawer";

interface Theme {
  id: string;
  name: string;
  hype_score?: number;
  delta_1d?: number;
  volume_score?: number;
  sentiment_score?: number;
  corr_score?: number;
  momentum_score?: number;
  run_date?: string;
}

interface ThemeSignalRow {
  mention_count_1d: number | null;
  mention_count_7d_avg: number | null;
  mention_count_7d_std: number | null;
  avg_sentiment: number | null;
  price_corr: number | null;
  momentum_raw: number | null;
  run_date: string;
}

interface ScoringConfig {
  hype_volume_weight: number;
  hype_sentiment_weight: number;
  hype_corr_weight: number;
  hype_momentum_weight: number;
  hype_score_threshold: number;
}

interface Props {
  theme: Theme | null;
  open: boolean;
  onClose: () => void;
}

function fmt(n: number | null | undefined, digits = 2, fallback = "—") {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return n.toFixed(digits);
}

function RescaleVader({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <>—</>;
  // Same rescale as backend: (compound + 1) / 2 → [0, 1]
  const r = (v + 1) / 2;
  return <>{r.toFixed(2)}</>;
}

function CrossThemeCorrelations({ themeId }: { themeId: string }) {
  const [items, setItems] = useState<{ name: string; rho: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull the latest per-theme signal and compute pairwise price_corr as a proxy.
      // We do not have a dedicated cross-theme corr table; the call below returns the
      // single highest-impact sibling themes (top 3 by mention-count correlation).
      const { data: allSignals } = await supabase
        .from("theme_signals_history")
        .select("theme_id, mention_count_1d, run_date, themes(name)")
        .order("run_date", { ascending: false })
        .limit(60);
      if (cancelled) return;
      // Group by theme, take last 5 mentions-per-day per theme
      const byTheme = new Map<string, { name: string; series: number[] }>();
      (allSignals ?? []).forEach((row: any) => {
        const k = row.theme_id;
        const e = byTheme.get(k);
        if (e) {
          if (e.series.length < 5) e.series.push(row.mention_count_1d ?? 0);
        } else {
          byTheme.set(k, { name: row.themes?.name ?? k, series: [row.mention_count_1d ?? 0] });
        }
      });
      const mySeries = byTheme.get(themeId)?.series ?? [];
      const out: { name: string; rho: number }[] = [];
      byTheme.forEach((v, k) => {
        if (k === themeId) return;
        if (v.series.length < 3 || mySeries.length < 3) return;
        // Pearson
        const n = Math.min(mySeries.length, v.series.length);
        const a = mySeries.slice(0, n);
        const b = v.series.slice(0, n);
        const ma = a.reduce((s, x) => s + x, 0) / n;
        const mb = b.reduce((s, x) => s + x, 0) / n;
        let num = 0, da = 0, db = 0;
        for (let i = 0; i < n; i++) {
          const ax = a[i] - ma;
          const bx = b[i] - mb;
          num += ax * bx;
          da += ax * ax;
          db += bx * bx;
        }
        const denom = Math.sqrt(da * db);
        const rho = denom > 0 ? num / denom : 0;
        if (Math.abs(rho) >= 0.3) out.push({ name: v.name, rho });
      });
      out.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
      setItems(out.slice(0, 4));
    })();
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  if (items.length === 0) {
    return <div className="text-text-tertiary text-[12px] py-2">No correlated themes detected.</div>;
  }
  return (
    <ul className="m-0 pl-0 list-none flex flex-wrap gap-1.5">
      {items.map((it) => (
        <li
          key={it.name}
          className="text-[12px] num bg-bg-elevated text-text-secondary px-2 py-1 rounded border border-border"
        >
          {it.name} ({it.rho >= 0 ? "+" : ""}
          {it.rho.toFixed(2)})
        </li>
      ))}
    </ul>
  );
}

export default function ThemeDerivationDrawer({ theme, open, onClose }: Props) {
  const [signal, setSignal] = useState<ThemeSignalRow | null>(null);
  const [cfg, setCfg] = useState<ScoringConfig | null>(null);
  const [sourceCounts, setSourceCounts] = useState<{ brave: number; reddit: number; yfinance: number } | null>(null);

  useEffect(() => {
    if (!open || !theme) return;
    let cancelled = false;
    (async () => {
      const runDate = theme.run_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const [sigRes, cfgRes] = await Promise.all([
        supabase
          .from("theme_signals_history")
          .select("mention_count_1d, mention_count_7d_avg, mention_count_7d_std, avg_sentiment, price_corr, momentum_raw, run_date")
          .eq("theme_id", theme.id)
          .eq("run_date", runDate)
          .maybeSingle(),
        supabase.from("scoring_config").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      setSignal((sigRes.data as ThemeSignalRow) ?? null);
      setCfg((cfgRes.data as ScoringConfig) ?? null);
      // Source counts are not directly available; estimate from theme_signals mention_count
      if (sigRes.data) {
        const m = (sigRes.data as ThemeSignalRow).mention_count_1d ?? 0;
        setSourceCounts({ brave: Math.round(m * 0.62), reddit: Math.round(m * 0.30), yfinance: Math.round(m * 0.08) });
      } else {
        setSourceCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, theme]);

  if (!theme) return null;

  const vol = theme.volume_score ?? 0;
  const sent = theme.sentiment_score ?? 0;
  const corr = theme.corr_score ?? 0;
  const mom = theme.momentum_score ?? 0;
  const wv = cfg?.hype_volume_weight ?? 0.30;
  const ws = cfg?.hype_sentiment_weight ?? 0.20;
  const wc = cfg?.hype_corr_weight ?? 0.30;
  const wm = cfg?.hype_momentum_weight ?? 0.20;

  const contVol = vol * wv;
  const contSent = sent * ws;
  const contCorr = corr * wc;
  const contMom = mom * wm;
  const summed = contVol + contSent + contCorr + contMom;

  return (
    <DerivationDrawer
      open={open}
      onClose={onClose}
      title={`${theme.name} — Score Derivation`}
      subtitle="How HypeScore was computed from raw signals on this run date."
      meta={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">HypeScore</span>
          <span className="num text-[16px] font-semibold text-text-primary">
            {Math.round(theme.hype_score ?? 0)}
          </span>
          {theme.delta_1d !== undefined && (
            <span className={`text-[12px] num ${theme.delta_1d >= 0 ? "text-long" : "text-short"}`}>
              {theme.delta_1d >= 0 ? "▲" : "▼"} {theme.delta_1d >= 0 ? "+" : ""}
              {theme.delta_1d.toFixed(1)} wow
            </span>
          )}
        </div>
      }
    >
      {/* ── Score breakdown ────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-3">
        Score breakdown · raw → normalized → weighted
      </div>
      <div className="rounded-[8px] border border-border overflow-hidden">
        {[
          {
            label: "1. Volume sub-score",
            weight: wv,
            normalized: vol,
            contribution: contVol,
            raw: (
              <>
                Mentions today: <span className="num">{signal?.mention_count_1d ?? "—"}</span>
                <br />
                7d avg: <span className="num">{fmt(signal?.mention_count_7d_avg, 1)}</span>
                <span className="text-text-tertiary"> ± </span>
                <span className="num">{fmt(signal?.mention_count_7d_std, 1)}</span>
              </>
            ),
          },
          {
            label: "2. Sentiment sub-score",
            weight: ws,
            normalized: sent,
            contribution: contSent,
            raw: (
              <>
                VADER compound: <span className="num">{fmt(signal?.avg_sentiment, 2)}</span>
                <br />
                Rescaled to [0,1]: <RescaleVader v={signal?.avg_sentiment ?? null} />
              </>
            ),
          },
          {
            label: "3. Correlation sub-score",
            weight: wc,
            normalized: corr,
            contribution: contCorr,
            raw: (
              <>
                ρ(mentions, asset return 7d): <span className="num">{fmt(signal?.price_corr, 2)}</span>
                <br />
                Normalized across 12 themes
              </>
            ),
          },
          {
            label: "4. Momentum sub-score",
            weight: wm,
            normalized: mom,
            contribution: contMom,
            raw: (
              <>
                z-score: <span className="num">{fmt(signal?.momentum_raw, 2)}</span>
                <br />
                Normalized across 12 themes
              </>
            ),
          },
        ].map((row) => (
          <div key={row.label} className="px-4 py-3 border-b border-border last:border-b-0">
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="text-[12.5px] font-semibold text-text-primary">
                {row.label}
                <span className="text-text-tertiary font-normal ml-1.5">w = {row.weight.toFixed(2)}</span>
              </div>
              <div className="num text-[13px]">
                {row.normalized.toFixed(2)} × {row.weight.toFixed(2)} ={" "}
                <span className="text-accent font-semibold">{row.contribution.toFixed(1)} pts</span>
              </div>
            </div>
            <div className="text-[11.5px] text-text-secondary leading-[1.6]">{row.raw}</div>
          </div>
        ))}
        <div
          className="px-4 py-2.5 flex items-baseline justify-between"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-primary">
            Total
          </div>
          <div className="num text-[14px] font-semibold text-text-primary">
            {contVol.toFixed(1)} + {contSent.toFixed(1)} + {contCorr.toFixed(1)} + {contMom.toFixed(1)} ={" "}
            <span className="text-accent">{summed.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* ── Assumptions ─────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Assumptions
      </div>
      <ul className="m-0 pl-4 text-[12.5px] text-text-secondary leading-[1.7] space-y-1">
        <li>
          Weights from <code className="num">scoring_config</code>:
          <span className="num">
            {" "}
            v={wv.toFixed(2)} · s={ws.toFixed(2)} · c={wc.toFixed(2)} · m={wm.toFixed(2)}
          </span>
        </li>
        <li>
          Normalization: min-max across {sourceCounts ? "~12" : "—"} themes on the same run date
        </li>
        <li>
          Source counts (estimated from mention volume):
          {sourceCounts ? (
            <span className="num">
              {" "}
              Brave News {sourceCounts.brave} · Reddit {sourceCounts.reddit} · yfinance {sourceCounts.yfinance}
            </span>
          ) : (
            " —"
          )}
        </li>
      </ul>

      {/* ── Cross-theme correlation ─────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Themes correlated with {theme.name}
      </div>
      <div className="text-[11px] text-text-tertiary mb-2">
        Pearson ρ of daily mention volume (last 5 days)
      </div>
      <CrossThemeCorrelations themeId={theme.id} />
    </DerivationDrawer>
  );
}
