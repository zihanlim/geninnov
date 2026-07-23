"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DerivationDrawer from "./DerivationDrawer";
import CitationList, { Citation } from "./CitationList";
import { DEFAULT_EDGE_WEIGHTS } from "@/lib/themeSignals";

/**
 * Per-trade derivation.
 *
 * The previous version of this drawer invented most of what it displayed:
 *   - it announced "TradeScore math · 0.55 × momentum + 0.45 × sentiment" and
 *     then computed `momentum = ts × 0.85`, `sentiment = ts × 0.15`;
 *   - it showed a "Kelly fraction (|trade_score| × 0.30, capped at 0.50)" — no
 *     Kelly sizing exists anywhere in the backend;
 *   - it rendered sizing as `hype / (hype × n)`, which is not the formula
 *     `allocate_portfolio` uses.
 *
 * Everything below is now either read from the database or derived with the
 * same formula the backend uses, and anything that cannot be reconstructed is
 * shown as unavailable rather than filled in.
 *
 * Backend references:
 *   backend/services/trade_generator.py  → trade_score()
 *   backend/services/trade_ranker.py     → allocate_portfolio()
 */

interface TradePick {
  id?: string;
  direction: "long" | "short";
  asset: string;
  theme_id?: string;
  theme_name?: string;
  themes?: { name: string };
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

interface Props {
  pick: TradePick | null;
  open: boolean;
  onClose: () => void;
  totalNotional: number;
}

interface ScoringWeights {
  trade_hype_weight: number;
  trade_sentiment_weight: number;
}

interface HistoryPoint {
  run_date: string;
  hype_score: number | null;
  avg_sentiment: number | null;
  edge_score?: number | null;
  trend_signal?: number | null;
  regime_bias?: number | null;
  carry_signal?: number | null;
  value_signal?: number | null;
  conviction?: number | null;
  vol?: number | null;
}

// The full 4-component EdgeScore weights + the abstention threshold, all read
// live from scoring_config. Defaults fall back to DEFAULT_EDGE_WEIGHTS (the
// shared, correct 0.35/0.25/0.20/0.20 + 0.15), NOT the stale hardcoded 0.6/0.4.
interface EdgeWeights {
  trend: number;
  regime: number;
  carry: number;
  value: number;
  abstain: number;
}

function fmt(n: number | null | undefined, digits = 2, fallback = "—") {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return n.toFixed(digits);
}

function fmtSigned(n: number | null | undefined, digits = 2, fallback = "—") {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

function Unavailable({ reason }: { reason: string }) {
  return <span className="text-text-tertiary">— ({reason})</span>;
}

export default function TradeDerivationDrawer({
  pick,
  open,
  onClose,
  totalNotional,
}: Props) {
  const [assets, setAssets] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [weights, setWeights] = useState<ScoringWeights | null>(null);
  const [edgeWeights, setEdgeWeights] = useState<EdgeWeights | null>(null);
  // Σ conviction over the book on this run — the denominator the pre-cap
  // conviction weight is normalised against. Null when the book carries no
  // conviction column yet (pre-migration-025 rows).
  const [bookConvictionSum, setBookConvictionSum] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !pick) return;
    let cancelled = false;
    (async () => {
      const runDate = pick.run_date?.slice(0, 10) ?? null;

      const [assetRes, histRes, cfgRes, bookRes] = await Promise.all([
        pick.theme_id
          ? supabase
              .from("theme_assets")
              .select("ticker, run_date")
              .eq("theme_id", pick.theme_id)
              .order("run_date", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
        pick.theme_id
          ? supabase
              .from("theme_signals_history")
              .select(
                "run_date, hype_score, avg_sentiment, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol"
              )
              .eq("theme_id", pick.theme_id)
              .order("run_date", { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("scoring_config").select("param_name, value"),
        // The candidate set the conviction weight was normalised over.
        supabase
          .from("portfolio_positions")
          .select("asset, conviction, run_date")
          .order("run_date", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;

      setAssets(
        Array.from(
          new Set(
            ((assetRes.data ?? []) as { ticker: string }[]).map((a) => a.ticker)
          )
        )
      );
      setHistory(((histRes.data ?? []) as HistoryPoint[]).slice().reverse());

      const cfg = Object.fromEntries(
        ((cfgRes.data ?? []) as { param_name: string; value: string }[]).map(
          (r) => [r.param_name, Number(r.value)]
        )
      );
      setWeights({
        trade_hype_weight: Number.isFinite(cfg.trade_hype_weight)
          ? cfg.trade_hype_weight
          : 0.55,
        trade_sentiment_weight: Number.isFinite(cfg.trade_sentiment_weight)
          ? cfg.trade_sentiment_weight
          : 0.45,
      });
      setEdgeWeights({
        trend: Number.isFinite(cfg.edge_trend_weight)
          ? cfg.edge_trend_weight
          : DEFAULT_EDGE_WEIGHTS.trend,
        regime: Number.isFinite(cfg.edge_regime_weight)
          ? cfg.edge_regime_weight
          : DEFAULT_EDGE_WEIGHTS.regime,
        carry: Number.isFinite(cfg.edge_carry_weight)
          ? cfg.edge_carry_weight
          : DEFAULT_EDGE_WEIGHTS.carry,
        value: Number.isFinite(cfg.edge_value_weight)
          ? cfg.edge_value_weight
          : DEFAULT_EDGE_WEIGHTS.value,
        abstain: Number.isFinite(cfg.edge_abstain_threshold)
          ? cfg.edge_abstain_threshold
          : DEFAULT_EDGE_WEIGHTS.abstainThreshold,
      });

      const book = ((bookRes.data ?? []) as {
        asset: string;
        conviction: number | null;
        run_date: string;
      }[]).filter((r) => !runDate || r.run_date === runDate);
      const convictions = book
        .map((r) => r.conviction)
        .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      // Only a real denominator: if no book row carries a conviction, leave it
      // null so the UI says the normaliser is unavailable rather than showing 0.
      setBookConvictionSum(
        convictions.length
          ? convictions.reduce((s, v) => s + Math.abs(v), 0)
          : null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pick]);

  if (!pick) return null;

  const isLong = pick.direction === "long";
  const dirColor = isLong ? "var(--long)" : "var(--short)";
  const ts = pick.trade_score ?? null;
  const hype = pick.hype_score ?? null;
  const themeName = pick.theme_name ?? pick.themes?.name ?? null;

  // ── Real TradeScore reconstruction ─────────────────────────────────────────
  // hype_yesterday is the prior scored observation for this theme. It is NULL
  // for every theme_signals_history row written before the column was
  // populated, in which case HypeMomentum is genuinely unknown — not zero.
  const scored = history.filter(
    (h): h is HistoryPoint & { hype_score: number } =>
      typeof h.hype_score === "number"
  );
  const hypeToday = scored.length ? scored[scored.length - 1].hype_score : hype;
  const hypeYesterday =
    scored.length >= 2 ? scored[scored.length - 2].hype_score : null;
  const latestSentiment =
    history.length && typeof history[history.length - 1].avg_sentiment === "number"
      ? history[history.length - 1].avg_sentiment!
      : null;

  // EdgeScore drives DIRECTION and SIZE (ADR-0031/0032). Read the latest
  // persisted breakdown for this theme; the book row's `direction` was computed
  // from sign(edge), and its weight from conviction = |edge| / vol.
  const latestEdge = history.length ? history[history.length - 1] : null;
  const num = (v: number | null | undefined): number | null =>
    typeof v === "number" && !Number.isNaN(v) ? v : null;
  const edgeScore = num(latestEdge?.edge_score);
  const trendSignal = num(latestEdge?.trend_signal);
  const regimeBias = num(latestEdge?.regime_bias);
  const carrySignal = num(latestEdge?.carry_signal);
  const valueSignal = num(latestEdge?.value_signal);
  const vol = num(latestEdge?.vol);

  const wTrend = edgeWeights?.trend ?? DEFAULT_EDGE_WEIGHTS.trend;
  const wRegime = edgeWeights?.regime ?? DEFAULT_EDGE_WEIGHTS.regime;
  const wCarry = edgeWeights?.carry ?? DEFAULT_EDGE_WEIGHTS.carry;
  const wValue = edgeWeights?.value ?? DEFAULT_EDGE_WEIGHTS.value;
  const abstainThreshold =
    edgeWeights?.abstain ?? DEFAULT_EDGE_WEIGHTS.abstainThreshold;

  // Four weighted contributions. A null component contributes 0 (honest
  // absence) and is flagged in the UI, never rendered as a real tilt.
  const edgeComponents = [
    { key: "Trend", label: "Trend (6m basket momentum, tanh)", raw: trendSignal, w: wTrend },
    { key: "Regime", label: "Regime fit (risk-beta × sentiment + cycle)", raw: regimeBias, w: wRegime },
    { key: "Carry", label: "Carry (yield / roll / funding advantage)", raw: carrySignal, w: wCarry },
    { key: "Value", label: "Value (cheapness vs fair value)", raw: valueSignal, w: wValue },
  ] as const;
  const anyEdgeComponent = edgeComponents.some((c) => c.raw !== null);
  const edgeRecon = anyEdgeComponent
    ? edgeComponents.reduce((acc, c) => acc + c.w * (c.raw ?? 0), 0)
    : null;

  // conviction = |EdgeScore| / vol — the pre-cap sizing weight. Prefer the
  // persisted value; recompute only when both inputs are present.
  const persistedConviction = num(latestEdge?.conviction);
  const conviction =
    persistedConviction !== null
      ? persistedConviction
      : edgeScore !== null && vol !== null && vol > 0
        ? Math.abs(edgeScore) / vol
        : null;
  const isAbstain =
    edgeScore !== null && Math.abs(edgeScore) < abstainThreshold;

  const elapsedDays =
    scored.length >= 2
      ? Math.max(
          1,
          Math.round(
            (new Date(scored[scored.length - 1].run_date).getTime() -
              new Date(scored[scored.length - 2].run_date).getTime()) /
              86400000
          )
        )
      : null;

  let hypeMomentum: number | null = null;
  if (
    hypeYesterday !== null &&
    hypeYesterday !== 0 &&
    hypeToday !== null &&
    elapsedDays !== null
  ) {
    const raw = (hypeToday - hypeYesterday) / hypeYesterday / Math.max(1, elapsedDays);
    hypeMomentum = Math.max(-1, Math.min(1, raw));
  }

  const wHype = weights?.trade_hype_weight ?? 0.55;
  const wSent = weights?.trade_sentiment_weight ?? 0.45;
  const momentumTerm = hypeMomentum === null ? null : wHype * hypeMomentum;
  const sentimentTerm = latestSentiment === null ? null : wSent * latestSentiment;
  const reconstructed =
    momentumTerm !== null && sentimentTerm !== null
      ? momentumTerm + sentimentTerm
      : null;

  // ── Sizing (conviction × inverse-vol, ADR-0032) ────────────────────────────
  // Pre-cap weight ∝ conviction = |EdgeScore| / vol, then normalised across the
  // sized book and clipped by single-name / sector / geo caps. The normalised
  // conviction share is what a name would get before caps bite.
  const normalisedConviction =
    conviction !== null && bookConvictionSum !== null && bookConvictionSum > 0
      ? conviction / bookConvictionSum
      : null;
  const weightPct =
    pick.weight !== undefined
      ? pick.weight * 100
      : pick.notional && totalNotional
        ? (pick.notional / totalNotional) * 100
        : null;
  const otherAssets = assets.filter((t) => t !== pick.asset);

  return (
    <DerivationDrawer
      open={open}
      onClose={onClose}
      title={`${pick.asset} ${isLong ? "Long" : "Short"} — Trade Derivation`}
      subtitle={themeName ? `Theme: ${themeName}` : undefined}
      meta={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            TradeScore
          </span>
          <span
            className="num text-[16px] font-semibold"
            style={{ color: isLong ? "var(--long)" : "var(--short)" }}
          >
            {ts === null ? "—" : `${ts >= 0 ? "+" : ""}${fmt(ts)}`}
          </span>
          {weightPct !== null && (
            <span className="badge badge-neutral" style={{ fontSize: 10 }}>
              {weightPct.toFixed(1)}% / {fmtUsd(pick.notional)}
            </span>
          )}
        </div>
      }
    >
      {/* ── TradeScore ──────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-1">
        TradeScore — intra-side ranking
      </div>
      <div className="text-[11.5px] text-text-tertiary mb-3 leading-[1.6]">
        <code className="num">
          {wHype.toFixed(2)} × HypeMomentum + {wSent.toFixed(2)} × Sentiment
        </code>
        <br />
        Weights read live from <code className="num">scoring_config</code>. Note:
        TradeScore no longer sets the side — it orders names once EdgeScore
        (below) has picked long vs short.
      </div>

      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between mb-1.5 gap-3">
            <div className="text-[12.5px] font-semibold text-text-primary">
              1. Hype momentum
              <span className="text-text-tertiary font-normal ml-1.5">
                w = {wHype.toFixed(2)}
              </span>
            </div>
            <div className="num text-[13px]">
              {momentumTerm === null ? (
                <Unavailable reason="no prior run" />
              ) : (
                `${momentumTerm >= 0 ? "+" : ""}${fmt(momentumTerm, 3)}`
              )}
            </div>
          </div>
          <div className="text-[11.5px] text-text-secondary leading-[1.6]">
            HypeScore today: <span className="num">{fmt(hypeToday, 1)}</span>
            <br />
            Prior scored run:{" "}
            <span className="num">
              {hypeYesterday === null ? "—" : fmt(hypeYesterday, 1)}
            </span>
            {elapsedDays !== null && (
              <span className="text-text-tertiary">
                {" "}
                ({elapsedDays}d earlier)
              </span>
            )}
            <br />
            {hypeMomentum === null ? (
              <span className="text-text-tertiary">
                HypeMomentum unavailable — theme_signals_history has fewer than
                two scored observations for this theme, so the momentum term
                cannot be reconstructed. It is not zero; it is unknown.
              </span>
            ) : (
              <>
                (Δ / prior) / max(1, {elapsedDays}d) ={" "}
                <span className="num">{fmt(hypeMomentum, 4)}</span>
                <span className="text-text-tertiary"> (clamped to ±1)</span>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between mb-1.5 gap-3">
            <div className="text-[12.5px] font-semibold text-text-primary">
              2. Sentiment
              <span className="text-text-tertiary font-normal ml-1.5">
                w = {wSent.toFixed(2)}
              </span>
            </div>
            <div className="num text-[13px]">
              {sentimentTerm === null ? (
                <Unavailable reason="no signal row" />
              ) : (
                `${sentimentTerm >= 0 ? "+" : ""}${fmt(sentimentTerm, 3)}`
              )}
            </div>
          </div>
          <div className="text-[11.5px] text-text-secondary leading-[1.6]">
            VADER compound (theme mean):{" "}
            <span className="num">{fmt(latestSentiment, 3)}</span>
            <span className="text-text-tertiary"> · range [-1, +1]</span>
          </div>
        </div>

        <div
          className="px-4 py-2.5 flex items-baseline justify-between gap-3"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-primary">
            TradeScore
          </div>
          <div className="num text-[14px] font-semibold text-right">
            <span style={{ color: isLong ? "var(--long)" : "var(--short)" }}>
              {ts === null ? "—" : `${ts >= 0 ? "+" : ""}${fmt(ts)}`}
            </span>
            {reconstructed !== null && ts !== null && (
              <div className="text-[10.5px] font-normal text-text-tertiary mt-0.5">
                reconstructed {reconstructed >= 0 ? "+" : ""}
                {fmt(reconstructed, 3)}
                {Math.abs(reconstructed - ts) > 0.005 && (
                  <span className="text-warning">
                    {" "}
                    · differs from persisted value
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Direction & conviction = EdgeScore, ADR-0031/0032 ──────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Direction — why {isLong ? "long" : "short"}
      </div>
      <div className="text-[11.5px] text-text-tertiary mb-2 leading-[1.6]">
        Side is <code className="num">sign(EdgeScore)</code>, not sign(TradeScore).
        EdgeScore is a weighted blend of four expected-return proxies — trend,
        regime fit, carry and value — with weights read live from{" "}
        <code className="num">scoring_config</code>. TradeScore (above) then only
        ranks names <em>within</em> the side EdgeScore picks. When{" "}
        <code className="num">|EdgeScore| &lt; {abstainThreshold.toFixed(2)}</code>{" "}
        the theme abstains — no position.
      </div>
      {edgeScore === null && !anyEdgeComponent ? (
        <div className="text-[12.5px] text-text-tertiary leading-[1.6]">
          EdgeScore not persisted for this theme&apos;s latest run
          (theme_signals_history.edge_score is null — pre-migration row). The book
          row&apos;s side is{" "}
          <span
            className="text-text-primary font-semibold"
            style={{ color: dirColor }}
          >
            {isLong ? "LONG" : "SHORT"}
          </span>
          , but its basis cannot be shown.
        </div>
      ) : (
        <div className="rounded-[8px] border border-border overflow-hidden text-[12px]">
          {edgeComponents.map((c) => (
            <div
              key={c.key}
              className="px-4 py-2.5 border-b border-border flex justify-between gap-3"
            >
              <span className="text-text-secondary">
                {c.label}
                <span className="text-text-tertiary ml-1.5">w = {c.w.toFixed(2)}</span>
              </span>
              <span className="num">
                {c.raw === null ? (
                  <Unavailable reason="not computed → 0" />
                ) : (
                  <>
                    {fmtSigned(c.raw, 3)}
                    <span className="text-text-tertiary">
                      {" "}
                      → {fmtSigned(c.w * c.raw, 3)}
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
          <div
            className="px-4 py-2.5 flex justify-between gap-3"
            style={{ background: "var(--bg-elevated)" }}
          >
            <span className="text-text-primary font-semibold uppercase tracking-[0.06em] text-[11.5px]">
              EdgeScore{" "}
              {isAbstain ? (
                <span className="text-warning">→ ABSTAIN</span>
              ) : (
                <>→ {isLong ? "LONG" : "SHORT"}</>
              )}
            </span>
            <span
              className="num font-semibold"
              style={{ color: isAbstain ? "var(--warning)" : dirColor }}
            >
              {fmtSigned(edgeScore ?? edgeRecon, 3)}
              {edgeScore !== null &&
                edgeRecon !== null &&
                Math.abs(edgeScore - edgeRecon) > 0.005 && (
                  <span className="text-warning text-[10.5px] ml-1.5">
                    ≠ recomputed {fmtSigned(edgeRecon, 3)}
                  </span>
                )}
            </span>
          </div>
        </div>
      )}

      {/* Abstention note — only when the signal is below threshold but the book
          still holds this name (e.g. it was sized before the edge decayed). */}
      {isAbstain && (
        <div className="mt-2 text-[11.5px] text-warning leading-[1.6]">
          |EdgeScore| = <span className="num">{fmt(Math.abs(edgeScore ?? 0), 3)}</span>{" "}
          is below the abstention threshold{" "}
          <span className="num">{abstainThreshold.toFixed(2)}</span>. On the latest
          run this theme&apos;s four components did not agree strongly enough to
          justify risk; a fresh screen would leave it out of the book.
        </div>
      )}

      {/* Conviction — the sizing weight, ADR-0032 */}
      <div className="mt-3 rounded-[8px] border border-border overflow-hidden text-[12px]">
        <div className="px-4 py-2.5 border-b border-border flex justify-between gap-3">
          <span className="text-text-secondary">
            Realised vol of the theme basket
          </span>
          <span className="num">{vol === null ? <Unavailable reason="no vol" /> : fmt(vol, 3)}</span>
        </div>
        <div
          className="px-4 py-2.5 flex justify-between gap-3"
          style={{ background: "var(--bg-elevated)" }}
        >
          <span className="text-text-primary font-semibold uppercase tracking-[0.06em] text-[11.5px]">
            Conviction = |EdgeScore| / vol
          </span>
          <span className="num font-semibold text-accent">
            {conviction === null ? (
              <Unavailable reason="need edge & vol" />
            ) : (
              `${fmt(conviction, 2)}×`
            )}
          </span>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-text-tertiary leading-[1.6]">
        Conviction is the pre-cap sizing weight (next section): a strong edge in a
        quiet basket is sized above an equally strong edge in a jumpy one. This is
        the conviction × inverse-vol rule that replaced HypeScore-proportional
        sizing.
      </div>

      {/* ── Asset selection ────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Asset selection
      </div>
      <div className="text-[12.5px] text-text-secondary leading-[1.6]">
        Theme{" "}
        <span className="text-text-primary font-semibold">{themeName ?? "—"}</span>{" "}
        maps to{" "}
        <span className="num">{assets.length ? assets.join(", ") : "—"}</span>.
        Selected:{" "}
        <span className="num text-text-primary font-semibold">{pick.asset}</span>
        {otherAssets.length > 0 && (
          <>
            <br />
            <span className="text-text-tertiary">
              Every mapped ticker enters the candidate pool independently; the
              screen keeps the strongest entry per (asset, direction). Other
              tickers for this theme: {otherAssets.join(", ")}.
            </span>
          </>
        )}
      </div>

      {/* ── Sizing ─────────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Position sizing
      </div>
      <div className="text-[11.5px] text-text-tertiary mb-2 leading-[1.6]">
        Pre-cap weight is <code className="num">∝ conviction = |EdgeScore| / vol</code>{" "}
        — conviction × inverse-vol, not HypeScore-proportional. A strong edge in a
        quiet basket outsizes an equally strong edge in a jumpy one.
      </div>
      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          <span className="text-text-primary font-semibold">1. Conviction weight</span>{" "}
          = |EdgeScore| / vol ={" "}
          <span className="num">
            {conviction === null ? (
              <Unavailable reason="need edge & vol" />
            ) : (
              `${fmt(conviction, 3)}×`
            )}
          </span>
        </div>
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          <span className="text-text-primary font-semibold">2. Normalise</span>{" "}
          across the book&apos;s conviction
          {bookConvictionSum !== null ? (
            <>
              {" "}
              (Σ|conviction| = <span className="num">{fmt(bookConvictionSum, 3)}</span>)
              {normalisedConviction !== null && (
                <>
                  {" "}
                  → pre-cap share{" "}
                  <span className="num">{fmt(normalisedConviction * 100, 1)}%</span>
                </>
              )}
            </>
          ) : (
            <span className="text-text-tertiary">
              {" "}
              — no book row carries a conviction on this run, so the normalising
              denominator cannot be shown
            </span>
          )}
        </div>
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          <span className="text-text-primary font-semibold">3. Cap enforcement</span>
          <ul className="m-0 pl-4 mt-1 space-y-0.5">
            <li>Single name ≤ 20% of book</li>
            <li>Sector ≤ 30% (applied only when the sector has ≥ 3 members)</li>
            <li>Geography ≤ 35% (applied only when the group has ≥ 3 members)</li>
          </ul>
          <div className="text-text-tertiary mt-1.5">
            A capped name is held at the limit and its excess is redistributed to
            uncapped names in proportion to their original weights, then the book
            is normalised once.
          </div>
        </div>
        <div
          className="px-4 py-2.5 flex items-baseline justify-between"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-text-primary">
            Final weight / notional
          </div>
          <div className="num text-[14px] font-semibold text-accent">
            {weightPct === null ? "—" : `${weightPct.toFixed(1)}%`} ·{" "}
            {fmtUsd(pick.notional)}
          </div>
        </div>
      </div>

      {/* ── Counter-thesis ─────────────────────────────────────────────── */}
      {pick.counter_thesis && (
        <>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
            Counter-thesis
          </div>
          <div
            className="rounded-[8px] border px-4 py-3 text-[12.5px] leading-[1.6]"
            style={{
              background: "rgba(159, 23, 42, 0.08)",
              borderColor: "rgba(159, 23, 42, 0.3)",
              color: "var(--text-primary)",
            }}
          >
            {pick.counter_thesis}
          </div>
        </>
      )}

      {/* ── Thesis ─────────────────────────────────────────────────────── */}
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
          Time horizon:{" "}
          <span className="num text-text-secondary">{pick.time_horizon}</span>
        </div>
      )}
    </DerivationDrawer>
  );
}
