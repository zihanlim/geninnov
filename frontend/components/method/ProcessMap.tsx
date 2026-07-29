// frontend/components/method/ProcessMap.tsx
//
// /method — chapter zero: what is the process, and where does each step live?
//
// The two existing chapters answer "how is this number built?" (/method/build)
// and "did it run, and who checked it?" (/method/evidence). Neither answers the
// question that precedes both: what are the steps, in what order, and which of
// them does this system actually perform. That question had no surface until
// ADR-0169, and its answer lived only in a comment at the top of `TopBar.tsx`.
//
// WHY THIS IS NOT A `MethodBody` CHAPTER.
// `MethodBody` fires all twelve of its Supabase queries on every chapter, on
// purpose — one component, one useEffect, so two chapters can never describe
// different vintages of the same run (ADR-0084). That trade is right for two
// chapters full of live figures and wrong for this one, which renders no figure
// at all. Routing the map through `MethodBody` would buy the consistency
// guarantee for a page with nothing to be inconsistent about, and charge twelve
// queries for it. It is a server component with no fetch instead.
//
// Every phase's target is read from `lib/method/phases.ts`, never written here,
// so this page and the `PhaseChip` eyebrows cannot disagree about which surface
// serves which step.

import Link from "next/link";
import { PHASES, phaseHref, phaseNumber } from "@/lib/method/phases";
import { Note } from "@/components/method/primitives";

export default function ProcessMap() {
  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
          Method &amp; Lineage
        </h1>
        <p className="m-0 text-text-secondary text-[13px] max-w-[80ch]">
          The six phases a portfolio manager works through, and the surface in
          this system that performs each one. Five are live and link to their
          evidence; one is out of scope and says why. For the arithmetic behind a
          score see{" "}
          <Link href="/method/build" className="text-accent hover:underline">
            how a number is built
          </Link>
          ; for whether the pipeline ran and who checked it see{" "}
          <Link href="/method/evidence" className="text-accent hover:underline">
            the audit trail
          </Link>
          .
        </p>
      </div>

      <ol className="list-none m-0 p-0 space-y-3">
        {PHASES.map((p) => {
          const href = phaseHref(p);
          return (
            <li key={p.id} className="card">
              <div className="card-header">
                <span className="card-title flex items-center gap-2.5">
                  <span className="num text-text-tertiary">{phaseNumber(p)}</span>
                  <span>{p.name}</span>
                </span>
                {href ? (
                  <Link
                    href={href}
                    className="text-accent hover:underline text-[11px] num"
                  >
                    {href}
                  </Link>
                ) : (
                  /* Not a disabled link and not a dash. A reader scanning the
                     right-hand column for destinations needs this row to read as
                     a decision rather than as a row that failed to load. */
                  <span className="badge badge-neutral text-[10px] uppercase tracking-[0.08em]">
                    Out of scope
                  </span>
                )}
              </div>
              <div className="card-body">
                <p className="m-0 text-[13px] text-text-primary leading-[1.6]">
                  {p.question}
                </p>
                <p className="m-0 mt-1.5 text-[12px] text-text-secondary leading-[1.6]">
                  {p.note}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-7 max-w-[80ch]">
        <Note label="Why the navigation is not six tabs">
          These phases are a sequence; the four destinations above are objects. A
          reader arrives asking <em>what is moving</em> or <em>what kills this
          book</em>, not asking to perform phase three. Two phases here land on{" "}
          <Link href="/risk" className="text-accent hover:underline">
            /risk
          </Link>{" "}
          — the mandate a book is measured against, and the scenarios that stress
          it — and separating them to satisfy the numbering would break the risk
          picture apart to serve the narrative. Phase 5 would be a permanently
          empty destination. So the process gets one surface and a label on each
          page, and navigation stays organised by what a reader came to ask.
        </Note>
      </div>
    </main>
  );
}
