// frontend/components/risk/CapUtilisation.tsx
//
// Violations answer "am I over?". Utilisation answers "how close am I?" — which
// is the only version of the question a limit can be managed against before it
// binds. Bars are drawn against the cap, so a full bar is exactly at the limit.

"use client";
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
  const util = isNum(row.utilisation)
    ? row.utilisation
    : isNum(row.weight) && isNum(row.cap) && row.cap !== 0
      ? row.weight / row.cap
      : null;
  const breached = row.breached === true || (util !== null && util > 1);
  const warning = !breached && util !== null && util >= CAP_WARN_UTILISATION;
  const fillPct = util === null ? 0 : Math.min(Math.max(util, 0), 1) * 100;
  const overflowPct =
    util !== null && util > 1 ? Math.min((util - 1) * 100, 100) : 0;
  const color = capBarColor({ ...row, utilisation: util ?? 0, breached });

  return (
    <li className="grid grid-cols-[minmax(96px,1fr)_minmax(120px,3fr)_auto] items-center gap-3 py-1.5">
      <span className="num text-[12px] text-text-primary truncate" title={row.key}>
        {row.key || "—"}
      </span>

      <div className="flex items-center gap-1.5">
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

      <span className="num text-[11px] text-right whitespace-nowrap">
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
  const violations = (data?.violations ?? []).filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  const totalRows =
    (data?.single_name?.length ?? 0) +
    (data?.sector?.length ?? 0) +
    (data?.geo?.length ?? 0);

  return (
    <details className="card mb-6 group" aria-labelledby="risk-caps-heading">
      <summary className="card-header cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <h2 id="risk-caps-heading" className="card-title m-0">
          Cap utilisation
        </h2>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary num">
            {state.status === "ok"
              ? `${totalRows} limit${totalRows === 1 ? "" : "s"} monitored · ${violations.length} breach${
                  violations.length === 1 ? "" : "es"
                }`
              : "Single name · sector · geography"}
          </span>
          <span className="text-[10px] text-text-tertiary transition-transform group-open:rotate-90">▸</span>
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
          {violations.length > 0 && (
            <div
              className="mb-5 pl-4 border-l-2 py-1"
              style={{ borderColor: "var(--short)" }}
              role="alert"
            >
              <p className="m-0 mb-1 text-[12px] font-medium text-short uppercase tracking-[0.1em]">
                {violations.length} cap breach{violations.length === 1 ? "" : "es"}
              </p>
              <ul className="m-0 pl-4 text-[12px] text-text-secondary">
                {violations.map((v, i) => (
                  <li key={`${v}-${i}`} className="num">
                    {v}
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
