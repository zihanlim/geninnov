// frontend/components/PageHeader.tsx
//
// The one page header. Title, lede, optional fine print, and the run metadata
// block on the right.
//
// WHY THIS EXISTS
// ---------------
// There were five, hand-rolled, in two treatments (ADR-0189):
//
//   /book              a vertical rule, then `RUN DATE` as a 10px uppercase
//                      micro-label ABOVE its value; lede 14.5px on text-primary
//                      with a 12px tertiary second line
//   /mandate /risk     no rule; `RUN DATE 2026-07-30` inline, label and value on
//   /attribution /     one line at one size; lede 13px on text-secondary
//
// The inline form was the majority — four pages to one — and it is the one that
// went. It is the only place on this site where a label and its figure share a
// line at the same size, which reads as a sentence fragment; every other labelled
// figure in the tree (answer cards, the book's stat strip, the mandate panel's
// boxes) is a micro-label above a `num` value. The rule does work too: it
// separates when-the-data-is-from from the prose that reads it.
//
// The drift was not a decision anywhere. `/` and `RiskBody` are near-identical
// markup written twice; nobody chose for them to differ from `/book`, they just
// did. That is the argument for a component rather than for a convention.
//
// WHAT IT DOES NOT DO
// -------------------
// It renders no figure of its own and takes no data. Every value is passed in,
// already formatted, by the page that read it — so this file can never become a
// second place a run date is derived.

import type { ReactNode } from "react";

export interface PageHeaderMeta {
  /** Rendered as a 10px uppercase micro-label. Kept short: two words at most. */
  label: string;
  /** Pre-formatted. A ReactNode so a caller can attach its own freshness label. */
  value: ReactNode;
  /** Set when the value should read as a warning — e.g. a stale run date. */
  warn?: boolean;
  /** Capitalise the value (the lens is stored lower-case). */
  capitalize?: boolean;
}

/**
 * The right-hand run-metadata block (label above value, right-aligned, with a
 * vertical rule at `sm`). Extracted so it can be rendered OUTSIDE the header —
 * /risk's credit-lens page places it as its own grid column to the right of
 * the scope banner instead of inside the title/lede cell — without duplicating
 * the markup or letting the two surfaces drift apart.
 */
export function PageHeaderMeta({
  meta,
  aside,
}: {
  meta?: PageHeaderMeta[];
  /** Anything that sits above the meta rows — `/` puts its StatusBadge here. */
  aside?: ReactNode;
}) {
  return (
    <div className="shrink-0 self-stretch text-right text-text-secondary text-[12px] sm:border-l sm:border-border sm:pl-5">
      {aside && <div className="mb-2 flex justify-end">{aside}</div>}
      {(meta ?? []).map((m, i) => (
        <div key={m.label} className={i === 0 ? "" : "mt-2.5"}>
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium leading-none">
            {m.label}
          </div>
          <div
            className={`num mt-1 ${m.capitalize ? "capitalize" : ""}`}
            style={m.warn ? { color: "var(--warning)" } : undefined}
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PageHeader({
  title,
  lede,
  fine,
  meta,
  aside,
  className,
}: {
  title: string;
  /** The page's summary sentence. One line of prose, not a caption. */
  lede: ReactNode;
  /** Optional second line — how to read the page, in fine print. */
  fine?: ReactNode;
  /** Right-hand run metadata, top to bottom. Empty renders no block at all. */
  meta?: PageHeaderMeta[];
  /** Anything that sits above the meta block — `/` puts its StatusBadge here. */
  aside?: ReactNode;
  /**
   * Merged into the root. Used by /risk's credit-lens header cell to zero the
   * default `mb-7` (the cell's own fixed height owns the spacing there).
   */
  className?: string;
}) {
  const hasMeta = (meta?.length ?? 0) > 0 || aside !== undefined;

  return (
    <div className={`mb-7 ${className ?? ""}`.trim()}>
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
        {title}
      </h1>
      <div className="flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-text-primary text-[14.5px] leading-[1.55] max-w-[92ch]">
            {lede}
          </p>
          {fine && (
            <p className="m-0 mt-2 text-text-tertiary text-[12px] leading-[1.5] max-w-[100ch]">
              {fine}
            </p>
          )}
        </div>

        {hasMeta && (
          // self-stretch is what makes the rule span the paragraph block rather
          // than hug the two lines of text. Below `sm` the block wraps under the
          // lede and a vertical rule there would be a stray line, so it starts at
          // `sm` — the one piece of this that is a breakpoint rather than a taste.
          <PageHeaderMeta meta={meta} aside={aside} />
        )}
      </div>
    </div>
  );
}
