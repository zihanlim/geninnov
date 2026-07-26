"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ScrollArea } from "@/components/ScrollArea";

/**
 * Does EdgeScore — the signal that actually decides the trades — predict returns?
 *
 * HypeScore has had a validation panel for a while. EdgeScore had none, which is the
 * wrong way round: HypeScore selects what we LOOK at, EdgeScore decides which side we
 * take and how hard. The harness (scripts/backtest_edge.py) existed and only ever
 * printed to a terminal, so nothing here could say whether the trade signal works.
 *
 * It reports what was measured, including the parts that look bad. On 2026-07-24
 * every testable component is positive and NONE is statistically significant, and
 * that is what this renders — a weak result stated plainly is worth more than a
 * strong one implied.
 */

interface BtRow {
  metric_name: string;
  realized_value: number | null;
  end_date: string;
  pass: boolean | null;
  notes: string | null;
}

interface Comp {
  name: string;
  ic: number | null;
  n: number | null;
  t: number | null;
  p: number | null;
  hit: number | null;
  testable: boolean;
  significant: boolean;
}

/** scoring_config key for each component, so weights are READ, never mirrored.
 *  A hardcoded copy would drift the moment someone tunes the config, and this panel
 *  exists to pair each IC with the weight it actually buys — a stale weight here
 *  would misstate exactly the thing it is meant to expose. */
const WEIGHT_KEY: Record<string, string> = {
  Trend: "edge_trend_weight",
  Regime: "edge_regime_weight",
  Carry: "edge_carry_weight",
  Value: "edge_value_weight",
  Sentiment: "edge_sentiment_weight",
};

const ORDER = ["Carry", "Regime", "Trend", "Value", "Sentiment"];

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {};
  try {
    return JSON.parse(n);
  } catch {
    return {};
  }
}

