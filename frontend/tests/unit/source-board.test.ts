// The source board must not flatten four different absences into one.
//
// A source can be: contributing and current; contributing and stale; fetched but SILENT
// (asked, got nothing); never asked because it is UNCONFIGURED; collected but SHADOW,
// meaning no scored corpus reads it; or contributing rows whose AGE IS UNKNOWABLE because
// its table records only when we fetched. Those are six distinct facts and each asks
// something different of a reader — retry, wait, fix a credential, ignore it for now, or
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

/**
 * The live 2026-07-26 state, measured from Supabase.
 *
 * The three `market_news` rows were measured on 2026-07-29 (gdelt 2,309 / brave_market 667 /
 * rss 405) and are dated back to 2026-07-26 here so they share this file's `NOW`. Their
 * relative shapes are the real ones — GDELT holds the most rows over the longest span
 * because it is the only archive (ADR-0144).
 */
const LIVE: SourceObservation[] = [
  { key: "brave", rows: 1339, published: "2026-07-26", retrieved: "2026-07-26" },
  { key: "reddit", rows: 0, unconfigured: true },
  { key: "brave_market", rows: 667, published: "2026-07-26", retrieved: "2026-07-26" },
  { key: "gdelt", rows: 2309, published: "2026-07-26", retrieved: "2026-07-26" },
  { key: "rss", rows: 405, published: "2026-07-26", retrieved: "2026-07-26" },
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
    expect(s.total).toBe(9);
    // Reddit contributes nothing and RSS is shadow; the other seven are read.
    expect(s.contributing).toBe(7);
    // brave, brave_market, gdelt, rss (published) + yfinance, cftc (observed).
    expect(s.withObservationDate).toBe(6);
    expect(s.sentence).toContain("7 of 9 sources contributed");
    expect(s.sentence).toContain("6 of 9");
    expect(s.sentence).toContain("age of our copy");
  });

  it("is a count, not a percentage", () => {
    // Nine is too small a denominator for a percentage to mean anything.
    expect(observabilitySummary(buildSourceBoard(LIVE, NOW)).sentence).not.toMatch(/\d+%/);
  });

  it("does not let a corpus nothing reads inflate the contributing count", () => {
    // RSS has 405 fresh rows. Counting `rows > 0` would report it as feeding the book,
    // which is the claim ADR-0157 deliberately withheld.
    const s = observabilitySummary(buildSourceBoard(LIVE, NOW));
    expect(s.shadow).toBe(1);
    expect(s.sentence).toContain("read by");
    expect(s.sentence).toContain("nothing");
  });
});

// ── ADR-0160: the corpus the board could not see ──────────────────────────────────────
describe("market_news is on the board, as three providers rather than one", () => {
  const board = buildSourceBoard(LIVE, NOW);

  it("names all three providers that write to market_news", () => {
    const market = SOURCES.filter((s) => s.table === "market_news").map((s) => s.key);
    // Never merged into one "news" row: a share is only comparable to a share of the same
    // corpus (ADR-0155), and these three differ in shape, not just in volume.
    expect(market).toEqual(["brave_market", "gdelt", "rss"]);
  });

  it("keeps the themed and un-themed Brave corpora as separate sources", () => {
    // Same provider, different question, different table. One `brave` row would have
    // implied the theme corpus and the market corpus were the same evidence.
    expect(row(board, "brave").table).toBe("theme_news");
    expect(row(board, "brave_market").table).toBe("market_news");
  });

  it("distinguishes the archive from the recency ranking in its own cadence copy", () => {
    // ADR-0144's finding, which is the reason two news rows are not redundancy.
    expect(row(board, "gdelt").cadence).toContain("ARCHIVE");
    expect(row(board, "brave_market").cadence).toContain("RANKING");
  });

  it("judges the two counted providers on publication date, like any dated source", () => {
    for (const key of ["brave_market", "gdelt"]) {
      expect(row(board, key).ageMeasuredFrom, key).toBe("published");
      expect(row(board, key).verdict, key).toBe("current");
    }
  });
});

describe("a source that is collected but read by nothing is SHADOW, not current", () => {
  const board = buildSourceBoard(LIVE, NOW);

  it("does not report fresh unread rows as current", () => {
    const r = row(board, "rss");
    expect(r.verdict).toBe("shadow");
    // `current` would assert the source is load-bearing. It is not.
    expect(r.verdict).not.toBe("current");
  });

  it("says plainly that no published share counts it", () => {
    const r = row(board, "rss");
    expect(r.note).toContain("no scored corpus reads it");
    expect(r.note).toContain("not counted in any published share");
  });

  it("still reports the age, so declaring a source shadow hides no fact", () => {
    const r = row(board, "rss");
    expect(r.ageDays).toBe(1);
    expect(r.note).toContain("1 day old");
    // "1 days old" shipped to the live page before this was pinned.
    expect(r.note).not.toContain("1 days old");
  });

  it("says 'from today' rather than '0 days old' on the live case", () => {
    // The state the page is in every morning after a successful run.
    const b = buildSourceBoard(
      LIVE.map((o) => (o.key === "rss" ? { ...o, published: "2026-07-27" } : o)),
      NOW,
    );
    expect(row(b, "rss").note).toContain("from today");
    expect(row(b, "rss").note).not.toContain("0 days");
  });

  it("is silent, not shadow, when the feeds returned nothing", () => {
    // Every feed failing is a different fact from a feed nobody reads, and ADR-0156 is
    // exactly about not absorbing the first into a calmer word.
    const b = buildSourceBoard(
      LIVE.map((o) => (o.key === "rss" ? { key: "rss", rows: 0 } : o)),
      NOW,
    );
    expect(row(b, "rss").verdict).toBe("silent");
  });

  it("marks exactly one source shadow, and it is the one COMBINED_SOURCES omits", () => {
    // If this fails because a provider was turned on, the fix is to drop `shadow` from its
    // spec — not to widen the assertion.
    expect(SOURCES.filter((s) => s.shadow).map((s) => s.key)).toEqual(["rss"]);
  });
});

describe("a keyless provider is never reported as unconfigured", () => {
  it("gives GDELT and RSS no credential story to tell", () => {
    // Both are keyless (ADR-0144, ADR-0157), so zero rows can only mean the fetch failed.
    // `unconfigured` would send a reader hunting for a secret that does not exist.
    const b = buildSourceBoard(
      LIVE.map((o) => (["gdelt", "rss"].includes(o.key) ? { key: o.key, rows: 0 } : o)),
      NOW,
    );
    expect(row(b, "gdelt").verdict).toBe("silent");
    expect(row(b, "rss").verdict).toBe("silent");
  });
});
