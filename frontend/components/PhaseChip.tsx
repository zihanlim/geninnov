// frontend/components/PhaseChip.tsx
//
// The eyebrow above a destination's title, naming which phase(s) of the
// investment process that destination serves.
//
// This is the half of ADR-0169 that travels TO the reader rather than waiting
// for them to visit /method. The process map states the whole sequence; this
// says "you are here" without making them go and look.
//
// Deliberately NOT `SectionNav`. That component is asserted to contain no digits
// (`SectionNav` labels are nouns, never figures), and every label here is
// numbered. Reusing it would either break its test or force the numbers out,
// and the number is the point — it is what locates the page in a sequence.
//
// Renders NOTHING for a route with no phases, rather than an empty rule or a
// placeholder. `/ask` and `/workbench` are tools for reading the site, not steps
// in the process, and labelling them would make the sequence claim more than it
// can support.

import Link from "next/link";
import { phaseNumber, phasesForRoute } from "@/lib/method/phases";

export default function PhaseChip({ route }: { route: string }) {
  const phases = phasesForRoute(route);
  if (phases.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
      {phases.map((p, i) => (
        <span key={p.id} className="inline-flex items-center gap-x-2">
          {i > 0 && (
            <span aria-hidden="true" className="text-text-tertiary text-[10px]">
              ·
            </span>
          )}
          <Link
            href="/method"
            className="badge badge-neutral hover:border-accent hover:text-accent transition-colors no-underline"
            // The link target is the map, not the phase's own destination — a
            // reader already ON that destination would otherwise be offered a
            // link back to where they are standing.
            title={`${p.name} — see the full process on /method`}
          >
            <span className="num text-text-tertiary">{phaseNumber(p)}</span>
            <span className="uppercase tracking-[0.08em] text-[10px]">
              {p.name}
            </span>
          </Link>
        </span>
      ))}
    </div>
  );
}
