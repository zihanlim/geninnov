// frontend/components/book/StepNumbered.tsx
//
// ADR-0081 \u2014 the single lineage step primitive. A bordered circle with the
// step number, prose, a formula line in the existing `.num` primitive, and an
// inline `// Source: column` comment in the tertiary text colour.
//
// No new colour, no new chip, no new font, no icon import. The bubble is a
// plain `<span>` inside a bordered circle so the icon-set question stays
// deferred. The connecting rule between sibling steps is the parent'\''s job,
// not this component'\''s, so two `<StepNumbered>`s stacked in a flex column
// produce the hairline between them via the parent'\''s `border-l` on each step
// after the first.

import type { WorkedExampleStep } from "@/lib/book/workedExample";
import { Reconciliation } from "@/components/Reconciliation";

/**
 * The same step, as ONE LINE, for a context that repeats it.
 *
 * `step.prose` is METHODOLOGY, not measurement: steps 1 and 2 are constant
 * strings and 3 and 4 branch only on whether the data exists. It is the same
 * paragraph on every position. Rendered full-size inside a row expander that is
 * already nine cards deep, it put four identical paragraphs between the reader
 * and the position they opened \u2014 the prose was 80% of the block and 0% of the
 * per-position content, which is the formula and the source.
 *
 * So the compact form drops the prose and keeps what differs: number, title,
 * figure, source. The prose survives as the `title` attribute \u2014 acceptable here
 * and NOT for the source line, because a definition may sit behind a hover and a
 * citation may not (design goal 1).
 */
export function StepLine({
  step,
  accent,
}: {
  step: WorkedExampleStep;
  /**
   * The colour of the position this chain belongs to \u2014 `var(--long)` or
   * `var(--short)`. Defaults to `--accent` where there is no direction to carry.
   *
   * A derivation is not a neutral object on this page: it is the derivation OF a
   * long or OF a short, and the row around it is already coloured that way. Four
   * teal bubbles inside a crimson short row read as a different kind of thing
   * than the row that contains them. Direction colour here is reinforcement, not
   * a second meaning \u2014 the step NUMBER carries the sequence, so nothing is
   * encoded by hue alone (goal 3).
   */
  accent?: string;
}) {
  const isGap = !step.sourcePersisted || step.formula.startsWith("\u2014");
  const ink = accent ?? "var(--accent)";
  return (
    <div
      className="grid grid-cols-[1.25rem_1fr] gap-x-2 gap-y-0.5 py-1.5"
      data-testid={`worked-example-step-${step.number}`}
      data-step-number={step.number}
      title={step.prose}
    >
      <span
        aria-hidden="true"
        className="flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-semibold leading-none mt-[1px]"
        style={{ borderColor: ink, color: ink }}
      >
        {step.number}
      </span>
      <div className="min-w-0">
        <span className="text-[12px] font-semibold text-text-primary">
          {step.title}
        </span>{" "}
        <span
          className={`num text-[12px] whitespace-pre-wrap ${isGap ? "text-text-tertiary" : "text-text-primary"}`}
        >
          {step.formula}
        </span>
        {step.formulaGap && (
          <span className="text-[11px] text-text-tertiary"> {step.formulaGap}</span>
        )}
        <div className="text-[10.5px] text-text-tertiary num leading-[1.4]">
          {step.sourceColumn}
          {!step.sourcePersisted && step.sourceGap && (
            <span className="ml-1">{"\u2014 "}{step.sourceGap}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function StepNumbered({ step }: { step: WorkedExampleStep }) {
  const isGap = !step.sourcePersisted || step.formula.startsWith("\u2014");
  return (
    <div
      className="relative pl-10"
      data-testid={`worked-example-step-${step.number}`}
      data-step-number={step.number}
    >
      {/* The bubble. A plain bordered circle, no icon library. */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 flex items-center justify-center w-7 h-7 rounded-full bg-bg-surface border-2 border-accent text-[12px] font-semibold text-accent leading-none"
      >
        {step.number}
      </span>

      <h4 className="m-0 mb-1 text-[13px] font-semibold text-text-primary">
        {step.title}
      </h4>
      <p className="m-0 mb-1.5 text-[12.5px] leading-[1.6] text-text-primary">
        {step.prose}
      </p>

      {/* whitespace-pre-wrap, not a bare div: a derivation is often several
          aligned lines (a column of weighted terms, a Σ rule, then the result),
          and a plain div collapses every newline so the arithmetic arrives as one
          unreadable run. Single-line formulas are unaffected. */}
      <div
        className={`num text-[12.5px] leading-[1.5] whitespace-pre-wrap ${isGap ? "text-text-tertiary" : "text-text-primary"}`}
      >
        {step.formula}
      </div>
      {step.formulaGap && (
        <p className="m-0 mt-1 text-[11.5px] leading-[1.5] text-text-tertiary">
          {step.formulaGap}
        </p>
      )}

      {/* Does this step's arithmetic reproduce what the product reads? Only steps
          that recompute something persisted have anything to answer. */}
      {step.reconciliation && (
        <Reconciliation
          verdict={step.reconciliation.verdict}
          labels={step.reconciliation.labels}
          format={step.reconciliation.format}
          compact
        />
      )}

      <div className="mt-1 text-[11px] text-text-tertiary">
        <span className="num">{step.sourceColumn}</span>
        {!step.sourcePersisted && step.sourceGap && (
          <>
            {" "}
            <span aria-hidden="true">{"\u2014  "}</span>
            <span>{step.sourceGap}</span>
          </>
        )}
      </div>
    </div>
  );
}