export default function EdgeValidation() {
  const [comps, setComps] = useState<Comp[] | null>(null);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number | null>(null);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("scoring_config")
      .select("param_name, value")
      .then(({ data }) => {
        const w: Record<string, number> = {};
        for (const r of (data ?? []) as { param_name: string; value: number }[]) {
          w[r.param_name] = Number(r.value);
        }
        setWeights(w);
      });
    supabase
      .from("backtest_results")
      .select("metric_name, realized_value, end_date, pass, notes")
      .eq("test_name", "edge_ic")
      .order("end_date", { ascending: false })
      .limit(40)
      .then(({ data, error: e }) => {
        if (e) {
          setError(e.message);
          return;
        }
        const rows = (data ?? []) as BtRow[];
        const latest = rows[0]?.end_date ?? null;
        setRunDate(latest);
        const seen = new Set<string>();
        const out: Comp[] = [];
        for (const r of rows.filter((x) => x.end_date === latest)) {
          if (seen.has(r.metric_name)) continue;
          seen.add(r.metric_name);
          const n = parseNotes(r.notes);
          if (typeof n.horizon_days === "number") setHorizon(n.horizon_days);
          out.push({
            name: (n.component as string) ?? r.metric_name,
            ic: r.realized_value,
            n: (n.n as number) ?? null,
            t: (n.t_stat as number) ?? null,
            p: (n.p_value as number) ?? null,
            hit: (n.hit_rate as number) ?? null,
            testable: (n.testable as boolean) ?? r.realized_value !== null,
            significant: r.pass === true,
          });
        }
        out.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
        setComps(out);
      });
  }, []);

  if (error) {
    return (
      <div className="card p-4 text-[12.5px] text-text-secondary">
        Could not read <code className="num">backtest_results</code>: {error}
      </div>
    );
  }
  if (!comps) return <div className="skeleton h-[200px]" />;

  if (comps.length === 0) {
    return (
      <div className="card p-4 text-[12.5px] text-text-secondary leading-[1.6]">
        No <code className="num">edge_ic</code> rows yet. Run{" "}
        <code className="num">scripts/backtest_edge.py</code>. Nothing is claimed here
        until it has.
      </div>
    );
  }

  const testable = comps.filter((c) => c.testable);
  const anySignificant = testable.some((c) => c.significant);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">EdgeScore component IC</span>
        <span
          className="num text-[11px]"
          style={{ color: anySignificant ? "var(--long)" : "var(--warning)" }}
        >
          {anySignificant
            ? `${testable.filter((c) => c.significant).length}/${testable.length} significant`
            : "measured · none significant"}
          {runDate ? ` · ${runDate}` : ""}
        </span>
      </div>

      <ScrollArea hint={false}>
        <table className="w-full border-collapse text-[12.5px] min-w-[640px]">
          <caption className="sr-only">
            Rank information coefficient of each EdgeScore component against forward
            returns, with sample size and significance.
          </caption>
          <thead>
            <tr className="border-y border-border-strong bg-bg-elevated">
              {["Component", "Weight", "IC", "N", "t", "p", "Hit", "Verdict"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`font-medium py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary ${
                      i === 0 ? "text-left px-[18px]" : i === 7 ? "text-left px-3" : "text-right px-3"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.name} className="border-b border-border last:border-b-0">
                <td className="px-[18px] py-2.5 font-medium">{c.name}</td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {weights && weights[WEIGHT_KEY[c.name]] !== undefined
                    ? weights[WEIGHT_KEY[c.name]].toFixed(2)
                    : "—"}
                </td>
                <td
                  className="px-3 py-2.5 num text-right font-medium"
                  style={{
                    color: !c.testable
                      ? "var(--text-tertiary)"
                      : (c.ic ?? 0) > 0
                        ? "var(--long)"
                        : "var(--short)",
                  }}
                >
                  {c.ic === null ? "—" : `${c.ic >= 0 ? "+" : ""}${c.ic.toFixed(4)}`}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.n ?? "—"}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.t === null ? "—" : `${c.t >= 0 ? "+" : ""}${c.t.toFixed(2)}`}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.p === null ? "—" : c.p.toFixed(3)}
                </td>
                <td className="px-3 py-2.5 num text-right text-text-secondary">
                  {c.hit === null ? "—" : `${(c.hit * 100).toFixed(1)}%`}
                </td>
                <td className="px-3 py-2.5 text-text-secondary">
                  {!c.testable ? (
                    <span className="text-text-tertiary">
                      not testable — needs per-theme history
                    </span>
                  ) : c.significant ? (
                    <span style={{ color: "var(--long)" }}>significant at p&lt;0.05</span>
                  ) : (
                    <span style={{ color: "var(--warning)" }}>
                      right sign, not significant
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      <div className="px-[18px] py-3 border-t border-border text-[12px] text-text-secondary leading-[1.65]">
        <p className="m-0 mb-2">
          <strong>What this says:</strong> every testable component points the right
          way and none of them clears conventional significance. Carry is the
          strongest and carries the largest weight
          {weights && weights[WEIGHT_KEY.Carry] !== undefined
            ? ` (${weights[WEIGHT_KEY.Carry].toFixed(2)})`
            : ""}
          , but at N=
          {testable.find((c) => c.name === "Carry")?.n ?? "—"} and p=
          {testable.find((c) => c.name === "Carry")?.p?.toFixed(3) ?? "—"} that is a
          prior, not a fitted result. The weights are deliberately{" "}
          <em>not</em> re-fitted on this evidence — re-weighting on p≈0.2 would be
          fitting noise.
        </p>
        <p className="m-0 text-text-tertiary text-[11px]">
          Rank IC (Spearman) against the forward {horizon ?? 21}-trading-day return,
          pooled over month-ends. Regime and Sentiment need per-theme history the
          daily job is still accruing, so they are not testable yet and are shown as
          such rather than as zero. Harness:{" "}
          <code className="num">scripts/backtest_edge.py</code> →{" "}
          <code className="num">backtest_results</code>. See{" "}
          <a href="#edgescore" className="text-accent hover:underline">
            EdgeScore
          </a>{" "}
          for what these components are and how they combine.
        </p>
      </div>
    </div>
  );
}
