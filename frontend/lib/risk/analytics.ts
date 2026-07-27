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
  /**
   * {sector: return_shock_as_decimal} — S6's transmission channel (ADR-0088).
   * Absent on every row written before S6 shipped, and empty on S1-S5, which
   * transmit through factor betas instead.
   */
  sector_shocks?: Record<string, number> | null;
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
  /** The published book. Only the assets are read here — /risk uses them to check
   *  that the positions it computes on are the names the book holds (ADR-0040). */
  picks?: Array<{ asset?: string | null }> | string | null;
  /** ADR-0096. Null on any run predating migration 045 — which means "not judged",
   *  never "no exposure". */
  sanctions_exposure?: SanctionsExposureRow | null;
  /** ADR-0097. Null on any run predating migration 046, or one where CFTC did not
   *  answer — which means "not retrieved", never "not crowded". */
  positioning_crowding?: PositioningCrowdingRow | null;
  /** ADR-0082, migration 038. Ex-ante, from the CONSTITUENTS' covariance — annualised, and
   *  emphatically not portfolio_risk.var_95. Persisted since 038 and rendered by nothing
   *  until now; the ADR itself recorded the render as pending. */
  risk_decomposition?: RiskDecompositionRow | null;
  /** ADR-0109, migration 047. Ex-ante, Student-t innovations, seeded. 21-day horizon. */
  monte_carlo_var?: MonteCarloVarRow | null;
  /** ADR-0109, migration 047. Square-root-of-time fan; the 21-day point matches the
   *  horizon pick_outcomes scores against (ADR-0090). */
  var_forecast?: VarForecastRow | null;
  /** ADR-0112, migration 048. Path statistics for the published weights held FIXED over
   *  252 days of constituent returns. NOT a track record — the weights were chosen
   *  knowing this window, and there is no rebalancing or cost. The forward record is
   *  `pick_outcomes` (ADR-0090). */
  weights_backtest?: WeightsBacktestRow | null;
}

/** `research_recommendations.weights_backtest` (migration 048). */
export interface WeightsBacktestRow {
  computed?: boolean | null;
  reason?: string | null;
  method_id?: string | null;
  n_observations?: number | null;
  min_sessions?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  coverage_share?: number | null;
  dropped_assets?: string[] | null;
  cumulative_return?: number | null;
  annualised_return?: number | null;
  annualised_vol?: number | null;
  sharpe?: number | null;
  sortino?: number | null;
  max_drawdown?: number | null;
  calmar?: number | null;
  var_95_historical?: number | null;
  es_95_historical?: number | null;
  best_day?: number | null;
  worst_day?: number | null;
  positive_days?: number | null;
  selection_caveat?: string | null;
  method_caveat?: string | null;
  is_track_record?: boolean | null;
  benchmark?: BenchmarkComparisonRow | null;
}

/** `research_recommendations.risk_decomposition` (migration 038). */
export interface RiskDecompositionRow {
  portfolio_vol?: number | null;
  portfolio_var?: number | null;
  confidence?: number | null;
  diversification_ratio?: number | null;
  n_observations?: number | null;
  dropped_assets?: string[] | null;
  positions?: Array<{
    asset?: string;
    signed_weight?: number;
    contribution_to_vol?: number;
    component_var?: number;
    risk_contribution_pct?: number;
  }> | null;
}

/** `research_recommendations.monte_carlo_var` (migration 047). */
export interface MonteCarloVarRow {
  horizon_days?: number | null;
  n_sims?: number | null;
  seed?: number | null;
  df?: number | null;
  prob_loss?: number | null;
  bands?: Array<{ confidence?: number; var?: number; es?: number }> | null;
  dropped_assets?: string[] | null;
}

