// frontend/lib/chat/guardrail.ts
//
// Every numeral in an /ask answer, adjudicated against what the tools actually
// returned.
//
// This is design goal 1 ("no naked numbers") enforced on text a language model
// wrote. The nightly book has had this since ADR-0012 — `verify_citations`
// rejects a pick whose numbers do not reconcile against the frozen L0–L4 inputs,
// and retries. A chat needs it MORE, not less: the book is one artefact reviewed
// daily, while the chat generates unbounded prose on demand, and the failure
// mode is a plausible number in a confident sentence.
//
// THE GROUNDING LADDER, strongest first:
//
//   cited     the numeral matches a Fact returned by a tool this turn. The
//             reader can be shown table.column for it.
//   quoted    it matches no fact but appears verbatim in prose the tools
//             returned (a thesis, a counter-thesis) or in the reader's own
//             question. Legitimate — an answer that quotes the thesis should not
//             be flagged — but it is a QUOTATION, not a computed figure, and the
//             UI says so.
//   unverified  it matches nothing. The model made it up, or derived it by doing
//             arithmetic it was told not to do.
//
// The prose tier exists because collapsing it into `cited` is exactly how a
// guardrail launders a hallucination: a thesis that happens to contain "8.8%"
// would otherwise bless any 8.8% the model wrote about anything. Kept separate,
// prose can only ever justify a quotation.

import type { Fact, ToolResult } from "./types";

export type Grounding = "cited" | "quoted" | "unverified";

export interface NumeralVerdict {
  /** The numeral exactly as it appears in the answer, e.g. "8.8%" or "-$6.0M". */
  token: string;
  /** Character offset in the answer, so the UI can mark it in place. */
  index: number;
  grounding: Grounding;
  /** The fact that grounded it, when `cited`. */
  fact?: Fact;
}

export interface VerificationResult {
  verdicts: NumeralVerdict[];
  citations: Fact[];
  unverified: string[];
  verified: boolean;
}

/**
 * Matches a number with its attached notation: leading sign and currency,
 * trailing percent / multiplier / magnitude suffix. The notation has to come
 * along because 8.8 and 8.8% and $8.8M are three different claims and only one
 * of them may be true of a given fact.
 */
// Two details here are load-bearing and were both found by test rather than by
// reading:
//
//   • The match must START on a sign, a currency symbol or a digit — never on
//     the space before one. A leading `\s?` put the match index one character
//     early, which slipped it outside the ISO-date span and let "2026-07-25"
//     report a stray "2026" alongside the date it belongs to.
//   • The letter suffixes need `(?![A-Za-z])`. Without it "the 2027 maturity
//     wall" parses as 2027 followed by the `m` of "maturity", so a calendar year
//     acquires a magnitude suffix and is adjudicated as a quantity. The suffix
//     group as a whole is optional, so a failed lookahead leaves the trailing
//     space unconsumed rather than mangling the token.
const NUMERAL =
  /[-−+]?\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|bps?|×|x|M|B|bn|m)(?![A-Za-z]))?/g;

/** ISO dates are handled separately — they are one token, not three numbers. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

interface Parsed {
  /** Absolute magnitude, sign dropped: direction is carried by words, not by the guardrail. */
  value: number;
  suffix: string;
  /** Decimal places the answer used, so grounded values are rounded the same way. */
  dp: number;
}

function parseNumeral(token: string): Parsed | null {
  const suffix = (token.match(/(%|bps?|×|x|M|B|bn|m)\s*$/i)?.[1] ?? "").toLowerCase();
  const bare = token
    .replace(/^[-−+]/, "")
    .replace(/\$/g, "")
    .replace(/(%|bps?|×|x|M|B|bn|m)\s*$/i, "")
    .replace(/,/g, "")
    .trim();
  const value = Number(bare);
  if (!Number.isFinite(value)) return null;
  const dp = bare.includes(".") ? bare.split(".")[1].length : 0;
  return { value, suffix, dp };
}

/**
 * Every surface form a fact may legitimately take in prose.
 *
 * A weight of 0.088 is "8.8%" to a reader and 0.088 in the database; a notional
 * of -6_000_000 is "$6.0M". Enumerating the renderings here — rather than asking
 * the model to quote raw values — is what lets the answer read like English
 * without the guardrail rejecting it.
 */
function renderings(fact: Fact): number[] {
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) return [];
  const v = Math.abs(fact.value);
  const out = [v];
  switch (fact.unit) {
    case "pct":
      out.push(v * 100);
      // A fraction quoted in basis points, e.g. a 0.0032 book return as 32bp.
      out.push(v * 10_000);
      break;
    case "pct_points":
      // Already in points (a 4.35% yield persists as 4.35), but a reader may see
      // it as basis points too.
      out.push(v * 100);
      break;
    case "usd":
      out.push(v / 1_000_000, v / 1_000_000_000, v / 1_000);
      break;
    case "usd_price":
      // Only itself. A $9.25 share price must not ground "$9.25M" of notional.
      break;
    case "bp":
      out.push(v / 100, v / 10_000);
      break;
    default:
      break;
  }
  return out;
}

