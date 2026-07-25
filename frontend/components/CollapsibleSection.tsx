"use client";
import type { ReactNode } from "react";
import { DisclosureChevron } from "@/components/DisclosureChevron";

/**
 * A card whose body collapses behind a one-line summary \u2014 the Perplexity pattern
 * of "headline first, detail on demand". Secondary/audit sections (screening
 * funnel, cross-cutting risks, dense risk tables) use this so a reader isn't
 * forced to scroll past everything at full density to reach the next primary
 * section. Native <details>, so it works without JS state and is keyboard/AT
 * accessible.
 */
export default function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: string;
  /** One-line plain-English gist shown next to the title while collapsed. */
  summary?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={`card mb-6 group ${className}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="card-header cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="card-title flex items-baseline gap-2 min-w-0">
          <span className="shrink-0">{title}</span>
          {summary && (
            <span className="normal-case tracking-normal font-normal text-text-tertiary text-[12px] truncate">
              {"\u00b7 "} {summary}
            </span>
          )}
        </span>
        <span className="text-[11px] text-text-tertiary flex items-center gap-1.5 shrink-0">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
          <DisclosureChevron />
        </span>
      </summary>
      {children}
    </details>
  );
}
