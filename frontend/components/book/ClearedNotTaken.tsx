"use client";

import { ScrollArea } from "@/components/ScrollArea";

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
 */

export interface CandidateRow {
  asset: string;
  direction: "long" | "short";
  edge_score: number | null;
  theme_id: string | null;
}

/** |rho| at or above which a candidate is largely the same bet as something held.
 *  Matches book_metrics.HIGH_CORR_THRESHOLD, the level /risk already uses to flag
 *  a correlated pair inside the book — one threshold, one meaning. */
const DUPLICATE_RHO = 0.7;

/** {asset: {closest, corr}} from research_recommendations.candidate_correlations. */
export type CandidateCorrelations = Record<
  string,
  { closest: string; corr: number }
>;

export default function ClearedNotTaken({
  candidates,
  heldAssets,
  themeNames,
  correlations = {},
}: {
  candidates: CandidateRow[];
  /** Assets in today's book. */
  heldAssets: Set<string>;
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
        over 252 days. At or above &rho;&nbsp;{DUPLICATE_RHO.toFixed(2)} the idea is
        largely in the book already, which is the usual reason a strong candidate is
        left out. Below it the name is a genuinely independent idea that was passed
        over — worth asking about, and the agent&apos;s reasoning is in the thesis
        above.
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
              return (
                <tr
                  key={`${c.asset}-${c.direction}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-[18px] py-2.5 num font-medium">{c.asset}</td>
                  <td
                    className="px-3 py-2.5"
                    style={{
                      color:
                        c.direction === "short" ? "var(--short)" : "var(--long)",
                    }}
                  >
                    {c.direction === "short" ? "Short" : "Long"}
                  </td>
                  <td className="px-3 py-2.5 num text-right text-text-secondary">
                    {c.edge_score === null
                      ? "—"
                      : `${c.edge_score >= 0 ? "+" : ""}${c.edge_score.toFixed(3)}`}
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary">
                    {(c.theme_id && themeNames[c.theme_id]) || "—"}
                  </td>

                  <td className="px-3 py-2.5">
                    {corr ? (
                      <>
                        <span className="num">{corr.closest}</span>{" "}
                        <span
                          className="num"
                          style={{
                            color:
                              Math.abs(corr.corr) >= 0.7
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
                  <td className="px-3 py-2.5">
                    {!corr ? (
                      <span className="text-text-tertiary">unmeasured</span>
                    ) : Math.abs(corr.corr) >= DUPLICATE_RHO ? (
                      <span style={{ color: "var(--warning)" }}>
                        largely already held
                      </span>
                    ) : (
                      <span style={{ color: "var(--short)" }}>
                        independent — passed over
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
