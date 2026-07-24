/**
 * What distinguishes THIS position from the other names that cleared the screen?
 *
 * The `ASSET · THEME · RATIONALE` line on /book called `plainRationale` alone, which
 * names the dominant EdgeScore component. Trend carries the largest raw magnitudes,
 * so it wins on nearly every name and the output collapses: on the live 2026-07-25
 * book, all five longs read "Long · a strong price uptrend" and all four shorts read
 * "Short · a price downtrend". Nine positions, two distinct strings, on the one layer
 * a reader sees without clicking — and Q1 is literally "what are your top five long
 * and short trades, AND WHY".
 *
 * `plainRationale` is not wrong; it does exactly what its docstring says. It is the
 * recurring shape in this codebase — a correct calculation presented as if it meant
 * something (ADR-0051).
 *
 * The fix is NOT more phrases. A second templated string is the same bug with more
 * words. It has to be a fact that genuinely differs per position, and one already
 * measured: the independent-idea complexes that `PoolDepth` renders (ADR-0048).
 * A name is either the strongest member of a correlated complex — in which case the
 * other members are what it was taken INSTEAD OF, the sharpest available answer to
 * "why this ticker" — or it stands alone, which is a different and equally
 * informative answer.
 *
 * The complexes are computed at rho 0.70 over 252 days, the same threshold /risk uses
 * to flag redundancy inside the book and ClearedNotTaken uses to explain an omission.
 * One threshold, one meaning across the site.
 *
 * Deliberately silent when there is no measurement. An unmeasured complex is not an
 * absent one, and "no correlated alternative" asserted from missing data would be the
 * confident invention GOAL.md keeps warning about.
 */

import type { IndependentIdeas, SideDepth } from "@/components/book/PoolDepth";

export type Distinction =
  | { kind: "strongest"; over: string[] }
  | { kind: "standalone" }
  | { kind: "unmeasured" };

/**
 * Where does `asset` sit in its side's idea map?
 *
 * Returns `unmeasured` — never `standalone` — when the side has no measurement, or
 * when the asset appears nowhere in it. Absence from the map is not evidence of
 * independence: it usually means the name had no usable return history to correlate.
 */
export function distinguishPosition(
  asset: string,
  direction: string | null | undefined,
  ideas: IndependentIdeas | null | undefined
): Distinction {
  if (!asset || !ideas) return { kind: "unmeasured" };
  const side: SideDepth | undefined =
    direction === "long" ? ideas.long : direction === "short" ? ideas.short : undefined;
  if (!side) return { kind: "unmeasured" };

  const complexes = side.complexes ?? [];
  const standalone = side.standalone ?? [];

  const owning = complexes.find((cx) => cx.members.includes(asset));
  if (owning) {
    // Only the strongest member is in the book — that is how the complex is defined.
    // If some other member is the one held, say nothing rather than claim it beat
    // names it did not: the honest reading of that state is that the measurement and
    // the book disagree, which is not this line's job to adjudicate.
    if (owning.strongest !== asset) return { kind: "unmeasured" };
    const over = owning.members.filter((m) => m !== asset);
    return over.length > 0 ? { kind: "strongest", over } : { kind: "standalone" };
  }

  if (standalone.includes(asset)) return { kind: "standalone" };
  return { kind: "unmeasured" };
}

/** How many names to list before eliding. Four is what fits the row at 1440px. */
const MAX_NAMED = 4;

/**
 * The distinction as a clause, or null when there is nothing measured to say.
 * Null is a real answer — the caller renders the driver phrase alone rather than
 * padding the line with a non-statement.
 */
export function distinctionClause(d: Distinction): string | null {
  switch (d.kind) {
    case "strongest": {
      const shown = d.over.slice(0, MAX_NAMED);
      const rest = d.over.length - shown.length;
      const names = shown.join(", ") + (rest > 0 ? ` +${rest} more` : "");
      return `taken over ${names}`;
    }
    case "standalone":
      return "no correlated alternative";
    case "unmeasured":
      return null;
  }
}

/**
 * The full scannable line: the driver phrase, then what the name was taken instead of.
 *
 * Both halves are optional and the line degrades rather than inventing: with no edge
 * the caller's fallback shows, with no measurement only the driver phrase shows.
 */
export function positionRationale(
  plain: string | null,
  d: Distinction
): string | null {
  const clause = distinctionClause(d);
  if (!plain) return clause ? clause[0].toUpperCase() + clause.slice(1) : null;
  return clause ? `${plain} · ${clause}` : plain;
}

/**
 * How many DISTINCT lines a set of positions produces.
 *
 * The defect being fixed was nine rows sharing two strings, and the failure mode of
 * the fix is the same bug with a larger constant. This is the check that catches it,
 * exercised against the live book shape in the tests rather than left to inspection.
 */
export function distinctLineCount(lines: (string | null)[]): number {
  return new Set(lines.filter((l): l is string => l !== null)).size;
}
