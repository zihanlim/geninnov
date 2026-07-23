"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DerivationDrawer from "./DerivationDrawer";
import CitationList, { Citation } from "./CitationList";

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
}

function fmt(n: number | null | undefined, digits = 2, fallback = "—") {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return n.toFixed(digits);
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
  const [bookHypeSum, setBookHypeSum] = useState<number | null>(null);
  const [capInfo, setCapInfo] = useState<{
    sectorMembers: number;
    geoMembers: number;
  } | null>(null);

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
              .select("run_date, hype_score, avg_sentiment")
              .eq("theme_id", pick.theme_id)
              .order("run_date", { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("scoring_config").select("param_name, value"),
        // The candidate set the weight was normalised over.
        supabase
          .from("portfolio_positions")
          .select("asset, hype_score, run_date")
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

      const book = ((bookRes.data ?? []) as {
        asset: string;
        hype_score: number | null;
        run_date: string;
      }[]).filter((r) => !runDate || r.run_date === runDate);
      setBookHypeSum(
        book.length
          ? book.reduce((s, r) => s + Math.max(r.hype_score ?? 0, 0) / 100, 0)
          : null
      );
      setCapInfo(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pick]);

  if (!pick) return null;

  const isLong = pick.direction === "long";
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

  // ── Sizing ────────────────────────────────────────────────────────────────
  const rawWeight = hype !== null ? Math.max(hype, 0) / 100 : null;
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
        TradeScore
      </div>
      <div className="text-[11.5px] text-text-tertiary mb-3 leading-[1.6]">
        <code className="num">
          {wHype.toFixed(2)} × HypeMomentum + {wSent.toFixed(2)} × Sentiment
        </code>
        <br />
        Weights read live from <code className="num">scoring_config</code>.
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

      {/* ── Direction ──────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Direction rule
      </div>
      <div className="text-[12.5px] text-text-secondary leading-[1.6]">
        TradeScore <span className="num">{fmt(ts)}</span> {isLong ? "> 0" : "< 0"} →{" "}
        <span className="text-text-primary font-semibold">
          {isLong ? "LONG" : "SHORT"}
        </span>
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
              screen keeps the highest-HypeScore entry per (asset, direction).
              Other tickers for this theme: {otherAssets.join(", ")}.
            </span>
          </>
        )}
      </div>

      {/* ── Sizing ─────────────────────────────────────────────────────── */}
      <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mt-6 mb-2">
        Position sizing
      </div>
      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          <span className="text-text-primary font-semibold">1. Raw weight</span> =
          HypeScore / 100 ={" "}
          <span className="num">{rawWeight === null ? "—" : fmt(rawWeight, 3)}</span>
        </div>
        <div className="px-4 py-3 border-b border-border text-[12px] text-text-secondary leading-[1.6]">
          <span className="text-text-primary font-semibold">2. Normalise</span>{" "}
          across the sized candidate set
          {bookHypeSum !== null ? (
            <>
              {" "}
              (Σ raw weights = <span className="num">{fmt(bookHypeSum, 3)}</span>)
            </>
          ) : (
            <span className="text-text-tertiary">
              {" "}
              — candidate set unavailable, so the normalising denominator cannot
              be shown
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
              background: "rgba(248, 81, 73, 0.08)",
              borderColor: "rgba(248, 81, 73, 0.3)",
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
