"use client";
// frontend/components/chat/VerifiedProse.tsx
//
// The answer, with every numeral wearing its provenance.
//
// This component is the reason /ask is allowed to exist in a product whose first
// design goal is "no naked numbers". A chat answer is prose full of figures; if
// they render as plain text, the page has just shipped the exact thing the rest
// of the site refuses. So each numeral is marked in place:
//
//   cited      dotted underline, hover shows the table.column it came from
//   quoted     no underline, marked with a ° and attributed to the prose it was
//              taken from — a figure the agent repeated, not one it looked up
//   unverified --warning ink, superscript ?, and named in the footer
//
// The marks are NOT colour alone. Goal 3's argument about direction applies to
// any semantic carried by hue: cited/quoted/unverified differ by underline,
// symbol and tooltip, so the distinction survives desaturation and colour
// blindness.

import type { NumeralVerdict } from "@/lib/chat/guardrail";

interface Props {
  answer: string;
  verdicts: NumeralVerdict[];
}

interface Segment {
  text: string;
  verdict?: NumeralVerdict;
}

/**
 * Cut the answer into plain and marked segments.
 *
 * Verdicts carry character offsets from the guardrail, so this never re-parses
 * the prose — a second regex here could disagree with the one that adjudicated,
 * and the reader would see a figure marked as unverified while the footer said
 * everything traced.
 */
export function segment(answer: string, verdicts: NumeralVerdict[]): Segment[] {
  const sorted = [...verdicts].sort((a, b) => a.index - b.index);
  const out: Segment[] = [];
  let cursor = 0;
  for (const v of sorted) {
    // The guardrail trims its tokens, so the recorded index can sit one
    // character before the token's own start.
    const start = answer.indexOf(v.token, Math.max(0, cursor));
    if (start < 0) continue;
    if (start > cursor) out.push({ text: answer.slice(cursor, start) });
    out.push({ text: v.token, verdict: v });
    cursor = start + v.token.length;
  }
  if (cursor < answer.length) out.push({ text: answer.slice(cursor) });
  return out;
}

function Numeral({ verdict, text }: { verdict: NumeralVerdict; text: string }) {
  // A month is a word, not a figure. Setting "July" in tabular mono beside the
  // surrounding prose would read as a data value and look like a typesetting
  // bug; it still gets the same mark, because it makes the same kind of claim.
  const mono = verdict.kind === "month" ? "" : "num";
  const noun = verdict.kind === "month" ? "date" : "figure";

  if (verdict.grounding === "cited") {
    return (
      <span
        className={`${mono} border-b border-dotted border-border-strong cursor-help`.trim()}
        title={
          verdict.kind === "month"
            ? "The month of the run this answer is about."
            : `${verdict.fact?.label ?? "Source"} — ${verdict.fact?.source ?? ""}`
        }
      >
        {text}
      </span>
    );
  }
  if (verdict.grounding === "quoted") {
    return (
      <span className={`${mono} cursor-help`.trim()} title="Quoted from the run's own prose (a thesis, a counter-thesis, or your question) — repeated, not recomputed.">
        {text}
        <span aria-hidden className="text-text-tertiary">°</span>
        <span className="sr-only"> (quoted, not recomputed)</span>
      </span>
    );
  }
  return (
    <span
      className={`${mono} font-semibold cursor-help`.trim()}
      style={{ color: "var(--warning)" }}
      title={`This ${noun} matched no fetched value. It was not verified against the published book — treat it as unsourced.`}
    >
      {text}
      <sup aria-hidden>?</sup>
      <span className="sr-only"> (unverified — traces to no fetched value)</span>
    </span>
  );
}

export default function VerifiedProse({ answer, verdicts }: Props) {
  const segments = segment(answer, verdicts);
  return (
    <div className="text-[13.5px] leading-[1.7] text-text-primary whitespace-pre-wrap">
      {segments.map((s, i) =>
        s.verdict ? <Numeral key={i} verdict={s.verdict} text={s.text} /> : <span key={i}>{s.text}</span>,
      )}
    </div>
  );
}
