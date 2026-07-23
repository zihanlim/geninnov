// frontend/lib/risk/riskBoard.ts
//
// Pure types + helpers for the ACTIONABLE half of /risk: the risk-limit board,
// per-position risk attribution, attention-crowding join, the what-if shock
// estimator, and prior-run deltas. Nothing here reads Supabase — the page fetches
// the rows and hands them in — so every function is a total, testable transform.
//
// Design rules, inherited from lib/risk/analytics.ts:
//   • A missing input yields null, never a fabricated 0. The UI renders "—".
//   • Limits are read from scoring_config when the row exists, else fall back to
//     documented constants (see DEFAULT_LIMITS). The source is reported so a PM
//     knows whether a limit is configured or a house default.
//   • portfolio_positions carries no signed_weight column, so we derive it from
//     (direction, weight): long → +weight, short → −weight.

import { isNum } from "@/lib/risk/analytics";

// ─────────────────────────────────────────────────────────────────────────────
// Positions & factor betas
// ─────────────────────────────────────────────────────────────────────────────

/** A row of portfolio_positions with the migration-025 decision block. */
export interface PositionRow {
  id: string;
  theme_id: string | null;
  asset: string;
  direction: "long" | "short";
  notional: number | null;
  weight: number | null;
  hype_score: number | null;
  trade_score: number | null;
  edge_score: number | null;
  trend_signal: number | null;
  regime_bias: number | null;
  carry_signal: number | null;
  value_signal: number | null;
  conviction: number | null;
  vol: number | null;
}

/** A row of factor_exposures — per-asset FF5 + UMD betas (L2). */
export interface FactorExposureRow {
  asset: string;
  run_date: string;
  beta_mkt: number | null;
  beta_smb: number | null;
  beta_hml: number | null;
  beta_rmw: number | null;
  beta_cma: number | null;
  beta_umd: number | null;
  r_squared: number | null;
}

export type FactorKey =
  | "beta_mkt"
  | "beta_smb"
  | "beta_hml"
  | "beta_rmw"
  | "beta_cma"
  | "beta_umd";

/**
 * Signed portfolio weight for a position. portfolio_positions.weight is stored as
 * an unsigned book fraction; the sign is the direction. Returns null when weight
 * is absent so callers can render "—" rather than treating a missing weight as 0.
 */
export function signedWeight(p: PositionRow): number | null {
  if (!isNum(p.weight)) return null;
  return p.direction === "short" ? -Math.abs(p.weight) : Math.abs(p.weight);
}

/** Latest factor-exposure row per asset, keyed by asset. */
export function factorsByAsset(
  rows: FactorExposureRow[],
): Record<string, FactorExposureRow> {
  const by: Record<string, FactorExposureRow> = {};
  // Rows arrive newest-first; the first seen per asset wins.
  for (const r of rows) {
    if (!r.asset) continue;
    if (by[r.asset]) continue;
    by[r.asset] = r;
  }
  return by;
}

// ─────────────────────────────────────────────────────────────────────────────
// scoring_config → limits
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigRow {
  param_name: string;
  value: string;
}

export function configMap(rows: ConfigRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.param_name, r.value]));
}

