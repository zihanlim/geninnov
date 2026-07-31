"use client";

import { ScrollArea } from "@/components/ScrollArea";
import CollapsibleSection from "@/components/CollapsibleSection";
import {
  classifyOverlap,
  overlapLabel,
  HIGH_CORR_THRESHOLD,
} from "@/lib/candidateOverlap";
import {
  inLensCandidates,
  reachedAgent,
  type PoolRestriction,
} from "@/lib/book/candidatePool";

/**
 * Names that cleared the screen and did NOT make the book.
 *
 * "Why isn't X in the book?" had no answer anywhere on the site. The abstention
 * roster covers themes that failed the |EdgeScore| band, and the screening funnel
 * counts what each filter removed — but a candidate that passed every filter and was
 * simply not selected by L5 was invisible. That is the largest remaining gap between
 * the pool and the book, and it is exactly the gap a reviewer probes.
 *
 * It also answers the sharpest question about the current book. Q1 asks for five long
 * and five short; the book holds five and THREE. The pool had five shorts — SLV
 * -0.399, GDX -0.336, NOC -0.304, GLD -0.301, ARKK -0.228 — and L5 took one from each
 * distinct complex, skipping GDX and GLD as the same precious-metals bet already
 * expressed through SLV. Three independent short ideas is the honest answer, and
 * showing the two it declined is what makes it checkable rather than assertable.
 *
 * Deliberately states only what the data supports: the name, its side, its EdgeScore
 * and whether the book already holds something from the same theme. It does NOT
 * attribute a reason to L5 — the agent's rationale lives in the thesis, and inventing
 * one here would be the kind of confident narration this codebase keeps removing.
 *
 * The first version of this panel DID invent one. It labelled every theme overlap
 * "would largely duplicate a held bet", which the data does not support: the
 * Geopolitical Risk theme alone holds TLT long (Rates), EFA long (Developed
 * Equities), SLV short (Metals) and NOC short (Defense) — four sectors, both
 * directions. So GDX was called a duplicate of a theme whose holdings are mostly
 * long, and QQQ long a duplicate of a theme held via UNH long and ARKK SHORT.
 * Occasionally right, for a reason that was wrong.
 *
 * That hedge is no longer needed. candidate_book_correlation (migration 033) now
 * computes each unheld candidate's correlation with its CLOSEST held position over
 * 252 days, so the column states evidence rather than a proxy: GDX -> SLV +0.82 and
 * GLD -> SLV +0.84 are demonstrably the same precious-metals bet the book already
 * holds, which is exactly why the short side is three ideas and not five. Against
 * that, BIL -> TLT -0.18 is genuinely independent and its absence needs a different
 * explanation.
 *
 * A candidate with no usable return history shows as an em dash, never 0.00: an
 * unmeasurable correlation is not an absent one.
 *
 * The "theme also held?" column is gone. Once the correlation column landed it read
 * "yes" on all sixteen rows — provably non-discriminating, and noise beside a column
 * that separates cleanly. The Read column states the consequence instead, and it
 * immediately surfaced something the theme proxy hid: NOC, a short with edge -0.301
 * and only +0.20 correlation to anything held, is INDEPENDENT and was still passed
 * over. So the short side is not capped by redundancy — a claim made one iteration
 * earlier and disproved by this very measurement.
 *
 * And the Read column itself was wrong for three rows until 2026-07-24. It compared
 * raw PRICE correlation and ignored both positions' directions, so with the book
 * SHORT ARKK it labelled long QQQ (+0.77), long IWM (+0.80) and long SPY (+0.80)
 * "largely already held" — each is nearer the REVERSE of a held bet than a duplicate
 * of one. classifyOverlap now signs the correlation by both directions before
 * thresholding it (lib/candidateOverlap.ts). Three rows flipped, and the new
 * "would net against ARKK" is a better reason to pass a name over than the one the
 * page had been giving.
 */

/**
 * Row cap applied to the `trade_candidates` fetch on /book.
 *
 * Exported so the query and the end-of-list terminator read the same number. If
 * they drift, the page silently claims a truncated list is complete — which is
 * precisely the failure the terminator exists to catch, so the constant has one
 * home rather than two literals.
 *
 * PostgREST also caps responses server-side (1000 rows by default) and this repo
 * has already been bitten by that once: `_macro_zscores` had to be rewritten
 * per-series after a silent truncation. A cap you cannot see is a wrong number
 * that looks right.
 */
export const CANDIDATE_POOL_LIMIT = 200;

export interface CandidateRow {
  asset: string;
  direction: "long" | "short";
  edge_score: number | null;
  theme_id: string | null;
  /** ADR-0046: this name's theme sits below the attention gate and was expanded
   *  only because the name's own EdgeScore is decisive. */
  via_conviction?: boolean | null;
}

