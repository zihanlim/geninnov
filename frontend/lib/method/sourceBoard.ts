// Every source the book rests on, and what each one can honestly say about its own age.
//
// WHY THIS EXISTS. Freshness was reported per surface: the book has a run_date, the news
// ribbon has a published_date, /method has pipeline health. No page listed the SOURCES
// themselves, so two questions had no answer anywhere — "what is this built on?" and "which
// of those is stale?".
//
// THE FINDING THIS SURFACES. ADR-0098 separated the timestamp ROLES (observed / published /
// retrieved) because conflating them misstates age. Applied to our own tables, most of them
// record RETRIEVAL only. `macro_indicators` has `fetch_date` and `fetched_at` and no
// observation column at all, so the honest answer to "how old is this FRED reading" is *we
// do not know; we know when we asked*. That is a real limitation, it was never stated, and
// a board that printed "updated 2026-07-25" would have hidden it behind a fresh-looking
// timestamp.
//
// A source with no rows is NOT the same as a source with old rows, and neither is the same
// as a source we never configured. Reddit is the live case: `daily_refresh` fetches it, the
// credential is absent, so `reddit_client` returns [] rather than fabricating posts
// (ADR-0023), and `theme_news` has zero Reddit rows. "Silent" and "stale" must not render
// alike.
//
// THE CORPUS THE BOARD COULD NOT SEE. Until 2026-07-29 this catalogue named six sources and
// none of them was `market_news` — the un-themed corpus behind the narrative trends board on
// `/` and behind ADR-0143's price-link gate. Three providers write to it (`brave_market`,
// `gdelt`, `rss`) and the page that exists to answer "what is this built on, and which of
// those is stale?" could not answer it for any of them. ADR-0157 defines a corpus by naming
// its providers; this is that list, on the reader's side of the wire. See ADR-0160.
//
// Those three are NOT interchangeable, and the board must not let them read as three
// helpings of the same thing. Brave is a recency ranking, GDELT is an archive (ADR-0144),
// and `rss` is **shadow**: collected daily, source-tagged, and read by no scored corpus at
// all until there is enough parallel history to say whether it agrees with Brave (ADR-0157).
// A shadow source with fresh rows is not `current` — `current` would claim it feeds
// something. That is the same defect goal 2 names in a two-state verdict, so it gets its own
// state rather than being flattened into the nearest one.
//
// See ADR-0105 and ADR-0160.

/** Which timestamp role a table can actually answer for — ADR-0098's roles, applied here. */
export type TimestampRole = "observed" | "published" | "retrieved";

export type SourceVerdict =
  /** Rows present, and the age below is a real observation age. */
  | "current"
  /** Rows present but older than this source's expected cadence. */
  | "stale"
  /** Configured to be fetched, but contributed nothing. Not the same as stale. */
  | "silent"
  /** No credential is set, so no request is made at all. */
  | "unconfigured"
  /**
   * Collected and stored, but read by no scored corpus. Fresh rows that feed nothing.
   * Distinct from `current`, which would claim the source is load-bearing.
   */
  | "shadow"
  /** Rows present, but the table records no observation date — age is unknowable. */
  | "age-unknowable";

export interface SourceSpec {
  key: string;
  label: string;
  /** What it feeds, in the reader's terms rather than the schema's. */
  feeds: string;
  /** The table its rows land in. */
  table: string;
  /** Roles this table ACTUALLY records. Absence here is the point, not an omission. */
  records: TimestampRole[];
  /** Days after which this source is stale, given its own publication cadence. */
  maxAgeDays: number;
  /** Why that cadence — so the threshold is arguable rather than asserted. */
  cadence: string;
  /**
   * True when the source is collected but no published number reads it (ADR-0157).
   * Declared here rather than inferred, because "nothing reads this" is a decision
   * recorded in `daily_refresh.COMBINED_SOURCES`, not a property of the rows.
   */
  shadow?: boolean;
}

/**
 * The catalogue. Data rather than JSX so a test can assert against it and so adding a source
 * is one entry rather than a component edit.
 *
 * `records` is the honest part. Only `theme_news` and the COT reading carry a genuine
 * publication or observation date; the rest record when the pipeline wrote them.
 */
