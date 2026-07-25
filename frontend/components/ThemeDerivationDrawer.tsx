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

interface ThemeAssetRow {
  ticker: string;
  weight: number | null;
  asset_class: string | null;
}

interface ThemeNewsRow {
  source: string | null;
  headline: string | null;
  published_date: string | null;
  run_date: string | null;
}

/**
 * `method_id` referencing the selection method used for the displayed
 * correlation. See backend ADR-0016 + `docs/superpowers/specs/...` for the
 * derivation of "max |corr| across theme_assets".
 */
const CORR_SELECTION_METHOD_ID = "theme_assets.max_abs_corr.v1";

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

/** Colour + honesty for a headline's source tag. Anything starting `mock_`
 * (mock_brave, mock_reddit, …) is synthetic fallback and flagged. */
function sourceMeta(source: string | null): { label: string; color: string; synthetic: boolean } {
  const s = (source ?? "unknown").toLowerCase();
  const synthetic = s.startsWith("mock") || s.includes("synthetic") || s.includes("fallback");
  if (synthetic) return { label: source ?? "mock", color: "var(--short)", synthetic: true };
  if (s.includes("brave")) return { label: source ?? "brave", color: "var(--accent)", synthetic: false };
  if (s.includes("reddit")) return { label: source ?? "reddit", color: "var(--warning)", synthetic: false };
  return { label: source ?? "unknown", color: "var(--text-tertiary)", synthetic: false };
}