/** `research_recommendations.var_forecast` (migration 047). */
export interface VarForecastRow {
  portfolio_volatility_daily?: number | null;
  portfolio_volatility_annual?: number | null;
  n_assets?: number | null;
  bands?: Array<{ horizon_days?: number; quantiles?: Record<string, number> }> | null;
  assumption?: string | null;
  method?: string | null;
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
  /** Migration 047. Historical/downside estimators computed BESIDE the parametric ones —
   *  never replacing them. The gap between `var_95` and `var_95_historical` measures how
   *  badly the Gaussian assumption fits this book, which is the reason they are two
   *  columns rather than one better value (ADR-0082, ADR-0109). Each is gated by
   *  `MIN_SESSIONS_BY_FIELD`; the empirical pair needs 100 sessions and Calmar a year. */
  var_95_historical?: number | null;
  es_95_historical?: number | null;
  sortino?: number | null;
  max_drawdown?: number | null;
  calmar?: number | null;
  tracking_error?: number | null;
  information_ratio?: number | null;
  /** ADR-0094 gave the book a benchmark; this is the MEASUREMENT of it rather than a
   *  second line on a chart. `down_capture` is the field that tests the book's own claim
   *  to be short the market — a book that rises when the benchmark falls captures LESS
   *  than none of a fall. */
  benchmark_comparison?: BenchmarkComparisonRow | null;
  /** EWMA + GARCH(1,1) on the book's own series. REPORTING ONLY — the conviction
   *  denominator still uses the trailing sample vol with the ADR-0047 floor. */
  conditional_vol?: ConditionalVolRow | null;
}

/** `portfolio_risk.benchmark_comparison` (migration 047). */
export interface BenchmarkComparisonRow {
  /** False when the comparison RAN and could not be made — distinct from a null
   *  column, which means the run predates the feature (ADR-0098). */
  computed?: boolean | null;
  reason?: string | null;
  n?: number | null;
  as_of?: string | null;
  sufficient?: boolean | null;
  portfolio_cumulative?: number | null;
  benchmark_cumulative?: number | null;
  active_return?: number | null;
  tracking_error?: number | null;
  information_ratio?: number | null;
  beta?: number | null;
  correlation?: number | null;
  up_capture?: number | null;
  down_capture?: number | null;
  up_days?: number | null;
  down_days?: number | null;
  warnings?: string[] | null;
}

