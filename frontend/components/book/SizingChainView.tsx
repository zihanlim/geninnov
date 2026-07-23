// frontend/components/book/SizingChainView.tsx
//
// The real sizing derivation, per position. Replaces the stale "HypeScore / 100"
// display. The documented model sizes by conviction (= |EdgeScore| / vol), then
// normalises across the book, clamps to the single-name/sector/geo caps, and
// converts the final weight to a signed notional.
//
// When a position carries no conviction the book was sized by the superseded
// HypeScore heuristic; the chain still renders, but the banner makes the
// provenance unmistakable so a fallback book is never mistaken for the model.

"use client";
import type { SizingChain, SizingStep } from "@/lib/book/positionEdge";

function StepRow({ step, last }: { step: SizingStep; last?: boolean }) {
  return (
    <div
      className={`px-3 py-2 flex justify-between gap-3 items-baseline ${
        last ? "" : "border-b border-border"
      }`}
      style={last ? { background: "var(--bg-elevated)" } : undefined}
    >
      <span className="text-text-secondary text-[12px]">{step.label}</span>
      <span
        className="num font-semibold text-right text-[12px]"
        style={{
          color: step.clamped
            ? "var(--warning)"
            : step.unavailable
              ? "var(--text-tertiary)"
              : undefined,
        }}
      >
        {step.display}
      </span>
    </div>
  );
}

export default function SizingChainView({ chain }: { chain: SizingChain }) {
  return (
    <div>
      {!chain.convictionBased && (
        <div
          className="rounded-md px-3 py-2 mb-2.5 border text-[11.5px] leading-[1.5]"
          style={{
            borderColor: "var(--warning)",
            background: "rgba(210, 153, 34, 0.08)",
            color: "var(--warning)",
          }}
          data-testid="hype-sized-banner"
        >
          Sized by HypeScore, not the documented conviction × inverse-vol model.
          No <span className="num">conviction</span>/<span className="num">vol</span>{" "}
          was persisted for this position, so the size below cannot be traced to an
          EdgeScore.
        </div>
      )}
      <div className="rounded-[8px] border border-border overflow-hidden">
        {chain.steps.map((s, i) => (
          <StepRow key={s.key} step={s} last={i === chain.steps.length - 1} />
        ))}
      </div>
    </div>
  );
}
