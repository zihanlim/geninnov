// Is a cap actually breached, or is it just sitting exactly on its limit with
// floating-point dust on top?
//
// A fully-utilised group lands EXACTLY on its cap by design (ADR-0037 clamps it
// there), and summing the clamped per-position floats reintroduces representation
// error: US geography persists as weight 0.35000000000000003 against a 0.35 cap,
// utilisation 1.0000000000000002. A bare `util > 1` — and the persisted `breached`
// flag written before the pipeline's own epsilon guard (ADR-0068) — both call that a
// governance breach. The RISK-LIMIT BOARD already recomputes with a tolerance
// (`CAP_UTIL_EPSILON`, iteration 55 / 1336a57a); the CAP UTILISATION panel did not, so
// one page read "0 breached" and "1 breach" at the same time. This shares the board's
// tolerance so both agree, and recomputes from utilisation rather than trusting a
// persisted flag that may predate the guard.

import { CAP_UTIL_EPSILON } from "./riskBoard";
import { isNum, type CapRow, type CapUtilisation } from "./analytics";

/** Utilisation of a cap row: persisted value, else weight/cap, else null. */
export function capRowUtil(row: CapRow): number | null {
  if (isNum(row.utilisation)) return row.utilisation;
  if (isNum(row.weight) && isNum(row.cap) && row.cap !== 0) return row.weight / row.cap;
  return null;
}

/** A representation-error guard, not an economic tolerance — one basis point of real
 *  breach is 10^7 times CAP_UTIL_EPSILON, so nothing actionable is masked. */
export function isCapBreached(row: CapRow): boolean {
  const util = capRowUtil(row);
  return util !== null && util > 1 + CAP_UTIL_EPSILON;
}

/** Every cap row across single-name / sector / geography that is genuinely breached. */
export function breachedCapRows(
  data: CapUtilisation | null | undefined,
): CapRow[] {
  if (!data) return [];
  return [
    ...(data.single_name ?? []),
    ...(data.sector ?? []),
    ...(data.geo ?? []),
  ].filter(isCapBreached);
}
