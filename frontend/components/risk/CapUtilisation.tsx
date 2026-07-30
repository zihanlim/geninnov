// frontend/components/risk/CapUtilisation.tsx
//
// Violations answer "am I over?". Utilisation answers "how close am I?" — which
// is the only version of the question a limit can be managed against before it
// binds. Bars are drawn against the cap, so a full bar is exactly at the limit.

"use client";

import { DisclosureChevron } from "@/components/DisclosureChevron";
import {
  CAP_WARN_UTILISATION,
  capBarColor,
  explainGap,
  fmtPct,
  isNum,
  type AnalyticsState,
  type CapRow,
  type CapUtilisation as CapUtilisationData,
} from "@/lib/risk/analytics";
import { breachedCapRows, capRowUtil, isCapBreached } from "@/lib/risk/capBreach";
import { Ident, InlineGap, SectionGap, SectionSkeleton } from "./SectionGap";

interface CapGroup {
  id: "single_name" | "sector" | "geo";
  title: string;
  /** Which backend constant this group is measured against. */
  limitLabel: string;
  emptyDetail: React.ReactNode;
}

const GROUPS: CapGroup[] = [
  {
    id: "single_name",
    title: "Single name",
    limitLabel: "MAX_SINGLE_NAME_WEIGHT",
    emptyDetail: (
      <>
        No per-name rows in <Ident>cap_utilisation.single_name</Ident>. This array is
        built from the sized picks, so it is empty exactly when the book has no
        positions.
      </>
    ),
  },
  {
    id: "sector",
    title: "Sector",
    limitLabel: "MAX_SECTOR_WEIGHT",
    emptyDetail: (
      <>
        No sector rows in <Ident>cap_utilisation.sector</Ident>. Sector weights come
        from <Ident>book_metrics.SECTOR_MAP</Ident>; an empty array means either no
        positions, or no held ticker is present in that map.
      </>
    ),
  },
  {
    id: "geo",
    title: "Geography",
    limitLabel: "MAX_GEO_WEIGHT",
    emptyDetail: (
      <>
        No geography rows in <Ident>cap_utilisation.geo</Ident>. Geography weights come
        from <Ident>book_metrics.GEO_MAP</Ident>; an empty array means either no
        positions, or no held ticker is present in that map.
      </>
    ),
  },
];

function CapBar({ row }: { row: CapRow }) {
  const util = capRowUtil(row);
  // Recomputed with the board's tolerance, not read from the persisted flag — a group
  // resting exactly on its cap carries float dust (util 1.0000000000000002) that a bare
  // `util > 1` misreads as a breach. See lib/risk/capBreach.ts.
  const breached = isCapBreached(row);
  const warning = !breached && util !== null && util >= CAP_WARN_UTILISATION;
  const fillPct = util === null ? 0 : Math.min(Math.max(util, 0), 1) * 100;
  const overflowPct =
    util !== null && util > 1 ? Math.min((util - 1) * 100, 100) : 0;
  const color = capBarColor({ ...row, utilisation: util ?? 0, breached });

  return (
    // Two columns on a phone, three on a desktop, two again at `xl`. At 375px the
    // three-column form needs 96 + 120 + ~110 + gaps ≈ 350px inside a 260px card
    // body, and the card clips overflow rather than scrolling it — so the
    // utilisation percentage, the one number this panel exists to show, was
    // invisible on mobile with nothing to suggest it had been cut. Below `sm` the
    // bar drops to its own full-width row.
    //
    // It drops BACK at `xl` for the same arithmetic at the other end: that is the
    // breakpoint where /mandate puts this card in the last of four columns
    // (1336 content − 3×24 gap, /4 = 316px, ~280px of card body), which is under
    // the 350px the three-column form needs. The gate is the layout's breakpoint,
    // not a guess — the card is full width below `xl` and a quarter of it above,
    // so each form is used exactly where its width exists.
    <li className="grid grid-cols-[minmax(72px,1fr)_auto] sm:grid-cols-[minmax(96px,1fr)_minmax(120px,3fr)_auto] xl:grid-cols-[minmax(72px,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5">
      <span className="num text-[12px] text-text-primary truncate order-1" title={row.key}>
        {row.key || "—"}
      </span>

      <div className="flex items-center gap-1.5 order-3 col-span-2 sm:order-2 sm:col-span-1 xl:order-3 xl:col-span-2">
        <div
          className="relative h-2 flex-1 rounded-sm bg-bg-elevated border border-border overflow-hidden"
          role="img"
          aria-label={`${row.key}: weight ${fmtPct(row.weight)} against a cap of ${fmtPct(row.cap)}, ${
            util !== null ? `${(util * 100).toFixed(2)}% of the limit` : "utilisation unavailable"
          }${breached ? " — breached" : ""}`}
        >
          {/* 80% warning tick — the point at which a limit starts to constrain. */}
          <div
            className="absolute top-0 bottom-0 w-px bg-border-strong"
            style={{ left: `${CAP_WARN_UTILISATION * 100}%` }}
            aria-hidden="true"
          />
          <div
            className="absolute left-0 top-0 bottom-0 rounded-sm"
            style={{ width: `${fillPct}%`, background: color }}
          />
        </div>
        {overflowPct > 0 && (
          <div
            className="h-2 rounded-sm"
            style={{
              width: `${Math.max(overflowPct * 0.2, 4)}px`,
              background: "var(--short)",
              opacity: 0.55,
            }}
            aria-hidden="true"
            title="Weight exceeds the cap"
          />
        )}
      </div>

      <span className="num text-[11px] text-right whitespace-nowrap order-2 sm:order-3 xl:order-2">
        <span className={breached ? "text-short" : warning ? "text-warning" : "text-text-primary"}>
          {fmtPct(row.weight)}
        </span>
        <span className="text-text-tertiary"> / {fmtPct(row.cap)}</span>
        <span className="text-text-tertiary ml-1.5">
          ({util !== null ? `${(util * 100).toFixed(0)}%` : "—"})
        </span>
      </span>
    </li>
  );
}

