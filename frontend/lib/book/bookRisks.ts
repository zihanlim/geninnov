// frontend/lib/book/bookRisks.ts
//
// Structure recovered from `research_recommendations.book_risks`, which is free
// prose the model wrote — five sentences on how this book breaks.
//
// WHAT THIS DOES NOT DO. It authors nothing. No figure is extracted, computed or
// re-labelled: every number in a risk stays inside the sentence the model wrote,
// where the citation guardrail already checked it. The temptation was to pull
// "-2.95%" out of risk 2 and draw a bar from it — and that number is the
// EQUAL-WEIGHTED POOL's return, which the sentence says and a bar would not.
// The book's own figure for that same scenario is -1.86%. Two numbers, one
// label, is the failure /risk exists to prevent; a chart of the wrong one would
// be worse than the paragraph.
//
// WHAT IT DOES. Two things a reader currently has to do by eye:
//
//   1. TICKERS. A risk about SMH is a risk about something the book HOLDS. A
//      risk about NVDA is about something it does not. The prose does not
//      distinguish them and the distinction is most of the point — so held
//      names become chips that open that position, and screened-but-not-held
//      names are marked as what they are.
//
//   2. KIND. The five risks are not five of a kind: some are concentration,
//      some are a named scenario, some are correlation between legs. The label
//      comes from the model's own wording, not from a classifier.
//
// MATCHING IS BOUNDED, and that is what makes it safe. A regex for "uppercase
// word" would hit AI, FY, YoY, PBOC, EM, AND and S1. Instead a token is a ticker
// only if it appears in a set this page already has: the held book, or the L1
// candidate pool. Anything else stays plain text, including real tickers the
// book never saw — NVDA is named in risk 1 and is correctly left alone, because
// nothing on this page can say anything about it.

/** What a risk is mostly about, from the model's own wording. */
export type RiskKind = "concentration" | "scenario" | "correlation" | "other";

export interface RiskToken {
  text: string;
  /** Set when this token is a ticker the page knows. */
  ticker?: string;
  /** In the published book — clickable, opens that position. */
  held?: boolean;
}

export interface ParsedRisk {
  kind: RiskKind;
  /** A named scenario id (`S1`, `S6`) when the risk cites one. Display only:
   *  it is NOT joined to `scenario_results` to print a figure, for the reason
   *  in the header. */
  scenario: string | null;
  tokens: RiskToken[];
  /** Distinct held tickers named, in order of first mention. */
  heldNamed: string[];
}

/**
 * Which kind, from the model's wording.
 *
 * Checked in this order because a sentence can satisfy more than one and the
 * FIRST clause of these sentences is reliably the subject: risk 4 opens "China
 * short concentration ..." and later says "are correlated with", and it is a
 * concentration risk that happens to explain itself through correlation.
 */
export function riskKind(text: string): RiskKind {
  if (/concentration/i.test(text)) return "concentration";
  if (/^\s*scenario\s+S\d/i.test(text)) return "scenario";
  if (/correlat/i.test(text)) return "correlation";
  return "other";
}

/** The scenario id a risk cites, e.g. "S1". Null when it cites none. */
export function riskScenario(text: string): string | null {
  const m = text.match(/\bS(\d)\b/);
  return m ? `S${m[1]}` : null;
}

/**
 * Split a risk into plain text and ticker tokens.
 *
 * `held` and `known` are both required rather than defaulted: a caller with no
 * candidate list should pass the held set twice and get held-only highlighting,
 * not silently lose the distinction between "not held" and "not known".
 */
export function parseRisk(
  text: string,
  held: ReadonlySet<string>,
  known: ReadonlySet<string>,
): ParsedRisk {
  const tokens: RiskToken[] = [];
  const heldNamed: string[] = [];
  // Uppercase runs of 1–5 characters, which is every ticker in this universe.
  // The boundary excludes a letter on either side so `EM` inside `EMB` and the
  // `S` of `S1` cannot match, and a trailing digit is excluded so `S1` and
  // `S6` are never read as tickers.
  const re = /\b[A-Z]{1,5}\b/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const tok = m[0];
    if (!known.has(tok)) continue;
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    const isHeld = held.has(tok);
    tokens.push({ text: tok, ticker: tok, held: isHeld });
    if (isHeld && !heldNamed.includes(tok)) heldNamed.push(tok);
    last = m.index + tok.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return {
    kind: riskKind(text),
    scenario: riskScenario(text),
    tokens,
    heldNamed,
  };
}

/** Every risk, parsed. Order is the model's; nothing is sorted or ranked. */
export function parseRisks(
  risks: readonly string[] | null | undefined,
  held: ReadonlySet<string>,
  known: ReadonlySet<string>,
): ParsedRisk[] {
  return (risks ?? []).filter(Boolean).map((r) => parseRisk(r, held, known));
}

/** Reader-facing label per kind. Nouns, no counts — a count here would be a
 *  figure with no source. */
export const RISK_KIND_LABEL: Record<RiskKind, string> = {
  concentration: "Concentration",
  scenario: "Scenario",
  correlation: "Correlation",
  other: "Risk",
};