export const SOURCES: SourceSpec[] = [
  {
    key: "brave",
    label: "Brave Search",
    feeds: "News headlines behind every HypeScore",
    table: "theme_news",
    records: ["published", "retrieved"],
    maxAgeDays: 3,
    cadence: "Fetched each pipeline run; headlines carry their own publication date.",
  },
  {
    key: "reddit",
    label: "Reddit",
    feeds: "Social posts, intended as a second attention source",
    table: "theme_news",
    records: ["published", "retrieved"],
    maxAgeDays: 3,
    cadence: "Fetched each run when REDDIT_CLIENT_ID is set.",
  },
  // ── market_news: the un-themed corpus (L1b) ────────────────────────────────────────
  // Three providers, three different jobs. Listed separately and never merged into one
  // "news" row: ADR-0155 is that a share is only comparable to a share of the SAME corpus,
  // and the whole finding of ADR-0144 is that these differ in shape, not just in volume.
  {
    key: "brave_market",
    label: "Brave Search (market corpus)",
    feeds: "The un-themed market corpus behind the narrative trends board (L1b)",
    table: "market_news",
    records: ["published", "retrieved"],
    maxAgeDays: 3,
    cadence:
      "Fetched each run. A recency RANKING, not an archive: 48% of a 45-day window falls " +
      "in the last 7 days, and it holds nothing before its window opens (ADR-0144).",
  },
  {
    key: "gdelt",
    label: "GDELT",
    feeds: "The same corpus's history — the only provider that has one",
    table: "market_news",
    records: ["published", "retrieved"],
    // GDELT publishes with a lag, so the newest day is always the thinnest. Four days
    // rather than three so a normal lag is not reported as staleness.
    maxAgeDays: 4,
    cadence:
      "Fetched each run, keyless. An ARCHIVE: 18% of a 45-day window in the last 7 days, " +
      "40 of 45 days populated. It publishes with a lag, so the newest day is the thinnest.",
  },
  {
    key: "rss",
    label: "RSS feeds",
    feeds: "Collected for corroboration against Brave — no published number reads it yet",
    table: "market_news",
    records: ["published", "retrieved"],
    maxAgeDays: 3,
    shadow: true,
    cadence:
      "Fetched each run, keyless. A feed holds only its most recent items and there is no " +
      "backfill, so what was not collected yesterday is gone.",
  },
  {
    key: "fred",
    label: "FRED",
    feeds: "Yield curve, HY OAS, CPI — the L0 macro snapshot and L3 regime",
    table: "macro_indicators",
    // No observation column exists. This is the gap the board is here to state.
    records: ["retrieved"],
    maxAgeDays: 4,
    cadence: "Fetched each run; FRED itself publishes on series-specific lags.",
  },
  {
    key: "yfinance",
    label: "yfinance",
    feeds: "VIX, DXY, gold, crude — market levels in the macro snapshot",
    table: "macro_daily_history",
    records: ["observed", "retrieved"],
    maxAgeDays: 4,
    cadence: "One row per trading date, so the observation date is real.",
  },
  {
    key: "kenfrench",
    label: "Ken French Data Library",
    feeds: "FF5 + UMD factor betas per asset (L2)",
    table: "factor_exposures",
    records: ["retrieved"],
    maxAgeDays: 40,
    cadence: "Monthly factor returns; the library itself updates with a multi-week lag.",
  },
  {
    key: "cftc",
    label: "CFTC Commitments of Traders",
    feeds: "External speculator positioning against the book (L5)",
    table: "research_recommendations.positioning_crowding",
    records: ["observed", "published", "retrieved"],
    maxAgeDays: 10,
    cadence:
      "Positions are as of Tuesday and publish the following Friday, so a reading is " +
      "never fresher than three days and is up to ten days old before the next print.",
  },
];

export interface SourceObservation {
  key: string;
  rows: number;
  /** Latest date for each role the table records. Absent = the table cannot answer it. */
  observed?: string | null;
  published?: string | null;
  retrieved?: string | null;
  /** True when the source needs a credential that is not set. */
  unconfigured?: boolean;
}

export interface SourceRow extends SourceSpec {
  rows: number;
  observed: string | null;
  published: string | null;
  retrieved: string | null;
  verdict: SourceVerdict;
  /** The age in days against the best date the table can offer, or null if it offers none. */
  ageDays: number | null;
  /** Which role `ageDays` was measured from — so a reader knows what it means. */
  ageMeasuredFrom: TimestampRole | null;
  /** One sentence a reader can act on. Never a bare status word. */
  note: string;
}

function daysBetween(from: string, to: Date): number | null {
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
}

/**
 * Judge each source against what its own table can answer.
 *
 * `asOf` is injected rather than read from the clock so the result is a pure function of its
 * inputs — the same reason `assessStaleness` takes one.
 */
