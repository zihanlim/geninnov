"use client";

import { ScrollArea } from "@/components/ScrollArea";
import {
  classifyOverlap,
  overlapLabel,
  HIGH_CORR_THRESHOLD,
} from "@/lib/candidateOverlap";

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
}: {
  candidates: CandidateRow[];
  /** Assets in today's book. */
  heldAssets: Set<string>;
  /** Side of each held asset — without it, a correlation cannot say whether a
   *  candidate duplicates a held bet or offsets it. */
  heldDirections?: Record<string, "long" | "short">;
  themeNames: Record<string, string>;
  correlations?: CandidateCorrelations;
}) {
  const notTaken = candidates
    .filter((c) => !heldAssets.has(c.asset))
    .sort((a, b) => {
      // Shorts first — that is the side the book is thin on and the side a reader
      // is most likely to be interrogating.
      if (a.direction !== b.direction) return a.direction === "short" ? -1 : 1;
      return Math.abs(b.edge_score ?? 0) - Math.abs(a.edge_score ?? 0);
    });

  if (notTaken.length === 0) return null;

  const shorts = notTaken.filter((c) => c.direction === "short").length;

  return (
    <div className="card mb-6">
      <div className="card-header">
        <span className="card-title">Cleared the screen — not taken</span>
        <span className="num text-[11px] text-text-tertiary">
          {notTaken.length} held back
          {shorts > 0 ? ` · ${shorts} short` : ""}
        </span>
      </div>

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
        <strong>Pool depth</strong> above, measured rather than assumed.
      </p>

      <ScrollArea hint={false}>
        <table className="w-full border-collapse text-[12.5px] min-w-[680px]">
          <caption className="sr-only">
            Candidates that cleared screening but are not held, with EdgeScore and
            whether their theme is already represented in the book.
          </caption>
          <thead>
            <tr className="border-y border-border bg-bg-elevated">
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
              return (
                <tr
                  key={`${c.asset}-${c.direction}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-[18px] py-[7px] num font-medium">{c.asset}</td>
                  <td
                    className="px-3 py-[7px]"
                    style={{
                      color:
                        c.direction === "short" ? "var(--short)" : "var(--long)",
                    }}
                  >
                    {c.direction === "short" ? "Short" : "Long"}
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
