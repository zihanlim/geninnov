// `fetchNarratives` must read ONE corpus.
//
// Two series live in `narrative_signals` since migration 057 (ADR-0153): `combined`
// (~98 docs/day, dense, the honest answer to "what is the news about today") and
// `archive` (~11 docs/day, sparse, but one definition all the way back, which is what
// makes a velocity mean anything).
//
// A share is a fraction OF a corpus. An unfiltered read interleaves an 11-document
// day with a 98-document day under the same phrase, so a chart line swings by a
// factor of nine for reasons that have nothing to do with attention — and nothing
// about the chart would look wrong. That is why this is asserted rather than trusted.

import { afterEach, describe, expect, it, vi } from "vitest";

const eq = vi.fn();
const order = vi.fn();
const limit = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...a: unknown[]) => {
      from(...a);
      return { select: (...b: unknown[]) => (select(...b), chain) };
    },
  },
}));

const chain: Record<string, unknown> = {
  eq: (...a: unknown[]) => (eq(...a), chain),
  order: (...a: unknown[]) => (order(...a), chain),
  limit: (...a: unknown[]) => {
    limit(...a);
    return Promise.resolve({ data: [], error: null });
  },
};

import { fetchNarratives } from "@/lib/narratives";

afterEach(() => vi.clearAllMocks());

describe("fetchNarratives", () => {
  it("filters to the combined corpus by default", async () => {
    await fetchNarratives();
    expect(from).toHaveBeenCalledWith("narrative_signals");
    expect(eq).toHaveBeenCalledWith("corpus", "combined");
  });

  it("reads the archive series when asked for it", async () => {
    await fetchNarratives(30, "archive");
    expect(eq).toHaveBeenCalledWith("corpus", "archive");
  });

  it("always constrains the corpus — never an unfiltered read", async () => {
    // The property that matters. If the filter is ever dropped, the query returns
    // both series interleaved and every share becomes incomparable with the one
    // beside it.
    for (const corpus of ["combined", "archive"] as const) {
      vi.clearAllMocks();
      await fetchNarratives(30, corpus);
      const corpusFilters = eq.mock.calls.filter(([col]) => col === "corpus");
      expect(corpusFilters).toHaveLength(1);
      expect(corpusFilters[0][1]).toBe(corpus);
    }
  });
});