/** `portfolio_risk.conditional_vol` (migration 047). */
export interface ConditionalVolRow {
  ewma?: { annualised_vol?: number | null; lam?: number | null; n_obs?: number | null } | null;
  garch?: {
    annualised_vol?: number | null;
    longrun_annualised_vol?: number | null;
    persistence?: number | null;
    converged?: boolean | null;
    warnings?: string[] | null;
  } | null;
  sample_annualised_vol?: number | null;
  n_observations?: number | null;
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

/** Tailwind classes for a severity chip.
 *
 *  Four bands, escalating by FILL and not only by hue, because this chip's whole
 *  job is answering "which shock hurts" from across the room. Every band used to
 *  be a low-opacity tint of its hue, which on warm paper rendered four
 *  near-identical faint pills — a table sorted worst-first whose severity column
 *  carried no visual weight at all. Now: solid crimson → solid orange → orange
 *  tint → grey outline.
 *
 *  White on --short is 8.0:1 and on --warning is 5.2:1, so both filled bands
 *  clear AA. The `high` band previously returned bg-[#3a2615]/text-[#f0883e] — a
 *  dark-theme leftover that painted a dark-brown chip on cream paper. See
 *  docs/design-goals.md §4.
 *
 *  Backend bands: scenario_analysis.py assigns low | moderate | high | severe. */
export function severityChipClass(severity: string): string {
  switch ((severity ?? "").toLowerCase()) {
    case "severe":
      // Was `bg-short` — direction crimson, on a scale that has nothing to do
      // with direction (ADR-0085). --warning-deep exists for this one band: the
      // ramp needed a level ABOVE solid --warning, which `high` already owns.
      return "bg-warning-deep text-white font-semibold tracking-[0.04em]";
    case "high":
      return "bg-warning text-white font-semibold tracking-[0.04em]";
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

const pairKey = (a: string, b: string): string => [a, b].sort().join("\u0000");   // escaped, not a literal NUL: an actual NUL byte in
  // the source makes grep treat this whole file as binary and skip it silently, and
  // several guards in this repo are grep-derived. Same character at runtime.

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
  // --short / --long by hand: alpha varies with |rho|, which var() cannot do.
  // Keep these triplets in step with globals.css.
  return corr >= 0
    ? `rgba(159, 23, 42, ${alpha.toFixed(3)})`
    : `rgba(18, 110, 83, ${alpha.toFixed(3)})`;
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

/**
 * `research_recommendations.sanctions_exposure` — ADR-0096.
 *
 * Computed in Python (`backend/services/sanctions_exposure.py`) and persisted, NOT
 * re-derived here. The jurisdiction map it rests on is a documented JUDGEMENT, and two
 * copies of a judgement drift into a confidently wrong classification with no visible
 * symptom — unlike a formula, which produces a visibly wrong number when it drifts.
 * (Contrast `lib/method/trackRecord.ts`, which does re-implement its backend aggregate:
 * justified there because that aggregate is never persisted, only its per-pick rows are.)
 *
 * `summary` travels with the figures for the same reason each scenario carries its own
 * description: the page must not restate the direction in different words from the module
 * that decided it.
 */
export interface SanctionsExposureRow {
  /** `long` | `short` | `flat` | `none`, by NET exposure to sanctions risk. */
  direction: string;
  long_weight: number;
  short_weight: number;
  /** Signed. Negative = net short sanctions risk, so escalation helps the book. */
  net_weight: number;
  /** Exposed weight, NOT netted — an offsetting pair still shows its full gross. */
  exposed_gross: number;
  gross_exposure: number;
  /** null when the book has no gross: a share of nothing is unmeasurable (ADR-0066). */
  share_of_gross: number | null;
  positions: Array<{
    asset: string;
    direction: string;
    weight: number;
    jurisdiction: string;
    /** The named channel, e.g. "HFCAA delisting risk…" — never a bare score. */
    mechanism: string;
  }>;
  /** Held names in neither the exposed nor the cleared map: unknown, not absent. */
  unclassified: string[];
  summary: string;
}

/**
 * `research_recommendations.positioning_crowding` — ADR-0097.
 *
 * External (CFTC Commitments of Traders) speculator positioning against the book. Computed
 * in Python (`backend/services/positioning_crowding.py` over `backend/data/cot_fetcher.py`)
 * and persisted, NOT re-derived here: the contract mapping is a judgement, on the same
 * argument as the sanctions jurisdiction map.
 *
 * COVERAGE IS THE HEADLINE. Only positions that trade against a futures contract can be
 * assessed at all — 2 of 10 in the live book. A component that rendered only `rows` would
 * let a reader conclude the whole book had been checked, so `coverage_share` is read first
 * and `unobservable` is rendered rather than dropped.
 */
export interface PositioningCrowdingRow {
  /** False = the fetch was never made or failed wholesale. NOT the same as "nothing is
   *  crowded" — it means we did not look. */
  fetched: boolean;
  gross_exposure: number;
  observed_gross: number;
  agreeing_gross: number;
  /** Share of book gross COT can speak to. null when the book has no gross (ADR-0066). */
  coverage_share: number | null;
  /** Share of book GROSS (not of the observed slice) sitting with a crowded consensus.
   *  Bounded above by `coverage_share` by construction. */
  crowded_share: number | null;
  rows: Array<{
    asset: string;
    /** The side the BOOK states. */
    direction: string;
    weight: number;
    contract: string;
    contract_code: string;
    /** True when long the asset is short the contract's underlying (SVXY). */
    inverse: boolean;
    /** Direction resolved into the contract's underlying — the side actually compared. */
    effective_side: string;
    /** 0-100 percentile of net speculator position in its own trailing 3y range. */
    cot_index: number;
    net_spec: number;
    /** `long` | `short` | null when speculators are mid-range. */
    crowded_side: string | null;
    agrees_with_crowd: boolean;
    as_of: string;
    rationale: string;
  }>;
  /** Positions COT cannot see, each WITH its reason — never a bare omission. */
  unobservable: Array<{
    asset: string;
    direction: string;
    weight: number;
    reason: string;
  }>;
  /** The CFTC OBSERVATION Tuesday (stalest across contracts), not the retrieval date. */
  as_of: string | null;
  crowded_high: number;
  crowded_low: number;
  summary: string;
}
