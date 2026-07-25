"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { slopeToBps } from "@/lib/regimeUnits";
import { DisclosureChevron } from "@/components/DisclosureChevron";

/**
 * Expandable panel that shows the 6 macro inputs that drove the current regime
 * classification, with their values, threshold, and which classification they
 * influence (cycle vs. sentiment).
 *
 * The 6 inputs are the exact fields in the regime_classifier backend
 * (regime_classifier.py):
 *   - yield_curve_slope   (cycle)
 *   - hy_oas              (cycle + sentiment)
 *   - real_rate           (cycle)
 *   - vix_level           (sentiment)
 *   - vix_term_diff       (sentiment)
 *   - spx_breadth         (sentiment)
 */
interface Props {
  /** Date of the regime classification to fetch. Defaults to most recent. */
  runDate?: string;
}

interface RegimeRow {
  yield_curve_slope: number | null;
  hy_oas: number | null;
  vix_level: number | null;
  vix_term_diff: number | null;
  real_rate: number | null;
  spx_breadth: number | null;
  cycle: string;
  sentiment: string;
  run_date: string;
}

interface InputRow {
  key: keyof RegimeRow;
  label: string;
  source: string;
  value: number | null;
  unit: string;
  /** Decimal places for the value. Defaults to 2; 0 for basis-point rows. */
  digits?: number;
  influences: ("cycle" | "sentiment")[];
  threshold: string;
  direction: "higher=worse" | "higher=better" | "context-only";
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function arrow(n: number | null | undefined, dir: InputRow["direction"]) {
  if (n === null || n === undefined) return null;
  if (dir === "context-only") return null;
  // Simple heuristic: very high values in 'higher=worse' inputs are "tight"
  if (dir === "higher=worse") {
    if (n > 30) return { glyph: "▲", color: "var(--short)" };
    return { glyph: "·", color: "var(--text-tertiary)" };
  }
  if (n < 0) return { glyph: "▼", color: "var(--short)" };
  return { glyph: "·", color: "var(--text-tertiary)" };
}

export default function RegimeInputsPanel({ runDate }: Props) {
  const [row, setRow] = useState<RegimeRow | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = supabase
        .from("regime_classifications")
        .select(
          "yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth, cycle, sentiment, run_date"
        )
        .order("run_date", { ascending: false })
        .limit(1);
      if (runDate) q.eq("run_date", runDate);
      const { data } = await q.maybeSingle();
      if (cancelled) return;
      setRow((data as RegimeRow) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [runDate]);

  const inputs: InputRow[] = [
    {
      key: "yield_curve_slope",
      label: "10y-2y slope",
      source: "FRED · DGS10 − DGS2",
      // Persisted in percentage points (DGS10−DGS2 = 0.36). The curve is quoted
      // in basis points and the threshold below is in bps, so scale to bps
      // (0.36 → 36). Rendering it raw printed "0.36 bp" against a ">200" threshold.
      value: slopeToBps(row?.yield_curve_slope),
      unit: "bp",
      digits: 0,
      influences: ["cycle"],
      threshold: "inverted (≤ 0) → late/recession; steep (>200) → early",
      direction: "context-only",
    },
    {
      key: "hy_oas",
      label: "HY OAS",
      source: "FRED · BAMLH0A0HYM2",
      // FRED reports OAS in percent (2.77 = 2.77% = 277bps). Keep it in percent
      // and state the unit; the thresholds are in percent to match, so the row no
      // longer read "2.77 bp" against a ">350" (bps) threshold.
      value: row?.hy_oas ?? null,
      unit: "%",
      influences: ["cycle", "sentiment"],
      threshold: ">5% → recession; >3.5% → caution; <3% → risk-on",
      direction: "higher=worse",
    },
    {
      key: "real_rate",
      label: "10y real rate",
      source: "FRED · DFII10",
      value: row?.real_rate ?? null,
      unit: "%",
      influences: ["cycle"],
      threshold: ">1.5% → late-cycle; <0 → early-cycle",
      direction: "context-only",
    },
    {
      key: "vix_level",
      label: "VIX spot",
      source: "yfinance · ^VIX",
      value: row?.vix_level ?? null,
      unit: "",
      influences: ["sentiment"],
      threshold: ">25 → risk-off; <15 → risk-on",
      direction: "higher=worse",
    },
    {
      key: "vix_term_diff",
      label: "VIX term diff",
      source: "yfinance · ^VIX − ^VIX3M",
      value: row?.vix_term_diff ?? null,
      unit: "pts",
      influences: ["sentiment"],
      threshold: "backwardation (≤ 0) → risk-off",
      direction: "context-only",
    },
    {
      key: "spx_breadth",
      label: "SPX breadth",
      source: "% of SPX above 200d MA",
      value: row?.spx_breadth ?? null,
      unit: "%",
      influences: ["sentiment"],
      threshold: "<50% → risk-off; >70% → risk-on",
      direction: "higher=better",
    },
  ];

  return (
    <div className="mt-3.5">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-accent hover:underline flex items-center gap-1"
        type="button"
      >
        {/* useState drives this one, not a <details>, so the caret takes `open`
            explicitly — there is no group-open selector to hang rotation on. */}
        <DisclosureChevron open={open} />
        {open ? "Hide" : "Show"} 6 inputs that drove this classification
      </button>
      {open && (
        <div
          className="mt-2.5 rounded-[8px] border border-border overflow-hidden"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="grid grid-cols-[1.6fr_1fr_1fr_1.2fr] text-[10px] uppercase tracking-[0.08em] text-text-tertiary px-3 py-2 border-b border-border bg-bg-surface">
            <div>Input</div>
            <div>Value</div>
            <div>Drives</div>
            <div>Threshold</div>
          </div>
          {inputs.map((inp) => {
            const a = arrow(inp.value, inp.direction);
            return (
              <div
                key={inp.key}
                className="grid grid-cols-[1.6fr_1fr_1fr_1.2fr] text-[12px] px-3 py-2 border-b border-border last:border-b-0 items-baseline"
              >
                <div>
                  <div className="text-text-primary font-semibold">{inp.label}</div>
                  <div className="text-text-tertiary text-[10.5px] mt-0.5 num">{inp.source}</div>
                </div>
                <div className="num text-text-primary">
                  {a && <span style={{ color: a.color, marginRight: 4 }}>{a.glyph}</span>}
                  {fmt(inp.value, inp.digits)}
                  <span className="text-text-tertiary ml-0.5">{inp.unit}</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {inp.influences.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] uppercase tracking-[0.06em] num px-1.5 py-0.5 rounded border border-border text-text-secondary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-text-secondary text-[11.5px] leading-[1.5]">{inp.threshold}</div>
              </div>
            );
          })}
          {row && (
            <div className="px-3 py-2 text-[10.5px] text-text-tertiary border-t border-border">
              Run date <span className="num">{row.run_date}</span> · Cycle: <span className="num">{row.cycle}</span> · Sentiment: <span className="num">{row.sentiment}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
