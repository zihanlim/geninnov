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

/** What one grouping's rows add up to, against the gross they should account for. */
export interface CapGroupCoverage {
  id: "single_name" | "sector" | "geo";
  /** Σ weight over the group's rows. Null when the group is absent or empty. */
  covered: number | null;
  /** covered / gross. Null when either side is unmeasurable. */
  share: number | null;
}

export interface CapCoverage {
  gross: number | null;
  groups: CapGroupCoverage[];
  /** True only when EVERY group accounts for the whole gross book. */
  complete: boolean;
}

/**
 * Does each cap grouping see the whole book?
 *
 * A cap can only bind on weight it can see. `sector` rows come from
 * `book_metrics.SECTOR_MAP` and `geo` rows from `GEO_MAP` — a held ticker absent
 * from either map lands in NO group, so its weight is never counted toward any
 * sector or geography cap and the cap silently cannot bind on it. Nothing on the
 * page said whether that was happening: the bars show each group against its cap
 * and are equally reassuring whether they describe 100% of the book or 60% of it.
 *
 * So this sums each grouping and compares it to gross. `complete` is asserted
 * only when every group reaches gross; a shortfall is reported as the share it
 * did reach rather than as a pass. Tolerance is `CAP_UTIL_EPSILON` — the same
 * representation-error guard the breach check uses, for the same reason: these
 * are sums of clamped floats.
 */
export function capCoverage(
  data: CapUtilisation | null | undefined,
  gross: number | null | undefined,
): CapCoverage {
  const g = isNum(gross) && gross > 0 ? gross : null;
  const sum = (rows: CapRow[] | null | undefined): number | null => {
    if (!rows || rows.length === 0) return null;
    let total = 0;
    for (const r of rows) {
      if (!isNum(r.weight)) return null;   // one unmeasurable row makes the sum a guess
      total += r.weight;
    }
    return total;
  };

  const groups: CapGroupCoverage[] = (
    [
      ["single_name", data?.single_name],
      ["sector", data?.sector],
      ["geo", data?.geo],
    ] as const
  ).map(([id, rows]) => {
    const covered = sum(rows);
    return {
      id,
      covered,
      share: covered !== null && g !== null ? covered / g : null,
    };
  });

  const complete =
    g !== null &&
    groups.length > 0 &&
    groups.every((x) => x.share !== null && x.share >= 1 - CAP_UTIL_EPSILON);

  return { gross: g, groups, complete };
}
