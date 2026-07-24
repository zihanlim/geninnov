"use client";

/**
 * Why isn't this book five long and five short?
 *
 * Q1 asks for five and five. The book has answered with fewer for many iterations
 * and the reason kept moving — first the universe was too narrow, then the attention
 * gate was discarding whole themes (ADR-0046). Every version of the answer was
 * argued rather than measured, and each one was eventually disproved by the next
 * measurement.
 *
 * This panel states the measurement. A candidate count cannot answer the question:
 * on 2026-07-25 the short side had TWELVE candidates and FIVE ideas, because five of
 * the twelve are one precious-metals bet and four are one China-internet bet. Taking
 * two names from one complex is one idea expressed twice, which is why an agent told
 * to avoid compounding correlated exposure correctly declines to do it.
 *
 * A complex is a connected component of names correlated at or above the same
 * rho 0.70 that /risk uses to flag redundancy inside the book and that
 * ClearedNotTaken uses to explain an omission — one threshold, one meaning across
 * the site.
 *
 * It deliberately does NOT excuse the book. When the count is at or above five and
 * the book holds fewer, this says so in warning colour: the pool was deep enough and
 * the shortfall is the agent's selection, visible in the thesis. That is the sentence
 * this project kept failing to be able to write.
 */

export interface IdeaComplex {
  members: string[];
  strongest: string;
}

/**
 * Whether the agent accounted for the ideas it declined (ADR-0056).
 *
 * Present only on a side that came back under Q1's five with ideas still available.
 * `unexplained` is the list of declined ideas the thesis never names — computed in
 * `shortfall_accounting`, not inferred here, so the panel and the backend cannot
 * disagree about what "explained" means.
 */
export interface Shortfall {
  held: number;
  available: number;
  /** available − held. How many explanations are owed (ADR-0058). */
  empty_slots?: number;
  passed_over: string[];
  named: string[];
  unexplained: string[];
  /** named.length >= empty_slots. The verdict; do not re-derive it here. */
  satisfied?: boolean;
}

export interface SideDepth {
  count: number;
  names: number;
  complexes?: IdeaComplex[];
  standalone?: string[];
  shortfall?: Shortfall;
}

export type IndependentIdeas = Partial<Record<"long" | "short", SideDepth>>;

/** What Q1 asks for per side. Not a threshold to tune — it is the question. */
const Q1_TARGET = 5;

