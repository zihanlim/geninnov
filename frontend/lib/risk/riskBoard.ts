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
import { ENFORCED, MONITORED } from "@/lib/mandate";

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

/**
 * `not_applicable` is NOT `unknown`. Unknown means the value is withheld (below its
 * declared minimum sample). Not-applicable means the value is known exactly and the
 * LIMIT does not govern this book — measured, never assumed. Today the only case is
 * the net-exposure band against a run whose candidate pool had no short side: a
 * long-only book cannot sit inside a +/-30% net band, so scoring it as a breach
 * spends the alarm register on a book working exactly as designed (ADR-0197).
 */
export type LimitStatus = "ok" | "near" | "breached" | "not_applicable" | "unknown";

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
  /**
   * Where the observed VALUE is read from — `table.column`, not prose.
   *
   * Split out of `note` in 2026-07-30 (ADR-0180). The board sits in a quarter
   * column beside `MandatePanel`, which already carries a "What it means" line
   * for every one of these limits, so the prose became the card's largest
   * single cost (33–66px per row) for content duplicated 24px to the left. The
   * SOURCE is not duplicated anywhere — the mandate panel says where a LIMIT
   * came from, never where the value measured against it came from — so it is
   * the half that had to survive as its own field rather than a sentence a
   * reader has to finish to reach it (goal 1).
   */
  source: string;
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
  /**
   * Why this limit does not govern this book. Set only with `status:
   * "not_applicable"`, and required with it — an inapplicable limit whose reason is
   * missing is indistinguishable from a bug that swallowed the status.
   */
  inapplicableReason?: string;
}

/**
 * Fallbacks for limits with no scoring_config row, DERIVED from `lib/mandate.ts`.
 *
 * These used to be hand-written literals kept in step with `book_metrics.py` by a
 * comment. The comment failed twice. The single-name and geo values shipped
 * TRANSPOSED (0.35 / 0.20), so the board judged every position against the wrong
 * ceiling — understating single-name breaches by measuring a 20% cap as 35%, and
 * overstating geographic ones by measuring a 35% cap as 20%. And
 * `gross_exposure_pct` read 2.0 (200% gross, 2× leverage) against an optimizer that
 * has enforced `max_gross = 1.0` since ADR-0037 banked un-deployable capital as cash
 * rather than renormalising the book. The board was publishing a limit permitting
 * leverage the sizer structurally cannot produce, which is the defect ADR-0123 names:
 * a published risk limit disagreeing with the published book.
 *
 * Now every value reads through the mandate module, and
 * `tests/unit/mandate-drift.test.ts` parses `backend/services/mandate.py` and fails
 * if the two ever disagree. Percentages are decimals (0.20 = 20%).
 */
export const DEFAULT_LIMITS = {
  var_95_pct: MONITORED.var_95_pct.value,
  cvar_95_pct: MONITORED.cvar_95_pct.value,
  max_drawdown_pct: MONITORED.max_drawdown_pct.value,
  net_exposure_pct: MONITORED.net_exposure_pct.value,
  gross_exposure_pct: ENFORCED.gross_exposure_pct.value,
  beta_abs: MONITORED.beta_abs.value,
  hhi: MONITORED.hhi.value,
  single_name_pct: ENFORCED.single_name_pct.value,
  sector_pct: ENFORCED.sector_pct.value,
  geo_pct: ENFORCED.geo_pct.value,
  // ADR-0173. Day-over-day against yesterday's published book — the ONLY limit
  // on this board that is a claim about the STRATEGY rather than about today's
  // snapshot. Every row above it is computed from today's weights alone.
  turnover_pct: ENFORCED.turnover_pct.value,
};