function CapGroupBlock({
  group,
  rows,
  limit,
}: {
  group: CapGroup;
  rows: CapRow[] | null | undefined;
  limit: number | null | undefined;
}) {
  const sorted = [...(rows ?? [])].sort(
    (a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0),
  );
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h3 className="card-title m-0">{group.title}</h3>
        <span className="text-[11px] text-text-tertiary num">
          limit {isNum(limit) ? fmtPct(limit) : "—"} · {group.limitLabel}
        </span>
      </div>
      {sorted.length === 0 ? (
        <InlineGap>{group.emptyDetail}</InlineGap>
      ) : (
        <ul className="m-0 p-0 list-none">
          {sorted.map((row, i) => (
            <CapBar key={`${row.key}-${i}`} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function CapUtilisation({
  state,
}: {
  state: AnalyticsState<CapUtilisationData>;
}) {
  const gap = explainGap(state, {
    column: "cap_utilisation",
    emptyMeaning:
      "The object is present but every group (single_name, sector, geo) is empty. Cap rows are derived " +
      "from the sized picks, so this is what a run with zero positions produces — there is nothing to " +
      "measure against the limits.",
  });

  const data = state.status === "ok" ? state.value : null;
  // Recompute breaches from utilisation with the board's tolerance rather than trusting
  // data.violations — that list is written by the pipeline and can carry a float-dust
  // "breach" (US at 35.0000000000003% > 35%) the board already discounts, which left the
  // panel reading "1 breach" beside the board's "0 breached". See lib/risk/capBreach.ts.
  const breaches = breachedCapRows(data);
  const totalRows =
    (data?.single_name?.length ?? 0) +
    (data?.sector?.length ?? 0) +
    (data?.geo?.length ?? 0);

  return (
    // `open`: the caps are one of the four cards /mandate opens with since it
    // became a single row, and a card whose whole content is behind a summary bar
    // spends a quarter of that row on a 58px header. Design goal 7's own 2026-07-30
    // narrowing is the standing direction here — every card stays visible on
    // arrival — so this is that rule reaching an existing <details> rather than a
    // new one being added. The disclosure itself is kept: a reader who wants the
    // limit board beside it without 19 bars can still close it.
    //
    // It carries NO `h-full`, unlike the other two cards in that row (ADR-0181):
    // it does not own its column, it shares it with the five risk-metric tiles
    // stacked beneath it. The COLUMN is what aligns to the row's height; this
    // card is content-height at the top of it, and a stretched card here would
    // push the tiles out of the row entirely.
    <details open className="card mb-6 group" aria-labelledby="risk-caps-heading">
      <summary className="card-header cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <h2 id="risk-caps-heading" className="card-title m-0">
          Cap utilisation
        </h2>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary num">
            {state.status === "ok"
              ? `${totalRows} limit${totalRows === 1 ? "" : "s"} monitored · ${breaches.length} breach${
                  breaches.length === 1 ? "" : "es"
                }`
              : "Single name · sector · geography"}
          </span>
          <DisclosureChevron className="text-text-tertiary" />
        </span>
      </summary>

      {state.status === "loading" ? (
        <SectionSkeleton height={240} />
      ) : gap || !data ? (
        gap ? (
          <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
        ) : null
      ) : (
        <div className="card-body">
          {breaches.length > 0 && (
            <div
              className="mb-5 pl-4 border-l-2 py-1"
              style={{ borderColor: "var(--short)" }}
              role="alert"
            >
              <p className="m-0 mb-1 text-[12px] font-medium text-short uppercase tracking-[0.1em]">
                {breaches.length} cap breach{breaches.length === 1 ? "" : "es"}
              </p>
              <ul className="m-0 pl-4 text-[12px] text-text-secondary">
                {breaches.map((row, i) => (
                  <li key={`${row.key}-${i}`} className="num">
                    {row.key} — {fmtPct(row.weight)} vs {fmtPct(row.cap)} cap
                  </li>
                ))}
              </ul>
            </div>
          )}

          {GROUPS.map((group) => (
            <CapGroupBlock
              key={group.id}
              group={group}
              rows={data[group.id]}
              limit={data.limits?.[group.id]}
            />
          ))}

          <p className="m-0 mt-4 pt-3.5 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
            Bars are drawn against the cap, so a full bar sits exactly on the limit;
            the tick marks {(CAP_WARN_UTILISATION * 100).toFixed(0)}% of the limit,
            where the constraint starts to bind. Amber above that, red once breached.
            Source: <Ident>research_recommendations.cap_utilisation</Ident>.
          </p>
        </div>
      )}
    </details>
  );
}
