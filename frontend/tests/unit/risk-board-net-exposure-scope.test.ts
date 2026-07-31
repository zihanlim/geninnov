import { describe, it, expect } from "vitest";
import { buildLimitBoard, type LimitBoardInputs } from "@/lib/risk/riskBoard";

/**
 * A long/short net band cannot be satisfied by a book that had nothing to short.
 *
 * Observed live on the 2026-07-30 credit book. Its candidate pool contained **zero**
 * short names, so the book is long-only, |net| equals gross by construction, and the
 * ±30% net-exposure band read **167% — BREACHED**. It was the only breach on
 * `/mandate`, and because `tightest()` picks the highest utilisation it was also the
 * "Closest to binding" headline, in warning colour, displacing the three limits that
 * genuinely bind (two single-name caps and the sector cap, all at exactly 100%).
 *
 * The band is MONITORED — nothing in the sizer targets a net exposure — so it could
 * not have caused the book's shape. It was an alarm about a book working exactly as
 * designed, which is what ADR-0197 argues trains a reader to ignore alarms.
 *
 * THE THREE PROPERTIES, and the second is the one most likely to be broken later:
 *
 *   1. the verdict is withheld, not the measurement — 50% against a 30% band is real
 *      and stays on screen;
 *   2. `tightest()` must skip it, or the fix changes nothing a reader sees on the
 *      answer card;
 *   3. it is measured PER RUN from the pool, never assumed per lens — the credit
 *      universe *can* produce shorts, so a blanket exemption would be a mandate that
 *      quietly relaxes itself.
 */

/** The live 2026-07-30 credit book: 3 long positions, 50% gross, 50% net. */
const CREDIT: LimitBoardInputs = {
  config: new Map(),
  totalCapital: 100_000_000,
  var95Usd: null,
  cvar95Usd: null,
  beta: null,
  hhi: 900,
  grossExposure: 0.5,
  netExposure: 0.5,
  maxDrawdown: 0,
  singleNameWeight: 0.2,     // EMB and BIL, both at the 20% cap
  sectorWeight: 0.3,         // Credit, at the 30% cap
  geoWeight: 0.3,
};

const rowFor = (rows: ReturnType<typeof buildLimitBoard>, key: string) => {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`no ${key} row on the board`);
  return row;
};

describe("net-exposure band against a pool with no short side", () => {
  it("is not_applicable, not breached", () => {
    const row = rowFor(
      buildLimitBoard({ ...CREDIT, shortSideAvailable: false }),
      "net_exposure",
    );
    expect(row.status).toBe("not_applicable");
  });

  it("keeps the measurement and withholds only the verdict", () => {
    // The reader should still see |net| 50% against a 30% band. Blanking the value
    // would hide a real figure to avoid an unhelpful judgement about it.
    const row = rowFor(
      buildLimitBoard({ ...CREDIT, shortSideAvailable: false }),
      "net_exposure",
    );
    expect(row.value).toBeCloseTo(0.5, 10);
    expect(row.limit).toBeCloseTo(0.3, 10);
    expect(row.utilisation).toBeCloseTo(0.5 / 0.3, 10);
  });

  it("states why, in the row, and names where the fact was measured", () => {
    // A published risk limit stamped N/A with no reason is indistinguishable from a
    // bug that swallowed the status.
    const row = rowFor(
      buildLimitBoard({ ...CREDIT, shortSideAvailable: false }),
      "net_exposure",
    );
    expect(row.inapplicableReason).toBeTruthy();
    expect(row.inapplicableReason).toContain("no short side");
    expect(row.inapplicableReason).toContain("independent_ideas");
  });

  it("does not become the tightest limit on the board", () => {
    // The headline property. 167% is the highest utilisation here, so anything
    // choosing a maximum must exclude it — the enforced caps at exactly 100% are what
    // actually bind. This mirrors `tightest()` in MandateAnswerCards.
    const rows = buildLimitBoard({ ...CREDIT, shortSideAvailable: false });
    const scoreable = rows.filter(
      (r) => typeof r.utilisation === "number" && r.status !== "not_applicable",
    );
    const top = scoreable.reduce((hi, r) => (r.utilisation! > hi.utilisation! ? r : hi));
    expect(top.key).not.toBe("net_exposure");
    expect(top.utilisation).toBeCloseTo(1, 10);
  });

  it("counts as neither breached nor unknown", () => {
    // `unknown` means the value was withheld for want of sample. Here the value is
    // known exactly and it is the LIMIT that does not govern. Conflating them would
    // send a reader looking for a broken pipeline.
    const rows = buildLimitBoard({ ...CREDIT, shortSideAvailable: false });
    const net = rowFor(rows, "net_exposure");
    expect(net.status).not.toBe("breached");
    expect(net.status).not.toBe("unknown");
  });
});

describe("the band still governs everywhere else", () => {
  it("is scored normally when the pool HAD a short side", () => {
    // Same 50% net, but the shorts existed and the agent chose not to use them. That
    // is a selection the band should absolutely judge.
    const row = rowFor(
      buildLimitBoard({ ...CREDIT, shortSideAvailable: true }),
      "net_exposure",
    );
    expect(row.status).toBe("breached");
    expect(row.inapplicableReason).toBeUndefined();
  });

  it("is scored normally when the pool is unrecorded", () => {
    // A row predating ADR-0056 carries no counts. Absence of evidence must not switch
    // a published limit off — that is the direction that flatters the book.
    for (const input of [
      { ...CREDIT },                              // field omitted entirely
      { ...CREDIT, shortSideAvailable: null },
      { ...CREDIT, shortSideAvailable: undefined },
    ]) {
      const row = rowFor(buildLimitBoard(input), "net_exposure");
      expect(row.status).toBe("breached");
    }
  });

  it("leaves the multi-asset book untouched", () => {
    // The live 07-30 multi-asset book: net −7.7%, 7 short ideas. 26% of the band, OK,
    // and the flag changes nothing about it.
    const MULTI: LimitBoardInputs = {
      ...CREDIT,
      grossExposure: 0.4439,
      netExposure: -0.0769,
      singleNameWeight: 0.075,
      sectorWeight: 0.115,
      geoWeight: 0.2348,
      shortSideAvailable: true,
    };
    const row = rowFor(buildLimitBoard(MULTI), "net_exposure");
    expect(row.status).toBe("ok");
    expect(row.utilisation).toBeCloseTo(0.0769 / 0.3, 4);
  });

  it("only the net-exposure row can be made not-applicable", () => {
    // The flag is about one band's meaning, not a general off switch. If it ever
    // silences another limit, that is a limit nobody decided to disable.
    const rows = buildLimitBoard({ ...CREDIT, shortSideAvailable: false });
    const na = rows.filter((r) => r.status === "not_applicable").map((r) => r.key);
    expect(na).toEqual(["net_exposure"]);
  });
});
