// frontend/lib/risk/analytics.ts
//
// Types + pure helpers for the /risk page.
//
// Every shape here mirrors what the L5 agent persists in
// `research_recommendations` (migration 022_book_analytics_surface.sql) and what
// L4 writes to `portfolio_risk` / `portfolio_returns`. Nothing in this module
// invents a value: when a field is absent the helpers return `null` and the UI
// is expected to render an explicit unavailable state naming the missing
// table.column.

// ─────────────────────────────────────────────────────────────────────────────
// Persisted shapes
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "low" | "moderate" | "high" | "severe";

/** research_recommendations.scenario_results[] — scenario_analysis.run_scenario_analysis */
export interface ScenarioResult {
  scenario_name: string;
  label: string;
  /** One-line description of what the shock assumes. May be "" on older rows. */
  description?: string | null;
  /** {factor: return_shock_as_decimal}, e.g. {"mkt": -0.18}. */
  factor_shocks?: Record<string, number> | null;
  /** Decimal, e.g. -0.048 = -4.8%. */
  estimated_book_return: number;
  /** Already denominated in $M by the backend (ScenarioResult.estimated_dollar_pnl). */
  estimated_dollar_pnl: number;
  severity: string;
  /** Preformatted per-position rows, e.g. "  TLT (long): +8.0% × +4% = +0.32%". */
  contribution_breakdown?: string[] | null;
}

/** research_recommendations.correlation_pairs[] — book_metrics.compute_correlation_matrix */
export interface CorrelationPair {
  asset_a: string;
  asset_b: string;
  corr: number;
  relationship?: string | null;
  threshold?: number | null;
}

/** One row of research_recommendations.cap_utilisation.{single_name|sector|geo} */
export interface CapRow {
  key: string;
  weight: number;
  cap: number;
  utilisation: number;
  breached?: boolean | null;
}

/** research_recommendations.cap_utilisation — book_metrics.cap_utilisation */
export interface CapUtilisation {
  single_name?: CapRow[] | null;
  sector?: CapRow[] | null;
  geo?: CapRow[] | null;
  limits?: {
    single_name?: number | null;
    sector?: number | null;
    geo?: number | null;
  } | null;
  violations?: string[] | null;
}

export interface FactorTilts {
  beta_mkt?: number | null;
  beta_smb?: number | null;
  beta_hml?: number | null;
  beta_rmw?: number | null;
  beta_cma?: number | null;
  beta_umd?: number | null;
}

/** research_recommendations.book_metrics — book_metrics.book_metrics_to_dict */
export interface BookMetrics {
  computed?: boolean | null;
  factor_tilts?: FactorTilts | null;
  gross_exposure?: number | null;
  net_exposure?: number | null;
  long_weight?: number | null;
  short_weight?: number | null;
  sector_weights?: Record<string, number> | null;
  geo_weights?: Record<string, number> | null;
}

export interface ResearchAnalyticsRow {
  run_date: string | null;
  lens: string | null;
  scenario_results: ScenarioResult[] | null;
  correlation_pairs: CorrelationPair[] | null;
  cap_utilisation: CapUtilisation | null;
  book_metrics: BookMetrics | null;
}

/** portfolio_risk latest row. */
export interface RiskRow {
  run_date?: string | null;
  updated_at?: string | null;
  total_capital?: number | null;
  var_95?: number | null;
  cvar_95?: number | null;
  sharpe?: number | null;
  beta?: number | null;
  concentration_hhi?: number | null;
  numeric_derivations?: Record<string, unknown> | null;
}