export function configNum(
  map: Map<string, string>,
  key: string,
): number | null {
  const raw = map.get(key);
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk-limit board
// ─────────────────────────────────────────────────────────────────────────────

export type LimitStatus = "ok" | "near" | "breached" | "unknown";

/**
 * Where a limit sits and how it is measured. `higherIsWorse` says whether
 * exceeding the limit is the breach (VaR, exposure, HHI, caps → true) or falling
 * below it is (nothing here today, but keeps the model honest).
 */
export interface LimitDef {
  key: string;
  label: string;
  /** How the limit is denominated, for the value/limit formatter. */
  unit: "pct_of_capital" | "pct_weight" | "ratio" | "score";
  /** Where the numeric limit came from. */
  limitSource: "scoring_config" | "house_default";
  /** Human note on what the limit governs and why the default is what it is. */
  note: string;
}

export interface LimitRow extends LimitDef {
  /** Current observed value, in the same unit as `limit`. Null = unmeasurable. */
  value: number | null;
  /** The limit itself. Null when neither config nor default supplies one. */
  limit: number | null;
  /** value / limit, the fraction of the limit consumed. Null when unmeasurable. */
  utilisation: number | null;
  /** limit − value in native units; negative once breached. Null when unmeasurable. */
  headroom: number | null;
  status: LimitStatus;
}

/**
 * House defaults for limits with no scoring_config row. Documented here so the
 * board can say "house default" and a PM can see the assumption. Percentages are
 * decimals (0.20 = 20%). Single-name/sector/geo mirror the 35/30/20 caps the
 * backend already enforces (book_metrics MAX_* constants, ADR sizing).
 */
export const DEFAULT_LIMITS = {
  var_95_pct: 0.06, // 6% of capital 1-day 95% VaR
  cvar_95_pct: 0.09, // 9% of capital 95% CVaR (tail beyond VaR)
  max_drawdown_pct: 0.15, // 15% peak-to-trough on the realised curve
  net_exposure_pct: 0.3, // ±30% net long/short of capital
  gross_exposure_pct: 2.0, // 200% gross (2x leverage)
  beta_abs: 0.5, // |beta| to SPX, market-neutral-ish mandate
  hhi: 0.2, // Herfindahl concentration ceiling
  single_name_pct: 0.35,
  sector_pct: 0.3,
  geo_pct: 0.2,
} as const;

/** scoring_config keys we look up before falling back to DEFAULT_LIMITS. */
const CONFIG_KEYS: Record<keyof typeof DEFAULT_LIMITS, string> = {
  var_95_pct: "limit_var_95_pct",
  cvar_95_pct: "limit_cvar_95_pct",
  max_drawdown_pct: "limit_max_drawdown_pct",
  net_exposure_pct: "limit_net_exposure_pct",
  gross_exposure_pct: "limit_gross_exposure_pct",
  beta_abs: "limit_beta_abs",
  hhi: "limit_hhi",
  single_name_pct: "max_single_name_weight",
  sector_pct: "max_sector_weight",
  geo_pct: "max_geo_weight",
};

function resolveLimit(
  map: Map<string, string>,
  key: keyof typeof DEFAULT_LIMITS,
): { limit: number; source: "scoring_config" | "house_default" } {
  const fromCfg = configNum(map, CONFIG_KEYS[key]);
  if (fromCfg !== null) return { limit: fromCfg, source: "scoring_config" };
  return { limit: DEFAULT_LIMITS[key], source: "house_default" };
}

/** Fraction of the limit at/above which a row is flagged "near" (amber). */
export const NEAR_LIMIT_FRACTION = 0.8;

function statusFor(util: number | null): LimitStatus {
  if (util === null) return "unknown";
  if (util > 1) return "breached";
  if (util >= NEAR_LIMIT_FRACTION) return "near";
  return "ok";
}

const STATUS_ORDER: Record<LimitStatus, number> = {
  breached: 0,
  near: 1,
  ok: 2,
  unknown: 3,
};

export interface LimitBoardInputs {
  config: Map<string, string>;
  totalCapital: number | null;
  var95Usd: number | null;
  cvar95Usd: number | null;
  beta: number | null;
  hhi: number | null;
  /** From book_metrics — decimals. */
  grossExposure: number | null;
  netExposure: number | null;
  /** Worst peak-to-trough on the realised curve, a negative decimal, or null. */
  maxDrawdown: number | null;
  /** Peak utilisation observed per cap group (max over rows), decimals. */
  singleNameWeight: number | null;
  sectorWeight: number | null;
  geoWeight: number | null;
}

/**
 * Build the risk-limit board, breached-first. Every input that is null yields a
 * row with value=null/status="unknown" rather than being dropped — a limit a PM
 * cannot see is a limit they cannot manage.
 */
export function buildLimitBoard(inp: LimitBoardInputs): LimitRow[] {
  const cap = isNum(inp.totalCapital) && inp.totalCapital > 0 ? inp.totalCapital : null;

  const varPct = cap !== null && isNum(inp.var95Usd) ? Math.abs(inp.var95Usd) / cap : null;
  const cvarPct = cap !== null && isNum(inp.cvar95Usd) ? Math.abs(inp.cvar95Usd) / cap : null;
  const ddAbs = isNum(inp.maxDrawdown) ? Math.abs(inp.maxDrawdown) : null;
  const netAbs = isNum(inp.netExposure) ? Math.abs(inp.netExposure) : null;
  const grossAbs = isNum(inp.grossExposure) ? Math.abs(inp.grossExposure) : null;
  const betaAbs = isNum(inp.beta) ? Math.abs(inp.beta) : null;

  const defs: Array<{
    def: LimitDef;
    value: number | null;
    limitKey: keyof typeof DEFAULT_LIMITS;
  }> = [
    {
      value: varPct,
      limitKey: "var_95_pct",
      def: {
        key: "var_95",
        label: "VaR (95%)",
        unit: "pct_of_capital",
        limitSource: "house_default",
        note: "1-day 95% parametric VaR as a share of capital. From portfolio_risk.var_95 / total_capital.",
      },
    },
    {
      value: cvarPct,
      limitKey: "cvar_95_pct",
      def: {
        key: "cvar_95",
        label: "CVaR (95%)",
        unit: "pct_of_capital",
        limitSource: "house_default",
        note: "Expected loss in the worst 5% of days, as a share of capital. From portfolio_risk.cvar_95.",
      },
    },
    {
      value: ddAbs,
      limitKey: "max_drawdown_pct",
      def: {
        key: "max_drawdown",
        label: "Max drawdown",
        unit: "pct_of_capital",
        limitSource: "house_default",
        note: "Worst realised peak-to-trough on portfolio_returns to date. Backward-looking, not a forecast.",
      },
    },
    {
      value: netAbs,
      limitKey: "net_exposure_pct",
      def: {
        key: "net_exposure",
        label: "Net exposure (|net|)",
        unit: "pct_of_capital",
        limitSource: "house_default",
        note: "|long − short| as a share of capital. From book_metrics.net_exposure.",
      },
    },
    {
      value: grossAbs,
      limitKey: "gross_exposure_pct",
      def: {
        key: "gross_exposure",
        label: "Gross exposure",
        unit: "pct_of_capital",
        limitSource: "house_default",
        note: "long + short as a share of capital — the leverage ceiling. From book_metrics.gross_exposure.",
      },
    },
    {
      value: betaAbs,
      limitKey: "beta_abs",
      def: {
        key: "beta",
        label: "Beta to SPX (|β|)",
        unit: "ratio",
        limitSource: "house_default",
        note: "Absolute market beta. A long-short mandate targets near-neutral; large |β| is directional drift. From portfolio_risk.beta.",
      },
    },
    {
      value: isNum(inp.hhi) ? inp.hhi : null,
      limitKey: "hhi",
      def: {
        key: "hhi",
        label: "Concentration (HHI)",
        unit: "score",
        limitSource: "house_default",
        note: "Herfindahl–Hirschman index of position weights; 1/N is fully diversified, 1.0 is a single name. From portfolio_risk.concentration_hhi.",
      },
    },
    {
      value: isNum(inp.singleNameWeight) ? inp.singleNameWeight : null,
      limitKey: "single_name_pct",
      def: {
        key: "single_name_cap",
        label: "Single-name cap (max)",
        unit: "pct_weight",
        limitSource: "scoring_config",
        note: "Largest single-name book weight vs the cap. From cap_utilisation.single_name.",
      },
    },
    {
      value: isNum(inp.sectorWeight) ? inp.sectorWeight : null,
      limitKey: "sector_pct",
      def: {
        key: "sector_cap",
        label: "Sector cap (max)",
        unit: "pct_weight",
        limitSource: "scoring_config",
        note: "Largest sector book weight vs the cap. From cap_utilisation.sector.",
      },
    },
    {
      value: isNum(inp.geoWeight) ? inp.geoWeight : null,
      limitKey: "geo_pct",
      def: {
        key: "geo_cap",
        label: "Geography cap (max)",
        unit: "pct_weight",
        limitSource: "scoring_config",
        note: "Largest geography book weight vs the cap. From cap_utilisation.geo.",
      },
    },
  ];

  const rows: LimitRow[] = defs.map(({ def, value, limitKey }) => {
    const { limit, source } = resolveLimit(inp.config, limitKey);
    const util = value !== null && isNum(limit) && limit !== 0 ? value / limit : null;
    const headroom = value !== null && isNum(limit) ? limit - value : null;
    return {
      ...def,
      limitSource: source,
      value,
      limit,
      utilisation: util,
      headroom,
      status: statusFor(util),
    };
  });

  return rows.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    // Within a status, most-consumed first.
    return (b.utilisation ?? -1) - (a.utilisation ?? -1);
  });
}

