// The mandate: the constraints the book is run under, mirrored from the backend.
//
// The values live in `backend/services/mandate.py`. This file is the frontend's
// reading of them, and `tests/unit/mandate-drift.test.ts` parses that Python and
// fails if the two disagree — the pattern `risk-thresholds.test.ts` already uses to
// pin the minimum-sample rule across the language boundary (ADR-0100).
//
// A hand-maintained copy is what this replaces, and it had drifted twice:
//
//   * the single-name and geo caps shipped TRANSPOSED (0.35 / 0.20), so the risk
//     board judged every position against the wrong ceiling — understating
//     single-name breaches and overstating geographic ones;
//   * `gross_exposure_pct` still read 2.0 (200%) against an optimizer that has
//     enforced `max_gross = 1.0` since ADR-0037. A published risk limit permitting
//     leverage the sizer cannot produce is the defect ADR-0123 names.
//
// ENFORCED vs MONITORED is a real distinction, not a label
// --------------------------------------------------------
// `ENFORCED` limits are entered into the solver as constraints (ADR-0107) and
// clamped by the heuristic allocator (ADR-0037). A published book cannot breach
// one. `MONITORED` thresholds are watched and reported, and **nothing in the
// backend constrains them** — there is no net-exposure or beta constraint anywhere
// in the sizer. Rendering the two in one undifferentiated list told a reader that
// a 30% net band was as binding as the 20% single-name cap. It is not.
//
// They are separate types so the difference cannot be lost by a later edit.

/** A limit the sizer physically cannot breach. */
export interface EnforcedLimit {
  readonly value: number;
  /** The `scoring_config.param_name` this is read from. */
  readonly configKey: string;
  readonly kind: "enforced";
}

/** A threshold that is watched and reported, but constrains nothing. */
export interface MonitoredThreshold {
  readonly value: number;
  readonly configKey: string;
  readonly kind: "monitored";
}

const enforced = (value: number, configKey: string): EnforcedLimit => ({
  value,
  configKey,
  kind: "enforced",
});

const monitored = (value: number, configKey: string): MonitoredThreshold => ({
  value,
  configKey,
  kind: "monitored",
});

/**
 * Constraints the solver enforces. Mirrors `backend/services/mandate.py`.
 *
 * Percentages are decimals (0.20 = 20%). Keep in step with the Python or
 * `mandate-drift.test.ts` fails — which is the point.
 */
export const ENFORCED = {
  /** The book is sized against this. */
  total_capital: enforced(100_000_000, "total_capital"),
  /** No single position > 20% of book. */
  single_name_pct: enforced(0.2, "max_single_name_weight"),
  /** No single sector > 30%. */
  sector_pct: enforced(0.3, "max_sector_weight"),
  /** No single geography > 35%. */
  geo_pct: enforced(0.35, "max_geo_weight"),
  /**
   * Long + short <= 100%. NOT 200%: ADR-0037 holds whatever the position limits
   * refuse as cash rather than renormalising the book back to full notional, so
   * `gross <= 1` is a ceiling the sizer reaches from below and never exceeds.
   */
  gross_exposure_pct: enforced(1.0, "max_gross"),
  /** A correlation complex is one idea, so it holds at most what one name may (ADR-0115). */
  complex_pct: enforced(0.2, "max_complex_weight"),
  /** A crowded name's single-name cap is halved (ADR-0110). Only ever tightens. */
  crowded_multiplier: enforced(0.5, "crowded_cap_multiplier"),
  /**
   * Day-over-day, against yesterday's PUBLISHED book — distinct from the intra-run
   * figure (this same solve vs the conviction book), which nothing constrains.
   * ADR-0107 carried this field since the optimizer shipped and nothing ever set
   * it; ADR-0173 is the first value. A first cut, not a fitted optimum — chosen
   * above the typical 30–58% band so an ordinary day is unaffected, and well below
   * the 72–200% band the two worst observed days sat in.
   */
  turnover_pct: enforced(0.6, "max_turnover"),
} as const;

/**
 * Thresholds the risk board reports against. **None of these constrains the sizer.**
 *
 * A book can and does breach these without any code preventing it — they exist so a
 * reader learns that it happened, which is a different promise from the caps above
 * and must read as one.
 */
export const MONITORED = {
  var_95_pct: monitored(0.06, "limit_var_95_pct"),
  cvar_95_pct: monitored(0.09, "limit_cvar_95_pct"),
  max_drawdown_pct: monitored(0.15, "limit_max_drawdown_pct"),
  /** ±30% net long/short of capital. Watched only — there is no net constraint in the solver. */
  net_exposure_pct: monitored(0.3, "limit_net_exposure_pct"),
  /** |beta| to SPX. Watched only — nothing in the backend targets a beta. */
  beta_abs: monitored(0.5, "limit_beta_abs"),
  /**
   * Herfindahl ceiling on the 0–10 000 (DOJ) scale — backend
   * `concentration_hhi = Σwᵢ²·10 000`, so the limit must be on the same scale.
   * 2 000 ≈ five equal-weight names; an earlier 0–1-scale 0.2 made a 2 500 book
   * read as 1 250 000 % utilisation.
   */
  hhi: monitored(2000, "limit_hhi"),
} as const;

/** Book shape. Not seeded into `scoring_config` — provenance reports `code_default`. */
export const BOOK_SHAPE = {
  max_longs: 5,
  max_shorts: 5,
} as const;

/** The lens the nightly run ships. ADR-0015 records that the firm's own mandate is credit + rates. */
export const DEFAULT_LENS = "multi_asset";

export const LENSES = [
  "multi_asset",
  "credit",
  "rates",
  "equity",
  "fx",
  "commodity",
] as const;

export type EnforcedKey = keyof typeof ENFORCED;
export type MonitoredKey = keyof typeof MONITORED;

/** Where a rendered limit's value actually came from. */
export type LimitSource = "scoring_config" | "code_default";

/**
 * Every limit as one flat list, enforcement status attached.
 *
 * For a mandate panel that must show all of them together while still saying which
 * ones bind. Deliberately not a merge into one shape — `kind` travels with each row.
 */
export function allLimits(): Array<
  (EnforcedLimit | MonitoredThreshold) & { key: string }
> {
  return [
    ...Object.entries(ENFORCED).map(([key, l]) => ({ ...l, key })),
    ...Object.entries(MONITORED).map(([key, l]) => ({ ...l, key })),
  ];
}
