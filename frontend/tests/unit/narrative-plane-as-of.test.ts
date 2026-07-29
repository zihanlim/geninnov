// The detection plane read ONE day, and it was the wrong one.
//
// `toSeries` keys every consumer off max(run_date), and the plane plots
// `latest.velocity`. That day is structurally the LEAST measurable: GDELT publishes
// with a lag, so the newest publication day is always the thinnest, and a thin day is
// precisely what ADR-0155's corpus-size guard withholds a velocity for.
//
// Measured 2026-07-29: the archive series held **381 velocities across 35 days**, and
// the board could see none of them, because it only ever looked at the newest.
//
// The fallback is only legitimate because the date is stated, and because BOTH plane
// coordinates move together — a share from today plotted against a velocity from
// Tuesday is not a point on any plane.

import { describe, expect, it } from "vitest";
import {
  latestMeasuredDate,
  toSeries,
  type NarrativeRow,
} from "@/lib/narratives";

function row(
  run_date: string,
  phrase: string,
  share: number,
  velocity: number | null,
): NarrativeRow {
  return {
    run_date,
    phrase,
    share,
    velocity,
    doc_count: 5,
    corpus_size: 100,
    days_observed: 6,
    first_seen: "2026-07-01",
    status: velocity !== null && velocity > 1.5 ? "emerging" : "established",
    covered_by: null,
    methods: null,
  } as unknown as NarrativeRow;
}

/** Two measured days, then a thin newest day where velocity was withheld. */
const ROWS: NarrativeRow[] = [
  row("2026-07-26", "tariffs", 0.10, 1.2),
  row("2026-07-26", "yields", 0.08, -0.4),
  row("2026-07-27", "tariffs", 0.14, 2.1),
  row("2026-07-27", "yields", 0.07, -0.9),
  // Newest day: present, but nothing measurable — the guard withheld it.
  row("2026-07-28", "tariffs", 0.11, null),
  row("2026-07-28", "yields", 0.06, null),
];

describe("latestMeasuredDate", () => {
  it("finds the most recent day carrying any velocity", () => {
    expect(latestMeasuredDate(ROWS)).toBe("2026-07-27");
  });

  it("prefers the newest measured day, not the first it encounters", () => {
    expect(latestMeasuredDate([...ROWS].reverse())).toBe("2026-07-27");
  });

  it("returns null when nothing was ever measurable", () => {
    const none = ROWS.map((r) => ({ ...r, velocity: null }));
    expect(latestMeasuredDate(none)).toBeNull();
  });

  it("returns null on no rows — not a date, not a guess", () => {
    expect(latestMeasuredDate([])).toBeNull();
  });
});

describe("toSeries pinned to an explicit day", () => {
  it("defaults to the newest run, unchanged", () => {
    const s = toSeries(ROWS);
    expect(s.every((x) => x.latest.run_date === "2026-07-28")).toBe(true);
    expect(s.every((x) => x.latest.velocity === null)).toBe(true);
  });

  it("reads the requested day when asked", () => {
    const s = toSeries(ROWS, "2026-07-27");
    expect(s.every((x) => x.latest.run_date === "2026-07-27")).toBe(true);
    expect(s.find((x) => x.phrase === "tariffs")?.latest.velocity).toBe(2.1);
  });

  it("moves BOTH coordinates together", () => {
    // The property that makes the fallback honest. Share and velocity must come
    // from the same day or the point describes nothing.
    const s = toSeries(ROWS, "2026-07-27");
    const tariffs = s.find((x) => x.phrase === "tariffs")!;
    expect(tariffs.latest.share).toBe(0.14); // 07-27's share, not 07-28's 0.11
    expect(tariffs.latest.velocity).toBe(2.1);
  });

  it("keeps the full history in points regardless of the as-of day", () => {
    const s = toSeries(ROWS, "2026-07-27");
    expect(s.find((x) => x.phrase === "tariffs")?.points).toHaveLength(3);
  });
});

describe("the regression: a full series behind a blank plane", () => {
  it("recovers velocities the newest-day view cannot see", () => {
    const newest = toSeries(ROWS);
    expect(newest.some((s) => s.latest.velocity !== null)).toBe(false);

    const day = latestMeasuredDate(ROWS)!;
    const fallback = toSeries(ROWS, day);
    expect(fallback.filter((s) => s.latest.velocity !== null)).toHaveLength(2);
  });

  it("does not engage when the newest day is measurable", () => {
    const healthy = ROWS.map((r) =>
      r.run_date === "2026-07-28" ? { ...r, velocity: 0.5 } : r,
    );
    expect(toSeries(healthy).some((s) => s.latest.velocity !== null)).toBe(true);
    expect(latestMeasuredDate(healthy)).toBe("2026-07-28");
  });
});
