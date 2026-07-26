"use client";

/**
 * ThesisBlock
 * ----------
 * Renders an `AdvisoryDerivation` for the Q1 thesis body with a strict
 * unavailable policy:
 *
 *   - `display_status === "unavailable"`  → render an explicit "Thesis
 *     unavailable" message with the `unavailable_reason`. NEVER show the body.
 *   - `display_status in {"verified", "partial"}` → render the body, a
 *     citation list, and a verified/partial badge.
 *   - `display_status in {"unverified"}` OR `fallback_used === true` → never
 *     render the body. The heuristic fallback is not investor-facing.
 *
 * The hard guarantee: the LLM-generated `body` is only rendered when the
 * advisory was actually produced by the verified/partial path. Anything else
 * shows a clear "Thesis unavailable" panel instead. This is intentional —
 * investors must never see the heuristic fallback dressed up as model output.
 */
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";
import CitationList, { Citation } from "@/components/CitationList";

interface Props {
  advisory: AdvisoryDerivation;
  /** Optional citations list to attach to the body when rendered. */
  citations?: Citation[];
  /** Optional className for the outer card. */
  className?: string;
}

function StatusBadge({
  displayStatus,
}: {
  displayStatus: AdvisoryDerivation["display_status"];
}) {
  if (displayStatus === "verified") {
    return (
      <span
        className="badge badge-neutral"
        style={{ fontSize: 10 }}
        aria-label="Verified"
      >
        VERIFIED
      </span>
    );
  }
  if (displayStatus === "partial") {
    return (
      <span
        className="badge"
        style={{
          fontSize: 10,
          // #f0883e read 2.53:1 on the card. This badge says the thesis is only
          // PARTIAL — a caveat nobody can read is not a caveat, so it takes the
          // AA-compliant warning token like every other caution on the site.
          // --warning at 12% / 40%. Keep both in step with the token in
          // globals.css: a stale triplet here renders the old, sub-AA orange
          // while every tokenised caution on the site moves.
          background: "rgba(168, 50, 9, 0.12)",
          color: "var(--warning)",
          borderColor: "rgba(168, 50, 9, 0.4)",
        }}
        aria-label="Partial"
      >
        PARTIAL
      </span>
    );
  }
  return null;
}

export default function ThesisBlock({ advisory, citations, className }: Props) {
  const { display_status, unavailable_reason } = advisory;

  // ---- Strict gate ----------------------------------------------------------
  // Delegated to `canRenderAdvisoryBody` so this policy lives in exactly one
  // place. Do not re-implement it here: the per-pick cards on /research gate on
  // the same function, and the two must never diverge.
  if (!canRenderAdvisoryBody(advisory)) {
    return (
      <div
        className={`card p-7 ${className ?? ""}`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: "rgba(159, 23, 42, 0.3)",
        }}
        role="status"
        aria-label="Thesis unavailable"
      >
        <div className="flex items-baseline gap-2.5 mb-3">
          <h3 className="text-[18px] font-semibold m-0">Thesis unavailable</h3>
          <span
            className="badge"
            style={{
              fontSize: 10,
              background: "rgba(159, 23, 42, 0.12)",
              color: "var(--short)",
              borderColor: "rgba(159, 23, 42, 0.4)",
            }}
            aria-label="Unavailable"
          >
            UNAVAILABLE
          </span>
        </div>
        <p className="m-0 leading-[1.7] text-text-primary text-[13.5px] mb-3">
          The Q1 thesis was not produced by the verified L5 path for this run.
          We do not display heuristic or unverified output to investors.
        </p>
        {unavailable_reason && (
          <p className="m-0 leading-[1.6] text-text-secondary text-[12.5px]">
            <span className="text-text-tertiary uppercase tracking-[0.1em] text-[10.5px] font-semibold mr-2">
              Reason
            </span>
            {unavailable_reason}
          </p>
        )}
      </div>
    );
  }

  // ---- Render the verified/partial body ------------------------------------
  return (
    <div className={`card p-7 ${className ?? ""}`}>
      <div className="flex items-baseline gap-2.5 mb-4">
        <h3 className="text-[18px] font-semibold m-0">Thesis</h3>
        <StatusBadge displayStatus={display_status} />
        {advisory.evidence_ids.length > 0 && (
          <span className="text-text-tertiary text-[11px]">
            {advisory.evidence_ids.length} evidence source
            {advisory.evidence_ids.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <CitationList text={advisory.body} citations={citations} />
    </div>
  );
}