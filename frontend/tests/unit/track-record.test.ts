// frontend/tests/unit/track-record.test.ts
//
// Pins the forward-track-record read model (ADR-0090) against the four ways this panel
// could lie, in order of damage:
//   1. a hit rate of 0% when nothing has resolved (asserts every call was wrong)
//   2. a void counted as a miss (a pick the spec could not score is not a wrong call)
//   3. a void rate denominated in ALL picks (drifts to ~0 as pending rows accumulate)
//   4. three resolved picks presented as a track record
//
// These assertions deliberately mirror tests/backend/test_pick_outcomes.py. The two
// aggregations are separate implementations — see the note in trackRecord.ts for why —
// so the shared semantics have to be pinned on both sides or they drift.

import { describe, expect, it } from "vitest";
import {
  THIN_RECORD_THRESHOLD,
  buildTrackRecord,
  fmtPct,
  fmtSignedPct,
  trackRecordStatus,
  type PickOutcomeRow,
} from "@/lib/method/trackRecord";

const row = (o: Partial<PickOutcomeRow> = {}): PickOutcomeRow => ({
  run_date: "2026-07-25",
  asset: "XLE",
  direction: "long",
  horizon_days: 21,
  verdict: "pending",
  ...o,
});

const many = (n: number, o: Partial<PickOutcomeRow>) =>
  Array.from({ length: n }, () => row(o));

describe("buildTrackRecord", () => {
  it("reports a hit rate of null, not 0, before anything resolves", () => {
    const tr = buildTrackRecord(
      many(23, { verdict: "pending", expected_exit_date: "2026-08-20" }),
      21,
    );
    expect(tr.total).toBe(23);
    expect(tr.pending).toBe(23);
    expect(tr.resolved).toBe(0);
    // The whole point: 0 would claim every call was wrong.
    expect(tr.hitRate).toBeNull();
    expect(tr.meanSignedReturn).toBeNull();
    expect(tr.voidRate).toBeNull();
    expect(tr.firstExpectedMaturity).toBe("2026-08-20");
  });

  it("reproduces the live 2026-07-26 state: 23 claims across 4 books, all pending", () => {
    const rows = ["2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"].flatMap(
      (d, i) => many(i === 3 ? 10 : i === 2 ? 9 : 2, {
        run_date: d,
        verdict: "pending",
        expected_exit_date: "2026-08-20",
      }),
    );
    const tr = buildTrackRecord(rows, 21);
    expect(tr.total).toBe(23);
    expect(tr.books).toBe(4);
    expect(trackRecordStatus(tr)).toBe("no-record-yet");
  });

  it("excludes voids from the hit rate and still reports them", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "hit", signed_return: 0.05 }),
        row({ verdict: "hit", signed_return: 0.02 }),
        row({ verdict: "miss", signed_return: -0.03 }),
        row({ verdict: "void", void_reason: "no close on run_date" }),
      ],
      21,
    );
    expect(tr.resolved).toBe(3);
    expect(tr.void).toBe(1);
    expect(tr.hitRate).toBeCloseTo(2 / 3, 10);
    expect(tr.voidRate).toBeCloseTo(0.25, 10); // 1 of 4 MATURED
  });

  it("denominates the void rate in matured picks, not all picks", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "hit", signed_return: 0.01 }),
        row({ verdict: "void", void_reason: "r" }),
        ...many(98, { verdict: "pending" }),
      ],
      21,
    );
    // 1 void of 2 matured. Against the 100 total it would read 1%.
    expect(tr.voidRate).toBeCloseTo(0.5, 10);
  });

  it("does not treat a flat as a hit", () => {
    const tr = buildTrackRecord([row({ verdict: "flat", signed_return: 0 })], 21);
    expect(tr.flats).toBe(1);
    expect(tr.hits).toBe(0);
    expect(tr.hitRate).toBe(0);
    expect(tr.meanSignedReturn).toBe(0);
  });

  it("reports hit rate and mean return separately, because a book can be right and still lose", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "hit", signed_return: 0.01 }),
        row({ verdict: "hit", signed_return: 0.01 }),
        row({ verdict: "hit", signed_return: 0.01 }),
        row({ verdict: "miss", signed_return: -0.2 }),
      ],
      21,
    );
    expect(tr.hitRate).toBe(0.75);
    expect(tr.meanSignedReturn).toBeLessThan(0);
  });

  it("splits by direction, because an aggregate hides a book right only on its longs", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "hit", direction: "long", signed_return: 0.05 }),
        row({ verdict: "hit", direction: "long", signed_return: 0.04 }),
        row({ verdict: "miss", direction: "short", signed_return: -0.02 }),
        row({ verdict: "miss", direction: "short", signed_return: -0.03 }),
      ],
      21,
    );
    expect(tr.hitRate).toBe(0.5);
    expect(tr.byDirection.long?.hitRate).toBe(1);
    expect(tr.byDirection.short?.hitRate).toBe(0);
  });

  it("ignores rows from another horizon", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "hit", signed_return: 0.05 }),
        row({ verdict: "miss", signed_return: -0.05, horizon_days: 63 }),
      ],
      21,
    );
    expect(tr.total).toBe(1);
    expect(tr.hitRate).toBe(1);
  });

  it("counts an unrecognised verdict in the total but scores it nowhere", () => {
    const tr = buildTrackRecord([row({ verdict: "superseded" })], 21);
    expect(tr.total).toBe(1);
    expect(tr.resolved).toBe(0);
    expect(tr.pending).toBe(0);
    expect(tr.void).toBe(0);
    expect(tr.hitRate).toBeNull();
  });

  it("takes the earliest pending maturity and ignores resolved rows' dates", () => {
    const tr = buildTrackRecord(
      [
        row({ verdict: "pending", expected_exit_date: "2026-09-01" }),
        row({ verdict: "pending", expected_exit_date: "2026-08-20" }),
        row({ verdict: "hit", signed_return: 0.01, expected_exit_date: "2026-01-01" }),
      ],
      21,
    );
    expect(tr.firstExpectedMaturity).toBe("2026-08-20");
  });

  it("handles an empty set without inventing anything", () => {
    const tr = buildTrackRecord([], 21);
    expect(tr.total).toBe(0);
    expect(tr.books).toBe(0);
    expect(tr.hitRate).toBeNull();
    expect(tr.firstExpectedMaturity).toBeNull();
    expect(trackRecordStatus(tr)).toBe("no-record-yet");
  });
});

