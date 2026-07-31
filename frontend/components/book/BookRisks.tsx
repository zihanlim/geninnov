"use client";
// frontend/components/book/BookRisks.tsx
//
// How this book breaks, as five marked rows rather than five bullets.
//
// The content is unchanged — it is the model's own prose, whole, in its own
// order. What the list could not do is show, without being read end to end,
// which risks are about names the book HOLDS and which are about names it does
// not. That is most of what a reader wants from this panel and it was carried
// only by the sentences.
//
// So: a kind marker per row (concentration / scenario / correlation, from the
// model's wording), the cited scenario id where there is one, held tickers as
// buttons that open that position, and screened-but-not-held tickers marked as
// what they are. Everything else stays plain text — including real tickers this
// page knows nothing about, which is why NVDA in risk 1 is not a chip.
//
// NO FIGURE IS LIFTED OUT. The temptation was a bar per risk from the "-2.95%"
// in risk 2; that is the EQUAL-WEIGHTED POOL's return, and the book's own figure
// for the same scenario is -1.86%. One label over two numbers is the failure
// /risk exists to prevent, so every number stays inside the sentence that
// qualifies it. See lib/book/bookRisks.ts.

import { useMemo } from "react";
import {
  parseRisks,
  RISK_KIND_LABEL,
  type ParsedRisk,
} from "@/lib/book/bookRisks";

/** Kind marker. A word, not a colour: the three kinds are not a severity scale
 *  and colouring them would imply an ordering the model never expressed. */
function KindTag({ risk }: { risk: ParsedRisk }) {
  return (
    <span className="shrink-0 flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.09em] text-text-tertiary border border-border rounded px-1.5 py-[1px]">
        {RISK_KIND_LABEL[risk.kind]}
      </span>
      {risk.scenario && (
        <span
          className="num text-[10px] text-text-tertiary"
          title="The scenario this risk cites. Its figure stays in the sentence, which says whether it is the book's or the equal-weighted pool's."
        >
          {risk.scenario}
        </span>
      )}
    </span>
  );
}

export default function BookRisks({
  risks,
  heldAssets,
  knownAssets,
  onSelectAsset,
}: {
  risks: string[] | null | undefined;
  /** Tickers in the published book — these become buttons. */
  heldAssets: ReadonlySet<string>;
  /** Held plus the screened pool. A token outside this set stays plain text. */
  knownAssets: ReadonlySet<string>;
  /** Opens the position drawer. Absent -> held tickers render as plain marks. */
  onSelectAsset?: (asset: string) => void;
}) {
  const parsed = useMemo(
    () => parseRisks(risks, heldAssets, knownAssets),
    [risks, heldAssets, knownAssets],
  );
  if (parsed.length === 0) return null;

  return (
    <ol className="m-0 p-0 list-none" data-testid="book-risks">
      {parsed.map((risk, i) => (
        <li
          key={i}
          className="grid sm:grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 py-2.5 border-b border-border last:border-b-0"
        >
          <KindTag risk={risk} />
          <p className="m-0 text-[13px] leading-[1.7] text-text-primary">
            {risk.tokens.map((t, j) => {
              if (!t.ticker) return <span key={j}>{t.text}</span>;
              if (t.held && onSelectAsset) {
                return (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onSelectAsset(t.ticker as string)}
                    title={`${t.ticker} is in this book — open the position`}
                    className="num font-semibold text-accent hover:underline"
                  >
                    {t.text}
                  </button>
                );
              }
              return (
                <span
                  key={j}
                  // Held but not clickable (no handler), or known-but-not-held.
                  // The second is the informative one: a risk naming a position
                  // the book does NOT hold is a different claim from one naming
                  // a position it does, and the prose does not distinguish them.
                  title={
                    t.held
                      ? `${t.ticker} is in this book`
                      : `${t.ticker} cleared the screen but is not in this book`
                  }
                  className={
                    t.held
                      ? "num font-semibold text-text-primary"
                      : "num text-text-tertiary underline decoration-dotted underline-offset-2"
                  }
                >
                  {t.text}
                </span>
              );
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}