/**
 * Which of these the SIZER actually enforces.
 *
 * `single_name_pct`, `sector_pct`, `geo_pct` and `gross_exposure_pct` are entered
 * into the solver as constraints (ADR-0107) and clamped by the heuristic allocator
 * (ADR-0037): a published book cannot breach one. Everything else on this board —
 * VaR, CVaR, drawdown, net exposure, beta, HHI — constrains NOTHING. There is no net
 * or beta constraint anywhere in `optimizer.py`.
 *
 * Rendering all ten in one undifferentiated list told a reader that a 30% net band
 * was as binding as the 20% single-name cap. A breach of the first is information; a
 * breach of the second would be a bug.
 */
export const ENFORCED_LIMIT_KEYS: ReadonlySet<keyof typeof DEFAULT_LIMITS> = new Set([
  "single_name_pct",
  "sector_pct",
  "geo_pct",
  "gross_exposure_pct",
  "turnover_pct",
] as const);

export function isEnforcedLimit(key: keyof typeof DEFAULT_LIMITS): boolean {
  return ENFORCED_LIMIT_KEYS.has(key);
}

/**
 * scoring_config keys we look up before falling back to DEFAULT_LIMITS.
 *
 * The four enforced keys are taken from the mandate module rather than restated, so
 * a lookup key cannot drift from the row migration 054 actually seeds — which is how
 * these three came to be looked up for months against rows that did not exist.
 */
