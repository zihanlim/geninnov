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

      <div
        className={`num text-[12.5px] leading-[1.5] ${isGap ? "text-text-tertiary" : "text-text-primary"}`}
      >
        {step.formula}
      </div>
      {step.formulaGap && (
        <p className="m-0 mt-1 text-[11.5px] leading-[1.5] text-text-tertiary">
          {step.formulaGap}
        </p>
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
