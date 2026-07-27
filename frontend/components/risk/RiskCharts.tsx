// frontend/components/risk/RiskCharts.tsx
//
// The five illustrations over the persisted quant layer. Each one reads a column
// that already exists and renders NOTHING when the column is absent — a chart is
// an illustration of a measurement, never a substitute for one.
//
// Two rules the first cut of this file broke, both worth stating because they are
// easy to re-break:
//
// 1. EVERY chart carries a value axis. A waterfall whose total is the book's
//    volatility, drawn with no tick labels, does not tell the reader the book's
//    volatility — it draws a shape. Values live in <title> tooltips too, but a
//    tooltip is hover-only and absent on touch, so it can never be the only copy.
//
// 2. `--long` (#126e53) against `--short` (#9f172a) measures ΔE 6.1 under
//    DEUTERANOPIA (validated, dataviz `validate_palette.js`) — inside the 6–8 band
//    that is legal only WITH secondary encoding. So wherever sign is carried by
//    those two tokens, a second channel carries it as well: a printed signed value
//    (stress rows), position above/below a baseline (waterfall, scatter y-axis), or
//    filled-vs-ring marks (scatter). Colour alone would make these charts
//    unreadable for ~5% of male readers.

"use client";

import type {
  MonteCarloVarRow,
  RiskDecompositionRow,
  ScenarioResult,
  VarForecastRow,
} from "@/lib/risk/analytics";

