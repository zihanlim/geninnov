// frontend/components/status/SourceCaveat.tsx
import { Ident } from "@/components/risk/SectionGap";

/**
 * A standing note about what a section's data is NOT, stated before the reader
 * reaches the figures.
 *
 * Distinct from `EmptyState`, which explains an absence. This is the opposite
 * case and the more dangerous one: the data is present, renders confidently, and
 * invites a reading it does not support — a seven-point series drawn in the shape
 * of a track record, or a crowd-odds feed sitting on a page whose every other
 * number is pipeline output. Goal 1 says a number a reader cannot trace is worse
 * than none; a number a reader traces to the WRONG thing is worse still, because
 * it arrives with confidence attached.
 *
 * Deliberately NOT dismissible. A caveat with a close button is a caveat the
 * reader has been given a way to stop seeing, and it is exactly the readers who
 * skim who need it. It is also not `--warning`: nothing here is wrong or
 * degraded, so the attention ramp would misreport a correct render as a fault
 * (Goal 3 — a tone that means "attention" must not be spent on "context").
 * Quiet ink on the elevated surface, held in place by a rule.
 *
 * `--text-tertiary` on `--bg-elevated` measures 5.23:1, clearing the Goal 8 floor
 * for small text on the only surface this lands on.
 */
export function SourceCaveat({
  children,
  source,
  className = "",
}: {
  /** The sentence. Say what the data is, then what it is not. */
  children: React.ReactNode;
  /** `table.column` the caveat is about, rendered as an ident chip. */
  source?: string;
  className?: string;
}) {
  return (
    <p
      role="note"
      className={`m-0 mb-3 px-3 py-2 text-[11.5px] leading-[1.65] text-text-tertiary bg-bg-elevated border-l-2 border-border-strong rounded-r flex flex-wrap items-baseline gap-x-1.5 gap-y-1 ${className}`}
    >
      <span>{children}</span>
      {source ? <Ident>{source}</Ident> : null}
    </p>
  );
}
