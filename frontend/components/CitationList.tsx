"use client";

import { DisclosureChevron } from "@/components/DisclosureChevron";

/**
 * Inline citation footnotes on a thesis paragraph, plus a footnotes panel.
 *
 * Pattern (Perplexity-style): every numeric claim in the thesis is followed by
 * a superscript ¹-⁵ that resolves to a source on click. The source list is
 * rendered below the thesis.
 *
 * Usage:
 *   <CitationList
 *     text={pick.thesis}
 *     citations={pick.citations}
 *   />
 *
 * If `citations` is missing, the text is rendered verbatim (no superscripts).
 */
export interface Citation {
  /** Number shown as superscript (1, 2, 3, ...). */
  n: number;
  /** Source label, e.g. "FRED · DGS10" or "Brave News · 87 articles". */
  source: string;
  /** Optional one-line detail. */
  detail?: string;
  /** Optional URL the reviewer can click to verify. */
  href?: string;
}

interface Props {
  /** Thesis text. May contain `{n}` placeholders that get replaced by superscript refs. */
  text: string;
  /** List of citations. If empty, text is rendered verbatim. */
  citations?: Citation[];
}

/** Renders a text block, replacing each `{N}` token with a superscript anchor. */
function InlineWithCitations({ text, citations }: Props) {
  if (!citations || citations.length === 0) return <>{text}</>;

  const byN = new Map(citations.map((c) => [c.n, c]));
  // Tokens like {1}, {2}, ... {N}; each renders as a clickable superscript anchor
  // that scrolls to the matching footnote.
  const parts: React.ReactNode[] = [];
  let i = 0;
  const re = /\{(\d+)\}/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) parts.push(text.slice(i, m.index));
    const n = Number(m[1]);
    const cite = byN.get(n);
    if (cite) {
      parts.push(
        <sup key={`cite-${key++}`}>
          <a
            href={`#cite-${n}`}
            className="text-accent no-underline hover:underline"
            style={{ fontSize: 10, marginLeft: 1 }}
            title={cite.source}
          >
            {n}
          </a>
        </sup>
      );
    } else {
      parts.push(`{${n}}`);
    }
    i = m.index + m[0].length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export default function CitationList({ text, citations }: Props) {
  if (!citations || citations.length === 0) {
    return <p className="m-0 leading-[1.7] text-text-primary text-[14px]">{text}</p>;
  }

  // The backend emits citations as {text, source, value} with no `n`, and often
  // repeats a source (four "scenario analysis" rows). Number them here from
  // position and collapse exact duplicates, so the panel reads as a clean source
  // list rather than "1. [] CL=F" twenty-three times.
  const seen = new Set<string>();
  const sources = citations
    .filter((c) => {
      const key = `${c.source}|${c.detail ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c, i) => ({ ...c, n: c.n ?? i + 1 }));

  return (
    <div>
      <p className="m-0 leading-[1.7] text-text-primary text-[14px]">
        <InlineWithCitations text={text} citations={citations} />
      </p>
      {/* Progressive disclosure: a compact count by default, the full source
          keys on click. The keys (FRED IDs, L4 risk, book_metrics) are audit
          provenance, not reader-facing prose — collapsed so they don't drown
          the thesis. */}
      <details className="mt-3 group">
        <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none text-[11.5px] text-text-secondary hover:text-text-primary select-none">
          <span className="num font-medium">{sources.length}</span> verified sources
          <DisclosureChevron className="text-text-tertiary" />
        </summary>
        <ul className="m-0 mt-2 p-0 flex flex-wrap gap-x-3 gap-y-1 text-text-secondary text-[11px] leading-[1.6] list-none">
          {sources.map((c) => (
            <li key={`${c.source}-${c.n}`} id={`cite-${c.n}`}>
              <span className="text-text-tertiary num mr-1">{c.n}</span>
              <span className="text-text-primary num">{c.source}</span>
              {c.detail && <span className="text-text-tertiary"> · {c.detail}</span>}
              {c.href && (
                <a
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline ml-1"
                >
                  ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
