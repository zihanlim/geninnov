"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FreshnessLabel } from "./status/FreshnessLabel";
import { StatusBadge } from "./status/StatusBadge";
import type { NumericDerivation, NumericStatus } from "@/lib/derivations/numeric";

interface MarketAsset {
  ticker: string;
  name: string;
  current: number;
  prev_close: number;
  pct_change: number;
  /** Trading date of `current` (migration 063). NOT `updated_at` — see below. */
  as_of?: string | null;
  updated_at?: string;
  /** US | Europe | Asia | Currencies | Crypto | Futures (migration 063). */
  market_group?: string | null;
  /** Position within the group. Ordering is data, not a constant here. */
  sort_order?: number | null;
}

/**
 * Order the GROUPS are offered in. Membership and within-group order are data
 * (`market_group` / `sort_order`, migration 063); only this sequence is a
 * display preference, and it is the one thing a column cannot carry without a
 * second ordering key nobody would maintain.
 *
 * Groups not listed here are appended alphabetically rather than dropped. That
 * matters: the previous version of this file held the whole membership list as
 * `DISPLAY_ORDER = ["^SPX","^NDX","^DJI","^RUT","^VIX"]` and sorted by
 * `indexOf`, so any ticker the backend added scored −1 and silently led the
 * tape. It also listed `^VIX`, which was never in the backend's
 * `EQUITY_INDICES`, so the VIX cell had never once rendered — two lists that
 * had to agree, with nothing failing when they stopped.
 */
const GROUP_ORDER = ["US", "Europe", "Asia", "Currencies", "Crypto", "Futures"];
const DEFAULT_GROUP = "US";
const FRESHNESS_FIELD = "market.index.as_of";
const MAX_AGE_SECONDS = 86400; // daily closes — never live intraday quotes

function derive(
  field_id: string,
  value: number | null,
  status: NumericStatus,
  observed_age_seconds: number,
  source_table: string,
  unavailable_reason?: string,
): NumericDerivation {
  return {
    field_id,
    display_status: status,
    value,
    unit: "pct",
    method_id: status === "unavailable" ? "db.unavailable" : "db.market_assets.column",
    source_records: [{ table: source_table, id: field_id, as_of: new Date().toISOString() }],
    computed_at: new Date().toISOString(),
    as_of: new Date().toISOString(),
    freshness: { max_age_seconds: MAX_AGE_SECONDS, observed_age_seconds },
    unavailable_reason,
  };
}

function ageFromDate(d?: string): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

