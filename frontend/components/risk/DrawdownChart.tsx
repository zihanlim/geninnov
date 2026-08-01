// frontend/components/risk/DrawdownChart.tsx
//
// Cumulative return, drawdown-from-peak, and the daily return strip, drawn from
// portfolio_returns. Hand-rolled SVG on purpose: a strict CSP blocks CDN chart
// libraries and none is installed for this page.
//
// The series prefers the persisted `cumulative_return` column and only
// compounds `daily_return` when every row of the former is NULL — and it always
// says which method produced the curve.

"use client";

import {
  buildDrawdownSeries,
  fmtSignedPct,
  type DrawdownSeries,
  type QueryFailure,
  type ReturnRow,
} from "@/lib/risk/analytics";
import { Ident, SectionGap, SectionSkeleton } from "./SectionGap";

const W = 960;
const PAD_L = 56;
const PAD_R = 14;
const CUM_TOP = 14;
const CUM_H = 140;
const DD_TOP = 206;
const DD_H = 90;
const DAILY_TOP = 338;
const DAILY_H = 76;
const H_WITH_DAILY = 452;
const H_NO_DAILY = 320;

const PLOT_W = W - PAD_L - PAD_R;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_L + PLOT_W / 2;
  return PAD_L + (i / (n - 1)) * PLOT_W;
}

function makeScale(min: number, max: number, top: number, height: number) {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo;
  const padded = span === 0 ? 0.01 : span * 0.08;
  const dLo = lo - padded;
  const dHi = hi + padded;
  const range = dHi - dLo || 1;
  return {
    lo: dLo,
    hi: dHi,
    y: (v: number) => top + height - ((v - dLo) / range) * height,
  };
}

function PanelLabel({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      fill="var(--text-tertiary)"
      fontSize={11}
      letterSpacing="0.1em"
      style={{ textTransform: "uppercase" }}
    >
      {children}
    </text>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
        {label}
      </div>
      <div className={`num text-[15px] ${color ?? "text-text-primary"}`}>{value}</div>
    </div>
  );
}

