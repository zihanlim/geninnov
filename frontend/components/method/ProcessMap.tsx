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
import ChapterTabs from "@/components/method/ChapterTabs";

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
          evidence; one is out of scope and says why.
        </p>
        {/* The two detail chapters are named in the TABS, not in this paragraph.
            They were prose links here and the detailed method page was reported
            as deleted — a sibling route mentioned only in running text is one a
            reader has to read to find. */}
        <ChapterTabs current="/method" />
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
        <Note label="What this page is, now that the nav is the sequence">
          The tabs above <em>are</em> these six phases, so this page is no longer
          the only place the process is legible. It stays because a strip can show
          six labels and not what each phase ASKS, what performs it, or where the
          system stops — and because the tabs are a place to stand, while this is
          the map of why they are in that order.
        </Note>
        <div className="mt-3">
          <Note label="What the split cost">
            <Link href="/risk" className="text-accent hover:underline">
              /risk
            </Link>{" "}
            used to answer three of these phases on one page — the mandate a book
            is measured against, the scenarios that stress it, and what it
            actually did. One page cannot be the current tab for three phases, so
            it is now three routes over one shared body and one shared fetch;
            reading the whole risk picture takes three stops rather than one
            scroll. Old <code className="num">/risk#…</code> links still resolve:
            the route reads the fragment and sends each to the phase that now owns
            it. The method chapters stayed off the strip — they explain{" "}
            <em>every</em> phase, so naming them as one would be false.
          </Note>
        </div>
      </div>
    </main>
  );
}
