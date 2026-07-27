// The book now has FOUR value-at-risk numbers, and they disagree.
//
// ADR-0082 had to say this when there were two: *"two contradicting VaRs on one page
// unlabelled is the regression PROGRESS records twice."* There are now four, and three of
// them are rendered nowhere — `risk_decomposition` has been persisted since migration 038
// with its render recorded as pending, and `monte_carlo_var` / `var_forecast` landed with
// migration 047. Left as they are, the first person to surface one puts two numbers called
// "VaR" on a page where they differ by an order of magnitude.
//
// THEY DIFFER IN TWO DIMENSIONS, NOT ONE. Method is the obvious one. **Horizon is the
// trap**: the parametric and historical figures are ONE DAY, the Euler decomposition is
// ANNUALISED, and the Monte Carlo is TWENTY-ONE DAYS. A table that showed method alone
// would invite a reader to conclude the methods disagree wildly when most of the spread is
// just √t. So every row carries its horizon, and `comparable` names which rows may be read
// against each other.
//
// A third axis matters too and is cheaper to state than to explain later: `basis`. The
// realised figures are computed from the BOOK's own return series and are as old as the
// book (three sessions today); the ex-ante figures are computed from the CONSTITUENTS'
// covariance and are available on day one. That is why a two-day-old book can have a
// meaningful ex-ante VaR and a meaningless realised one.

import type {
  MonteCarloVarRow,
  RiskDecompositionRow,
  RiskRow,
  VarForecastRow,
} from "./analytics";
import { sampleAdequacy } from "./sampleAdequacy";

const TRADING_DAYS = 252;

export type VarBasis = "realised" | "ex_ante";