function Chart({
  series,
  benchmark = [],
}: {
  series: DrawdownSeries;
  /** Already filtered to rows with a usable cumulative_return. Drawn only when
   *  it clears BENCHMARK_MIN_OBS — the caller decides, the chart just draws. */
  benchmark?: (BenchmarkRow & { cumulative_return: number })[];
}) {
  const pts = series.points;
  const n = pts.length;
  const hasDaily = pts.some((p) => p.daily !== null);
  const height = hasDaily ? H_WITH_DAILY : H_NO_DAILY;

  const cums = pts.map((p) => p.cum);
  const cumScale = makeScale(Math.min(...cums), Math.max(...cums), CUM_TOP, CUM_H);

  const dds = pts.map((p) => p.drawdown);
  const ddScale = makeScale(Math.min(...dds), 0, DD_TOP, DD_H);

  const dailies = pts.map((p) => p.daily).filter((d): d is number => d !== null);
  const dailyMax = dailies.length > 0 ? Math.max(...dailies.map(Math.abs)) : 0.01;
  const dailyScale = makeScale(-dailyMax, dailyMax, DAILY_TOP, DAILY_H);

  const cumLine = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i, n).toFixed(2)},${cumScale.y(p.cum).toFixed(2)}`)
    .join(" ");
  const cumArea =
    n > 1
      ? `${cumLine} L${xAt(n - 1, n).toFixed(2)},${cumScale.y(0).toFixed(2)} L${xAt(0, n).toFixed(2)},${cumScale.y(0).toFixed(2)} Z`
      : "";

  const ddLine = pts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xAt(i, n).toFixed(2)},${ddScale.y(p.drawdown).toFixed(2)}`,
    )
    .join(" ");
  const ddArea =
    n > 1
      ? `${ddLine} L${xAt(n - 1, n).toFixed(2)},${ddScale.y(0).toFixed(2)} L${xAt(0, n).toFixed(2)},${ddScale.y(0).toFixed(2)} Z`
      : "";

  // The reference curve, plotted on the SAME scale as the book's so the two are
  // actually comparable, and in the SAME ink. ADR-0085: --long sits 1.03:1 from
  // --accent and two AA-clearing inks are at most ~3.3:1 apart, so a second hue
  // would be indistinguishable desaturated and would also spend a semantic the
  // palette reserves for direction. The dash carries identity instead.
  const drawBenchmark = benchmark.length >= BENCHMARK_MIN_OBS;
  const bmLine = drawBenchmark
    ? benchmark
        .map(
          (b, i) =>
            `${i === 0 ? "M" : "L"}${xAt(i, benchmark.length).toFixed(2)},${cumScale
              .y(b.cumulative_return)
              .toFixed(2)}`,
        )
        .join(" ")
    : "";

  const last = pts[n - 1];
  const cumColor = last.cum >= 0 ? "var(--long)" : "var(--short)";
  const barWidth = n > 1 ? Math.max(Math.min(PLOT_W / n - 1, 10), 1) : 10;

  const firstDate = pts[0].date;
  const lastDate = last.date;
  const midDate = pts[Math.floor((n - 1) / 2)].date;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block w-full h-auto"
        style={{ minWidth: 620 }}
        role="img"
        aria-labelledby="dd-chart-title dd-chart-desc"
      >
        <title id="dd-chart-title">
          Cumulative return and drawdown from peak, {firstDate} to {lastDate}
        </title>
        <desc id="dd-chart-desc">
          {n} observations. Final cumulative return {fmtSignedPct(last.cum)}. Maximum
          drawdown {fmtSignedPct(series.maxDrawdown)}. Current drawdown{" "}
          {fmtSignedPct(series.currentDrawdown)}.
        </desc>

        {/* ── Panel 1: cumulative return ────────────────────────────────── */}
        <PanelLabel x={PAD_L} y={CUM_TOP - 2}>
          Cumulative return
        </PanelLabel>
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={cumScale.y(0)}
          y2={cumScale.y(0)}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
        <text
          x={PAD_L - 8}
          y={cumScale.y(0) + 3}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          0%
        </text>
        <text
          x={PAD_L - 8}
          y={CUM_TOP + 12}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          {fmtSignedPct(cumScale.hi)}
        </text>
        <text
          x={PAD_L - 8}
          y={CUM_TOP + CUM_H}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          {fmtSignedPct(cumScale.lo)}
        </text>
        {cumArea && <path d={cumArea} fill={cumColor} fillOpacity={0.14} />}
        <path d={cumLine} fill="none" stroke={cumColor} strokeWidth={1.75} />
        {/* Benchmark: dashed, same ink, no fill. Identity goes in a pinned
            end-label rather than a legend — a legend forces a colour lookup,
            and colour is exactly what is NOT distinguishing these two lines. */}
        {drawBenchmark && (
          <>
            <path
              d={bmLine}
              fill="none"
              stroke={cumColor}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              strokeOpacity={0.75}
            />
            <text
              x={(xAt(benchmark.length - 1, benchmark.length) + 4).toFixed(2)}
              y={(
                cumScale.y(benchmark[benchmark.length - 1].cumulative_return) + 3
              ).toFixed(2)}
              className="num"
              fontSize={9}
              fill="var(--text-tertiary)"
            >
              {benchmark[0]?.ticker ?? "^SPX"}
            </text>
          </>
        )}
        {n === 1 && <circle cx={xAt(0, 1)} cy={cumScale.y(pts[0].cum)} r={3} fill={cumColor} />}

        {/* ── Panel 2: drawdown from peak ───────────────────────────────── */}
        <PanelLabel x={PAD_L} y={DD_TOP - 10}>
          Drawdown from peak
        </PanelLabel>
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={ddScale.y(0)}
          y2={ddScale.y(0)}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
        <text
          x={PAD_L - 8}
          y={ddScale.y(0) + 3}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          0%
        </text>
        <text
          x={PAD_L - 8}
          y={DD_TOP + DD_H}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          {fmtSignedPct(ddScale.lo)}
        </text>
        {ddArea && <path d={ddArea} fill="var(--short)" fillOpacity={0.22} />}
        <path d={ddLine} fill="none" stroke="var(--short)" strokeWidth={1.5} />
        {n === 1 && (
          <circle cx={xAt(0, 1)} cy={ddScale.y(pts[0].drawdown)} r={3} fill="var(--short)" />
        )}

        {/* ── Panel 3: daily returns ────────────────────────────────────── */}
        {hasDaily && (
          <>
            <PanelLabel x={PAD_L} y={DAILY_TOP - 10}>
              Daily return
            </PanelLabel>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={dailyScale.y(0)}
              y2={dailyScale.y(0)}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 8}
              y={DAILY_TOP + 10}
              textAnchor="end"
              fill="var(--text-tertiary)"
              fontSize={10}
            >
              {fmtSignedPct(dailyScale.hi)}
            </text>
            <text
              x={PAD_L - 8}
              y={DAILY_TOP + DAILY_H}
              textAnchor="end"
              fill="var(--text-tertiary)"
              fontSize={10}
            >
              {fmtSignedPct(dailyScale.lo)}
            </text>
            {pts.map((p, i) => {
              if (p.daily === null) return null;
              const zero = dailyScale.y(0);
              const y = dailyScale.y(p.daily);
              return (
                <rect
                  key={p.date}
                  x={xAt(i, n) - barWidth / 2}
                  y={Math.min(y, zero)}
                  width={barWidth}
                  height={Math.max(Math.abs(zero - y), 0.75)}
                  fill={p.daily >= 0 ? "var(--long)" : "var(--short)"}
                  fillOpacity={0.75}
                />
              );
            })}
          </>
        )}

        {/* ── X axis ────────────────────────────────────────────────────── */}
        <text x={PAD_L} y={height - 6} fill="var(--text-tertiary)" fontSize={10}>
          {firstDate}
        </text>
        {n > 2 && (
          <text
            x={PAD_L + PLOT_W / 2}
            y={height - 6}
            textAnchor="middle"
            fill="var(--text-tertiary)"
            fontSize={10}
          >
            {midDate}
          </text>
        )}
        <text
          x={W - PAD_R}
          y={height - 6}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize={10}
        >
          {lastDate}
        </text>
      </svg>
    </div>
  );
}