function fmtDay(d: string | null): string {
  if (!d) return "—";
  return d.slice(0, 10);
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
  const [sourceCounts, setSourceCounts] = useState<Record<string, number> | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [themeAssets, setThemeAssets] = useState<ThemeAssetRow[]>([]);
  const [headlines, setHeadlines] = useState<ThemeNewsRow[]>([]);

  useEffect(() => {
    if (!open || !theme) return;
    let cancelled = false;
    (async () => {
      const runDate = theme.run_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const [sigRes, cfgRes, assetsRes] = await Promise.all([
        supabase
          .from("theme_signals_history")
          .select("mention_count_1d, mention_count_7d_avg, mention_count_7d_std, avg_sentiment, price_corr, momentum_raw, run_date")
          .eq("theme_id", theme.id)
          .eq("run_date", runDate)
          .maybeSingle(),
        supabase.from("scoring_config").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase
          .from("theme_assets")
          .select("ticker, weight, asset_class")
          .eq("theme_id", theme.id)
          .order("run_date", { ascending: false }),
      ]);
      if (cancelled) return;
      setSignal((sigRes.data as ThemeSignalRow) ?? null);
      setCfg((cfgRes.data as ScoringConfig) ?? null);
      setThemeAssets((assetsRes.data as ThemeAssetRow[]) ?? []);

      // Real per-source counts from theme_news. The previous implementation
      // split the mention count by fixed ratios (×0.62 Brave, ×0.30 Reddit,
      // ×0.08 yfinance) and rendered the result as though it were a measured
      // breakdown. It was arithmetic on a single number, and it was wrong in a
      // way that mattered: with empty Reddit credentials the social feed falls
      // back to one synthetic post per theme, so the invented "Reddit 7" masked
      // an absent source.
      const { data: newsRows, error: newsErr } = await supabase
        .from("theme_news")
        .select("source, headline, published_date, run_date")
        .eq("theme_id", theme.id)
        .eq("run_date", runDate)
        .order("published_date", { ascending: false })
        .limit(40);
      if (cancelled) return;
      if (newsErr) {
        setSourceCounts(null);
        setHeadlines([]);
        setSourceError(newsErr.message);
      } else {
        const rows = (newsRows ?? []) as ThemeNewsRow[];
        const counts: Record<string, number> = {};
        for (const r of rows) {
          const key = r.source || "unknown";
          counts[key] = (counts[key] ?? 0) + 1;
        }
        setSourceCounts(Object.keys(counts).length ? counts : null);
        // Keep only rows that carry an actual headline to read.
        setHeadlines(rows.filter((r) => (r.headline ?? "").trim().length > 0));
        setSourceError(null);
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
                <span data-testid="corr-label">abs(corr)</span> (mentions × asset return, 7d):{" "}
                <span className="num">{fmt(Math.abs(signal?.price_corr ?? NaN), 2)}</span>
                <br />
                {themeAssets.length > 0 ? (
                  <>
                    <span data-testid="corr-selection-tickers" className="num">
                      Theme tickers ({themeAssets.length}): {themeAssets.map((a) => a.ticker).join(", ")}
                    </span>
                    <br />
                  </>
                ) : null}
                <span data-testid="corr-selection-method">
                  Selection method: max |corr| across theme_assets ·{" "}
                  <code className="num">method_id={CORR_SELECTION_METHOD_ID}</code>
                </span>
                <br />
                |ρ| ÷ 0.50 full-credit level, capped at 1 — an absolute scale, so the
                reading means the same on any day (ADR-0028 dropped the old cross-theme
                min-max, which moved when other themes moved)
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
                tanh(z ÷ 2) rescaled to [0,1], 0.5 at no change — the theme&apos;s own
                MAD-scaled z, absolute, not a rank against the other themes
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
            v={wv.toFixed(2)} · s={ws.toFixed(2)} · c={wc.toFixed(2)} · m=
            {wm.toFixed(2)}
          </span>
        </li>
        <li>
          Normalisation: each sub-score is a saturating transform of the theme&apos;s
          own signal — volume tanh(m/3), correlation |ρ|/0.50, momentum tanh(z/2) — so a
          reading is an <em>absolute</em> level that means the same thing on any day, not
          a rank against the other themes (ADR-0028/0042).
        </li>
        <li>
          Source counts:{" "}
          {sourceError ? (
            <span className="text-text-tertiary">
              unavailable ({sourceError})
            </span>
          ) : sourceCounts ? (
            <span className="num">
              {Object.entries(sourceCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([src, n]) => `${src} ${n}`)
                .join(" · ")}
              {Object.keys(sourceCounts).some((s) => s.startsWith("mock")) && (
                <span className="text-warning ml-1.5 font-sans">
                  — includes fallback data; treat this score as estimated
                </span>
              )}
            </span>
          ) : (
            <span className="text-text-tertiary">
              no per-source rows for this run (theme_news)
            </span>
          )}
        </li>
      </ul>

      {/* ── Raw headlines behind the score ──────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Headlines behind the score
      </div>
      <div className="text-[11px] text-text-tertiary mb-2">
        The actual items collected for this theme on{" "}
        <span className="num">{fmtDay(theme.run_date ?? null)}</span>, source-tagged.
        The Volume and Sentiment sub-scores are computed from exactly these.
      </div>
      {sourceError ? (
        <div className="text-text-tertiary text-[12px] py-2">
          theme_news unavailable ({sourceError})
        </div>
      ) : headlines.length === 0 ? (
        <div className="text-text-tertiary text-[12px] py-2">
          No headline rows for this theme on this run date (theme_news). The
          aggregate sub-scores may still exist, but there is no raw item to read
          behind them.
        </div>
      ) : (
        <ul className="m-0 pl-0 list-none flex flex-col gap-1.5">
          {headlines.map((h, i) => {
            const meta = sourceMeta(h.source);
            return (
              <li
                key={`${h.headline}-${i}`}
                className="rounded-[6px] border border-border bg-bg-elevated px-3 py-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] num"
                    style={{
                      color: meta.color,
                      border: `1px solid ${meta.color}`,
                    }}
                    title={meta.synthetic ? "Synthetic fallback — no live source" : undefined}
                  >
                    {meta.label}
                  </span>
                  {meta.synthetic && (
                    <span className="text-warning text-[10px] font-semibold">
                      synthetic
                    </span>
                  )}
                  <span className="num text-[10.5px] text-text-tertiary ml-auto">
                    {fmtDay(h.published_date)}
                  </span>
                </div>
                <div className="text-[12.5px] text-text-primary leading-[1.45]">
                  {h.headline}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {headlines.some((h) => sourceMeta(h.source).synthetic) && (
        <div className="text-[11px] text-warning mt-2 font-sans">
          Some items are mock fallback — treat this theme&apos;s HypeScore as
          estimated, not measured.
        </div>
      )}

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
