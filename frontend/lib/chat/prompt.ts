// frontend/lib/chat/prompt.ts
//
// What the model is told. Kept in one file because prompts are the part of an
// LLM feature most likely to be edited by someone who has not read the rest, and
// the rules below are load-bearing rather than stylistic.
//
// The recurring instruction is: DO NOT COMPUTE. The model is a writer with a
// research file, not an analyst with a calculator. Every rule here exists to
// keep it on that side of the line, because the guardrail can only catch a
// fabricated number after the fact — and an answer that fails the guardrail is
// a wasted completion on a shared quota.

import { TOOLS } from "./tools";
import type { ToolResult } from "./types";

const toolCatalogue = () =>
  TOOLS.map((t) => {
    const args = Object.entries(t.args)
      .map(([k, v]) => `      ${k}: ${v}`)
      .join("\n");
    return `  ${t.name}\n    ${t.description}${args ? `\n    args:\n${args}` : "\n    args: none"}`;
  }).join("\n\n");

export const PLAN_SYSTEM = `You route questions about a published quantitative macro book to the data sources that can answer them. You do not answer the question yourself and you do not know any market facts — you only choose sources.

Reply with a single JSON object:
{"calls": [{"tool": "<name>", "args": {...}, "because": "<short reason, shown to the reader>"}], "cannot_answer": "<only if no tool applies>"}

Rules:
- At most 4 calls. Prefer the fewest that cover the question.
- "because" is shown to the reader above the fetched data. Write it as a plain-English reason ("to see how UNH was sized"), not as a restatement of the tool name.
- If the question is about a specific ticker, pass it in args.
- If nothing here can answer (a question about a stock not in the book, live prices, a forecast, or anything outside this product), set "cannot_answer" to one sentence explaining what this book does and does not cover, and return an empty calls array.`;

export const ANSWER_SYSTEM = `You explain a published quantitative macro book to a professional reader, using ONLY the fetched data you are given.

THE ONE RULE: every number in your answer must be copied from the FACTS block. You may not add, average, sum, convert, annualise, extrapolate or otherwise compute any figure. If a number a reader would want is not in the FACTS block, say it was not computed for this run — do not derive it.

Also:
- The book is published once a day. Write about it in the past tense of its run date. Never imply live or intraday data.
- NAME THE RUN BY ITS ISO DATE ONLY — "the 2026-07-25 run". Never write a month name. The first production answer opened "The May 2026 run" about a run dated 2026-07-25: no month was fetched, and inventing one misdates the entire book for the reader.
- WRITE THE DISPLAYED FORM, NEVER THE RAW ONE. A fact shown as "9.25%  (raw 0.0925279954328765)" is written "9.25%". A raw fraction or a fifteen-decimal number in prose is a defect, not precision.
- When a tool reports an ABSENCE, state what is missing and why. Never fill a gap with a plausible value, and never render missing data as zero — they are different claims.
- Report the steps; do not invent the mechanism between them. If two figures do not obviously compose and no note explains why, say plainly that they differ — a confident causal story ("the cap permitted it to expand") is a fabrication even when every number in it is real.
- Spell out integers that are not data ("three reasons", not "3 reasons") so a reader can tell prose from figures at a glance.
- Quote the thesis, counter-thesis and risk prose where it answers the question; you may quote numbers that appear inside that prose, attributing them to the thesis.
- Be direct and specific. No preamble, no "great question", no offer to help further. A short answer that is fully sourced beats a long one that is partly guessed.

Reply with a single JSON object: {"answer": "<your answer as PLAIN PROSE — blank lines between paragraphs, no markdown. Asterisks, hashes and backticks render literally to the reader.>"}`;

export function buildPlanPrompt(question: string): string {
  return `Available tools:

${toolCatalogue()}

Reader's question:
${question}`;
}

/**
 * Render one fact the way a reader should see it, with the raw value beside it.
 *
 * The display form comes FIRST because the model copies what it is shown, and on
 * the first live run it was shown raw fractions — so it wrote "weight
 * 0.0925279954328765" into prose meant for a portfolio manager. Telling it in
 * the system prompt that pct facts are fractions was not enough; it needs the
 * string it should type. The raw value stays visible so a question about the
 * underlying precision is still answerable.
 */
const displayFact = (f: ToolResult["facts"][number]): string => {
  if (f.value === null) return "not computed";
  if (typeof f.value === "string") return f.value;
  switch (f.unit) {
    case "pct":
      return `${(f.value * 100).toFixed(2)}%  (raw ${f.value})`;
    case "usd": {
      const m = f.value / 1_000_000;
      return `${m < 0 ? "-" : ""}$${Math.abs(m).toFixed(2)}M  (raw ${f.value})`;
    }
    case "usd_price":
      return `$${f.value.toFixed(2)}`;
    case "pct_whole":
      return `${f.value.toFixed(2)}%`;
    case "pct_points":
      return `${f.value.toFixed(2)} percentage points`;
    case "count":
      return String(f.value);
    default:
      return String(Number(f.value.toFixed(4)));
  }
};

const renderFacts = (results: ToolResult[]): string =>
  results
    .map((r) => {
      const head = `── ${r.tool}(${JSON.stringify(r.args)}) ──`;
      const facts = r.facts.length
        ? r.facts
            .map((f) => `  ${f.label} = ${displayFact(f)}  (source: ${f.source})`)
            .join("\n")
        : "  (no facts)";
      const notes = Object.entries(r.notes ?? {})
        .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(" | ") : v}`)
        .join("\n");
      const absence = r.absence ? `  ABSENCE: ${r.absence}` : "";
      return [head, facts, notes, absence].filter(Boolean).join("\n");
    })
    .join("\n\n");

export function buildAnswerPrompt(
  question: string,
  results: ToolResult[],
  rejected: string[] = [],
): string {
  // The retry names the exact offending tokens. A generic "cite your sources"
  // retry mostly produces the same answer with more hedging; naming the figure
  // that failed is what actually changes the output.
  const retry = rejected.length
    ? `\n\nYOUR PREVIOUS ANSWER WAS REJECTED. These figures or dates appear in no FACT above: ${rejected.join(", ")}.
Rewrite the answer using only figures from the FACTS block. If one of those numbers was arithmetic you performed, remove it and describe the relationship in words instead.`
    : "";

  return `FACTS (the only numbers you may use):

${renderFacts(results)}

Reader's question:
${question}${retry}`;
}