/** The authoritative since-inception figure persisted by L4 to
 *  `portfolio_cumulative_return` — a growth factor (1.0073 = +0.73%) carrying its
 *  own provenance (inception date, how many daily returns compounded into it). */
export interface InceptionRow {
  as_of: string;
  inception_date: string;
  cumulative_value: number;
  daily_returns_count: number;
  compounded: boolean;
}

/** A row of `benchmark_returns` (migration 045, ADR-0094). */
export interface BenchmarkRow {
  run_date: string;
  ticker: string;
  /** NULL on the first observation — no prior close to difference against. */
  daily_return: number | null;
  /** Compounded from the BOOK's inception, so both curves share an origin. */
  cumulative_return: number | null;
  inception_date: string | null;
}

/**
 * Usable observations before a benchmark comparison is drawn at all.
 *
 * 60 to match the bar `/risk` already applies to Sharpe and Beta — a page that
 * refuses to publish a Sharpe from 3 sessions cannot coherently draw a
 * head-to-head curve from the same 3. Below it the chart states the count
 * instead, which is ADR-0058 applied to a comparison rather than to a cell.
 */
export const BENCHMARK_MIN_OBS = 60;

export function DrawdownChart({
  loading,
  rows,
  failure,
  inception = null,
  benchmark = [],
}: {
  loading: boolean;
  rows: ReturnRow[];
  failure: QueryFailure | null;
  /** Optional: the persisted since-inception row. Shown alongside the series so
   *  the authoritative number is read from the table rather than only re-derived
   *  here — and so the two can be reconciled in the open. */
  inception?: InceptionRow | null;
  /** Optional reference series (ADR-0094). Empty before migration 045 has run,
   *  which walks into the same gate as "too few points" and needs no branch. */
  benchmark?: BenchmarkRow[];
}) {
  const series = rows.length > 0 ? buildDrawdownSeries(rows) : null;

  // A row with a null cumulative_return is the series' first observation, which
  // has no prior close to difference against. It is a real row and not a usable
  // POINT, so it is filtered here rather than coerced to 0 — plotting it as flat
  // would invent a day the benchmark did not have (ADR-0066).
  const usableBenchmark = benchmark.filter(
    (b): b is BenchmarkRow & { cumulative_return: number } =>
      b.cumulative_return !== null && Number.isFinite(b.cumulative_return),
  );
  const benchmarkTicker = benchmark[0]?.ticker ?? "^SPX";

  const methodLabel =
    series?.method === "cumulative_return_column"
      ? "portfolio_returns.cumulative_return"
      : "compounded from portfolio_returns.daily_return";

  // Reconcile the persisted since-inception return against the series' last point.
  // Same number by construction; a divergence means a run wrote one and not the
  // other, which is worth seeing rather than silently preferring one.
  const persistedPct =
    inception && Number.isFinite(inception.cumulative_value)
      ? inception.cumulative_value - 1
      : null;
  const seriesPct = series?.points.length
    ? series.points[series.points.length - 1].cum
    : null;
  const divergence =
    persistedPct !== null && seriesPct !== null
      ? Math.abs(persistedPct - seriesPct)
      : null;

  return (
    <section className="card mb-6" aria-labelledby="risk-dd-heading">
      <div className="card-header">
        <h2 id="risk-dd-heading" className="card-title m-0">
          Drawdown &amp; daily P&amp;L
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {series
            ? `${series.points.length} session${series.points.length === 1 ? "" : "s"} · ${methodLabel}`
            : "portfolio_returns"}
        </span>
      </div>

      {loading ? (
        <SectionSkeleton height={280} />
      ) : failure ? (
        <SectionGap
          tone="error"
          copy={{
            headline: "Query rejected — portfolio_returns could not be read",
            detail:
              `PostgREST returned ${failure.code ?? "an error"}: ${failure.message}. ` +
              "The chart is blank because the read failed, not because the book is flat.",
            source: `portfolio_returns (${failure.columns})`,
            command: "supabase db push  # apply pending migrations, then re-run the pipeline",
          }}
        />
      ) : rows.length === 0 ? (
        <SectionGap
          copy={{
            headline: "No return history to chart",
            detail:
              "portfolio_returns has no rows. L4 appends one row per session from " +
              "scripts/daily_refresh.py; until the pipeline has run at least twice there is no " +
              "series to compute a peak or a drawdown from.",
            source: "portfolio_returns",
            command: "python -m scripts.daily_refresh",
          }}
        />
      ) : !series ? (
        <SectionGap
          copy={{
            headline: "Return rows exist, but carry no usable return",
            detail: `${rows.length} row${rows.length === 1 ? "" : "s"} found, and every one has NULL in both cumulative_return and daily_return. There is no honest curve to draw from NULLs, so nothing is plotted. Re-running the pipeline recomputes both columns.`,
            source: "portfolio_returns.cumulative_return, portfolio_returns.daily_return",
            command: "python -m scripts.daily_refresh",
          }}
        />
      ) : (
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <Stat
              label="Cumulative"
              value={fmtSignedPct(series.points[series.points.length - 1].cum)}
              color={
                series.points[series.points.length - 1].cum >= 0
                  ? "text-long"
                  : "text-short"
              }
            />
            <Stat
              label="Max drawdown"
              value={fmtSignedPct(series.maxDrawdown)}
              color={series.maxDrawdown < 0 ? "text-short" : "text-text-primary"}
            />
            <Stat
              label="Current drawdown"
              value={fmtSignedPct(series.currentDrawdown)}
              color={series.currentDrawdown < 0 ? "text-short" : "text-text-primary"}
            />
            <Stat
              label="Best day"
              value={series.best ? fmtSignedPct(series.best.ret) : "—"}
              color={series.best ? "text-long" : "text-text-tertiary"}
            />
            <Stat
              label="Worst day"
              value={series.worst ? fmtSignedPct(series.worst.ret) : "—"}
              color={series.worst ? "text-short" : "text-text-tertiary"}
            />
            <Stat label="Sessions" value={`${series.points.length}`} />
          </div>

          {inception && persistedPct !== null && (
            <p className="m-0 mb-3 text-[12px] text-text-secondary leading-[1.6] max-w-[95ch]">
              <span className="text-text-tertiary">Since inception (persisted):</span>{" "}
              <span
                className={`num font-semibold ${persistedPct >= 0 ? "text-long" : "text-short"}`}
              >
                {fmtSignedPct(persistedPct)}
              </span>{" "}
              — compounded from {inception.daily_returns_count} daily return
              {inception.daily_returns_count === 1 ? "" : "s"} since{" "}
              <span className="num">{inception.inception_date}</span>, as of{" "}
              <span className="num">{inception.as_of}</span>. Source{" "}
              <Ident>portfolio_cumulative_return</Ident> — L4&rsquo;s authoritative
              figure, read rather than re-derived.
              {divergence !== null && divergence > 0.0005 && (
                <span className="text-warning">
                  {" "}
                  The series above ends at {fmtSignedPct(seriesPct ?? 0)} — a{" "}
                  {(divergence * 100).toFixed(2)}pp divergence, which means a run wrote
                  one and not the other. Trust the persisted figure and re-run the
                  pipeline.
                </span>
              )}
            </p>
          )}

          {series.points.length === 1 && (
            <p className="m-0 mb-3 text-[12px] text-warning leading-[1.6] max-w-[90ch]">
              Only one usable observation. A line needs two points, so the single value
              is drawn as a dot and the drawdown is measured against inception rather
              than a realised peak.
            </p>
          )}

          <Chart series={series} benchmark={usableBenchmark} />

          {/* The comparison states itself when it is withheld. "Versus what?" is
              the reader's next question and silence answers it wrongly — they
              would conclude no reference exists rather than that one exists and
              is too short to mean anything. */}
          {usableBenchmark.length < BENCHMARK_MIN_OBS && (
            /* One sentence. An earlier draft spent three explaining why a line
               is absent, which is more words than the chart itself carries —
               the reader needs the fact and the count, not the argument. */
            <p className="m-0 mt-2 text-[11px] text-text-tertiary leading-[1.6] max-w-[95ch]">
              No {benchmarkTicker} benchmark drawn —{" "}
              <strong>{usableBenchmark.length}</strong> usable observation
              {usableBenchmark.length === 1 ? "" : "s"} against the{" "}
              {BENCHMARK_MIN_OBS} a Sharpe needs.{" "}
              <Ident>benchmark_returns.cumulative_return</Ident>
            </p>
          )}

          <p className="m-0 mt-3 pt-3 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[95ch]">
            Cumulative series taken from <Ident>{methodLabel}</Ident>. Drawdown is
            value ÷ running peak − 1, with the peak seeded at inception (1.00), so the
            first observation can itself be a drawdown.
            {series.skipped > 0 && (
              <>
                {" "}
                {series.skipped} row{series.skipped === 1 ? " was" : "s were"} skipped for
                carrying no usable return; they are omitted rather than interpolated.
              </>
            )}
            {series.best === null && series.worst === null && (
              <>
                {" "}
                Best/worst day are unavailable because{" "}
                <Ident>portfolio_returns.daily_return</Ident> is NULL on every row.
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