/** portfolio_returns row. */
export interface ReturnRow {
  run_date: string;
  daily_return: number | null;
  cumulative_return: number | null;
  portfolio_value: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query failure + section state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Supabase/PostgREST failure, kept as data so the page can render it instead
 * of silently degrading to an empty list. Three production bugs (400/42703 on a
 * non-existent column, 404/PGRST205 on a non-existent table) survived for weeks
 * precisely because the frontend swallowed `res.error` and rendered `?? []`.
 */
export interface QueryFailure {
  table: string;
  columns: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export type AnalyticsState<T> =
  | { status: "loading" }
  | { status: "query_error"; failure: QueryFailure }
  | { status: "no_row" }
  | { status: "null_column"; runDate: string | null }
  | { status: "empty"; runDate: string | null }
  | { status: "ok"; value: T; runDate: string | null };

export interface AnalyticsSource {
  loading: boolean;
  /** Non-null when the select over the migration-022 columns was rejected. */
  failure: QueryFailure | null;
  /** True when `research_recommendations` has at least one row at all. */
  rowExists: boolean;
  runDate: string | null;
  row: ResearchAnalyticsRow | null;
}

export function classify<T>(
  src: AnalyticsSource,
  pick: (row: ResearchAnalyticsRow) => T | null | undefined,
  isEmpty: (value: T) => boolean,
): AnalyticsState<T> {
  if (src.loading) return { status: "loading" };
  if (src.failure) return { status: "query_error", failure: src.failure };
  if (!src.rowExists || !src.row) return { status: "no_row" };
  const value = pick(src.row);
  if (value === null || value === undefined) {
    return { status: "null_column", runDate: src.runDate };
  }
  if (isEmpty(value)) return { status: "empty", runDate: src.runDate };
  return { status: "ok", value, runDate: src.runDate };
}

/**
 * Copy for a section that has nothing to draw. Every branch names the exact
 * table.column that is missing and the command that fills it — "No data" is not
 * an acceptable terminal state for a tool a PM makes decisions with.
 */
export interface GapCopy {
  headline: string;
  detail: string;
  source: string;
  command?: string;
}

const REFRESH_CMD = "python -m scripts.daily_refresh";

export function explainGap(
  state: AnalyticsState<unknown>,
  opts: { column: string; emptyMeaning: string },
): GapCopy | null {
  const source = `research_recommendations.${opts.column}`;
  switch (state.status) {
    case "loading":
    case "ok":
      return null;
    case "query_error":
      return {
        headline: `Query rejected — ${state.failure.table} could not be read`,
        detail:
          `PostgREST returned ${state.failure.code ?? "an error"}: ${state.failure.message}. ` +
          (state.failure.code === "42703"
            ? "Code 42703 means the column does not exist: migration 022_book_analytics_surface.sql has not been applied to this database."
            : state.failure.code === "PGRST205"
              ? "Code PGRST205 means the table is not in the PostgREST schema cache — it does not exist, or the anon role cannot see it."
              : "The section below is blank because the read failed, not because the book is clean."),
        source: `${state.failure.table} (${state.failure.columns})`,
        command: "supabase db push  # apply pending migrations, then re-run the pipeline",
      };
    case "no_row":
      return {
        headline: "No recommendation run to analyse",
        detail:
          "The L5 Q1 agent writes one row per run to research_recommendations; the table currently has none, " +
          "so there is no book to report risk on.",
        source,
        command: REFRESH_CMD,
      };
    case "null_column":
      return {
        headline: `${source} is NULL`,
        detail:
          `A recommendation row exists${state.runDate ? ` for run_date ${state.runDate}` : ""}, but this column is NULL. ` +
          "That is what a row written before migration 022_book_analytics_surface.sql looks like — the agent computed " +
          "these analytics and discarded them. Re-running the pipeline repopulates the column.",
        source,
        command: REFRESH_CMD,
      };
    case "empty":
      return {
        headline: `${source} is present but empty`,
        detail: `${opts.emptyMeaning}${state.runDate ? ` Latest run_date: ${state.runDate}.` : ""}`,
        source,
        command: REFRESH_CMD,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters — percentages 2dp, dollars $X.XM, betas 2dp with explicit sign
// ─────────────────────────────────────────────────────────────────────────────

export const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** 0.0483 → "4.83%" */
export const fmtPct = (v: number | null | undefined): string =>
  isNum(v) ? `${(v * 100).toFixed(2)}%` : "—";

/** -0.048 → "-4.80%", 0.012 → "+1.20%" */
export const fmtSignedPct = (v: number | null | undefined): string =>
  isNum(v) ? `${v >= 0 ? "+" : "-"}${(Math.abs(v) * 100).toFixed(2)}%` : "—";

/** Value already in $M. -4.8 → "-$4.8M" */
export const fmtSignedMillions = (v: number | null | undefined): string =>
  isNum(v) ? `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(1)}M` : "—";

/** Raw USD → "$2.3M" */
export const fmtUsdAsMillions = (v: number | null | undefined): string =>
  isNum(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v / 1_000_000).toFixed(1)}M` : "—";

/** -0.34 → "-0.34", 0.9 → "+0.90" */
export const fmtSignedBeta = (v: number | null | undefined): string =>
  isNum(v) ? `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}` : "—";

export const fmtRatio = (v: number | null | undefined): string =>
  isNum(v) ? v.toFixed(2) : "—";

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  severe: 0,
  high: 1,
  moderate: 2,
  low: 3,
};

export function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity?.toLowerCase()] ?? 99;
}

/** Tailwind classes for a severity chip. `high` uses the same orange as the
 *  `stale` StatusBadge so the palette stays closed. */
export function severityChipClass(severity: string): string {
  switch ((severity ?? "").toLowerCase()) {
    case "severe":
      return "bg-short-dim text-short";
    case "high":
      return "bg-[#3a2615] text-[#f0883e]";
    case "moderate":
      return "bg-warning-dim text-warning";
    case "low":
      return "bg-bg-elevated text-text-secondary border border-border";
    default:
      return "bg-bg-elevated text-text-tertiary border border-border";
  }
}

/** Worst-first: most negative book return leads, severity breaks ties. */
export function sortWorstFirst(rows: ScenarioResult[]): ScenarioResult[] {
  return [...rows].sort((a, b) => {
    const ra = isNum(a.estimated_book_return) ? a.estimated_book_return : 0;
    const rb = isNum(b.estimated_book_return) ? b.estimated_book_return : 0;
    if (ra !== rb) return ra - rb;
    return severityRank(a.severity) - severityRank(b.severity);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation helpers
// ─────────────────────────────────────────────────────────────────────────────

const pairKey = (a: string, b: string): string => [a, b].sort().join(" ");

/** Sorted union of every asset named in the flagged pairs. */
export function assetsFromPairs(pairs: CorrelationPair[]): string[] {
  const set = new Set<string>();
  for (const p of pairs) {
    if (p.asset_a) set.add(p.asset_a);
    if (p.asset_b) set.add(p.asset_b);
  }
  return Array.from(set).sort();
}

/**
 * Lookup for the heatmap. Only flagged pairs are persisted, so any cell absent
 * from this map is genuinely unknown (|rho| below the threshold) — the grid must
 * render it as unknown, never as 0.
 */
export function correlationLookup(pairs: CorrelationPair[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of pairs) {
    if (p.asset_a && p.asset_b && isNum(p.corr)) {
      map.set(pairKey(p.asset_a, p.asset_b), p.corr);
    }
  }
  return map;
}

export function lookupCorr(
  map: Map<string, number>,
  a: string,
  b: string,
): number | undefined {
  return map.get(pairKey(a, b));
}

/** The threshold the backend actually used, if any pair carries it. */
export function thresholdFromPairs(pairs: CorrelationPair[]): number | null {
  for (const p of pairs) {
    if (isNum(p.threshold)) return p.threshold;
  }
  return null;
}

/**
 * Cell background. Positive = red (two positions moving together doubles a bet),
 * negative = green (the pair is acting as a hedge). Alpha tracks |rho| so the
 * eye ranks magnitude without reading every number.
 */
export function correlationCellColor(corr: number): string {
  const alpha = Math.min(Math.abs(corr), 1) * 0.55;
  return corr >= 0
    ? `rgba(248, 81, 73, ${alpha.toFixed(3)})`
    : `rgba(63, 185, 80, ${alpha.toFixed(3)})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cap utilisation
// ─────────────────────────────────────────────────────────────────────────────

export const CAP_WARN_UTILISATION = 0.8;

export function capBarColor(row: CapRow): string {
  if (row.breached || (isNum(row.utilisation) && row.utilisation > 1)) return "var(--short)";
  if (isNum(row.utilisation) && row.utilisation >= CAP_WARN_UTILISATION) return "var(--warning)";
  return "var(--accent)";
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawdown series
// ─────────────────────────────────────────────────────────────────────────────

export type CumMethod = "cumulative_return_column" | "compounded_daily_return";

export interface DrawdownPoint {
  date: string;
  /** Cumulative return as a decimal. */
  cum: number;
  /** 1 + cum. */
  value: number;
  /** value / running_peak - 1, always <= 0. */
  drawdown: number;
  daily: number | null;
}

export interface DrawdownSeries {
  method: CumMethod;
  points: DrawdownPoint[];
  maxDrawdown: number;
  currentDrawdown: number;
  best: { date: string; ret: number } | null;
  worst: { date: string; ret: number } | null;
  /** Rows dropped because both return columns were NULL. */
  skipped: number;
}

/**
 * Build the cumulative + drawdown series from portfolio_returns.
 *
 * Prefers the persisted `cumulative_return` column. Only if every row is NULL
 * there does it compound `daily_return`, and the caller is expected to surface
 * which method produced the chart. Returns null when neither column has a
 * single usable value — there is no honest curve to draw in that case.
 */
export function buildDrawdownSeries(rows: ReturnRow[]): DrawdownSeries | null {
  const sorted = [...rows]
    .filter((r) => typeof r.run_date === "string" && r.run_date.length > 0)
    .sort((a, b) => a.run_date.localeCompare(b.run_date));
  if (sorted.length === 0) return null;

  const haveCum = sorted.some((r) => isNum(r.cumulative_return));
  const haveDaily = sorted.some((r) => isNum(r.daily_return));
  if (!haveCum && !haveDaily) return null;

  const method: CumMethod = haveCum
    ? "cumulative_return_column"
    : "compounded_daily_return";

  const points: DrawdownPoint[] = [];
  let compounded = 1;
  let peak = 1;
  let skipped = 0;

  for (const r of sorted) {
    let cum: number | null = null;
    if (method === "cumulative_return_column") {
      cum = isNum(r.cumulative_return) ? r.cumulative_return : null;
    } else if (isNum(r.daily_return)) {
      compounded *= 1 + r.daily_return;
      cum = compounded - 1;
    }
    if (cum === null) {
      skipped += 1;
      continue;
    }
    const value = 1 + cum;
    peak = Math.max(peak, value);
    points.push({
      date: r.run_date,
      cum,
      value,
      drawdown: peak > 0 ? value / peak - 1 : 0,
      daily: isNum(r.daily_return) ? r.daily_return : null,
    });
  }

  if (points.length === 0) return null;

  let maxDrawdown = 0;
  let best: { date: string; ret: number } | null = null;
  let worst: { date: string; ret: number } | null = null;
  for (const p of points) {
    if (p.drawdown < maxDrawdown) maxDrawdown = p.drawdown;
    if (p.daily !== null) {
      if (best === null || p.daily > best.ret) best = { date: p.date, ret: p.daily };
      if (worst === null || p.daily < worst.ret) worst = { date: p.date, ret: p.daily };
    }
  }

  return {
    method,
    points,
    maxDrawdown,
    currentDrawdown: points[points.length - 1].drawdown,
    best,
    worst,
    skipped,
  };
}
