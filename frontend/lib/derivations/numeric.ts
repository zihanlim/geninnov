// frontend/lib/derivations/numeric.ts
// Mirrors backend/derivations/numeric.py field-for-field.
//
// That sentence was a comment for as long as this file existed, and a comment is not a
// guarantee — the two copies could drift and nothing would notice until a field read
// `undefined` on a page. `tests/unit/derivation-parity.test.ts` now parses both files and
// fails when they disagree, so the claim above is enforced rather than asserted.

export type NumericStatus =
  | "exact"
  | "estimated"
  | "stale"
  | "unavailable"
  | "unverified";

export type NumericUnit =
  | "pct"
  | "usd_m"
  | "usd"
  | "ratio"
  | "count"
  | "score"
  | "duration"
  | "basis_points";

export type UncertaintyMethod = "bootstrap" | "analytical" | "heuristic";

/**
 * What we KNOW about a claim, independent of how it is drawn (ADR-0098).
 *
 * `not_applicable` is not a softer `unknown`. Unknown says the answer exists and we failed
 * to get it — retry, fix the source, buy the credential. Not-applicable says there is no
 * answer to get, because the question does not apply to this subject. Rendering them alike
 * tells a reader to wait for a number that is never coming.
 */
export type Epistemic = "known" | "unknown" | "not_applicable";

export interface SourceRecord {
  table: string;
  id: string | number;
  as_of: string;
}

export interface Freshness {
  max_age_seconds: number;
  observed_age_seconds: number;
}

export interface Uncertainty {
  band_low?: number;
  band_high?: number;
  confidence?: number;
  method: UncertaintyMethod;
}

/**
 * The four timestamp ROLES, carried separately because they answer different questions.
 *
 * CFTC Commitments of Traders is the case that proves they differ: positions are OBSERVED on
 * Tuesday, PUBLISHED the following Friday, RETRIEVED whenever the pipeline runs. Freshness is
 * measured from `observed` — measuring from `retrieved` would report a five-day-old reading
 * as two days old.
 *
 * The backend enforces the roles with distinct wrapper types and an isinstance check. Over
 * the wire they are plain ISO strings, so the discipline here is to read the field you mean:
 * never substitute `retrieved` for `observed` because it happens to be present.
 */
export interface Timestamps {
  /** When the world was in this state. Freshness is measured from here. */
  observed: string;
  /** When the source first made it available. Absent when unrecorded. */
  published?: string;
  /** When we fetched it. Says nothing about the value's age, only our copy's. */
  retrieved?: string;
  /** The period the value applies to, where that differs from observation (revisions). */
  effective?: string;
}

export interface NumericDerivation {
  field_id: string;
  display_status: NumericStatus;
  value: number | null;
  unit: NumericUnit;
  method_id: string;
  source_records: SourceRecord[];
  computed_at: string;
  as_of: string;
  freshness: Freshness;
  uncertainty?: Uncertainty;
  unavailable_reason?: string;
  /** Defaults to `known` server-side; an absent value is never `known` (validated). */
  epistemic?: Epistemic;
  /** Absent on derivations that predate role-typed timestamps. */
  timestamps?: Timestamps;
}

export function isNumericPresent(d: NumericDerivation): boolean {
  return d.value !== null;
}

/**
 * Why a figure is missing, in words a reader can act on — or null when it is present.
 *
 * The two absences get DIFFERENT copy on purpose. "Not available" for both would tell a
 * reader to come back tomorrow for a number that, in the not-applicable case, does not
 * exist and never will.
 */
export function absenceCopy(d: NumericDerivation): string | null {
  if (d.value !== null) return null;
  const reason = d.unavailable_reason?.trim();
  if (d.epistemic === "not_applicable") {
    return reason
      ? `Does not apply here — ${reason}`
      : "Does not apply to this subject.";
  }
  return reason ? `Not measured — ${reason}` : "Not measured.";
}