const WIDTH = 720;
const HEIGHT = 220;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 16;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 34;
const PLOT_WIDTH = WIDTH - PLOT_LEFT - PLOT_RIGHT;
const PLOT_HEIGHT = HEIGHT - PLOT_TOP - PLOT_BOTTOM;

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number, digits = 1) {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value * 100).toFixed(digits)}%`;
}

/** Unsigned, for axis ticks — a tick reading "+2.0%" on a loss axis is noise. */
function tick(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Rounded tick values across [min, max]; 1/2/5 × 10ⁿ steps. */
function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
  const out: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    out.push(Math.abs(value) < step * 1e-6 ? 0 : value);
  }
  return out;
}

function xScale(value: number, min: number, max: number) {
  return PLOT_LEFT + ((value - min) / (max - min || 1)) * PLOT_WIDTH;
}

function yScale(value: number, min: number, max: number) {
  return PLOT_TOP + PLOT_HEIGHT - ((value - min) / (max - min || 1)) * PLOT_HEIGHT;
}

function ChartFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid={label}>
      <h4 className="m-0 mb-2 text-[11px] uppercase tracking-[0.1em] text-text-secondary">
        {label}
      </h4>
      {children}
    </div>
  );
}

/** Legend row. HTML, not SVG <rect>, so a swatch never counts as a data mark. */
function Legend({
  items,
}: {
  items: Array<{ key: string; label: string; color?: string; ring?: boolean }>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-text-tertiary mt-1">
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          {item.color && (
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={
                item.ring
                  ? { border: `2px solid ${item.color}` }
                  : { background: item.color }
              }
            />
          )}
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export function MonteCarloDistributionChart({
  data,
}: {
  data?: MonteCarloVarRow | null;
}) {
  const points = (data?.histogram ?? []).filter(
    (point): point is { mid: number; density: number } =>
      isNum(point?.mid) && isNum(point?.density),
  );
  if (points.length < 2) return null;

  const rawMin = Math.min(...points.map((point) => point.mid));
  const rawMax = Math.max(...points.map((point) => point.mid));
  const min = Math.min(rawMin, 0);
  const max = Math.max(rawMax, 0);
  const densityMax = Math.max(...points.map((point) => point.density), 0.01);
  const halfStep = Math.abs(points[1].mid - points[0].mid) / 2;
  const zero = xScale(0, min, max);
  const PLOT_MAX_X = PLOT_LEFT + PLOT_WIDTH;
  // Bars are drawn from their BIN EDGES and clamped to the plot, rather than as a
  // fixed width centred on the midpoint. Centring overhung the axis by half a bar
  // at each end (~8px on the live 41-bin payload) and blew far outside the viewBox
  // on a coarse histogram — a 3-bin payload put the first bar at x = -128 of 720.
  const barEdges = (mid: number) => {
    const x0 = Math.min(Math.max(xScale(mid - halfStep, min, max), PLOT_LEFT), PLOT_MAX_X);
    const x1 = Math.min(Math.max(xScale(mid + halfStep, min, max), PLOT_LEFT), PLOT_MAX_X);
    return { x: x0, width: Math.max(1, x1 - x0 - 1) };
  };
  const bands = (data?.bands ?? []).filter(
    (band) => isNum(band?.confidence) && isNum(band?.var),
  );
  const densityTicks = niceTicks(0, densityMax, 3);

  return (
    <ChartFrame label="Simulated terminal-return distribution">
      <p className="m-0 mb-2 text-[11px] text-text-tertiary leading-[1.55]">
        {data?.horizon_days ?? 21}-day Student-t paths · {data?.n_sims?.toLocaleString() ?? "-"} simulations · every losing path shaded, VaR marks the tail
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Monte Carlo simulated terminal return distribution with loss paths shaded and VaR markers"
      >
        {densityTicks.map((value) => (
          <g key={`ytick-${value}`}>
            <line
              x1={PLOT_LEFT}
              x2={WIDTH - PLOT_RIGHT}
              y1={yScale(value, 0, densityMax)}
              y2={yScale(value, 0, densityMax)}
              stroke="var(--border)"
              opacity={value === 0 ? 1 : 0.5}
            />
            <text x={PLOT_LEFT - 5} y={yScale(value, 0, densityMax) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
              {tick(value)}
            </text>
          </g>
        ))}
        <text x={PLOT_LEFT - 5} y={PLOT_TOP - 5} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
          of paths
        </text>
        <line x1={zero} x2={zero} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_HEIGHT} stroke="var(--text-secondary)" strokeDasharray="3 3" />
        {points.map((point, pointIndex) => {
          const { x: barX, width: barWidth } = barEdges(point.mid);
          const barY = yScale(point.density, 0, densityMax);
          return (
            <rect
              key={`${point.mid}-${pointIndex}`}
              x={barX}
              y={barY}
              width={barWidth}
              height={PLOT_TOP + PLOT_HEIGHT - barY}
              fill={point.mid < 0 ? "var(--short)" : "var(--accent)"}
              opacity={point.mid < 0 ? 0.72 : 0.42}
            >
              <title>{`${pct(point.mid)} · ${(point.density * 100).toFixed(2)}% of paths`}</title>
            </rect>
          );
        })}
        {bands.map((band, bandIndex) => {
          const marker = xScale(-(band.var as number), min, max);
          const confidence = Math.round((band.confidence as number) * 100);
          // Stagger by INDEX. The old `confidence / 20` separated 95 from 99 by
          // 0.2px — a stagger that does not stagger, and two bands whose VaRs are
          // close in value would have collided outright.
          return (
            <g key={confidence}>
              <line x1={marker} x2={marker} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_HEIGHT} stroke="var(--warning)" strokeDasharray="4 3" />
              <text x={marker + 4} y={PLOT_TOP + 11 + bandIndex * 12} fill="var(--warning)" fontSize="10">
                VaR {confidence}% {pct(-(band.var as number))}
              </text>
            </g>
          );
        })}
        <text x={PLOT_LEFT} y={HEIGHT - 8} fill="var(--text-tertiary)" fontSize="10">{pct(min)}</text>
        <text x={zero - 10} y={HEIGHT - 8} fill="var(--text-tertiary)" fontSize="10">0%</text>
        <text x={WIDTH - PLOT_RIGHT - 28} y={HEIGHT - 8} fill="var(--text-tertiary)" fontSize="10">{pct(max)}</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-text-tertiary mt-1">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "var(--short)" }} />
          <span>losing paths</span>
        </span>
        {bands.map((band) => (
          <span key={`legend-${band.confidence}`} className="num">
            VaR {Math.round((band.confidence as number) * 100)}% {pct(-(band.var as number))}
            {isNum(band.es) ? ` · ES ${pct(-(band.es as number))}` : ""}
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

export function VarHorizonChart({
  data,
}: {
  data?: VarForecastRow | null;
}) {
  const bands = (data?.bands ?? [])
    .filter(
      (band): band is { horizon_days: number; quantiles: Record<string, number> } =>
        isNum(band?.horizon_days) && typeof band?.quantiles === "object" && band.quantiles !== null,
    )
    // Sorted defensively: the path is drawn in array order, so an out-of-order
    // payload would zig-zag rather than fan.
    .slice()
    .sort((left, right) => left.horizon_days - right.horizon_days);
  const values = bands
    .flatMap((band) => [band.quantiles.p90, band.quantiles.p95, band.quantiles.p99])
    .filter(isNum);
  if (bands.length < 2 || values.length === 0) return null;

  // Wider right margin than the shared constant: each line is DIRECT-LABELLED at
  // its right end, which is what makes the three readable without a colour lookup.
  const right = 44;
  const plotWidth = WIDTH - PLOT_LEFT - right;
  const minHorizon = Math.min(...bands.map((band) => band.horizon_days));
  const maxHorizon = Math.max(...bands.map((band) => band.horizon_days));
  const maxLoss = Math.max(...values, 0.01) * 1.12;
  const x = (value: number) =>
    PLOT_LEFT + ((value - minHorizon) / (maxHorizon - minHorizon || 1)) * plotWidth;
  const y = (value: number) => yScale(value, 0, maxLoss);

  // Emphasis, not three competing hues: p95 is the published figure, p90/p99 are
  // the context around it. The previous cut drew p90 and p99 in the SAME token at
  // different opacity, so the two were not tellable apart at all.
  const SERIES = [
    { key: "p90", color: "var(--text-tertiary)", width: 1.25 },
    { key: "p99", color: "var(--text-tertiary)", width: 1.25 },
    { key: "p95", color: "var(--accent)", width: 2 },
  ];
  const line = (key: string) =>
    bands
      .filter((band) => isNum(band.quantiles[key]))
      .map((band, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${x(band.horizon_days).toFixed(2)},${y(band.quantiles[key]).toFixed(2)}`)
      .join(" ");

  const lossTicks = niceTicks(0, maxLoss, 4);
  const scored = bands.find((band) => band.horizon_days === 21);
  const scoredP95 = scored && isNum(scored.quantiles.p95) ? scored.quantiles.p95 : null;

  return (
    <ChartFrame label="VaR horizon fan">
      <p className="m-0 mb-2 text-[11px] text-text-tertiary leading-[1.55]">
        Ex-ante parametric loss projection · square-root-of-time assumption · the{" "}
        <span className="num">21-day</span> horizon is the one <span className="num">pick_outcomes</span> scores against
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Parametric VaR loss projections across five holding horizons, p90 p95 and p99"
      >
        {lossTicks.map((value) => (
          <g key={`loss-${value}`}>
            <line x1={PLOT_LEFT} x2={WIDTH - right} y1={y(value)} y2={y(value)} stroke="var(--border)" opacity={value === 0 ? 1 : 0.5} />
            <text x={PLOT_LEFT - 5} y={y(value) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
              {tick(value)}
            </text>
          </g>
        ))}
        <text x={PLOT_LEFT - 5} y={PLOT_TOP - 5} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
          loss
        </text>
        {bands.map((band) => {
          const highlighted = band.horizon_days === 21;
          return (
            <g key={band.horizon_days}>
              <line x1={x(band.horizon_days)} x2={x(band.horizon_days)} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_HEIGHT} stroke={highlighted ? "var(--warning)" : "var(--border)"} strokeDasharray={highlighted ? "4 3" : "2 4"} />
              <text x={x(band.horizon_days) - 10} y={HEIGHT - 8} fill={highlighted ? "var(--warning)" : "var(--text-tertiary)"} fontSize="10">
                {band.horizon_days}d
              </text>
            </g>
          );
        })}
        {SERIES.map((series) => (
          <path key={series.key} d={line(series.key)} fill="none" stroke={series.color} strokeWidth={series.width} />
        ))}
        {SERIES.map((series) => {
          const last = [...bands].reverse().find((band) => isNum(band.quantiles[series.key]));
          if (!last) return null;
          return (
            <text
              key={`end-${series.key}`}
              x={x(last.horizon_days) + 5}
              y={y(last.quantiles[series.key]) + 3}
              fill={series.color}
              fontSize="10"
            >
              {series.key}
            </text>
          );
        })}
        {scoredP95 !== null && (
          <g>
            <circle cx={x(21)} cy={y(scoredP95)} r={3.5} fill="var(--accent)" />
            <text x={x(21) + 6} y={y(scoredP95) - 6} fill="var(--accent)" fontSize="10" className="num">
              {tick(scoredP95)}
            </text>
          </g>
        )}
      </svg>
      <Legend
        items={[
          { key: "p95", label: "p95 — the published figure", color: "var(--accent)" },
          { key: "ctx", label: "p90 / p99 — context", color: "var(--text-tertiary)" },
          { key: "h", label: "21d — scored horizon (ADR-0090)" },
        ]}
      />
    </ChartFrame>
  );
}