/** {asset: {closest, corr}} from research_recommendations.candidate_correlations. */
export type CandidateCorrelations = Record<
  string,
  { closest: string; corr: number }
>;

export default function ClearedNotTaken({
  candidates,
  heldAssets,
  heldDirections = {},
  themeNames,
  correlations = {},
  poolLimit = CANDIDATE_POOL_LIMIT,
  pool = null,
  lensLabel,
}: {
  candidates: CandidateRow[];
  /** Assets in today's book. */
  heldAssets: Set<string>;
  /** Side of each held asset — without it, a correlation cannot say whether a
   *  candidate duplicates a held bet or offsets it. */
  heldDirections?: Record<string, "long" | "short">;
  themeNames: Record<string, string>;
  correlations?: CandidateCorrelations;
  /** Row cap the candidate query was fetched under. When the pool comes back at
   *  exactly this size the list is truncated, not complete, and says so. */
  poolLimit?: number;
  /**
   * Which candidates reached the agent, and what to do about the ones that did
   * not. `trade_candidates` has no lens column — it is the one L1 pool shared by
   * every lens — so without this the credit book listed 31 names its own
   * screening funnel had already removed, on the same page saying the pool held
   * 11. Built by `lib/book/candidatePool.ts` from the lens-keyed
   * `independent_ideas` row; see that module's header for why the pool comes
   * from the book's own record rather than from a ticker list, and why a
   * lens-removed name is EXCLUDED while a cap-truncated one is MARKED.
   *
   * Applied here rather than by the caller so ONE component owns the list, the
   * markers and the counts under it. Filtering upstream would have left the
   * truncation check comparing a filtered length against the raw query's row
   * cap, which is how "the list is complete" and "the query was capped" start
   * disagreeing.
   */
  pool?: PoolRestriction | null;
  /** How this book's lens is named in the exclusion line. Absent under the
   *  default lens, where there is no exclusion line to write. */
  lensLabel?: string;
}) {
  // Mode "filter": the lens removed these, so they were never in this book's
  // universe and listing them as declined is a false claim about its selection.
  // Mode "mark": the cap truncated them, so they DID clear every filter and are
  // the only on-page evidence the cap binds — kept, and marked below.
  const shown =
    pool?.mode === "filter" ? inLensCandidates(candidates, pool) : candidates;
  const excludedByLens = candidates.length - shown.length;

  const notTaken = shown
    .filter((c) => !heldAssets.has(c.asset))
    .sort((a, b) => {
      // Shorts first — that is the side the book is thin on and the side a reader
      // is most likely to be interrogating.
      if (a.direction !== b.direction) return a.direction === "short" ? -1 : 1;
      return Math.abs(b.edge_score ?? 0) - Math.abs(a.edge_score ?? 0);
    });

  if (notTaken.length === 0) return null;

  const shorts = notTaken.filter((c) => c.direction === "short").length;
  // Rows kept but never shown to the agent. Only non-empty under mode "mark":
  // under "filter" they are already gone, and under "none" nothing is known.
  const truncated = notTaken.filter((c) => reachedAgent(c, pool) === false);

  // The panel opens by default, but its collapsed summary still carries the finding.
  //
  // This is the answer to the sharpest question a reviewer asks — "what did you
  // look at and decline?" — and its own docstring says so. Hiding it behind
  // "12 held back" would hide the interesting part and leave only the
  // bookkeeping. The interesting part is the name that was genuinely
  // INDEPENDENT of everything the book holds and was passed over anyway:
  // same-bet and offsets candidates are explicable (already owned, or would net
  // against a position), an independent one is a live question.
  //
  // Safari and Firefox do NOT auto-expand a closed <details> for find-in-page,
  // so anything a reader might search for has to appear in the summary text.
  // Naming the ticker here is what keeps Ctrl+F working for the one name that
  // matters.
  //
  // A cap-truncated name is excluded from this selection: it was never shown to
  // the agent, so calling it "passed over" attributes a judgement nobody made —
  // the same invention this panel's docstring refuses for the reason a name is
  // absent. It stays in the TABLE, where its marker says what happened; it just
  // cannot be the headline.
  const mostIndependent = notTaken
    .filter((c) => reachedAgent(c, pool) !== false)
    .map((c) => {
      const corr = correlations[c.asset];
      const { aligned, kind } = classifyOverlap(
        c.direction,
        corr ? heldDirections[corr.closest] : undefined,
        corr?.corr,
      );
      return { asset: c.asset, direction: c.direction, aligned, kind };
    })
    .filter((r) => r.kind === "independent" && typeof r.aligned === "number")
    .sort((a, b) => Math.abs(a.aligned as number) - Math.abs(b.aligned as number))[0];

  const summary = [
    `${notTaken.length} held back`,
    shorts > 0 ? `${shorts} short` : null,
    mostIndependent
      ? `most independent: ${mostIndependent.asset} ${mostIndependent.direction} at ρ ${(mostIndependent.aligned as number).toFixed(2)} to anything held`
      : "none measurably independent of the book",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CollapsibleSection
      title="Cleared the screen — not taken"
      summary={summary}
      className="mb-6"
      defaultOpen
    >

      <p className="m-0 px-[18px] py-3 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
        These names passed every screen and still did not make the book.{" "}
        <strong>Closest held</strong> is the position each is most correlated with
        over 252 days, shown with the side the book holds it on. The read is taken on
        the correlation <em>signed by both directions</em> — a long candidate against
        a short holding is not a duplicate of that bet but its reverse. At or above{" "}
        {HIGH_CORR_THRESHOLD.toFixed(2)} the idea is largely in the book already;
        at or below &minus;{HIGH_CORR_THRESHOLD.toFixed(2)} taking it would net
        against a position already on. Between the two the name is a genuinely
        independent idea that was passed over — worth asking about. Whether the
        thesis actually accounts for what the book declined is stated in{" "}
        {/* `Pool depth` was replaced by `BookFunnel` (ADR-0199); the panel this
            sentence pointed at no longer exists under that name. */}
        the <strong>pool-to-book funnel</strong> above, measured rather than assumed.
      </p>

      <ScrollArea hint={false}>
        <table className="w-full border-collapse text-[12.5px] min-w-[680px]">
          <caption className="sr-only">
            Candidates that cleared screening but are not held, with EdgeScore and
            whether their theme is already represented in the book.
          </caption>
          <thead>
            <tr className="border-y border-border-strong bg-bg-elevated">
              <th className="text-left font-medium px-[18px] py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Asset
              </th>
              <th className="text-left font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Side
              </th>
              <th className="text-right font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Edge
              </th>
              <th className="text-left font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Theme
              </th>
              <th className="text-left font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Closest held (252d)
              </th>
              <th className="text-left font-medium px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                Read
              </th>
            </tr>
          </thead>
          <tbody>
            {notTaken.map((c) => {
              const corr = correlations[c.asset];
              const heldSide = corr ? heldDirections[corr.closest] : undefined;
              const { aligned, kind } = classifyOverlap(
                c.direction,
                heldSide,
                corr?.corr,
              );
              // This name cleared every filter and the cap-30 stage still cut it
              // from the LLM's context window, ordered by conviction. The agent
              // never saw it, so "passed over" would be wrong about this row in
              // the same way the whole panel was wrong about the credit book.
              const cut = reachedAgent(c, pool) === false;
              return (
                <tr
                  key={`${c.asset}-${c.direction}`}
                  className="border-b border-border last:border-b-0"
                  // Stable anchor so a PositionRow on the same page can deep-link
                  // to THIS specific cleared candidate, not just to the section.
                  // Format documented where it is consumed: PositionRow.tsx
                  // (clearedAlternatives) renders `#cleared-${asset}-${direction}`.
                  id={`cleared-${c.asset}-${c.direction}`}
                >
                  <td className="px-[18px] py-[7px] num font-medium">{c.asset}</td>
                  {/* Hollow, not filled — these are sides the book DECLINED, and a
                      solid dir-pill on /book means "we hold this". Same hue so the
                      column still scans (the table sorts shorts first for exactly
                      that reason), same wordmark so nothing rests on colour, but
                      the fill now separates held from passed-over. */}
                  <td className="px-3 py-[7px]">
                    <span
                      className={`dir-pill ${
                        c.direction === "short"
                          ? "dir-pill-cand-short"
                          : "dir-pill-cand-long"
                      }`}
                    >
                      {c.direction === "short" ? "Short" : "Long"}
                    </span>
                  </td>
                  <td className="px-3 py-[7px] num text-right text-text-secondary">
                    {c.edge_score === null
                      ? "—"
                      : `${c.edge_score >= 0 ? "+" : ""}${c.edge_score.toFixed(3)}`}
                  </td>
                  <td className="px-3 py-[7px] text-text-secondary">
                    {(c.theme_id && themeNames[c.theme_id]) || "—"}
                    {/* ADR-0046: which door this name came through. A candidate
                        whose theme cleared the attention gate and one admitted on
                        its own edge alone are different claims about why it is
                        here, and they should not read identically. */}
                    {c.via_conviction && (
                      <span
                        className="ml-1.5 text-[10px] uppercase tracking-[0.08em]"
                        style={{ color: "var(--warning)" }}
                        title="Theme is below the attention gate — admitted on this name's own EdgeScore (ADR-0046)"
                      >
                        on edge
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-[7px]">
                    {corr ? (
                      <>
                        <span className="num">{corr.closest}</span>
                        {/* The side matters as much as the ticker: the same rho reads
                            as a duplicate against one side and a hedge against the
                            other, so it is never shown without it. */}
                        {heldSide && (
                          <span
                            className="text-[11px]"
                            style={{
                              color:
                                heldSide === "short"
                                  ? "var(--short)"
                                  : "var(--long)",
                            }}
                          >
                            {" "}
                            {heldSide === "short" ? "short" : "long"}
                          </span>
                        )}{" "}
                        <span
                          className="num"
                          style={{
                            color:
                              kind === "same-bet" || kind === "offsets"
                                ? "var(--warning)"
                                : "var(--text-secondary)",
                          }}
                        >
                          {corr.corr >= 0 ? "+" : ""}
                          {corr.corr.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      /* No return history: an unmeasurable correlation is not 0.00. */
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-3 py-[7px]">
                    {kind === "unmeasured" ? (
                      <span className="text-text-tertiary">
                        {overlapLabel(kind, null)}
                      </span>
                    ) : (
                      <span
                        style={{
                          color:
                            kind === "independent"
                              ? "var(--short)"
                              : "var(--warning)",
                        }}
                      >
                        {overlapLabel(kind, corr?.closest ?? null)}
                        {kind !== "independent" && aligned !== null && (
                          <span className="num text-text-tertiary">
                            {" "}
                            ({aligned >= 0 ? "+" : ""}
                            {aligned.toFixed(2)})
                          </span>
                        )}
                      </span>
                    )}
                    {/* Sits AFTER the overlap read, not instead of it: the
                        correlation is still true and still worth reading, and
                        replacing it would hide why this name was low-conviction
                        in the first place. On its own line so it cannot be
                        skimmed past as a suffix to the read above it. */}
                    {cut && (
                      <span
                        className="block text-[11px] text-text-tertiary"
                        title="This name cleared every filter. The candidate pool (cap 30) stage then truncated it out of the LLM's context window, keeping the highest |EdgeScore| — so the agent never saw it and did not decline it. See the screening funnel below."
                      >
                        not shown to the agent — cut by the pool cap
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>

      {/* End-of-list terminator. Without it "that is the whole candidate set" and
          "the query hit its row cap" render identically — Goal 2's null-vs-zero
          distinction applied to list LENGTH rather than to a single cell. */}
      {/* The cap is checked against the RAW query length, not the in-lens one: a
          capped query is a capped query whichever lens reads it, and comparing a
          filtered count to the row cap would report a truncated pool as
          complete. */}
      {candidates.length >= poolLimit ? (
        <p className="m-0 px-[18px] py-2 text-[11px] leading-[1.6] text-warning">
          List truncated — the candidate query returned {candidates.length} rows,
          its row cap. There are more names in the pool than are shown here, so
          treat this as a sample and not as the full screen.
        </p>
      ) : (
        <p className="m-0 px-[18px] py-2 text-[11px] leading-[1.6] text-text-tertiary">
          End of list — {notTaken.length} not taken, of {shown.length}{" "}
          candidates screened this run.
        </p>
      )}

      {/* The cap, said once under the list as well as marked per row. A reader
          who scans the table sees the markers; a reader who reads the count needs
          to know that {truncated.length} of the rows above are not the agent's
          judgement at all. Both, because they are different readers. */}
      {truncated.length > 0 && (
        <p className="m-0 px-[18px] pb-2 text-[11px] leading-[1.6] text-text-tertiary">
          {truncated.length} of those{" "}
          {truncated.length === 1 ? "was" : "were"} never shown to the agent: the
          candidate-pool cap in the screening funnel below truncated the pool by
          conviction rank, keeping the highest &#124;EdgeScore&#124;. Those rows
          are marked, and the book did not decline them — nothing chose against
          them, a context-window limit did.
        </p>
      )}

      {/* The excluded names, counted rather than dropped in silence. `trade_candidates`
          is the one L1 pool every lens shares, so a reader who knows the pool ran
          to 42 needs to be told where the other 31 went — and told that they were
          never candidates for THIS book rather than candidates it declined. That
          distinction is the whole point of the panel. */}
      {excludedByLens > 0 && (
        <p className="m-0 px-[18px] pb-2 text-[11px] leading-[1.6] text-text-tertiary">
          A further {excludedByLens} name{excludedByLens === 1 ? "" : "s"} in the
          shared L1 pool{" "}
          {excludedByLens === 1 ? "sits" : "sit"} outside the
          {lensLabel ? ` ${lensLabel}` : ""} lens and{" "}
          {excludedByLens === 1 ? "is" : "are"} not listed. They were removed by
          the lens stage of the screening funnel above, so they never cleared this
          book&rsquo;s screen — they are not names it declined.
        </p>
      )}
    </CollapsibleSection>
  );
}
