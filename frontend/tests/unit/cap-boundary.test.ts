import { describe, it, expect } from "vitest";
import { buildLimitBoard, CAP_UTIL_EPSILON } from "@/lib/risk/riskBoard";

/**
 * `/risk`'s limit board recomputes each row's status client-side from weights and
 * limits — it does NOT read the backend's persisted `cap_utilisation`. So ADR-0068,
 * which fixed the comparison in `book_metrics.py`, left this board still reporting the
 * phantom breach.
 *
 * The live 2026-07-25 book carried geo US at 0.35000000000000003 against a 0.35 cap,
 * because `allocate_portfolio` clamps a group to its cap (ADR-0037) and summing the
 * clamped per-position floats reintroduces representation error. `util` is then
 * 1.0000000000000002 and a bare `util > 1` calls it breached.
 *
 * Two implementations of one rule is the drift ADR-0058 and ADR-0064 were about. These
 * tests pin the second site.
 */

/** The exact live geo weight that produced "1 breached". */
const LIVE_GEO_US = 0.35000000000000003;

function geoRow(weight: number) {
  const board = buildLimitBoard({
    config: new Map<string, string>(),
    totalCapital: 100_000_000,
    var95Usd: null,
    cvar95Usd: null,
    beta: null,
    hhi: null,
    grossExposure: null,
    netExposure: null,
    maxDrawdown: null,
    singleNameWeight: null,
    sectorWeight: null,
    geoWeight: weight,
    returnSessions: 252,
  });
  return board.find((r) => /geograph/i.test(r.label));
}

describe("a cap sitting exactly on its limit is compliance, not breach", () => {
  it("does not flag the live one-ULP overshoot", () => {
    // Sanity: the raw comparison the board used to make.
    expect(LIVE_GEO_US > 0.35).toBe(true);
    expect(LIVE_GEO_US / 0.35 > 1).toBe(true);

    const row = geoRow(LIVE_GEO_US);
    expect(row).toBeDefined();
    expect(row!.status).not.toBe("breached");
  });

  it("does not flag a weight exactly equal to the cap", () => {
    expect(geoRow(0.35)!.status).not.toBe("breached");
  });

  it("still flags a real overshoot", () => {
    // One basis point over is ~3e-4 of utilisation — five orders above the guard.
    expect(geoRow(0.3501)!.status).toBe("breached");
    expect(geoRow(0.42)!.status).toBe("breached");
  });

  it("the guard is a representation-error guard, not an economic tolerance", () => {
    // 1e-9 of utilisation against a 0.35 cap is ~3.5e-10 of weight — nothing anyone
    // could act on, and five orders below a basis point.
    expect(CAP_UTIL_EPSILON).toBeLessThan(1e-6);
    expect(CAP_UTIL_EPSILON).toBeGreaterThan(0);
  });

  it("a comfortably-under weight is still ok, and a near one still near", () => {
    expect(geoRow(0.10)!.status).toBe("ok");
    expect(geoRow(0.30)!.status).toBe("near"); // 0.30/0.35 = 0.857 >= 0.8
  });
});
