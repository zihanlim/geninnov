// size_book: the tool that lets a caller bring their own mandate.
//
// It PROXIES to the Python function rather than sizing in TypeScript, so what is
// worth testing here is the wiring and the failure modes — not the arithmetic,
// which is `optimizer.py`'s and is covered by tests/backend/test_compute_api.py.
//
// The failure modes matter more than usual because this tool has a dependency no
// other tool has: a separate runtime that may not be deployed. A reader must never
// be left thinking the published book is broken because a compute function is
// missing.

import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_BY_NAME } from "@/lib/chat/tools";
import type { DbReader } from "@/lib/chat/types";

const SIGNAL_ROWS = [
  { run_date: "2026-07-28", asset: "VRT", direction: "long", conviction: 9.09, vol: 0.044 },
  { run_date: "2026-07-28", asset: "BABA", direction: "short", conviction: 15.81, vol: 0.0262 },
  // An older vintage that must never be mixed into today's solve.
  { run_date: "2026-07-25", asset: "OLD", direction: "long", conviction: 5.0, vol: 0.03 },
];

const db = (rows: Record<string, unknown>[], error: string | null = null): DbReader => ({
  select: async () => ({ rows, error }),
});

const tool = () => TOOL_BY_NAME.get("size_book")!;

function mockFetch(status: number, body: unknown, contentType = "application/json") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("size_book", () => {
  it("is registered and takes a mandate argument", () => {
    expect(tool()).toBeTruthy();
    expect(Object.keys(tool().args)).toContain("mandate");
  });

  it("sends only the latest run's signal to the sizer", async () => {
    const fetchMock = mockFetch(200, {
      ok: true,
      gross: 0.4,
      cash: 0.6,
      signed_weights: { VRT: 0.2, BABA: -0.2 },
      notional: { VRT: 20_000_000, BABA: -20_000_000 },
      mandate: { values: { total_capital: 100_000_000 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    await tool().run({}, { db: db(SIGNAL_ROWS) });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The 2026-07-25 row must not be in it: sizing a mixed-vintage book would
    // silently include a name that was never in today's signal.
    expect(sent.signals.map((s: { asset: string }) => s.asset)).toEqual(["VRT", "BABA"]);
  });

  it("forwards the caller's mandate verbatim", async () => {
    const fetchMock = mockFetch(200, {
      ok: true, gross: 0.2, cash: 0.8,
      signed_weights: { VRT: 0.1 }, notional: { VRT: 50_000_000 },
      mandate: { values: { total_capital: 500_000_000 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    await tool().run(
      { mandate: { total_capital: 500_000_000, max_single_name: 0.1 } },
      { db: db(SIGNAL_ROWS) },
    );

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.mandate).toEqual({ total_capital: 500_000_000, max_single_name: 0.1 });
  });

  it("returns weights and notionals as sourced facts", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      ok: true, gross: 0.4, cash: 0.6,
      signed_weights: { VRT: 0.2, BABA: -0.2 },
      notional: { VRT: 20_000_000, BABA: -20_000_000 },
      mandate: { values: { total_capital: 100_000_000 } },
    }));

    const out = await tool().run({}, { db: db(SIGNAL_ROWS) });
    const byKey = Object.fromEntries(out.facts.map((f) => [f.key, f]));
    expect(byKey["size_book.VRT.weight"].value).toBe(0.2);
    expect(byKey["size_book.BABA.notional"].value).toBe(-20_000_000);
    expect(byKey["size_book.gross"].value).toBe(0.4);
    // Never mistakable for the published book.
    expect(out.notes?.basis).toContain("NOT the published book");
  });

  it("names the no-view assets rather than letting a zero mu pass as a measurement", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      ok: true, gross: 0.2, cash: 0.8,
      signed_weights: { NVDA: 0.05 }, notional: { NVDA: 5_000_000 },
      mandate: { values: { total_capital: 100_000_000 } },
      no_expected_return: { assets: ["NVDA"], note: "no view" },
    }));

    const out = await tool().run({}, { db: db(SIGNAL_ROWS) });
    expect(out.absence).toContain("NVDA");
    expect(out.absence).toContain("variance reduction only");
  });

  it("diagnoses a missing deployment as missing, not as a parser error", async () => {
    // Next.js answers an undeployed /api/compute/size with an HTML 404. Surfacing
    // the JSON parser's complaint about "<!DOCTYPE" reads as a bug in the sizer.
    vi.stubGlobal("fetch", mockFetch(404, null, "text/html"));

    const out = await tool().run({}, { db: db(SIGNAL_ROWS) });
    expect(out.facts).toEqual([]);
    expect(out.absence).toContain("no Python function is serving");
    // And it must protect the reader's confidence in everything else.
    expect(out.absence).toContain("does not affect the published book");
  });

  it("passes the sizer's refusal through verbatim", async () => {
    vi.stubGlobal("fetch", mockFetch(400, {
      ok: false,
      error: "max_gross must be between 0.0001 and 10.0, got 99.0",
    }));

    const out = await tool().run({ mandate: { max_gross: 99 } }, { db: db(SIGNAL_ROWS) });
    // Actionable: the caller can fix this. A generic "bad request" cannot be acted on.
    expect(out.absence).toContain("max_gross must be between");
  });

  it("survives a thrown fetch without taking the answer down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const out = await tool().run({}, { db: db(SIGNAL_ROWS) });
    expect(out.absence).toContain("ECONNREFUSED");
    expect(out.facts).toEqual([]);
  });

  it("says there is no signal rather than sizing nothing", async () => {
    const out = await tool().run({}, { db: db([]) });
    expect(out.absence).toContain("no rows");
    expect(out.facts).toEqual([]);
  });
});
