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
 */

export interface CandidateRow {
  asset: string;
  direction: "long" | "short";
  edge_score: number | null;
  theme_id: string | null;
}

export default function ClearedNotTaken({
  candidates,
  heldAssets,
  heldThemeIds,
  themeNames,
}: {
  candidates: CandidateRow[];
  /** Assets in today's book. */
  heldAssets: Set<string>;
  /** Themes the book already has exposure to. */
  heldThemeIds: Set<string>;
  themeNames: Record<string, string>;
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
        These names passed every screen and still did not make the book. A name whose
        theme is <em>already held</em> would mostly duplicate a bet the book has — the
        usual reason a strong candidate is left out. The agent&apos;s own reasoning is
        in the thesis above; this table states only what the data shows.
      </p>

      <ScrollArea hint={false}>
        <table className="w-full border-collapse text-[12.5px] min-w-[520px]">
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
                Book already has this theme?
              </th>
            </tr>
          </thead>
          <tbody>
            {notTaken.map((c) => {
              const dup = c.theme_id ? heldThemeIds.has(c.theme_id) : false;
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
                  <td className="px-3 py-2.5 text-text-secondary">
                    {dup ? (
                      <span style={{ color: "var(--warning)" }}>
                        yes — would largely duplicate a held bet
                      </span>
                    ) : (
                      <span className="text-text-tertiary">no</span>
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
