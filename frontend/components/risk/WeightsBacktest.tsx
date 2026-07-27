// What these weights would have done — which is not what we did.
//
// The caveats lead. That is deliberate and it is the whole design: a drawdown and a Sortino
// look identical whether they came from a live book or a simulation, and the only thing
// separating them is the sentence above the number. Putting that sentence below the table,
// or in a tooltip, would leave a reader with a track record they were never offered.
//
// The book is three sessions old, so every realised statistic on this page is withheld.
// This panel exists because the ex-ante figures — correct as they are — are distributional
// and say nothing about the PATH: drawdown depth, downside asymmetry, behaviour on days the
// market falls. It fills that gap with a stated method rather than with silence.

"use client";

import type { WeightsBacktestRow } from "@/lib/risk/analytics";
import { describeDownCapture } from "@/lib/risk/benchmarkReading";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="num text-[13px] mt-0.5">{children}</div>
    </div>
  );
}

export default function WeightsBacktest({ data }: { data?: WeightsBacktestRow | null }) {
  if (!data) {
    return (
      <section className="panel p-4" aria-label="Backtest of the published weights">
        <h3 className="text-[13px] font-semibold mb-1">These weights, over the past year</h3>
        <p className="text-[11.5px] text-text-tertiary leading-[1.55]">
          Not computed for this run — a gap in the pipeline, not a statement about how the
          book would have performed.
        </p>
      </section>
    );
  }

  if (data.computed === false) {
    return (
      <section className="panel p-4" aria-label="Backtest of the published weights" data-testid="weights-backtest">
        <h3 className="text-[13px] font-semibold mb-1">These weights, over the past year</h3>
        <p className="text-[11.5px] text-text-tertiary leading-[1.55]">
          {data.reason ??
            "The window could not support path statistics, so none were computed."}
        </p>
      </section>
    );
  }

  const down = describeDownCapture(data.benchmark?.down_capture, data.benchmark?.down_days);

  return (
    <section className="panel p-4" aria-label="Backtest of the published weights" data-testid="weights-backtest">
      <h3 className="text-[13px] font-semibold mb-1">These weights, over the past year</h3>

      {/* The caveats come FIRST. See the file header. */}
      <div
        className="rounded-md px-3 py-2.5 mb-3 border text-[11.5px] leading-[1.55]"
        style={{
          borderColor: "var(--warning)",
          background: "rgba(210, 153, 34, 0.08)",
          color: "var(--warning)",
        }}
        data-testid="backtest-caveat"
      >
        <strong>This is not a track record.</strong> It holds today&rsquo;s published weights
        fixed across {data.n_observations ?? "—"} sessions of the constituents&rsquo; own
        returns{data.window_start ? ` (${data.window_start} to ${data.window_end})` : ""}.{" "}
        {data.selection_caveat} {data.method_caveat} The forward record — picks scored
        against a horizon fixed <em>before</em> the outcome was knowable — is on{" "}
        <code className="num">/method</code>.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mb-3">
        <Stat label="Cumulative">
          {isNum(data.cumulative_return) ? signed(data.cumulative_return) : "—"}
        </Stat>
        <Stat label="Annualised">
          {isNum(data.annualised_return) ? signed(data.annualised_return) : "—"}
        </Stat>
        <Stat label="Volatility">
          {isNum(data.annualised_vol) ? pct(data.annualised_vol) : "—"}
        </Stat>
        <Stat label="Max drawdown">
          <span style={{ color: "var(--short)" }}>
            {isNum(data.max_drawdown) ? signed(data.max_drawdown) : "—"}
          </span>
        </Stat>
        <Stat label="Sharpe">{isNum(data.sharpe) ? data.sharpe.toFixed(2) : "—"}</Stat>
        <Stat label="Sortino">{isNum(data.sortino) ? data.sortino.toFixed(2) : "—"}</Stat>
        <Stat label="Calmar">{isNum(data.calmar) ? data.calmar.toFixed(2) : "—"}</Stat>
        <Stat label="VaR 95% (historical)">
          {isNum(data.var_95_historical) ? pct(data.var_95_historical) : "—"}
        </Stat>
      </div>

      {isNum(data.coverage_share) && data.coverage_share < 0.999 && (
        <p className="text-[11px] text-text-tertiary leading-[1.5] mb-2">
          Measured over <span className="num">{pct(data.coverage_share, 0)}</span> of book
          gross — {(data.dropped_assets ?? []).join(", ") || "some holdings"} could not be
          priced across the window and{" "}
          {(data.dropped_assets ?? []).length === 1 ? "was" : "were"} excluded rather than
          treated as flat. A path statistic over part of the book is not a path statistic
          about the book.
        </p>
      )}

      {down && (
        <p className="text-[11px] leading-[1.55] text-text-secondary" data-testid="backtest-down-capture">
          Against the benchmark over the same window: down-capture{" "}
          <span className="num">
            {isNum(data.benchmark?.down_capture) ? pct(data.benchmark!.down_capture!, 1) : "—"}
          </span>
          . {down.text}
        </p>
      )}
    </section>
  );
}