const CONFIG_KEYS: Record<keyof typeof DEFAULT_LIMITS, string> = {
  var_95_pct: MONITORED.var_95_pct.configKey,
  cvar_95_pct: MONITORED.cvar_95_pct.configKey,
  max_drawdown_pct: MONITORED.max_drawdown_pct.configKey,
  net_exposure_pct: MONITORED.net_exposure_pct.configKey,
  gross_exposure_pct: ENFORCED.gross_exposure_pct.configKey,
  beta_abs: MONITORED.beta_abs.configKey,
  hhi: MONITORED.hhi.configKey,
  single_name_pct: ENFORCED.single_name_pct.configKey,
  sector_pct: ENFORCED.sector_pct.configKey,
  geo_pct: ENFORCED.geo_pct.configKey,
  turnover_pct: ENFORCED.turnover_pct.configKey,
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

/**
 * Utilisation above which a row is genuinely over its limit.
 *
 * Mirrors `CAP_EPSILON` in `backend/services/book_metrics.py` (ADR-0068), and exists
 * for the same reason: `allocate_portfolio` CLAMPS a group to its cap (ADR-0037), so a
 * fully-utilised book sits exactly on the limit by design, and summing the clamped
 * per-position floats reintroduces representation error. The live 2026-07-25 book
 * carried geo US at 0.35000000000000003 against a 0.35 cap, so
 * `util = 1.0000000000000002` and a bare `util > 1` reported a governance breach on a
 * book that was correctly capped.
 *
 * ADR-0068 fixed the BACKEND comparison. This board never read it — it recomputes the
 * status client-side from weights and limits — so the phantom breach kept rendering
 * here regardless. Two implementations of one rule is the drift ADR-0058 and ADR-0064
 * were both about; this is the second site, corrected to match.
 *
 * A representation-error guard, NOT an economic tolerance: an absolute weight error of
 * 1e-9 maps to ~3e-9 of utilisation against a 0.35 cap, while one basis point of real
 * overshoot is ~3e-4 — five orders of magnitude clear.
 */
export const CAP_UTIL_EPSILON = 1e-9;

/**
 * Headroom whose magnitude is below representation error is **zero**, not a signed
 * sliver.
 *
 * `headroom = limit − value`, and the same clamping that puts a fully-utilised group
 * exactly on its cap (ADR-0037) leaves `0.35 − 0.35000000000000003 = −5.55e-17`, which
 * formats as **"−0.0%"**. ADR-0068 deferred this as cosmetic — correctly at the time,
 * because the row still read BREACHED and a negative headroom agreed with that badge.
 *
 * Fixing the badge invalidated the deferral: the geography row now reads
 * `35.0% / 35.0% / 100% / −0.0% / NEAR`, a **negative headroom on a row the same board
 * has just declared compliant**. Two cells of one row disagreeing is the defect class
 * this project keeps finding, and it was introduced by the fix for the previous one.
 *
 * Scaled by the limit rather than absolute, because this board mixes units — weight
 * fractions, percentages, HHI points — so a single absolute epsilon would mean
 * different things per row. Relative keeps it unit-free and matches
 * {@link CAP_UTIL_EPSILON}'s magnitude.
 */
export function snapHeadroom(headroom: number, limit: number): number {
  return Math.abs(headroom) < Math.abs(limit) * CAP_UTIL_EPSILON ? 0 : headroom;
}

function statusFor(util: number | null): LimitStatus {
  if (util === null) return "unknown";
  // Sitting exactly on a limit is compliance, not breach — the allocator puts it there.
  if (util > 1 + CAP_UTIL_EPSILON) return "breached";
  if (util >= NEAR_LIMIT_FRACTION) return "near";
  return "ok";
}

const STATUS_ORDER: Record<LimitStatus, number> = {
  breached: 0,
  near: 1,
  ok: 2,
  not_applicable: 3,
  unknown: 4,
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
  /**
   * Which table the `hhi` value above came from, so the row can cite what it actually
   * read. `book_metrics` is the lens-following field (ADR-0208); `portfolio_risk` is
   * the lens-less fallback for a row written before it existed. Omitted = fallback,
   * which is what every historical row is.
   */
  hhiSource?: "book_metrics" | "portfolio_risk";
  /**
   * Did THIS RUN's candidate pool contain a short side?
   *
   * `false` makes the net-exposure band not-applicable: a book with no short
   * candidates cannot sit inside a +/-30% net band, so |net| = gross by
   * construction and scoring it as a breach reports a book working as designed.
   * The credit lens on 2026-07-30 was long-only and read 167% of the band — the
   * only breach on /mandate.
   *
   * MEASURED, NOT ASSUMED, and per RUN rather than per lens. The credit universe
   * CAN produce shorts (L1 sets direction from sign(TradeScore), and HYG/LQD/JNK/
   * TLT could all come through short); it happened to be empty on that run. So
   * this is read from `independent_ideas.short.count`, and the band goes back to
   * being live the first day a credit short appears. A blanket per-lens exemption
   * would be a mandate that quietly relaxes itself.
   *
   * `null`/undefined = unrecorded, and the band is scored normally. Absence of
   * evidence must not switch a limit off.
   */
  shortSideAvailable?: boolean | null;
  /**
   * The book's OWN market beta — the un-normalised `Σ(signed_w × β_mkt)` recovered
   * as `book_metrics.factor_tilts.beta_mkt × book_metrics.factor_covered_gross`.
   * Null when the run predates `factor_covered_gross` or no pick cleared its r² floor.
   *
   * Preferred over `beta` above, and NOT gated by `returnSessions`. Both halves of
   * that are deliberate:
   *
   * - **Preferred**, because it follows the lens. `portfolio_risk.beta` has no lens
   *   column (ADR-0194), so the credit page measured its own directionality with the
   *   multi-asset book's regression — the same defect ADR-0208 fixed for HHI.
   * - **Ungated**, because it needs no return history: it is today's weights against
   *   252-day per-asset regressions, the same family as the cap and exposure rows,
   *   and ADR-0063 already ruled on exactly this quantity — *"it needs no return
   *   history and is knowable on day one. Gating it would replace a real number with
   *   a blank."* The 60-session floor exists for the REGRESSION beta and travels with
   *   it into the fallback below, where it still applies.
   *
   * It is a different quantity from `beta`, so the row says which one it read rather
   * than presenting them interchangeably — ADR-0063's other half, which stopped a
   * panel promising a reconciliation between the two that fails 40× on a short sample.
   */
  bookBetaMkt?: number | null;
  /** Worst peak-to-trough on the realised curve, a negative decimal, or null. */
  maxDrawdown: number | null;
  /** Peak utilisation observed per cap group (max over rows), decimals. */
  singleNameWeight: number | null;
  sectorWeight: number | null;
  geoWeight: number | null;
  /**
   * Sessions of realised return history (`portfolio_returns` row count).
   *
   * The board must not stamp OK on a statistic whose sample cannot support it.
   * It did: VaR read "1.7% of a 6.0% limit — OK" while the metrics tile on the
   * same page said "Not shown: 2 sessions of history, needs 30. A VaR from this
   * sample is noise, so we do not publish one." Same number, same page, opposite
   * claims — and an OK against a governing limit is the stronger of the two,
   * because it reads as a risk check that passed.
   */
  returnSessions?: number | null;
  /**
   * Day-over-day distance from yesterday's published book, signed weights, summed
   * absolute (`research_recommendations.optimizer_result.realised_turnover`).
   *
   * NOT gated by `returnSessions` / MIN_SESSIONS below — it needs no history at
   * all, the same reason cap/exposure rows do not: it is a function of today's
   * weights and yesterday's, not a statistical estimate over a return series.
   * null (not 0) when no prior book existed to measure against (ADR-0173).
   */
  realisedTurnover?: number | null;
}

/**
 * Sessions of return history each ESTIMATED statistic needs before the board will
 * score it. Mirrors MIN_DAYS_FOR_* in backend/services/risk_engine.py and the
 * minSessions in RiskMetricsGrid, so the tile and the board cannot disagree.
 *
 * Deliberately limited to statistical estimates. Max drawdown is a REALISED fact —
 * "no drawdown has occurred yet" is true on two sessions, merely uninformative — and
 * the cap/exposure rows are computed from today's weights and need no history at
 * all. Gating those would replace a real number with a blank.
 */
export const MIN_SESSIONS: Partial<Record<keyof typeof DEFAULT_LIMITS, number>> = {
  var_95_pct: 30,   // MIN_DAYS_FOR_VAR
  cvar_95_pct: 30,  // MIN_DAYS_FOR_VAR
  beta_abs: 60,     // MIN_DAYS_FOR_BETA
};

/**
 * Build the risk-limit board, breached-first. Every input that is null yields a
 * row with value=null/status="unknown" rather than being dropped — a limit a PM
 * cannot see is a limit they cannot manage.
 */
export function buildLimitBoard(inp: LimitBoardInputs): LimitRow[] {
  const cap = isNum(inp.totalCapital) && inp.totalCapital > 0 ? inp.totalCapital : null;

  // Below its declared minimum a statistic is withheld, not scored — the row still
  // renders (a limit a PM cannot see is a limit they cannot manage) but as "unknown"
  // rather than a green OK on noise.
  const enough = (k: keyof typeof DEFAULT_LIMITS): boolean => {
    const need = MIN_SESSIONS[k];
    if (need === undefined) return true;
    if (!isNum(inp.returnSessions)) return true;   // unknown sample: do not withhold
    return (inp.returnSessions as number) >= need;
  };

  const varPct =
    enough("var_95_pct") && cap !== null && isNum(inp.var95Usd)
      ? Math.abs(inp.var95Usd) / cap
      : null;
  const cvarPct =
    enough("cvar_95_pct") && cap !== null && isNum(inp.cvar95Usd)
      ? Math.abs(inp.cvar95Usd) / cap
      : null;
  const ddAbs = isNum(inp.maxDrawdown) ? Math.abs(inp.maxDrawdown) : null;
  const netAbs = isNum(inp.netExposure) ? Math.abs(inp.netExposure) : null;
  const grossAbs = isNum(inp.grossExposure) ? Math.abs(inp.grossExposure) : null;
  // The book's OWN market beta when the run carries one, the lens-less realised
  // regression otherwise. `enough()` gates only the fallback — see `bookBetaMkt`.
  const ownBeta = isNum(inp.bookBetaMkt) ? Math.abs(inp.bookBetaMkt) : null;
  const regressionBeta =
    enough("beta_abs") && isNum(inp.beta) ? Math.abs(inp.beta) : null;
  const betaFromBook = ownBeta !== null;
  const betaAbs = ownBeta ?? regressionBeta;

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
        source: "portfolio_risk.var_95 / total_capital",
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
        source: "portfolio_risk.cvar_95 / total_capital",
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
        source: "portfolio_returns.cumulative_return",
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
        source: "book_metrics.net_exposure",
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
        source: "book_metrics.gross_exposure",
      },
    },
    {
      value: betaAbs,
      limitKey: "beta_abs",
      def: {
        key: "beta",
        // "Market beta", not "Beta to SPX". The two sources measure against
        // different benchmarks — the regression is on `benchmark_returns`, the
        // factor beta on Ken French's MKT-RF (the CRSP value-weighted market, not
        // the S&P) — so a label naming one index is false whenever the other is
        // read. `MandatePanel`'s entry for this limit is renamed with it: the two
        // cards sit 24px apart and must not name one limit two ways.
        label: "Market beta (|β|)",
        unit: "ratio",
        limitSource: "house_default",
        // The note says WHICH beta, because they are different quantities and
        // ADR-0063 is the record of what happens when a surface lets a reader
        // assume otherwise.
        note: betaFromBook
          ? "Absolute market beta. A long-short mandate targets near-neutral; large |β| is directional drift. This book's OWN beta: value-weighted MKT-RF loading over the sized positions × the gross those loadings cover. Ex-ante, from each holding's 252-day regression, so it needs no return history and is knowable on day one (ADR-0063)."
          // METHOD only, no lens clause. Whose book this is belongs to the scope
          // tag, which renders only under a non-default lens; saying it here would
          // put "the multi-asset book's whatever lens is selected" into a title on
          // the DEFAULT page, where there is no other book in view. Caught by
          // `lens-scope-rows.test.tsx`'s byte-for-byte default-lens assertion.
          : "Absolute market beta. A long-short mandate targets near-neutral; large |β| is directional drift. Realised regression of the book's own returns on the benchmark, from portfolio_risk.beta — withheld below 60 sessions.",
        source: betaFromBook
          ? "book_metrics.factor_tilts.beta_mkt × book_metrics.factor_covered_gross"
          : "portfolio_risk.beta",
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
        note:
          "Herfindahl–Hirschman index of position weights on the 0–10 000 (DOJ) scale: " +
          "10 000/N is fully diversified, 10 000 is a single name; the 2 000 ceiling is " +
          "exactly 10 000/5, i.e. “hold at least five roughly-equal names”, so a " +
          "book of four or fewer breaches it by construction.",
        // Cites the table actually read. The lens-following field is preferred; the
        // lens-less one is the fallback, and a reader must be able to tell which they
        // are looking at, because only one of them is this book's.
        source:
          inp.hhiSource === "book_metrics"
            ? "book_metrics.concentration_hhi"
            : "portfolio_risk.concentration_hhi",
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
        source: "cap_utilisation.single_name",
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
        source: "cap_utilisation.sector",
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
        source: "cap_utilisation.geo",
      },
    },
    {
      value: isNum(inp.realisedTurnover) ? inp.realisedTurnover : null,
      limitKey: "turnover_pct",
      def: {
        key: "turnover",
        label: "Turnover (day-over-day)",
        unit: "pct_of_capital",
        limitSource: "scoring_config",
        note: "Distance from yesterday's published book, signed weights summed absolute. From optimizer_result.realised_turnover. Null (not 0) with no prior book — the FIRST run this cap was live for.",
        source: "optimizer_result.realised_turnover",
      },
    },
  ];

  const rows: LimitRow[] = defs.map(({ def, value, limitKey }) => {
    const { limit, source } = resolveLimit(inp.config, limitKey);
    const util = value !== null && isNum(limit) && limit !== 0 ? value / limit : null;
    const headroom =
      value !== null && isNum(limit) ? snapHeadroom(limit - value, limit) : null;

    // The net-exposure band does not govern a book with no short candidates. The
    // VALUE and the UTILISATION are kept — |net| 50% against a 30% band is real and
    // worth reading — and only the VERDICT is withheld, because it is the judgement
    // that would be wrong, not the measurement. `statusFor` never returns
    // `not_applicable`: it is a fact about the pool, which a utilisation cannot see.
    const inapplicable =
      def.key === "net_exposure" && inp.shortSideAvailable === false;

    return {
      ...def,
      limitSource: source,
      value,
      limit,
      utilisation: util,
      headroom,
      status: inapplicable ? "not_applicable" : statusFor(util),
      ...(inapplicable
        ? {
            inapplicableReason:
              "This run's candidate pool had no short side, so the book is long-only " +
              "and |net| equals gross by construction. A long/short band cannot be " +
              "satisfied by a book that had nothing to short. Measured from " +
              "research_recommendations.independent_ideas.short.count, per run — the " +
              "band applies again the first run a short candidate appears.",
          }
        : {}),
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
  const c: Record<LimitStatus, number> = {
    breached: 0, near: 0, ok: 0, not_applicable: 0, unknown: 0,
  };
  for (const r of rows) c[r.status] += 1;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-position risk attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is "share of net exposure" a share at all for this book?
 *
 * A share is a part of a whole and cannot exceed the whole. If the largest single
 * position is bigger than the entire net tilt, `signedWeight / |net|` stops being a
 * decomposition and starts being a ratio against a near-zero denominator — which is
 * the normal state of a long-short book, not an edge case. The live 2026-07-25 book
 * ran net +0.90% on 59.6% gross and the column rendered -1071.4% and +975.7%.
 *
 * Exported and used by BOTH the computation and the panel that explains the blank, so
 * the rule cannot drift into two different definitions of "meaningful" — the failure
 * ADR-0058 hit when a verdict was re-derived at the render layer.
 */
export function netShareIsMeaningful(signedWeights: (number | null)[]): boolean {
  const net = signedWeights.reduce<number>((s, w) => s + (w ?? 0), 0);
  const maxAbs = signedWeights.reduce<number>(
    (m, w) => Math.max(m, w === null ? 0 : Math.abs(w)),
    0,
  );
  return Math.abs(net) > 0 && maxAbs <= Math.abs(net);
}

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
  /** Signed weight / |net exposure|, or null when that ratio is not a share —
   *  see {@link netShareIsMeaningful}. */
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
  // "Net share" divides a position's signed weight by the book's NET exposure, and
  // the only guard was netAbs > 0. A long-short book is BUILT to run near
  // market-neutral, so that denominator is near zero by design — and the column then
  // reports numbers like -1071.4% and +975.7%, which is what the live 2026-07-25 book
  // showed: net +0.90% against positions of ~9%.
  //
  // The rule is not a fitted threshold, it is what the word means. A share is a part
  // of a whole, so it cannot exceed the whole. If the largest single position is
  // bigger than the entire net tilt, the ratios are not shares of anything and
  // rendering them as percentages invites a reader to conclude the book is levered
  // ten times over.
  //
  // Withheld rather than clamped: the honest statement is "this book is close to
  // market-neutral, so its directional tilt does not decompose", not a capped number
  // that still implies the decomposition exists. Same treatment VaR/Sharpe get below
  // their minimum sample — "we do not know" and "we know, and it is X" must look
  // different (ADR-0060).
  const netShareIsAShare = netShareIsMeaningful(raw.map((r) => r.sw));
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
    netShare: r.sw !== null && netShareIsAShare ? r.sw / netAbs : null,
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
  /** Scored hype observations behind this theme — a within-history percentile
   *  needs five, so this is what the empty state counts down against. */
  nObs: number;
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