describe("trackRecordStatus", () => {
  it("refuses to call a thin record measured", () => {
    const thin = buildTrackRecord(
      many(THIN_RECORD_THRESHOLD - 1, { verdict: "hit", signed_return: 0.01 }),
      21,
    );
    expect(thin.hitRate).toBe(1);
    // A perfect hit rate over 19 picks is still not a track record.
    expect(trackRecordStatus(thin)).toBe("too-thin");
  });

  it("calls it measured only at the threshold", () => {
    const ok = buildTrackRecord(
      many(THIN_RECORD_THRESHOLD, { verdict: "hit", signed_return: 0.01 }),
      21,
    );
    expect(trackRecordStatus(ok)).toBe("measured");
  });
});

describe("formatters", () => {
  it("renders a null as an em dash, never as a zero", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtSignedPct(null)).toBe("—");
    expect(fmtPct(0)).toBe("0%"); // a real zero still prints
  });

  it("uses a true minus sign for a negative return", () => {
    expect(fmtSignedPct(-0.0123)).toBe("−1.23%");
    expect(fmtSignedPct(0.0123)).toBe("+1.23%");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Superseded claims — picks from a book the pipeline replaced the same day.
//
// The pipeline runs twice on some dates. Each run writes its picks to
// `pick_outcomes` at publication, and the second run's upsert replaces the book
// in `research_recommendations` WITHOUT touching the first run's outcome rows
// (`book_revisions` logs it as `trigger_type: pipeline_rerun`). So the claim
// count legitimately exceeds the picks visible on /book — 13 against 9 on
// 2026-07-30, and 20 of ~80 across 07-27..07-30 — and nothing on screen said why.
//
// The fixture below is that real run. The decisive assertion is that `total` does
// NOT shrink: ADR-0090's property is that a claim cannot leave the denominator
// once it looks bad, and "the book was later replaced" is not a reason the claim
// was never published. Counted, disclosed, never subtracted.
describe("buildTrackRecord — superseded claims", () => {
  /** pick_outcomes for 2026-07-30: the 9 published names + 4 from the replaced book. */
  const OUTCOMES_0730 = [
    ...["BABA", "F", "GEV", "GLD", "NOC", "PDD", "SMH", "UNG", "UNH"].map((asset) =>
      row({ run_date: "2026-07-30", asset }),
    ),
    ...["ARKK", "JD", "MSFT", "NUE"].map((asset) => row({ run_date: "2026-07-30", asset })),
  ];

  /** book_holdings for that run_date, multi_asset — what was FINALLY published. */
  const PUBLISHED = new Map([
    [
      "2026-07-30",
      new Set(["BABA", "F", "GEV", "GLD", "NOC", "PDD", "SMH", "UNG", "UNH"]),
    ],
  ]);

  it("counts the picks absent from the finally-published book", () => {
    const tr = buildTrackRecord(OUTCOMES_0730, 21, PUBLISHED);
    expect(tr.superseded).toBe(4);
  });

  it("does NOT remove them from the denominator", () => {
    // The whole point. A rerun that silently dropped picks from `total` would be
    // exactly the hole ADR-0090 exists to close.
    const tr = buildTrackRecord(OUTCOMES_0730, 21, PUBLISHED);
    expect(tr.total).toBe(13);
    expect(tr.books).toBe(1);
  });

  it("is null — not 0 — when no published book was supplied", () => {
    // "Nothing superseded" and "nobody checked" are different facts, and the
    // second must not render as the first.
    expect(buildTrackRecord(OUTCOMES_0730, 21).superseded).toBeNull();
  });

  it("treats a run_date missing from the map as unknown, not as all-superseded", () => {
    // A partial map is the realistic failure (book_holdings only goes back so far).
    // Counting every row of an unmapped run_date would invent a huge superseded
    // figure out of missing data.
    const partial = new Map([["2026-07-30", PUBLISHED.get("2026-07-30")!]]);
    const rows = [...OUTCOMES_0730, row({ run_date: "2026-07-22", asset: "XLE" })];
    const tr = buildTrackRecord(rows, 21, partial);
    expect(tr.total).toBe(14);
    expect(tr.superseded).toBe(4);
  });

  it("reports 0 for a run_date whose every pick is still published", () => {
    // 2026-07-25 and earlier: outcome rows equal book picks exactly, so a
    // well-behaved date must read zero rather than null.
    const clean = [row({ run_date: "2026-07-25", asset: "XLE" })];
    const tr = buildTrackRecord(clean, 21, new Map([["2026-07-25", new Set(["XLE"])]]));
    expect(tr.superseded).toBe(0);
  });
});
