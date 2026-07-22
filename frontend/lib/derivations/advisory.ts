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

/**
 * The single authority on whether advisory prose may be shown to an investor.
 *
 * Advisory text is strict-provenance: it renders ONLY when the evidence-backed
 * L5 path produced it and its citations survived verification. Every other
 * combination — a missing advisory, an unverified/unavailable status, or a run
 * that fell back to the deterministic heuristic — must render an explicit
 * "unavailable" state instead of the prose.
 *
 * Note the `null`/`undefined` case is deliberately part of this predicate: a
 * row persisted before the advisory column existed carries no provenance at
 * all, so its legacy body is exactly as untrustworthy as an unverified one.
 *
 * Every consumer must gate on this function rather than re-deriving the rule,
 * so the policy cannot drift between the book view and the per-pick cards.
 */
export function canRenderAdvisoryBody(
  a: AdvisoryDerivation | null | undefined,
): a is AdvisoryDerivation & { body: string } {
  if (!a) return false;
  if (a.display_status !== "verified" && a.display_status !== "partial") return false;
  if (a.fallback_used) return false;
  return typeof a.body === "string" && a.body.length > 0;
}
