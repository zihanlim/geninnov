// frontend/lib/derivations/advisory.ts
// Mirrors backend/derivations/advisory.py field-for-field.

export type AdvisoryStatus = "verified" | "partial" | "unverified" | "unavailable";

export type GeneratedBy = "l5_q1_agent" | "human" | "none";

export type CitationStatus =
  | "all_verified"
  | "some_failed_retry_ok"
  | "some_failed_no_retry"
  | "not_attempted";

export interface AdvisoryDerivation {
  field_id: string;
  generated_by: GeneratedBy;
  display_status: AdvisoryStatus;
  body: string | null;
  method_id: string;
  evidence_ids: string[];
  citation_status: CitationStatus;
  fallback_used: boolean;
  computed_at: string;
  as_of: string;
  unavailable_reason?: string;
}

export function isAdvisoryPresent(a: AdvisoryDerivation): boolean {
  return a.body !== null;
}