export function buildSourceBoard(
  observations: SourceObservation[],
  asOf: Date,
): SourceRow[] {
  return SOURCES.map((spec) => {
    const o = observations.find((x) => x.key === spec.key);
    const rows = o?.rows ?? 0;
    const observed = o?.observed ?? null;
    const published = o?.published ?? null;
    const retrieved = o?.retrieved ?? null;

    // Age is measured from the most meaningful date the table actually has. Preferring
    // observation over publication over retrieval is not cosmetic: measuring a five-day-old
    // CFTC reading from its retrieval date reports it as fresh.
    let ageMeasuredFrom: TimestampRole | null = null;
    let basis: string | null = null;
    if (spec.records.includes("observed") && observed) {
      ageMeasuredFrom = "observed";
      basis = observed;
    } else if (spec.records.includes("published") && published) {
      ageMeasuredFrom = "published";
      basis = published;
    } else if (retrieved) {
      ageMeasuredFrom = "retrieved";
      basis = retrieved;
    }
    const ageDays = basis ? daysBetween(basis, asOf) : null;

    let verdict: SourceVerdict;
    let note: string;

    if (o?.unconfigured) {
      verdict = "unconfigured";
      note =
        `No credential is set, so no request is made at all. This source contributes ` +
        `nothing, which is not the same as contributing zero — it was never asked.`;
    } else if (rows === 0) {
      verdict = "silent";
      note =
        `Fetched, but contributed no rows. The pipeline asked and got nothing back; ` +
        `that is a gap in the corpus, not evidence that there was nothing to find.`;
    } else if (spec.shadow) {
      // Checked BEFORE freshness on purpose. "How old is it" is the wrong first question
      // about a source nothing reads, and answering `current` would assert it is load-bearing.
      // The age still travels in the note, so declaring a source shadow hides no fact.
      verdict = "shadow";
      note =
        `Collected and stored, but no scored corpus reads it — it is not counted in any ` +
        `published share (ADR-0157). ` +
        (ageDays !== null ? `Newest row is ${ageDays} days old. ` : "") +
        spec.cadence;
    } else if (ageMeasuredFrom === "retrieved") {
      // The finding worth stating: we know when we asked, not when the world was in
      // this state.
      verdict = "age-unknowable";
      // Kept short deliberately: this note repeats once per retrieval-only source, and the
      // footnote already explains the rule. The table name is the part that differs and so
      // the part worth printing.
      note = `${spec.table} records no observation date — this is our copy's age.`;
    } else if (ageDays !== null && ageDays > spec.maxAgeDays) {
      verdict = "stale";
      note =
        `${ageDays} days old against a ${spec.maxAgeDays}-day expectation. ${spec.cadence}`;
    } else {
      verdict = "current";
      note = spec.cadence;
    }

    return { ...spec, rows, observed, published, retrieved, verdict, ageDays, ageMeasuredFrom, note };
  });
}

/**
 * The headline: how many sources can state when the world was in the state they describe.
 *
 * Reported as a count rather than a percentage because the denominator is small enough that
 * a percentage would imply a precision it does not support.
 *
 * `contributing` counts rows a published number actually READS, so a shadow source is
 * excluded from it and stated separately. Counting `rows > 0` alone would have let a
 * corpus nothing reads inflate the figure that answers "what is this book built on".
 */
export function observabilitySummary(board: SourceRow[]): {
  total: number;
  withObservationDate: number;
  contributing: number;
  shadow: number;
  sentence: string;
} {
  const total = board.length;
  const withObservationDate = board.filter(
    (r) => r.ageMeasuredFrom === "observed" || r.ageMeasuredFrom === "published",
  ).length;
  const contributing = board.filter((r) => r.rows > 0 && r.verdict !== "shadow").length;
  const shadow = board.filter((r) => r.verdict === "shadow").length;

  return {
    total,
    withObservationDate,
    contributing,
    shadow,
    sentence:
      `${contributing} of ${total} sources contributed rows this book reads. ` +
      (shadow > 0
        ? `${shadow === 1 ? "One more is" : `${shadow} more are`} collected and read by ` +
          `nothing, held for corroboration rather than counted. `
        : "") +
      `${withObservationDate} of ${total} can say when the underlying data was observed or ` +
      `published; for the rest the only date recorded is when the pipeline fetched it, so ` +
      `their age is the age of our copy rather than of the reading.`,
  };
}