/**
 * Does a numeral in the answer match a rendering of a fact?
 *
 * Rounded to the answer's OWN precision before comparing, which is what makes
 * "8.8%" a match for 0.08812 without a tolerance constant that would also let
 * 8.9% through. An exact-equality check on unrounded values would reject every
 * correctly-rounded figure the model wrote; a fixed epsilon would accept figures
 * that are simply wrong. Rounding to the stated precision does neither.
 */
function matches(parsed: Parsed, candidate: number): boolean {
  const round = (n: number) => Number(n.toFixed(parsed.dp));
  if (round(candidate) === round(parsed.value)) return true;
  // One ulp of the stated precision, for a value the model rounded half-up where
  // toFixed rounded half-even (or vice versa).
  return Math.abs(round(candidate) - round(parsed.value)) <= Math.pow(10, -parsed.dp) / 2 + 1e-9;
}

/** Numerals inside prose the tools returned, plus the reader's own question. */
function proseNumerals(results: ToolResult[], question: string): Set<string> {
  const bag = [question];
  for (const r of results) {
    for (const v of Object.values(r.notes ?? {})) {
      bag.push(Array.isArray(v) ? v.join(" ") : v);
    }
    if (r.absence) bag.push(r.absence);
  }
  const out = new Set<string>();
  for (const text of bag) {
    for (const m of Array.from(text.matchAll(NUMERAL))) {
      const p = parseNumeral(m[0]);
      if (p) out.add(`${p.value}${p.suffix}`);
    }
  }
  return out;
}

/**
 * Adjudicate an answer.
 *
 * Deliberately NOT a boolean. The caller needs to know which figures failed so
 * it can tell the model exactly what to fix on the retry, and the UI needs the
 * per-token verdicts so a reader sees which figure is untraceable rather than a
 * banner over the whole answer.
 */
export function verifyAnswer(
  answer: string,
  results: ToolResult[],
  question = "",
): VerificationResult {
  const facts = results.flatMap((r) => r.facts);
  const prose = proseNumerals(results, question);
  const dates = new Set<string>();
  for (const fact of facts) {
    if (typeof fact.value === "string") dates.add(fact.value);
    if (fact.runDate) dates.add(fact.runDate);
  }

  const verdicts: NumeralVerdict[] = [];
  const citations: Fact[] = [];

  // Dates first, and their spans are excluded from numeral scanning: "2026-07-25"
  // would otherwise decompose into 2026, 07 and 25 — three untraceable integers
  // standing in for one perfectly good date.
  const dateSpans: [number, number][] = [];
  for (const m of Array.from(answer.matchAll(ISO_DATE))) {
    const idx = m.index ?? 0;
    dateSpans.push([idx, idx + m[0].length]);
    verdicts.push({
      token: m[0],
      index: idx,
      grounding: dates.has(m[0]) ? "cited" : "unverified",
    });
  }

  for (const m of Array.from(answer.matchAll(NUMERAL))) {
    const token = m[0].trim();
    const index = m.index ?? 0;
    if (dateSpans.some(([a, b]) => index >= a && index < b)) continue;
    const parsed = parseNumeral(token);
    if (!parsed) continue;

    // A bare four-digit integer in the calendar range is a year — "the 2026
    // refinancing wall" — not a figure claiming to be data. Only bare: 2026% or
    // $2026 is a quantity and gets checked like any other.
    if (!parsed.suffix && parsed.dp === 0 && parsed.value >= 1900 && parsed.value <= 2100 && !/[$%]/.test(token)) {
      verdicts.push({ token, index, grounding: "quoted" });
      continue;
    }

    const hit = facts.find((fact) => {
      // A percent sign in the answer must be met by a percent-ish fact. Without
      // this, a Sharpe of 1.9 would happily ground "1.9%" of anything.
      const wantsPct = parsed.suffix === "%" || parsed.suffix.startsWith("bp");
      const isPct = fact.unit === "pct" || fact.unit === "pct_points" || fact.unit === "bp";
      if (wantsPct && !isPct) return false;
      return renderings(fact).some((c) => matches(parsed, c));
    });

    if (hit) {
      verdicts.push({ token, index, grounding: "cited", fact: hit });
      if (!citations.some((c) => c.key === hit.key)) citations.push(hit);
      continue;
    }
    verdicts.push({
      token,
      index,
      grounding: prose.has(`${parsed.value}${parsed.suffix}`) ? "quoted" : "unverified",
    });
  }

  const unverified = verdicts.filter((v) => v.grounding === "unverified").map((v) => v.token);
  return { verdicts, citations, unverified, verified: unverified.length === 0 };
}