export interface VarMethodRow {
  key: string;
  label: string;
  /** The `method_id` the pipeline stamped, so a reader can trace the number. */
  methodId: string;
  basis: VarBasis;
  /** Trading days. `null` means annualised. */
  horizonDays: number | null;
  horizonLabel: string;
  /** Loss as a positive fraction of capital, or null when withheld/absent. */
  value: number | null;
  /** Present when the figure exists but must not be published. */
  withheld: string | null;
  /** Absent for a reason that is not a sample shortfall. */
  absent: string | null;
  note: string;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Rescale a VaR between horizons by square root of time.
 *
 * Used ONLY to state a reconciliation, never to publish a number the pipeline did not
 * compute. The rule assumes IID returns, which is exactly the assumption `var_forecast`
 * carries a warning about — so a rescaled figure is a check that two methods agree, not a
 * fifth method.
 */
export function rescale(value: number, fromDays: number, toDays: number): number {
  return value * Math.sqrt(toDays / fromDays);
}

/**
 * Assemble every VaR the book publishes, with what makes each one different.
 *
 * `sessions` is the realised-return sample size, used to gate the two realised figures via
 * `MIN_SESSIONS_BY_FIELD`. The ex-ante figures are NOT gated on it — they borrow history
 * from the constituents rather than from the book, which is the whole reason they exist,
 * and gating them on the book's age would suppress the only risk numbers a young book has.
 */
export function varMethods(
  risk: RiskRow | null,
  decomposition: RiskDecompositionRow | null | undefined,
  monteCarlo: MonteCarloVarRow | null | undefined,
  forecast: VarForecastRow | null | undefined,
  sessions: number | null,
  totalCapital: number | null,
): VarMethodRow[] {
  const rows: VarMethodRow[] = [];
  const capital = isNum(totalCapital) && totalCapital > 0 ? totalCapital : null;

  // ── Realised, from the book's own series. Stored in USD; shown as a fraction. ──
  const asFraction = (v: unknown): number | null =>
    isNum(v) && capital ? v / capital : null;

  for (const [key, column, label, methodId, note] of [
    [
      "parametric",
      "var_95",
      "Parametric (Gaussian)",
      "risk.var.parametric.v1",
      "z × σ of the book's realised daily returns. Assumes a normal distribution, which is exactly what the historical figure beside it tests.",
    ],
    [
      "historical",
      "var_95_historical",
      "Historical (empirical)",
      "risk.var.historical.v1",
      "The realised 5th-percentile loss. No distributional assumption, so it carries whatever skew the book actually had.",
    ],
  ] as const) {
    const adequacy = sampleAdequacy(column, sessions);
    const raw = (risk as Record<string, unknown> | null)?.[column];
    rows.push({
      key,
      label,
      methodId,
      basis: "realised",
      horizonDays: 1,
      horizonLabel: "1 day",
      value: adequacy.ok ? asFraction(raw) : null,
      withheld: adequacy.ok ? null : adequacy.reason,
      absent:
        adequacy.ok && !isNum(raw)
          ? "not computed for this run"
          : adequacy.ok && !capital
            ? "total capital unknown, so the USD figure cannot be shown as a share"
            : null,
      note,
    });
  }

  // ── Ex-ante, from the constituents' covariance. Available on day one. ──
  rows.push({
    key: "euler",
    label: "Ex-ante (covariance)",
    methodId: "risk.var.euler.v1",
    basis: "ex_ante",
    horizonDays: null,
    horizonLabel: "annualised",
    value: isNum(decomposition?.portfolio_var) ? decomposition!.portfolio_var! : null,
    withheld: null,
    absent: decomposition
      ? isNum(decomposition.portfolio_var)
        ? null
        : "the covariance could not be estimated — under 60 overlapping sessions or fewer than two priced names"
      : "not computed for this run (migration 038)",
    note: "z × √(wᵀΣw) on 252 days of the constituents' returns. Decomposes exactly by position, which is the thing the realised figures structurally cannot do.",
  });

  const mcBand = (monteCarlo?.bands ?? []).find((b) => b?.confidence === 0.95);
  rows.push({
    key: "monte_carlo",
    label: "Monte Carlo (Student-t)",
    methodId: "risk.var.monte_carlo.v1",
    basis: "ex_ante",
    horizonDays: isNum(monteCarlo?.horizon_days) ? monteCarlo!.horizon_days! : 21,
    horizonLabel: `${isNum(monteCarlo?.horizon_days) ? monteCarlo!.horizon_days! : 21} days`,
    value: isNum(mcBand?.var) ? mcBand!.var! : null,
    withheld: null,
    absent: monteCarlo
      ? isNum(mcBand?.var)
        ? null
        : "no 95% band in the simulation output"
      : "not computed for this run (migration 047)",
    note: "The only one with a fat tail: daily innovations are drawn from a multivariate Student-t, so a loss may exceed the worst day in the sample. Seeded, so it reproduces.",
  });

  return rows;
}

export interface VarReconciliation {
  ok: boolean;
  text: string;
}

/**
 * The one comparison that is genuinely apples-to-apples, stated explicitly.
 *
 * The Euler VaR and the √t fan are built from the SAME covariance, so they must agree once
 * put on the same horizon — the fan's 1-day p95 times √252 is the annualised Euler figure.
 * If they ever diverge, one of them has a bug, and this is the line that says so rather
 * than leaving two numbers to be eyeballed.
 */
export function reconcileExAnte(
  decomposition: RiskDecompositionRow | null | undefined,
  forecast: VarForecastRow | null | undefined,
  tolerance = 0.02,
): VarReconciliation | null {
  const euler = decomposition?.portfolio_var;
  const oneDay = (forecast?.bands ?? []).find((b) => b?.horizon_days === 1)?.quantiles?.p95;
  if (!isNum(euler) || !isNum(oneDay) || euler === 0) return null;

  const annualisedFan = rescale(oneDay, 1, TRADING_DAYS);
  const drift = Math.abs(annualisedFan - euler) / Math.abs(euler);
  return {
    ok: drift <= tolerance,
    text:
      drift <= tolerance
        ? `The two ex-ante figures reconcile: the fan's 1-day 95% loss scaled by √252 is ` +
          `${(annualisedFan * 100).toFixed(2)}% against the covariance figure's ` +
          `${(euler * 100).toFixed(2)}%. They are built from the same covariance, so this is a check, not a coincidence.`
        : `The two ex-ante figures DISAGREE by ${(drift * 100).toFixed(1)}%: the fan implies ` +
          `${(annualisedFan * 100).toFixed(2)}% annualised against the covariance figure's ` +
          `${(euler * 100).toFixed(2)}%. They are built from the same covariance and should not, so one of them is wrong.`,
  };
}

/** Horizons the fan publishes, for the reader who wants the number at their own horizon. */
export function fanRows(
  forecast: VarForecastRow | null | undefined,
): { horizonDays: number; label: string; p95: number }[] {
  const labels: Record<number, string> = {
    1: "1 day", 5: "1 week", 10: "2 weeks", 21: "1 month", 63: "3 months",
  };
  return (forecast?.bands ?? [])
    .filter((b) => isNum(b?.horizon_days) && isNum(b?.quantiles?.p95))
    .map((b) => ({
      horizonDays: b.horizon_days!,
      label: labels[b.horizon_days!] ?? `${b.horizon_days} days`,
      p95: b.quantiles!.p95,
    }));
}
