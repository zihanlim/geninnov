// frontend/lib/method/trackRecord.ts
//
// The forward track record read model: `pick_outcomes` rows → the numbers /method
// renders. ADR-0090.
//
// This mirrors `backend/services/pick_outcomes.build_scorecard`. Two copies of an
// aggregation is normally the thing this codebase refuses (ADR-0064: a second copy is a
// second thing to drift), and the reason one is justified here is that the backend
// aggregate is never persisted — only the per-pick rows are. The frontend has to
// aggregate whatever rows it fetched, so the alternative is not "share the function", it
// is "persist a summary and let it go stale against its own rows".
//
// What must NOT drift, and is pinned by tests on both sides:
//   * hitRate is null — never 0 — until something resolves. Zero asserts every call was
//     wrong; the honest statement is that the question cannot be answered yet. This is
//     design goal 2 on the metric most tempted by a plausible-looking default.
//   * voidRate is denominated in MATURED picks (resolved + void), not in all picks.
//     Against the total it drifts toward zero as pending rows accumulate, understating
//     how much of the record the spec could not score.
//   * a void is not a miss, and a pending is not a void.

/** One `pick_outcomes` row. Nulls are real — a pending pick has no exit. */
export interface PickOutcomeRow {
  run_date: string;
  asset: string;
  direction: "long" | "short" | string;
  horizon_days: number;
  verdict: "pending" | "hit" | "miss" | "flat" | "void" | string;
  void_reason?: string | null;
  entry_price?: number | null;
  exit_price?: number | null;
  entry_date?: string | null;
  exit_date?: string | null;
  signed_return?: number | null;
  expected_exit_date?: string | null;
  spec_version?: string | null;
}

export interface DirectionStat {
  resolved: number;
  hitRate: number;
}

export interface TrackRecord {
  horizonDays: number;
  total: number;
  resolved: number;
  pending: number;
  void: number;
  hits: number;
  misses: number;
  flats: number;
  /** null until at least one pick resolves. Never 0 as a stand-in. */
  hitRate: number | null;
  meanSignedReturn: number | null;
  /** Denominated in matured picks (resolved + void), null when nothing has matured. */
  voidRate: number | null;
  /** Earliest expected maturity among PENDING rows — a business-day estimate. */
  firstExpectedMaturity: string | null;
  byDirection: Partial<Record<"long" | "short", DirectionStat>>;
  /** Distinct run_dates represented, i.e. how many published books are covered. */
  books: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildTrackRecord(
  rows: PickOutcomeRow[],
  horizonDays: number,
): TrackRecord {
  const scoped = rows.filter((r) => r.horizon_days === horizonDays);

  const tr: TrackRecord = {
    horizonDays,
    total: scoped.length,
    resolved: 0,
    pending: 0,
    void: 0,
    hits: 0,
    misses: 0,
    flats: 0,
    hitRate: null,
    meanSignedReturn: null,
    voidRate: null,
    firstExpectedMaturity: null,
    byDirection: {},
    books: new Set(scoped.map((r) => r.run_date)).size,
  };

  const scored: PickOutcomeRow[] = [];
  const pendingDates: string[] = [];

  for (const r of scoped) {
    if (r.verdict === "pending") {
      tr.pending += 1;
      if (r.expected_exit_date) pendingDates.push(r.expected_exit_date);
    } else if (r.verdict === "void") {
      tr.void += 1;
    } else if (r.verdict === "hit" || r.verdict === "miss" || r.verdict === "flat") {
      scored.push(r);
      if (r.verdict === "hit") tr.hits += 1;
      else if (r.verdict === "miss") tr.misses += 1;
      else tr.flats += 1;
    }
    // An unrecognised verdict is counted in `total` but scored nowhere. Coercing it into
    // a bucket would invent a claim about a row this build does not understand.
  }

  tr.resolved = scored.length;
  // ISO dates sort lexicographically, so this is a min without parsing.
  if (pendingDates.length > 0) {
    tr.firstExpectedMaturity = pendingDates.reduce((a, b) => (a < b ? a : b));
  }

  const matured = tr.resolved + tr.void;
  if (matured > 0) tr.voidRate = tr.void / matured;

  if (scored.length > 0) {
    tr.hitRate = tr.hits / scored.length;
    const vals = scored.map((r) => r.signed_return).filter(isNum);
    if (vals.length > 0) {
      tr.meanSignedReturn = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  for (const side of ["long", "short"] as const) {
    const rowsFor = scored.filter((r) => r.direction === side);
    if (rowsFor.length > 0) {
      tr.byDirection[side] = {
        resolved: rowsFor.length,
        hitRate: rowsFor.filter((r) => r.verdict === "hit").length / rowsFor.length,
      };
    }
  }

  return tr;
}

/**
 * What the panel is allowed to claim, as data so it can be tested.
 *
 * The failure this guards is the one ADR-0059 already caught on the IC panel: a verdict
 * keyed on "is there a number" paints a single observation as validation. A hit rate over
 * three resolved picks is not a track record, and saying so is the whole point of
 * building the instrument before the results exist.
 */
export type TrackRecordStatus = "no-record-yet" | "too-thin" | "measured";

/** Below this many resolved picks, a hit rate is noise dressed as a record. */
export const THIN_RECORD_THRESHOLD = 20;

export function trackRecordStatus(tr: TrackRecord): TrackRecordStatus {
  if (tr.resolved === 0) return "no-record-yet";
  if (tr.resolved < THIN_RECORD_THRESHOLD) return "too-thin";
  return "measured";
}

/** Percent for display, or an em dash. Never renders a null as 0%. */
export function fmtPct(v: number | null | undefined, dp = 0): string {
  return isNum(v) ? `${(v * 100).toFixed(dp)}%` : "—";
}

/** Signed percent for a return, or an em dash. */
export function fmtSignedPct(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(dp)}%`;
}
