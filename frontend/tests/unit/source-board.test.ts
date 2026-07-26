// The source board must not flatten four different absences into one.
//
// A source can be: contributing and current; contributing and stale; fetched but SILENT
// (asked, got nothing); never asked because it is UNCONFIGURED; or contributing rows whose
// AGE IS UNKNOWABLE because its table records only when we fetched. Those are five distinct
// facts and each asks something different of a reader — retry, wait, fix a credential, or
// accept that the age cannot be known at all.
//
// The last one is the finding this board exists to state. `macro_indicators` has `fetch_date`
// and `fetched_at` and no observation column, so "how old is this FRED reading" has no
// answer in our schema. A board that printed a fresh-looking "updated 2026-07-25" would have
// hidden that behind a timestamp.

import { describe, expect, it } from "vitest";
import {
  SOURCES,
  buildSourceBoard,
  observabilitySummary,
  type SourceObservation,
} from "@/lib/method/sourceBoard";

const NOW = new Date("2026-07-27T00:00:00Z");
const row = (board: ReturnType<typeof buildSourceBoard>, key: string) =>
  board.find((r) => r.key === key)!;

/** The live 2026-07-26 state, measured from Supabase. */
const LIVE: SourceObservation[] = [
  { key: "brave", rows: 1339, published: "2026-07-26", retrieved: "2026-07-26" },
  { key: "reddit", rows: 0, unconfigured: true },
  { key: "fred", rows: 77, retrieved: "2026-07-25" },
  { key: "yfinance", rows: 4977, observed: "2026-07-24", retrieved: "2026-07-24" },
  { key: "kenfrench", rows: 156, retrieved: "2026-07-24" },
  { key: "cftc", rows: 2, observed: "2026-07-21", published: "2026-07-24", retrieved: "2026-07-26" },
];

describe("the five states stay distinct", () => {
  const board = buildSourceBoard(LIVE, NOW);

  it("an unconfigured source is not silent and not stale", () => {
    const r = row(board, "reddit");
    expect(r.verdict).toBe("unconfigured");
    expect(r.note).toContain("never asked");
    // The distinction ADR-0094 turned on: absent because unasked, not absent because empty.
    expect(r.note).not.toContain("stale");
  });

  it("a source that was asked and returned nothing is SILENT", () => {
    const b = buildSourceBoard(
      LIVE.map((o) => (o.key === "reddit" ? { key: "reddit", rows: 0 } : o)),
      NOW,
    );
    const r = row(b, "reddit");
    expect(r.verdict).toBe("silent");
    expect(r.note).toContain("asked and got nothing back");
    expect(r.note).toContain("not evidence that there was nothing to find");
  });

  it("a retrieval-only table reports its age as UNKNOWABLE, not as fresh", () => {
    // The point of the board. FRED was fetched yesterday, which says nothing about how old
    // the reading is.
    const r = row(board, "fred");
    expect(r.verdict).toBe("age-unknowable");
    expect(r.ageMeasuredFrom).toBe("retrieved");
    expect(r.note).toContain("no observation date");
    expect(r.note).toContain("our copy's age");
  });

  it("a source with a real observation date is judged on it", () => {
    const r = row(board, "yfinance");
    expect(r.ageMeasuredFrom).toBe("observed");
    expect(r.verdict).toBe("current");
  });

  it("marks a genuinely old source stale, with the shortfall stated", () => {
    const b = buildSourceBoard(
      LIVE.map((o) => (o.key === "yfinance" ? { ...o, observed: "2026-06-01" } : o)),
      NOW,
    );
    const r = row(b, "yfinance");
    expect(r.verdict).toBe("stale");
    expect(r.note).toContain("days old against a 4-day expectation");
  });
});

describe("age is measured from the most meaningful date available", () => {
  it("prefers observation over publication over retrieval", () => {
    const r = row(buildSourceBoard(LIVE, NOW), "cftc");
    // Observed Tuesday 21st, published Friday 24th, retrieved Sunday 26th. Measuring from
    // retrieval would call a six-day-old reading one day old.
    expect(r.ageMeasuredFrom).toBe("observed");
    expect(r.ageDays).toBe(6);
  });

  it("falls back to publication when there is no observation date", () => {
    const r = row(buildSourceBoard(LIVE, NOW), "brave");
    expect(r.ageMeasuredFrom).toBe("published");
    expect(r.ageDays).toBe(1);
  });

  it("reports a null age rather than a zero when no date exists at all", () => {
    const b = buildSourceBoard([{ key: "fred", rows: 5 }], NOW);
    const r = row(b, "fred");
    expect(r.ageDays).toBeNull();
    expect(r.ageMeasuredFrom).toBeNull();
  });
});

describe("the catalogue is honest about what each table records", () => {
  it("does not claim FRED has an observation date", () => {
    const fred = SOURCES.find((s) => s.key === "fred")!;
    expect(fred.records).toEqual(["retrieved"]);
  });

  it("claims all three roles only for the source that genuinely has them", () => {
    const three = SOURCES.filter((s) => s.records.length === 3).map((s) => s.key);
    expect(three).toEqual(["cftc"]);
  });

  it("every source states its cadence, so the staleness threshold is arguable", () => {
    for (const s of SOURCES) {
      expect(s.cadence.trim().length, `${s.key} has no stated cadence`).toBeGreaterThan(20);
      expect(s.maxAgeDays).toBeGreaterThan(0);
    }
  });

  it("every source names what it feeds in a reader's terms", () => {
    for (const s of SOURCES) {
      expect(s.feeds.trim().length, `${s.key} does not say what it feeds`).toBeGreaterThan(10);
    }
  });
});

describe("the headline counts what can actually be known", () => {
  it("states both how many contributed and how many can date themselves", () => {
    const s = observabilitySummary(buildSourceBoard(LIVE, NOW));
    expect(s.total).toBe(6);
    // Reddit contributes nothing; the other five do.
    expect(s.contributing).toBe(5);
    // Only brave (published), yfinance (observed) and cftc (observed) can date themselves.
    expect(s.withObservationDate).toBe(3);
    expect(s.sentence).toContain("5 of 6 sources contributed");
    expect(s.sentence).toContain("3 of 6");
    expect(s.sentence).toContain("age of our copy");
  });

  it("is a count, not a percentage", () => {
    // Six is too small a denominator for a percentage to mean anything.
    expect(observabilitySummary(buildSourceBoard(LIVE, NOW)).sentence).not.toMatch(/\d+%/);
  });
});
