// frontend/lib/themeOrigin.ts
//
// Why a theme exists (ADR-0134).
//
// `themes.source` says which METHOD named a theme. This says something else and
// more interrogable: whether a **measurement preceded the decision**. Before
// migration 051 every theme read `practitioner` with a null `discovered_at`, so
// `AI Capex` — created on 2026-07-28 after a tracker signal and an operator's
// instruction — was byte-identical in provenance to `Fed Policy`, a line in
// migration 001 from an opening list.
//
// The distinction this file exists to preserve: a practitioner prior is NOT a
// deficient measured discovery. It is a different kind of claim, legitimately
// made, and the UI must not render its absent evidence as missing data.

export type PromotionBasis =
  | "practitioner_prior"
  | "operator_directed"
  | "measured_discovery"
  | "unrecorded";

export interface ThemeOrigin {
  promotion_basis: PromotionBasis | null;
  promoted_on: string | null;
  promotion_evidence: Record<string, unknown> | null;
}

interface BasisCopy {
  /** Short chip label. */
  label: string;
  /** One line a reader can act on, in plain language. */
  detail: string;
  /** Does this basis CLAIM the system found the theme? Only one of them does. */
  claimsDiscovery: boolean;
}

export const BASIS_COPY: Record<PromotionBasis, BasisCopy> = {
  practitioner_prior: {
    label: "Practitioner prior",
    detail:
      "Chosen as part of the opening universe, not derived from a measurement. " +
      "That is a legitimate way to start — it is a stated prior, and it is " +
      "labelled as one rather than implying evidence it never had.",
    claimsDiscovery: false,
  },
  operator_directed: {
    label: "Operator-directed",
    detail:
      "A person named this theme. Any evidence attached was measured AFTER the " +
      "decision, so it confirms the theme is findable without making the " +
      "promotion evidence-led.",
    claimsDiscovery: false,
  },
  measured_discovery: {
    label: "Measured discovery",
    detail:
      "The pipeline surfaced this theme and the evidence came FIRST. The only " +
      "basis that claims the system found it.",
    claimsDiscovery: true,
  },
  unrecorded: {
    label: "Unrecorded",
    detail:
      "Created before promotion provenance was tracked (migration 051). Not a " +
      "judgement about the theme — nobody wrote down why.",
    claimsDiscovery: false,
  },
};

/**
 * Whether missing evidence on this theme is EXPECTED rather than a gap.
 *
 * A practitioner prior has no evidence by definition. Rendering its null payload
 * with the same "not recorded" treatment used for a theme that should have one
 * would manufacture a defect out of an honest label.
 */
export function evidenceExpected(basis: PromotionBasis | null): boolean {
  return basis === "operator_directed" || basis === "measured_discovery";
}

/**
 * The ordering caveat, when the evidence post-dates the promotion.
 *
 * Returns null when there is nothing to caveat. This is deliberately derived
 * from the payload's own shape — a `retrospective` block with no `at_promotion`
 * counterpart that justified the call — rather than from a hand-set flag, so it
 * cannot say "evidence-led" about a payload that is not.
 */
export function orderingCaveat(origin: ThemeOrigin): string | null {
  const ev = origin.promotion_evidence;
  if (!ev) return null;
  const caveat = ev["ordering_caveat"];
  if (typeof caveat === "string" && caveat.trim()) return caveat;
  if (ev["retrospective"] && origin.promotion_basis !== "measured_discovery") {
    return "The measurement followed the decision.";
  }
  return null;
}

/** One-line summary for a card or a tooltip. */
export function originSummary(origin: ThemeOrigin): string {
  const basis = origin.promotion_basis ?? "unrecorded";
  const copy = BASIS_COPY[basis] ?? BASIS_COPY.unrecorded;
  const when = origin.promoted_on ? ` · promoted ${origin.promoted_on}` : "";
  return `${copy.label}${when}`;
}
