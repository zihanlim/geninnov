"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  horizonStatus,
  isValidated,
  isMeasuredThin,
} from "@/lib/method/hypeValidation";

// Honest signal-validation status. HypeScore measures ATTENTION; whether attention
// predicts returns is an empirical question the IC backtest (scripts/backtest_hype.py)
// answers. This surfaces the latest run so the platform says plainly what is
// validated vs asserted — the standing critique's #1 gap. When the news-mention
// history is still too thin to compute an IC, we show exactly that, never a number
// we don't have.

interface BtRow {
  metric_name: string;
  realized_value: number | null;
  end_date: string;
  notes: string | null;
}

interface HorizonStat {
  h: number;
  ic: number | null;
  nObs: number | null;
  nDates: number | null;
  icIr: number | null;
  hitRate: number | null;
}

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {};
  try {
    return JSON.parse(n);
  } catch {
    return {};
  }
}

export default function SignalValidation() {
  const [stats, setStats] = useState<HorizonStat[] | null>(null);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("backtest_results")
      .select("metric_name, realized_value, end_date, notes")
      .eq("test_name", "hype_ic")
      .order("end_date", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        const rows = (data ?? []) as BtRow[];
        const latest = rows[0]?.end_date ?? null;
        setRunDate(latest);
        // Latest run only; one row per horizon metric (mean_ic_h1/5/20).
        const byMetric = new Map<string, BtRow>();
        for (const r of rows.filter((r) => r.end_date === latest)) {
          if (!byMetric.has(r.metric_name)) byMetric.set(r.metric_name, r);
        }
        const out: HorizonStat[] = [1, 5, 20].map((h) => {
          const r = byMetric.get(`mean_ic_h${h}`);
          const notes = parseNotes(r?.notes ?? null);
          return {
            h,
            ic: r?.realized_value ?? null,
            nObs: (notes.n_obs as number) ?? null,
            nDates: (notes.n_dates as number) ?? null,
            icIr: (notes.ic_ir as number) ?? null,
            hitRate: (notes.hit_rate as number) ?? null,
          };
        });
        setStats(out);
      });
  }, []);

  const anyObs = (stats ?? []).some((s) => (s.nObs ?? 0) > 0);
  // validated / measuredThin live in lib/method/hypeValidation.ts and are unit-tested:
  // the failure mode they guard (a single-date IC read as validation) is exactly the
  // kind of confident-but-wrong number this codebase keeps removing.
  const validated = isValidated(stats ?? []);
  const measuredThin = isMeasuredThin(stats ?? []);

  return (
    <section className="mb-7" id="signal-validation">
      <h2 className="text-[18px] font-semibold m-0 mb-1.5">
        Does HypeScore actually predict returns?
      </h2>
      <p className="m-0 mb-4 text-[13.5px] text-text-secondary leading-[1.65] max-w-[76ch]">
        HypeScore measures <em>attention</em>, not mispricing — a theme can be loud
        and still go nowhere. Whether attention predicts forward returns is an
        empirical question, answered by the rank information coefficient (IC): the
        Spearman correlation between HypeScore and the theme asset&rsquo;s forward
        return at 1 / 5 / 20 trading days. A <span className="num">+</span> IC means
        attention has momentum (chase it); a <span className="num">−</span> IC means
        it mean-reverts (crowding — fade it, which is what the EdgeScore sentiment
        tilt already assumes). The harness is{" "}
        <code className="num">scripts/backtest_hype.py</code>.
      </p>

      <div className="card">
        <div className="card-header flex-wrap gap-2">
          <span className="card-title">HypeScore IC · decay curve</span>
          <span className="text-[11px] text-text-tertiary num">
            {runDate ? `last run ${runDate}` : ""}
          </span>
        </div>
        <div className="overflow-x-auto min-w-0">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Horizon", "Rank IC", "IC IR", "Hit rate", "N obs", "Status"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-[14px] py-2.5 text-[10.5px] uppercase tracking-[0.09em] text-text-tertiary font-medium border-b border-border-strong bg-bg-elevated ${
                        i === 0 || i === 5 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {stats === null ? (
                <tr>
                  <td colSpan={6} className="px-[14px] py-4">
                    <div className="skeleton h-[20px]" />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-[14px] py-4 text-text-tertiary text-[12.5px]">
                    Could not read <code className="num">backtest_results</code>: {error}
                  </td>
                </tr>
              ) : (
                stats.map((s) => (
                  <tr key={s.h}>
                    <td className="px-[14px] py-2.5 border-b border-border num">
                      {s.h}d
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num font-semibold">
                      {s.ic === null ? "—" : `${s.ic >= 0 ? "+" : ""}${s.ic.toFixed(4)}`}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                      {s.icIr == null ? "—" : s.icIr.toFixed(2)}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                      {s.hitRate == null ? "—" : `${(s.hitRate * 100).toFixed(0)}%`}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-right num text-text-secondary">
                      {s.nObs ?? "—"}
                    </td>
                    <td className="px-[14px] py-2.5 border-b border-border text-text-secondary text-[11.5px]">
                      {(() => {
                        switch (horizonStatus(s)) {
                          case "validated":
                            return "measured";
                          case "measured-thin":
                            return `measured · ${s.nDates ?? 1} date${(s.nDates ?? 1) === 1 ? "" : "s"} — not yet stable`;
                          case "too-few-names":
                            return "too few names to rank";
                          default:
                            return "no forward window yet";
                        }
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          {validated ? (
            <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
              Read the sign and the IC information ratio (mean/σ across dates) above —
              a stable non-zero IC is what makes HypeScore a signal rather than a
              heuristic.
            </p>
          ) : (
            <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
              <span className="text-warning font-semibold">
                Not yet validated — and we say so.
              </span>{" "}
              {measuredThin ? (
                <>
                  The IC above is a <strong>single-date point estimate</strong> — one
                  rank correlation across the day&rsquo;s themes, not a stable signal.
                  The IC information ratio (mean/σ across dates) is undefined until
                  there are at least two independent cross-sections, and that
                  cross-date stability is the whole bar for calling HypeScore a signal.
                  So the number is shown for what it is and no more.{" "}
                </>
              ) : (
                <>
                  HypeScore is built on news-mention history the daily pipeline has
                  only just begun accruing, so there is not yet a run-date with a
                  forward price window to correlate against
                  {anyObs ? "" : " (0 usable observations)"}.{" "}
                </>
              )}
              Until this table shows a stable IC across dates, HypeScore is an{" "}
              <em>attention heuristic</em>, used for idea generation and{" "}
              <strong>not</strong> as a return forecast — direction and sizing come
              from EdgeScore, whose components <em>are</em> IC-tested (carry rank IC{" "}
              <span className="num">+0.277</span>, t=2.77,{" "}
              <a href="/method#edgescore" className="text-accent hover:underline">
                see EdgeScore
              </a>
              ). The harness re-runs as history grows; the moment N is sufficient this
              table fills in on its own.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