export default function MarketBar() {
  const [assets, setAssets] = useState<MarketAsset[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [group, setGroup] = useState(DEFAULT_GROUP);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("market_assets")
        .select("*")
        .order("ticker");
      if (cancelled) return;
      // PGRST…/404-ish errors land in `error`; an empty row set is fine
      // and renders nothing (existing behavior preserved).
      if (error) {
        setUnavailable(true);
        setAssets([]);
        return;
      }
      // Ordered by the row's own `sort_order` within its group. A row written
      // before migration 063 defaults to group "US", order 0 — so a database
      // that has the columns but has not been refreshed still renders its old
      // tape rather than nothing.
      const list = (data as MarketAsset[]) ?? [];
      setAssets(
        [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (assets === null) {
    // flex-wrap to match the loaded MarketBar (line ~133): the real tape wraps its
    // indices on a narrow screen. Without it the skeleton's 5 non-wrapping items are
    // ~700px, so on a 375 phone the loading state — not the settled one — flashes a
    // horizontal scroll (body to 841px) for the second before data arrives. The
    // skeleton must obey the same containment as what it stands in for.
    return (
      <div
        className="flex flex-wrap gap-3 px-4 py-2.5 bg-bg-surface border border-border rounded-[8px] mb-4"
        data-testid="market-bar-skeleton"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="skeleton h-3 w-8 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // ── Explicit unavailable state (e.g. migration 010 not deployed) ─────────
  if (unavailable || assets.length === 0) {
    const d = derive(FRESHNESS_FIELD, null, "unavailable", 0, "market_assets",
      "market_assets table unavailable — run migration 010");
    return (
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 bg-bg-surface border border-border rounded-[8px] mb-4"
        data-testid="market-bar-unavailable"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-semibold">
            Market indices
          </span>
          <StatusBadge status={d.display_status} />
          <span className="text-text-secondary text-[12px]" data-testid="market-bar-unavailable-text">
            Major-index tape unavailable · market_assets not deployed
          </span>
        </div>
      </div>
    );
  }

  // ── Healthy ──────────────────────────────────────────────────────────────
  // Groups actually present, in GROUP_ORDER, then anything unrecognised.
  const present = Array.from(
    new Set(assets.map((a) => a.market_group || DEFAULT_GROUP)),
  );
  const groups = [
    ...GROUP_ORDER.filter((g) => present.includes(g)),
    ...present.filter((g) => !GROUP_ORDER.includes(g)).sort(),
  ];
  // Fall back to the first present group rather than rendering an empty tape:
  // `group` is US by default and a database without US rows is not a reason to
  // show nothing.
  const active = groups.includes(group) ? group : (groups[0] ?? DEFAULT_GROUP);
  const shown = assets.filter((a) => (a.market_group || DEFAULT_GROUP) === active);

  // Freshness is computed over the GROUP ON SCREEN, not the whole tape. The
  // groups close in different sessions — measured 2026-07-31, Asia, FX and
  // crypto carried 07-31 while the US, Europe and futures carried 07-30 — so a
  // single tape-wide "freshest" would have advertised Tokyo's age above New
  // York's numbers. Per group, the label describes what the reader is looking
  // at.
  const freshestAge = shown.reduce(
    (min, a) => Math.min(min, ageFromDate(a.as_of ?? a.updated_at)),
    Number.POSITIVE_INFINITY
  );
  const freshestDisplay =
    Number.isFinite(freshestAge) ? freshestAge : 0;
  // The SESSION every quote on screen closed in. Distinct dates within one
  // group are possible (a market on holiday while its neighbours trade), so
  // this states each one rather than picking the newest.
  const sessions = Array.from(
    new Set(shown.map((a) => a.as_of).filter(Boolean) as string[]),
  ).sort();

  return (
    <div className="mb-4" data-testid="market-bar-wrap">
      {groups.length > 1 && (
        /* `flex-wrap`, and the session label wraps BELOW the control rather
           than competing with it for one row. Measured at 390px: six buttons
           are ~310px and the label ~180px, so on one row the strip clipped
           `Crypto` and `Futures` — a toggle whose last two options cannot be
           reached is worse than no toggle. The control also scrolls if it ever
           outgrows the viewport by itself; that is the table's `overflow-x-auto`
           escape hatch, not goal 7's forbidden page-level scroller. */
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
          {/* Same segmented control as `LensSelector`, hand-rolled rather than
              imported: that component's `value`/`onChange` are typed to the L5
              `Lens` union (ADR-0015), and widening a lens type so a price tape
              can borrow its markup would couple the homepage tape to the
              book's asset-class contract. The LOOK is shared; the vocabulary
              is not. */}
          <div
            className="inline-flex items-stretch rounded-md border border-border bg-bg-elevated overflow-x-auto max-w-full"
            role="group"
            aria-label="Market group"
          >
            {groups.map((g, idx) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={g === active}
                className={[
                  "px-2.5 py-1 text-[11px] font-medium transition-colors",
                  idx > 0 ? "border-l border-border" : "",
                  g === active
                    ? "bg-accent text-bg-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
                ].join(" ")}
              >
                {g}
              </button>
            ))}
          </div>
          {/* Daily closes, said once. The tape looks like a live ticker and is
              not one: the pipeline runs at 21:30 UTC, so every figure here is a
              settled close from the session named beside it. Design goal 1 —
              a number a reader cannot place is worse than no number. */}
          <span className="text-[10.5px] text-text-tertiary">
            Daily closes
            {sessions.length > 0 && (
              <>
                {" · "}
                <span className="num">{sessions.join(", ")}</span> session
                {sessions.length > 1 ? "s" : ""}
              </>
            )}
          </span>
        </div>
      )}
    <div
      className="flex flex-wrap gap-0 bg-bg-surface border border-border rounded-[8px] overflow-hidden"
      data-testid="market-bar"
    >
      {shown.map((a, i) => {
        const isPos = a.pct_change >= 0;
        const isNeg = a.pct_change < 0;
        const isVix = a.ticker === "^VIX";
        // VIX: high is bad (red), low is good (green)
        const changeColor = isVix
          ? isPos
            ? "var(--short)"
            : "var(--long)"
          : isPos
            ? "var(--long)"
            : "var(--short)";

        return (
          <div key={a.ticker} className="flex items-center gap-2.5 px-4 py-2.5">
            {i > 0 && (
              <div className="w-px h-5 bg-border self-center" />
            )}
            <div className="flex flex-col">
              <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-[0.1em] leading-none mb-0.5">
                {a.name}
              </span>
              <div className="flex items-baseline gap-1.5">
                {/* Four decimals under 10, two above. Fixed 2dp was right for
                    a tape of index points and rounds EUR/USD 1.1512 to "1.15",
                    throwing away the two digits an FX quote is actually read
                    in — a 0.4% move would render as no move at all. Keyed on
                    magnitude rather than on the group, so USD/JPY at 160.84
                    and Bitcoin at 64,131.20 stay at 2dp where more would be
                    noise. */}
                <span className="num text-[13px] font-semibold text-text-primary leading-none">
                  {a.current.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: Math.abs(a.current) < 10 ? 4 : 2,
                  })}
                </span>
                <span
                  className="num text-[11.5px] font-semibold leading-none"
                  style={{ color: changeColor }}
                >
                  {isPos ? "▲" : "▼"}{" "}
                  {Math.abs(a.pct_change).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="ml-auto px-4 py-2.5 flex items-center text-text-tertiary text-[11px]">
        <FreshnessLabel observed_age_seconds={freshestDisplay} />
      </div>
    </div>
    </div>
  );
}