function Side({
  label,
  depth,
  held,
}: {
  label: string;
  depth: SideDepth | undefined;
  held: number;
}) {
  if (!depth || depth.names === 0) return null;
  const { count, names, complexes = [], standalone = [], shortfall } = depth;
  // Short of Q1's five because the pool genuinely had fewer ideas, or because the
  // book left some on the table? Those are different answers and must read
  // differently.
  const poolLimited = count < Q1_TARGET;
  const underPicked = held < Math.min(count, Q1_TARGET);
  // This panel used to end "the agent's reasoning is in the thesis above" whenever a
  // side was under-picked. On the live 2026-07-25 run that was FALSE: the book took
  // four shorts against five ideas and the thesis never mentioned ARKK, the one it
  // declined. The single panel built to expose the shortfall was sending the reader
  // somewhere that did not answer it. It now says which case this is (ADR-0056).
  //
  // The verdict is `satisfied`, computed in shortfall_accounting: the thesis owes one
  // named idea per EMPTY SLOT, not one per declined idea (ADR-0058). Re-deriving it
  // from `unexplained.length` here would resurrect the rule the harness disproved —
  // on a side with ten ideas and five slots, five declines are forced by arithmetic
  // and mean nothing. Older rows carry no `satisfied`, so fall back to the original
  // all-or-nothing reading for them rather than inventing a verdict.
  const unexplained = shortfall?.unexplained ?? [];
  const explained = shortfall?.named ?? [];
  const satisfied = shortfall
    ? (shortfall.satisfied ?? unexplained.length === 0)
    : null;

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="text-[12.5px] font-medium">{label}</span>
        <span className="num text-[12.5px]">
          {names} candidate{names === 1 ? "" : "s"} →{" "}
          <span className="font-semibold">{count}</span> independent idea
          {count === 1 ? "" : "s"} → <span className="font-semibold">{held}</span> held
        </span>
      </div>

      <p className="m-0 mb-2 text-[12px] leading-[1.6] max-w-[92ch]">
        {poolLimited ? (
          <span className="text-text-secondary">
            The pool held fewer than the {Q1_TARGET} Q1 asks for, so this side is
            limited by what the market offered, not by the selection.
          </span>
        ) : underPicked && satisfied === false ? (
          <span style={{ color: "var(--warning)" }}>
            The pool held {count} independent ideas and the book took {held}. This
            side is short of {Q1_TARGET} by choice, not by constraint —{" "}
            <strong>and the thesis does not say why</strong>: it never names{" "}
            <span className="num">{unexplained.join(", ")}</span>. Q1 asks for five a
            side with reasons, so an unexplained omission is the gap, not the count.
          </span>
        ) : underPicked && satisfied === true ? (
          <span className="text-text-secondary">
            The pool held {count} independent ideas and the book took {held}. This
            side is short of {Q1_TARGET} by choice, not by constraint, and the thesis
            accounts for what it declined —{" "}
            <span className="num">{explained.join(", ")}</span>.
          </span>
        ) : underPicked ? (
          <span style={{ color: "var(--warning)" }}>
            The pool held {count} independent ideas and the book took {held}. This
            side is short of {Q1_TARGET} by choice, not by constraint. Whether the
            thesis accounts for the difference was not measured on this run.
          </span>
        ) : (
          <span className="text-text-secondary">
            The book took every independent idea available up to {Q1_TARGET}.
          </span>
        )}
      </p>

      {complexes.length > 0 && (
        <ul className="m-0 p-0 list-none text-[12px] leading-[1.65] space-y-0.5">
          {complexes.map((cx) => (
            <li key={cx.members.join("-")}>
              <span className="text-text-tertiary">One idea — </span>
              <span className="num">{cx.members.join(", ")}</span>
              <span className="text-text-tertiary">
                {" "}
                (strongest <span className="num">{cx.strongest}</span>)
              </span>
            </li>
          ))}
        </ul>
      )}
      {standalone.length > 0 && (
        <p className="m-0 mt-1 text-[12px] text-text-tertiary leading-[1.65] max-w-[92ch]">
          Independent on their own —{" "}
          <span className="num text-text-secondary">{standalone.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

export default function PoolDepth({
  ideas,
  heldLongs,
  heldShorts,
}: {
  ideas: IndependentIdeas | null | undefined;
  heldLongs: number;
  heldShorts: number;
}) {
  // No measurement is not a measurement of zero — render nothing rather than imply
  // the pool was empty.
  if (!ideas || (!ideas.long && !ideas.short)) return null;

  return (
    <div className="card mb-6">
      <div className="card-header">
        <span className="card-title">Pool depth — how many separate bets existed</span>
        <span className="num text-[11px] text-text-tertiary">
          Q1 asks {Q1_TARGET} + {Q1_TARGET}
        </span>
      </div>

      <p className="m-0 px-[18px] pt-3 pb-1 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
        Candidate counts overstate choice. Names correlated at or above &rho;&nbsp;0.70
        over 252 days are <em>one</em> bet however many tickers express it — the same
        threshold <a href="/risk" className="text-accent hover:underline">/risk</a>{" "}
        uses to flag redundancy inside the book. This is what the agent was shown
        before it picked.
      </p>

      <div className="px-[18px] pb-4">
        <Side label="Longs" depth={ideas.long} held={heldLongs} />
        <Side label="Shorts" depth={ideas.short} held={heldShorts} />
      </div>
    </div>
  );
}
