// frontend/components/risk/SectionGap.tsx
//
// The empty state for every /risk section. Because the L5 pipeline currently
// produces no positions, this component is the most-seen surface on the page —
// so it has to be useful. Each instance names the exact table.column that is
// missing and the command that fills it.

import type { GapCopy } from "@/lib/risk/analytics";

export function SectionGap({
  copy,
  tone = "empty",
}: {
  copy: GapCopy;
  /** `error` renders the red rail; a failed read is not the same as a clean book. */
  tone?: "empty" | "error";
}) {
  const railColor = tone === "error" ? "var(--short)" : "var(--border-strong)";
  return (
    <div
      role="status"
      className="px-[18px] py-6 text-[13px]"
      data-testid="section-gap"
    >
      <div
        className="pl-4 border-l-2 max-w-[78ch]"
        style={{ borderColor: railColor }}
      >
        <p className="m-0 mb-1.5 font-medium text-text-primary">{copy.headline}</p>
        <p className="m-0 mb-2.5 text-text-secondary leading-[1.6]">{copy.detail}</p>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-baseline">
          <dt className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            Source
          </dt>
          <dd className="m-0">
            <code className="num text-[12px] text-text-secondary bg-bg-elevated border border-border rounded px-1.5 py-0.5">
              {copy.source}
            </code>
          </dd>
          {copy.command && (
            <>
              <dt className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
                Remedy
              </dt>
              <dd className="m-0">
                <code className="num text-[12px] text-accent bg-bg-elevated border border-border rounded px-1.5 py-0.5">
                  {copy.command}
                </code>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

/** A one-line inline note for a sub-group that is missing inside an otherwise
 *  populated section (e.g. sector caps present, geography caps absent). */
export function InlineGap({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 text-[12px] text-text-tertiary leading-[1.6]">{children}</p>
  );
}

/** Monospace identifier chip, for naming a table.column inline in prose. */
export function Ident({ children }: { children: React.ReactNode }) {
  return (
    // [overflow-wrap:anywhere] because these are table.column identifiers with no
    // spaces to break on: `research_recommendations.correlation_pairs` is wider than
    // a 375px card body and its enclosing card clips rather than scrolls, so without
    // this the tail of the source name is silently cut off on a phone.
    <code className="num text-[12px] text-text-secondary bg-bg-elevated border border-border rounded px-1 py-px [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

export function SectionSkeleton({ height = 180 }: { height?: number }) {
  return <div className="skeleton m-[18px]" style={{ height }} aria-hidden="true" />;
}
