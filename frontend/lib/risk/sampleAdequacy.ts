// Which risk statistics the return sample can actually support.
//
// WHY THIS FILE EXISTS. The rule "a statistic below its declared minimum is withheld, not
// published" was implemented three times — `MIN_DAYS_FOR_*` in
// `backend/services/risk_engine.py`, `MIN_SESSIONS` in `lib/risk/riskBoard.ts`, and
// `minSessions` in `RiskMetricsGrid.tsx` — and kept in agreement by a COMMENT saying they
// mirror each other.
//
// It was also implemented ZERO times on the surface that matters most. `lib/chat/tools.ts`
// serves `portfolio_risk` straight to `/ask` and, through the shared TOOLS registry, to the
// MCP server (ADR-0092). On the 2026-07-25 book that meant a Sharpe of 6.32 computed from
// THREE return observations — against a declared minimum of 60 — was quotable as a cited
// fact by an external model, while the tile on /risk suppressed the very same number.
//
// The engine is not wrong to compute it and `portfolio_risk` is not wrong to store it; that
// was settled deliberately ("the computed value stays in portfolio_risk for anyone who
// queries it; the page no longer asserts it"). What was wrong is that "do not assert it"
// lived in a React component, so every non-React consumer asserted it.
//
// So the rule lives here, once, and every surface reads it. See ADR-0100.

/**
 * Sessions of realised return history each ESTIMATED statistic needs, keyed by its
 * `portfolio_risk` column so any consumer of that table can look it up directly.
 *
 * Mirrors MIN_DAYS_FOR_* in backend/services/risk_engine.py — and `risk-thresholds.test.ts`
 * now PARSES that file and fails if they disagree, so this is enforced rather than asserted.
 *
 * Deliberately limited to statistical estimates. `concentration_hhi` and `total_capital` are
 * computed from today's weights and need no history at all; gating them would replace a real
 * number with a blank.
 */
export const MIN_SESSIONS_BY_FIELD: Record<string, number> = {
  var_95: 30,
  cvar_95: 30,
  sharpe: 60,
  beta: 60,
};

export type Adequacy =
  | { ok: true }
  /** Withheld: the sample is known and too small. */
  | { ok: false; reason: string; sessions: number; needs: number }
  /** Not judged: we do not know the sample size, so we do not withhold. */
  | { ok: true; unjudged: true };

/**
 * Can `field` be published given `sessions` of return history?
 *
 * An UNKNOWN sample size does not withhold. Withholding on ignorance would suppress every
 * figure whenever the count query failed, turning a read error into a silent blackout — the
 * opposite failure from the one this guards. It is reported as `unjudged` so a caller can
 * tell "we checked and it is fine" from "we could not check".
 */
export function sampleAdequacy(field: string, sessions: number | null | undefined): Adequacy {
  const needs = MIN_SESSIONS_BY_FIELD[field];
  if (needs === undefined) return { ok: true };
  if (typeof sessions !== "number" || !Number.isFinite(sessions)) {
    return { ok: true, unjudged: true };
  }
  if (sessions >= needs) return { ok: true };
  return {
    ok: false,
    sessions,
    needs,
    reason:
      `${sessions} session${sessions === 1 ? "" : "s"} of return history, needs ${needs}. ` +
      `A figure from this sample is noise, so it is not published.`,
  };
}

/** The fields withheld at this sample size, in the order they appear in the table. */
export function withheldFields(sessions: number | null | undefined): string[] {
  return Object.keys(MIN_SESSIONS_BY_FIELD).filter(
    (k) => sampleAdequacy(k, sessions).ok === false,
  );
}
