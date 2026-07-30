// frontend/tests/unit/risk-board-turnover.test.ts
//
// The turnover row on the mandate limit board (ADR-0173).
//
// Day-over-day distance from yesterday's published book is the one row on this
// board that is a claim about the STRATEGY rather than about today's snapshot —
// every other row is a pure function of today's weights. Two failure modes this
// guards, in order of how much damage each does:
//
//   1. a first-day / read-failure absence reads as "no turnover", i.e. 0% — which
//      would be the strongest possible governance claim ("perfectly still") for
//      the one case where nothing was actually measured;
//   2. it gets gated by returnSessions like VaR/CVaR/beta above it, silently
//      withholding a number that needs no return-series history at all.

import { describe, it, expect } from "vitest";
import {
  buildLimitBoard,
  isEnforcedLimit,
  NEAR_LIMIT_FRACTION,
  type LimitBoardInputs,
} from "@/lib/risk/riskBoard";
import { ENFORCED } from "@/lib/mandate";

const base: LimitBoardInputs = {
  config: new Map(),
  totalCapital: 100_000_000,
  var95Usd: 1_700_000,
  cvar95Usd: 2_100_000,
  beta: 0.12,
  hhi: 362,
  grossExposure: 0.487,
  netExposure: 0.006,
  maxDrawdown: 0,
  singleNameWeight: 0.137,
  sectorWeight: 0.137,
  geoWeight: 0.35,
  returnSessions: 6,
};

const rowFor = (rows: ReturnType<typeof buildLimitBoard>, key: string) =>
  rows.find((r) => r.key === key)!;

describe("the turnover row", () => {
  it("is an ENFORCED limit", () => {
    expect(isEnforcedLimit("turnover_pct")).toBe(true);
  });

  it("renders null, not zero, with no prior book to measure against", () => {
    const rows = buildLimitBoard({ ...base, realisedTurnover: null });
    const r = rowFor(rows, "turnover");
    expect(r.value).toBeNull();
    expect(r.utilisation).toBeNull();
    expect(r.status).toBe("unknown");
    // The row still carries a real limit, so it is visible even unmeasurable —
    // a limit a PM cannot see is a limit they cannot manage.
    expect(r.limit).toBeGreaterThan(0);
  });

  it("is NOT withheld by returnSessions — it needs no history at all", () => {
    // Unlike VaR/CVaR/beta, this is a function of today's weights and yesterday's,
    // not a statistical estimate over a return series. Two sessions of history
    // must not blank a number that needed none.
    const rows = buildLimitBoard({ ...base, returnSessions: 2, realisedTurnover: 0.3 });
    const r = rowFor(rows, "turnover");
    expect(r.value).toBe(0.3);
    expect(r.status).not.toBe("unknown");
  });

  it("resolves against the mandate default absent a scoring_config row", () => {
    const rows = buildLimitBoard({ ...base, realisedTurnover: 0.3 });
    const r = rowFor(rows, "turnover");
    expect(r.limit).toBe(ENFORCED.turnover_pct.value);
    expect(r.limitSource).toBe("house_default");
  });

  it("reads a scoring_config override when present", () => {
    const cfg = new Map([[ENFORCED.turnover_pct.configKey, "0.45"]]);
    const rows = buildLimitBoard({ ...base, config: cfg, realisedTurnover: 0.3 });
    const r = rowFor(rows, "turnover");
    expect(r.limit).toBe(0.45);
    expect(r.limitSource).toBe("scoring_config");
  });

  it("scores ok / near / breached against its own limit like every other row", () => {
    const wellUnder = rowFor(
      buildLimitBoard({ ...base, realisedTurnover: 0.1 }),
      "turnover",
    );
    expect(wellUnder.status).toBe("ok");

    const near = rowFor(
      buildLimitBoard({
        ...base,
        realisedTurnover: ENFORCED.turnover_pct.value * NEAR_LIMIT_FRACTION,
      }),
      "turnover",
    );
    expect(near.status).toBe("near");

    const breached = rowFor(
      buildLimitBoard({ ...base, realisedTurnover: ENFORCED.turnover_pct.value * 1.5 }),
      "turnover",
    );
    expect(breached.status).toBe("breached");
    expect(breached.headroom).toBeLessThan(0);
  });

  it("carries a source that names the actual persisted column", () => {
    const r = rowFor(buildLimitBoard({ ...base, realisedTurnover: 0.3 }), "turnover");
    expect(r.note).toContain("optimizer_result.realised_turnover");
  });
});