export function StressScenarioChart({
  scenarios,
}: {
  scenarios: ScenarioResult[];
}) {
  const rows = scenarios.filter((scenario) => isNum(scenario.estimated_book_return));
  if (rows.length < 2) return null;
  const maximum = Math.max(...rows.map((row) => Math.abs(row.estimated_book_return)), 0.01);
  const chartWidth = 520;
  const zero = chartWidth / 2;
  // Reserve only a hairline, not 90px. The signed value is printed in its own
  // grid column OUTSIDE the track, so the track never needed room for it — the
  // old reserve simply threw away a third of every bar's length.
  const barScale = (value: number) => (Math.abs(value) / maximum) * (chartWidth / 2 - 8);

  return (
    <ChartFrame label="Stress return profile">
      <p className="m-0 mb-2 text-[11px] text-text-tertiary leading-[1.55]">
        Independent what-if returns · not probability-weighted · worst first · widest bar = {tick(maximum)}
      </p>
      <div className="space-y-1.5" role="img" aria-label="Diverging bars for estimated stress scenario returns">
        {rows.map((scenario, rowIndex) => {
          const value = scenario.estimated_book_return;
          const width = barScale(value);
          const left = value < 0 ? zero - width : zero;
          return (
            <div key={`${scenario.scenario_name}-${rowIndex}`} className="grid grid-cols-[minmax(120px,1fr)_minmax(220px,2fr)_72px] items-center gap-2 text-[11px]">
              <span className="truncate text-text-secondary" title={scenario.label}>{scenario.label}</span>
              <div className="relative h-4 border-y border-border">
                <span className="absolute top-0 bottom-0 w-px" style={{ left: `${(zero / chartWidth) * 100}%`, background: "var(--text-tertiary)" }} />
                <span className="absolute top-0.5 h-3 rounded-sm" style={{ left: `${(left / chartWidth) * 100}%`, width: `${(width / chartWidth) * 100}%`, background: value < 0 ? "var(--short)" : "var(--long)", opacity: 0.82 }} />
              </div>
              {/* The printed signed value is the secondary encoding that makes the
                  red/green split legible under deuteranopia (ΔE 6.1). */}
              <span className={`num text-right ${value < 0 ? "text-short" : "text-long"}`}>{pct(value)}</span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

type ChartPosition = {
  asset: string;
  direction: "long" | "short";
  conviction: number | null;
};

export function PositionRiskScatter({
  positions,
  decomposition,
}: {
  positions: ChartPosition[];
  decomposition?: RiskDecompositionRow | null;
}) {
  const contributionByAsset = new Map(
    (decomposition?.positions ?? [])
      .filter((position) => typeof position.asset === "string" && isNum(position.contribution_to_vol))
      .map((position) => [position.asset, position.contribution_to_vol as number]),
  );
  const points = positions
    .filter((position) => isNum(position.conviction) && contributionByAsset.has(position.asset))
    .map((position) => ({
      ...position,
      contribution: contributionByAsset.get(position.asset) as number,
    }));
  if (points.length < 2) return null;
  const omitted = positions.length - points.length;

  const chartWidth = 620;
  const chartHeight = 240;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const maxConviction = Math.max(...points.map((point) => point.conviction as number), 1) * 1.1;
  // Domain from the DATA (with zero always in frame), not a forced ±max. Forcing
  // symmetry left the entire lower half blank on a book with no hedges, and
  // crushed every point into a band a third of the plot high.
  const contributions = points.map((point) => point.contribution);
  const rawLow = Math.min(0, ...contributions);
  const rawHigh = Math.max(0, ...contributions);
  const pad = Math.max((rawHigh - rawLow) * 0.15, 0.002);
  const low = rawLow - pad;
  const high = rawHigh + pad;
  const x = (value: number) => left + (value / maxConviction) * plotWidth;
  const y = (value: number) => top + plotHeight - ((value - low) / (high - low || 1)) * plotHeight;

  const riskTicks = niceTicks(low, high, 4);
  const convictionTicks = niceTicks(0, maxConviction, 4);

  // Greedy vertical de-collision so two names at the same risk level do not print
  // over each other (PDD and UNH did).
  const placed: Array<{ x: number; y: number }> = [];
  const labelY = (px: number, py: number) => {
    let candidate = py;
    for (let guard = 0; guard < 12; guard += 1) {
      const clash = placed.some(
        (seen) => Math.abs(seen.x - px) < 46 && Math.abs(seen.y - candidate) < 10,
      );
      if (!clash) break;
      candidate += 10;
    }
    placed.push({ x: px, y: candidate });
    return candidate;
  };

  return (
    <ChartFrame label="Position risk versus conviction">
      <p className="m-0 mb-2 text-[11px] text-text-tertiary leading-[1.55]">
        Covariance contribution to annualised volatility versus conviction · above the zero line adds risk, below it hedges
        {omitted > 0 ? ` · ${omitted} held name${omitted === 1 ? "" : "s"} absent from the decomposition and not plotted` : ""}
      </p>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" role="img" aria-label="Position risk contribution plotted against conviction, by direction">
        {riskTicks.map((value) => (
          <g key={`r-${value}`}>
            <line x1={left} x2={chartWidth - right} y1={y(value)} y2={y(value)} stroke="var(--border)" opacity={value === 0 ? 1 : 0.5} />
            <text x={left - 5} y={y(value) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">{tick(value)}</text>
          </g>
        ))}
        {convictionTicks.map((value) => (
          <text key={`c-${value}`} x={x(value)} y={chartHeight - 20} textAnchor="middle" fill="var(--text-tertiary)" fontSize="9">
            {value.toFixed(1)}×
          </text>
        ))}
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="var(--border)" />
        {points.map((point) => {
          const isShort = point.direction === "short";
          const color = isShort ? "var(--short)" : "var(--long)";
          return (
            <circle
              key={point.asset}
              cx={x(point.conviction as number)}
              cy={y(point.contribution)}
              r={4.5}
              // Filled for long, ring for short — the shape channel that has to
              // carry direction because the two tokens are ΔE 6.1 under deuteranopia.
              fill={isShort ? "var(--bg-surface)" : color}
              stroke={color}
              strokeWidth={2}
            >
              <title>{`${point.asset} · ${point.direction} · conviction ${(point.conviction as number).toFixed(1)}× · risk contribution ${pct(point.contribution)}`}</title>
            </circle>
          );
        })}
        {points.map((point) => (
          <text
            key={`label-${point.asset}`}
            x={x(point.conviction as number) + 7}
            y={labelY(x(point.conviction as number), y(point.contribution) + 3)}
            fill="var(--text-secondary)"
            fontSize="9"
          >
            {point.asset}
          </text>
        ))}
        <text x={left} y={chartHeight - 6} fill="var(--text-tertiary)" fontSize="10">conviction</text>
        <text x={left - 5} y={top - 5} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">risk</text>
      </svg>
      <Legend
        items={[
          { key: "long", label: "long", color: "var(--long)" },
          { key: "short", label: "short", color: "var(--short)", ring: true },
        ]}
      />
    </ChartFrame>
  );
}

export function RiskContributionWaterfall({
  decomposition,
}: {
  decomposition?: RiskDecompositionRow | null;
}) {
  const contributions = (decomposition?.positions ?? [])
    .filter((position) => typeof position.asset === "string" && isNum(position.contribution_to_vol))
    .map((position) => ({ asset: position.asset as string, value: position.contribution_to_vol as number }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  if (contributions.length < 2) return null;

  const width = 720;
  const height = 250;
  const left = 46;
  const right = 16;
  const top = 22;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const cumulative = [0];
  for (const contribution of contributions) cumulative.push(cumulative[cumulative.length - 1] + contribution.value);
  const total = cumulative[cumulative.length - 1];
  const minValue = Math.min(0, ...cumulative, total);
  const maxValue = Math.max(0, ...cumulative, total);
  const padding = Math.max((maxValue - minValue) * 0.12, 0.001);
  const minScale = minValue - padding;
  const maxScale = maxValue + padding;
  const y = (value: number) => top + plotHeight - ((value - minScale) / (maxScale - minScale || 1)) * plotHeight;
  // n + 2 slots, not n + 1: the total bar occupies a slot of its own. Dividing by
  // n + 1 put the total's CENTRE exactly on the right plot edge, so half of it
  // rendered outside the viewBox and was clipped (measured 683.5→724.5 of 720).
  const slot = plotWidth / (contributions.length + 2);
  const barWidth = Math.min(42, slot * 0.62);
  const totalCentre = left + slot * (contributions.length + 1);
  const valueTicks = niceTicks(minScale, maxScale, 4);

  return (
    <ChartFrame label="Signed risk-contribution waterfall">
      <p className="m-0 mb-2 text-[11px] text-text-tertiary leading-[1.55]">
        Euler contributions accumulate to the book&apos;s ex-ante annualised volatility of{" "}
        <span className="num text-text-secondary">{tick(total, 2)}</span> · bars below the running line reduce risk
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Signed position risk contribution waterfall ending at portfolio volatility">
        {valueTicks.map((value) => (
          <g key={`t-${value}`}>
            <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--border)" opacity={value === 0 ? 1 : 0.5} />
            <text x={left - 5} y={y(value) + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">{tick(value)}</text>
          </g>
        ))}
        <text x={left - 5} y={top - 6} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">vol</text>
        {contributions.map((contribution, contributionIndex) => {
          const start = cumulative[contributionIndex];
          const end = cumulative[contributionIndex + 1];
          const barX = left + slot * (contributionIndex + 1) - barWidth / 2;
          const barY = y(Math.max(start, end));
          const barHeight = Math.max(2, Math.abs(y(start) - y(end)));
          const nextCentre = left + slot * (contributionIndex + 2);
          return (
            <g key={contribution.asset}>
              <rect x={barX} y={barY} width={barWidth} height={barHeight} fill={contribution.value < 0 ? "var(--long)" : "var(--short)"} opacity="0.82">
                <title>{`${contribution.asset} · ${pct(contribution.value)} contribution · running total ${pct(end)}`}</title>
              </rect>
              {/* Connector runs to the TOTAL as well — the last position used to
                  end in mid-air beside a bar it visibly summed into. */}
              <line x1={barX + barWidth} x2={nextCentre - barWidth / 2} y1={y(end)} y2={y(end)} stroke="var(--border-strong)" strokeDasharray="2 2" />
              <text x={barX + barWidth / 2} y={height - 18} fill="var(--text-tertiary)" fontSize="9" textAnchor="middle">{contribution.asset}</text>
            </g>
          );
        })}
        <rect x={totalCentre - barWidth / 2} y={y(Math.max(0, total))} width={barWidth} height={Math.max(2, Math.abs(y(total) - y(0)))} fill="var(--accent)" opacity="0.9">
          <title>{`Portfolio ex-ante annualised volatility ${tick(total, 2)}`}</title>
        </rect>
        <text x={totalCentre} y={y(Math.max(0, total)) - 5} fill="var(--text-secondary)" fontSize="9.5" textAnchor="middle" className="num">
          {tick(total, 2)}
        </text>
        <text x={totalCentre} y={height - 18} fill="var(--text-secondary)" fontSize="9" textAnchor="middle">total</text>
      </svg>
      <Legend
        items={[
          { key: "adds", label: "adds risk", color: "var(--short)" },
          { key: "reduces", label: "reduces risk", color: "var(--long)" },
          { key: "total", label: "book volatility", color: "var(--accent)" },
        ]}
      />
    </ChartFrame>
  );
}
