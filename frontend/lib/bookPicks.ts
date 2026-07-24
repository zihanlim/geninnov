// The "held book" is L5's published picks (ADR-0040), the same source /book renders.
// This pulls the distinct asset symbols out of a `research_recommendations.picks`
// payload, which arrives as a jsonb array (or, defensively, its string form).

/** Distinct asset symbols in an L5 `picks` payload. null when unusable. */
export function bookAssetsFromPicks(picks: unknown): string[] | null {
  let arr: unknown = picks;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  return arr
    .map((p) => (p && typeof p === "object" ? (p as { asset?: string }).asset : undefined))
    .filter((a): a is string => Boolean(a));
}
