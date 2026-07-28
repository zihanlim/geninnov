"use client";
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
//
// Step row visually Ã¢â‚¬â€ 2026-07-29. The prototype at
//   stitch_remix_of_auralis_saas_landing_page/.../andromeda_the_100m_book_refined/code.html
// renders the same chain as a node-and-line column (Raw -> Norm -> Cap), with
// the final node filled. This file mirrors that: each step gets a hollow ring
// at the row baseline, the active (last) step gets a solid accent fill, and a
// 2px vertical line connects them. The old `border-b` separators are gone Ã¢â‚¬â€ the
// line replaces them, and one column has become the place hierarchy lives.
//
// Each step also carries a SourceTag pill on the right edge so a reader
// scanning the chain can tell, without a hover, which step is the LITERAL book
// figure (XACT) and which is a computed intermediate (RAW/NORM). Per-key
// vocabulary lives in STEP_TOKEN below; a future test asserts every shipped
// key has an entry.
//
// The border-banner for `convictionBased = false` and the reconciliation alert
// are unchanged Ã¢â‚¬â€ the visual treatment is a layout change, not a contract
// change. tests/unit/book-row-field-coverage.test.tsx asserts the persistence
// of `data-testid="sizing-reconciliation"` and the field-coverage of the
// expanded row, and both still hold.
//
// COLUMN/ROW SHAPE Ã¢â‚¬â€ why the column has no pl-6 and every row does.
// The line and the circles must share one X. Both are absolutely positioned:
//   line   :  absolute left-[3px]  width 2px  (centre at column-left + 4px)
//   circle :  absolute left-[-2px] width 12px (centre at row-border + 4px)
// The only way those centres coincide is if the circle's containing block
// (the row's padding edge) sits at the same X as the line's containing block
// (the column's padding edge). That happens when NEITHER has padding on the
// left of the line, and the ROW supplies its own padding-left to keep its
// labels out from under the circle. The earlier pass gave the column pl-6,
// which pushed the row's containing block 24px to the right and the circles
// landed far away from the line Ã¢â‚¬â€ the column read as a label list with
// floating elements, not a chain.
//
// The border-banner for `convictionBased = false` and the reconciliation alert
// are unchanged Ã¢â‚¬â€ the visual treatment is a layout change, not a contract
// change. tests/unit/book-row-field-coverage.test.tsx asserts the persistence
// of `data-testid="sizing-reconciliation"` and the field-coverage of the
// expanded row, and both still hold.

import type { SizingChain, SizingStep } from "@/lib/book/positionEdge";
import SourceTag, { type SourceToken } from "@/components/source/SourceTag";

/**
 * Default SourceTag token per SizingStep.key. Exported so a test can assert
 * every shipped step key has a vocabulary entry, and so a future tweak (e.g.
 * move CAP to "XACT" only when scoring_config holds it) is one file rather
 * than a fork hunt across the component.
 *
 *   RAW    Ã¢â‚¬â€ raw signal (|edge|, vol, the conviction = |edge|/vol ratio).
 *   NORM   Ã¢â‚¬â€ normalised across the book.
 *   HRS    Ã¢â‚¬â€ the HypeScore fallback path.
 *   XACT   Ã¢â‚¬â€ the live book figure (cap, final, signed, notional).
 */
export const STEP_TOKEN: Record<string, SourceToken> = {
  edge: "RAW",
  vol: "RAW",
  conviction: "RAW",
  normalised: "NORM",
  hype: "HRS",
  cap: "XACT",
  final: "XACT",
  signed: "XACT",
  notional: "XACT",
};

function tokenForStep(step: SizingStep): SourceToken {
  return STEP_TOKEN[step.key] ?? "EST";
}

function StepRow({ step, last }: { step: SizingStep; last: boolean }) {
  // A clamped step is "attention" Ã¢â‚¬â€ the cap ate the raw weight and the figure
  // you see is whatever survived. The warning ink is direction-neutral (it
  // tones the InkRamp above the resolved side), per ADR-0085.
  const valueTone =
    step.unavailable
      ? "text-text-tertiary"
      : step.clamped
        ? "text-warning"
        : last
          ? "text-accent"
          : "text-text-primary";
  return (
    <div className="relative pl-6 pr-1 flex items-center justify-between gap-3 py-0.5">
      {/* Node. Hollow ring by default; solid accent on the resolved (final)
          step, mirroring the prototype's `bg-secondary border-secondary` fill.
          Sits at the row baseline so the line centres through it: left-[-2px]
          on a 12px circle puts the centre at +4px from the row's padding
          edge, which IS the column's left edge in this column structure. */}
      <span
        aria-hidden="true"
        className={`absolute -left-[2px] top-[10px] w-3 h-3 rounded-full ${
          last
            ? "bg-accent border-2 border-accent"
            : "bg-bg-surface border-2 border-border-strong"
        }`}
      />
      <span className="text-text-secondary text-[12px]">{step.label}</span>
      <span
        className={`num font-semibold text-right text-[12px] flex items-center ${valueTone}`}
      >
        {step.display}
        <SourceTag token={tokenForStep(step)} marginLeft />
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
          Sized by HypeScore, not the documented conviction Ãƒâ€” inverse-vol model.
          No <span className="num">conviction</span>/<span className="num">vol</span>{" "}
          was persisted for this position, so the size below cannot be traced to an
          EdgeScore.
        </div>
      )}
      {/* The banner above only catches a MISSING conviction. This catches the
          harder case: conviction present, the chain rendered in full, and the
          steps still not composing into the weight the book holds Ã¢â‚¬â€ which is what
          the published book looked like for as long as it was hype-sized while
          this panel drew the conviction path (ADR-0053). */}
      {chain.reconciliation && (
        <div
          className="rounded-md px-3 py-2 mb-2.5 border text-[11.5px] leading-[1.5]"
          style={{
            borderColor: "var(--warning)",
            background: "rgba(210, 153, 34, 0.08)",
            color: "var(--warning)",
          }}
          data-testid="sizing-reconciliation"
          role="alert"
        >
          {chain.reconciliation}
        </div>
      )}
      {/* The chain column. NO padding-left: the line is anchored here at
          left-[3px] and its centre has to land on the same X the rows' circles
          claim, which only happens when the column's padding edge equals the
          rows' padding edge (= both are at the column's border-left). The
          rows each carry their own pl-6 so the label/value text sits clear
          of the circles. */}
      <div className="relative">
        {/* Vertical line, 2px, between top-2 and bottom-2 (so it doesn't poke
            past the first or last node). Anchored at left-[3px] so its centre
            aligns with the 12px node circles (each at left-[-2px], centre
            +4px). */}
        <span
          aria-hidden="true"
          className="absolute left-[3px] top-2 bottom-2 w-[2px] bg-border-strong"
        />
        {chain.steps.map((s, i) => (
          <StepRow key={s.key} step={s} last={i === chain.steps.length - 1} />
        ))}
      </div>
    </div>
  );
}