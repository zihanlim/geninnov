// frontend/lib/derivations/numeric.ts
// Mirrors backend/derivations/numeric.py field-for-field.

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
}

export function isNumericPresent(d: NumericDerivation): boolean {
  return d.value !== null;
}