export function countByStatus(rows: LimitRow[]): Record<LimitStatus, number> {
  const c: Record<LimitStatus, number> = { breached: 0, near: 0, ok: 0, unknown: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-position risk attribution
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionAttribution {
  id: string;
  asset: string;
  themeId: string | null;
  direction: "long" | "short";
  signedWeight: number | null;
  /** Position β_mkt from factor_exposures, or null when no regression exists. */
  betaMkt: number | null;
  /** signed_weight × β_mkt — the position's contribution to book beta (absolute). */
  betaContribution: number | null;
  /** As a share of the summed |contribution|, for the bar. Null when total is 0. */
  betaContributionShare: number | null;
  /** Contribution to gross: |signed_weight| / gross. */
  grossShare: number | null;
  /** Contribution to net: signed_weight / |net| (can exceed 1 / flip sign). */
  netShare: number | null;
  /** Mean |ρ| to the rest of the book across flagged correlation pairs, or null. */
  avgCorr: number | null;
  /** How many flagged pairs this asset appears in. */
  corrPairCount: number;
}

export interface CorrelationPairLite {
  asset_a: string;
  asset_b: string;
  corr: number;
}

/**
 * Per-position risk attribution. `bookBeta` is the value-weighted book beta
 * (from portfolio_risk / book_metrics) used only to sanity-scale — the reported
 * betaContribution is the raw signed_weight × β so contributions sum to book beta
 * when every position has a regression. `pairs` are the flagged correlation pairs.
 */
export function buildPositionAttribution(
  positions: PositionRow[],
  factors: Record<string, FactorExposureRow>,
  pairs: CorrelationPairLite[],
): PositionAttribution[] {
  // Aggregate |ρ| per asset across flagged pairs.
  const corrSum: Record<string, number> = {};
  const corrCount: Record<string, number> = {};
  for (const p of pairs) {
    if (!isNum(p.corr)) continue;
    for (const a of [p.asset_a, p.asset_b]) {
      if (!a) continue;
      corrSum[a] = (corrSum[a] ?? 0) + Math.abs(p.corr);
      corrCount[a] = (corrCount[a] ?? 0) + 1;
    }
  }

  const raw = positions.map((p) => {
    const sw = signedWeight(p);
    const fx = factors[p.asset];
    const betaMkt = fx && isNum(fx.beta_mkt) ? fx.beta_mkt : null;
    const betaContribution = sw !== null && betaMkt !== null ? sw * betaMkt : null;
    const count = corrCount[p.asset] ?? 0;
    const avgCorr = count > 0 ? corrSum[p.asset] / count : null;
    return { p, sw, betaMkt, betaContribution, count, avgCorr };
  });

  const gross = raw.reduce((s, r) => s + (r.sw !== null ? Math.abs(r.sw) : 0), 0);
  const net = raw.reduce((s, r) => s + (r.sw ?? 0), 0);
  const netAbs = Math.abs(net);
  const totalBetaAbs = raw.reduce(
    (s, r) => s + (r.betaContribution !== null ? Math.abs(r.betaContribution) : 0),
    0,
  );

  const out: PositionAttribution[] = raw.map((r) => ({
    id: r.p.id,
    asset: r.p.asset,
    themeId: r.p.theme_id,
    direction: r.p.direction,
    signedWeight: r.sw,
    betaMkt: r.betaMkt,
    betaContribution: r.betaContribution,
    betaContributionShare:
      r.betaContribution !== null && totalBetaAbs > 0
        ? Math.abs(r.betaContribution) / totalBetaAbs
        : null,
    grossShare: r.sw !== null && gross > 0 ? Math.abs(r.sw) / gross : null,
    netShare: r.sw !== null && netAbs > 0 ? r.sw / netAbs : null,
    avgCorr: r.avgCorr,
    corrPairCount: r.count,
  }));

  // Largest absolute beta contribution first — "which trade moves the book most".
  return out.sort(
    (a, b) => Math.abs(b.betaContribution ?? 0) - Math.abs(a.betaContribution ?? 0),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What-if shock estimator
// ─────────────────────────────────────────────────────────────────────────────

/** A shock in decimal return terms per factor, e.g. { mkt: -0.10, umd: 0.03 }. */
export interface FactorShocks {
  mkt: number;
  smb: number;
  hml: number;
  rmw: number;
  cma: number;
  umd: number;
}

export const ZERO_SHOCKS: FactorShocks = {
  mkt: 0,
  smb: 0,
  hml: 0,
  rmw: 0,
  cma: 0,
  umd: 0,
};

const SHOCK_TO_BETA: Record<keyof FactorShocks, FactorKey> = {
  mkt: "beta_mkt",
  smb: "beta_smb",
  hml: "beta_hml",
  rmw: "beta_rmw",
  cma: "beta_cma",
  umd: "beta_umd",
};

export interface WhatIfContribution {
  asset: string;
  direction: "long" | "short";
  signedWeight: number;
  /** signed_weight × Σ(beta_f × shock_f) for this position. */
  contribution: number;
}

export interface WhatIfResult {
  /** Σ over positions of signed_weight × Σ(beta × shock). Decimal book return. */
  bookReturn: number;
  /** Per-position, sorted by |contribution| desc. */
  contributions: WhatIfContribution[];
  /** Positions that had a signed weight but no factor regression — excluded. */
  missingFactorAssets: string[];
  /** Positions that had a factor row but no usable weight — excluded. */
  missingWeightAssets: string[];
}

/**
 * Estimate the book return under a factor shock path:
 *   book_return = Σ_i signed_weight_i × Σ_f beta_{i,f} × shock_f
 * A best-effort model estimate from historical regressions — the caller must
 * label it an estimate. Positions with no regression are excluded and named so
 * the estimate's coverage is legible, never silently zero-filled.
 */
export function estimateWhatIf(
  positions: PositionRow[],
  factors: Record<string, FactorExposureRow>,
  shocks: FactorShocks,
): WhatIfResult {
  const contributions: WhatIfContribution[] = [];
  const missingFactorAssets: string[] = [];
  const missingWeightAssets: string[] = [];
  let bookReturn = 0;

  for (const p of positions) {
    const sw = signedWeight(p);
    const fx = factors[p.asset];
    if (sw === null) {
      if (fx) missingWeightAssets.push(p.asset);
      continue;
    }
    if (!fx) {
      missingFactorAssets.push(p.asset);
      continue;
    }
    let factorReturn = 0;
    let usedAny = false;
    for (const shockKey of Object.keys(shocks) as (keyof FactorShocks)[]) {
      const betaKey = SHOCK_TO_BETA[shockKey];
      const beta = fx[betaKey];
      const shock = shocks[shockKey];
      if (isNum(beta) && isNum(shock) && shock !== 0) {
        factorReturn += beta * shock;
        usedAny = true;
      }
    }
    // A position with a regression but all-zero shocks still counts as covered
    // (contribution 0); one with no numeric betas at all is genuinely missing.
    const anyBeta = (Object.keys(SHOCK_TO_BETA) as (keyof FactorShocks)[]).some(
      (k) => isNum(fx[SHOCK_TO_BETA[k]]),
    );
    if (!anyBeta) {
      missingFactorAssets.push(p.asset);
      continue;
    }
    void usedAny;
    const contribution = sw * factorReturn;
    bookReturn += contribution;
    contributions.push({
      asset: p.asset,
      direction: p.direction,
      signedWeight: sw,
      contribution,
    });
  }

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { bookReturn, contributions, missingFactorAssets, missingWeightAssets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prior-run deltas
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskDeltaInput {
  run_date?: string | null;
  var_95?: number | null;
  cvar_95?: number | null;
  sharpe?: number | null;
  beta?: number | null;
  concentration_hhi?: number | null;
}

export interface MetricDelta {
  /** latest − previous, or null when either run lacks the metric. */
  delta: number | null;
  /** The previous run's value, for the tooltip. */
  previous: number | null;
  /** Previous run_date, for the tooltip. */
  previousDate: string | null;
}

/**
 * Signed change of each metric between the two most recent portfolio_risk runs.
 * `rows` must be ordered newest-first; only the first two are used. Returns all
 * nulls when fewer than two runs exist, so the UI shows "—" not a fake 0.
 */
export function computeRiskDeltas(
  rows: RiskDeltaInput[],
): Record<"var_95" | "cvar_95" | "sharpe" | "beta" | "concentration_hhi", MetricDelta> {
  const latest = rows[0] ?? null;
  const prev = rows[1] ?? null;
  const keys = ["var_95", "cvar_95", "sharpe", "beta", "concentration_hhi"] as const;
  const out = {} as Record<(typeof keys)[number], MetricDelta>;
  for (const k of keys) {
    const cur = latest && isNum(latest[k]) ? (latest[k] as number) : null;
    const old = prev && isNum(prev[k]) ? (prev[k] as number) : null;
    out[k] = {
      delta: cur !== null && old !== null ? cur - old : null,
      previous: old,
      previousDate: prev?.run_date ?? null,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attention crowding — book positioning join
// ─────────────────────────────────────────────────────────────────────────────

export interface CrowdingRow {
  themeId: string;
  themeName: string;
  /** Attention percentile in the theme's own history, 0–100, or null (<5 obs). */
  percentile: number | null;
  /** 1-session change in hype, or null. */
  delta1d: number | null;
  /** How the book is positioned in this theme, null when unpositioned. */
  bookDirection: "long" | "short" | "mixed" | null;
  /** Summed |signed_weight| of positions in this theme. */
  bookWeight: number | null;
  /** A one-line crowding read for the flagged, positioned themes. */
  flag: string | null;
}

/** At/above this percentile a positioned theme is flagged as crowded. */
export const CROWDING_PERCENTILE = 80;

export interface CrowdingHistoryLite {
  percentile: number | null;
  delta1d: number | null;
}

/**
 * Rank themes by attention percentile and flag the ones the book is positioned
 * in. A positioned theme sitting at/above CROWDING_PERCENTILE is a crowding
 * warning: the book is leaning into a trade the crowd is already loud about.
 */
export function buildCrowding(
  histories: Record<string, CrowdingHistoryLite>,
  themeNames: Record<string, string>,
  positions: PositionRow[],
): CrowdingRow[] {
  // Book positioning per theme.
  const dirByTheme: Record<string, Set<"long" | "short">> = {};
  const weightByTheme: Record<string, number> = {};
  for (const p of positions) {
    if (!p.theme_id) continue;
    (dirByTheme[p.theme_id] ??= new Set()).add(p.direction);
    const sw = signedWeight(p);
    if (sw !== null) {
      weightByTheme[p.theme_id] = (weightByTheme[p.theme_id] ?? 0) + Math.abs(sw);
    }
  }

  const rows: CrowdingRow[] = Object.entries(histories).map(([themeId, h]) => {
    const dirs = dirByTheme[themeId];
    const bookDirection: CrowdingRow["bookDirection"] = !dirs
      ? null
      : dirs.size > 1
        ? "mixed"
        : dirs.has("long")
          ? "long"
          : "short";
    const themeName = themeNames[themeId] ?? themeId;
    const bookWeight = weightByTheme[themeId] ?? null;

    let flag: string | null = null;
    if (
      bookDirection !== null &&
      h.percentile !== null &&
      h.percentile >= CROWDING_PERCENTILE
    ) {
      const sideWord =
        bookDirection === "mixed" ? "Positioned both ways in" : `${cap(bookDirection)}`;
      flag =
        bookDirection === "mixed"
          ? `${sideWord} ${themeName}, at its ${Math.round(h.percentile)}th-pct attention → crowded both ways`
          : `${sideWord} ${themeName}, at its ${Math.round(h.percentile)}th-pct attention → crowded ${bookDirection}`;
    }

    return {
      themeId,
      themeName,
      percentile: h.percentile,
      delta1d: h.delta1d,
      bookDirection,
      bookWeight,
      flag,
    };
  });

  // Highest attention first; positioned themes break ties above unpositioned.
  return rows.sort((a, b) => {
    const pa = a.percentile ?? -1;
    const pb = b.percentile ?? -1;
    if (pb !== pa) return pb - pa;
    const posA = a.bookDirection ? 1 : 0;
    const posB = b.bookDirection ? 1 : 0;
    return posB - posA;
  });
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
