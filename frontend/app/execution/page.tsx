// frontend/app/execution/page.tsx
//
// Phase 5 — the one this system does not perform.
//
// This route exists BECAUSE it is empty. Navigation is one tab per phase, and a
// sequence that silently skips from 4 to 6 makes a reader wonder whether they
// missed a page or whether the process has a hole. Neither is true: execution is
// out of scope, on purpose, and the reason is worth more than the tab costs.
//
// It renders no figure because there is none to render. Per ADR-0040 the
// published book is a RECOMMENDATION — nobody has paid to put it on — so there
// is no fill, no borrow cost and no slippage anywhere in the system. Reporting
// them would mean inventing them, which ADR-0025's rule 1 forbids outright: no
// investor-facing string may be authored in the frontend.

import Link from "next/link";
import { Note } from "@/components/method/primitives";

export default function ExecutionPage() {
  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
          Execution &amp; Microstructure
        </h1>
        <p className="m-0 text-text-secondary text-[13px] max-w-[80ch]">
          Can this be put on without the impact eating the thesis? geninnov does
          not answer that, and this page exists to say so rather than let a gap in
          the sequence imply the question was forgotten.
        </p>
      </div>

      <div className="max-w-[80ch] space-y-4">
        <Note label="Out of scope, deliberately">
          The book published on{" "}
          <Link href="/book" className="text-accent hover:underline">
            Construction
          </Link>{" "}
          is a <strong>recommendation, not a held position</strong> — ADR-0040
          makes the published book the book of record, and nobody has paid to put
          it on. So there is no fill price, no borrow cost, no slippage and no
          market impact anywhere in this system. Every number that would populate
          this page would have to be invented, and a fabricated fill is worse than
          an absent one: it would look exactly like a measurement.
        </Note>

        <div className="card">
          <div className="card-header">
            <span className="card-title">What this phase would need</span>
          </div>
          <div className="card-body text-[12.5px] leading-[1.65] text-text-secondary space-y-2">
            <p className="m-0">
              Named here so the boundary is a scope decision a reader can check,
              rather than a list of things that quietly do not exist:
            </p>
            <ul className="m-0 pl-5 space-y-1">
              <li>
                An execution venue or broker connection — the system is read-only
                and has no order path.
              </li>
              <li>
                Borrow availability and rates per short, which would change which
                shorts are feasible at all.
              </li>
              <li>
                A market-impact model. <code className="num">cost_model.py</code>{" "}
                prices the optimizer&apos;s signed <code className="num">weight_delta</code>{" "}
                linearly and has <em>no</em> impact term, so it understates a large
                trade in a thin name — it is a turnover cost, not an execution
                estimate.
              </li>
              <li>
                Fills to attribute against. Without them,{" "}
                <Link href="/attribution" className="text-accent hover:underline">
                  Attribution
                </Link>{" "}
                scores the published pick, not a realised trade.
              </li>
            </ul>
          </div>
        </div>

        <Note label="What is measured instead" tone="info">
          Turnover and its modelled cost are computed and published — they sit
          with the sizing on{" "}
          <Link href="/book" className="text-accent hover:underline">
            Construction
          </Link>
          . That is the closest this system gets to phase 5, and it is a cost
          applied to a hypothetical rebalance rather than to anything traded.
        </Note>
      </div>
    </main>
  );
}
