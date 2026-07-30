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
  type CorrelationSummary,
} from "@/lib/risk/analytics";
import {
  breachedCapRows,
  capCoverage,
  capRowUtil,
  isCapBreached,
} from "@/lib/risk/capBreach";
import { ENFORCED } from "@/lib/mandate";
import type { ComplexSizing } from "@/lib/book/sizingProvenance";
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

/**
 * How close the book is to forming a complex, drawn rather than described.
 *
 * The scale is a CORRELATION (0…1), not a weight against a cap, so it is not a
 * `CapBar`: the fill is the book's most correlated held pair, the tick is the
 * threshold at which two names become one idea, and the caret under the track is
 * the mean across every pair. Both the value AND the threshold are read from
 * `book_metrics.correlation_summary` — including `flag_threshold`, which is why
 * 0.70 is no longer a number written into this component's prose (the drift
 * ADR-0185 left open).
 */
function CorrelationMeter({
  label,
  corr,
  threshold,
  mean,
  pairCount,
}: {
  label: string;
  corr: number;
  threshold: number;
  mean: number | null;
  pairCount: number | null;
}) {
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const crossed = corr >= threshold;
  const fill = clamp01(corr) * 100;
  const tick = clamp01(threshold) * 100;
  const meanPct = isNum(mean) ? clamp01(mean) * 100 : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-[12px] text-text-primary truncate" title={label}>
          {label}
        </span>
        <span className="num text-[11px] whitespace-nowrap">
          <span className={crossed ? "text-warning" : "text-text-primary"}>
            {corr.toFixed(3)}
          </span>
          <span className="text-text-tertiary"> / {threshold.toFixed(2)}</span>
        </span>
      </div>

      <div
        className="relative h-2 mt-1 rounded-sm bg-bg-elevated border border-border overflow-hidden"
        role="img"
        aria-label={
          `The book's most correlated pair, ${label}, at ${corr.toFixed(3)} against a ` +
          `${threshold.toFixed(2)} threshold — ${crossed ? "at or above it" : "below it"}` +
          (isNum(mean) ? `, with a mean absolute correlation of ${mean.toFixed(3)}` : "") +
          "."
        }
      >
        <div
          className="absolute left-0 top-0 bottom-0 rounded-sm"
          style={{ width: `${fill}%`, background: crossed ? "var(--warning)" : "var(--accent)" }}
        />
        {/* Drawn AFTER the fill so it stays visible once the bar passes it — the
            one position on this track a reader has to be able to find. */}
        <div
          className="absolute top-0 bottom-0 w-px bg-border-strong"
          style={{ left: `${tick}%` }}
          aria-hidden="true"
        />
      </div>

      {meanPct !== null && (
        <div className="relative h-[9px]" aria-hidden="true">
          <div
            className="absolute top-0 w-px h-[4px] bg-text-tertiary"
            style={{ left: `${meanPct}%` }}
          />
        </div>
      )}

      <p className="m-0 mt-0.5 text-[10.5px] text-text-tertiary leading-[1.45]">
        Bar: the book&rsquo;s most correlated held pair. Tick:{" "}
        <span className="num">{threshold.toFixed(2)}</span>, where names become one
        idea.
        {isNum(mean) && (
          <>
            {" "}
            Mark below: mean <span className="num">|ρ| {mean.toFixed(3)}</span>
            {isNum(pairCount) ? (
              <>
                {" "}
                across <span className="num">{pairCount}</span> pairs
              </>
            ) : null}
            .
          </>
        )}
      </p>
    </div>
  );
}

function ComplexCap({
  sizing,
  summary,
  singleName,
}: {
  sizing: ComplexSizing | null | undefined;
  summary: CorrelationSummary | null | undefined;
  singleName: CapRow[] | null | undefined;
}) {
  const mu = sizing?.mu_signal_equalised ?? null;
  const complexes = mu?.complexes ?? [];
  const skipped = mu?.skipped ?? [];
  const riskMultiple = sizing?.risk_cap_multiple_of_single_name;

  const cap = ENFORCED.complex_pct.value;
  const weightOf = (asset: string): number | null => {
    const hit = (singleName ?? []).find((r) => r.key === asset);
    return hit && isNum(hit.weight) ? hit.weight : null;
  };
  /** Σ weight over a complex's members. Null if ANY member is unpriced — a
   *  partial sum measured against a whole-group cap understates utilisation. */
  const groupWeight = (members: string[]): number | null => {
    if (members.length === 0) return null;
    let total = 0;
    for (const m of members) {
      const w = weightOf(m);
      if (w === null) return null;
      total += w;
    }
    return total;
  };

  const top = summary?.max_abs_pair ?? null;
  const threshold = summary?.flag_threshold;
  const topCorr = top?.corr;
  const pair =
    top?.asset_a && top?.asset_b ? [top.asset_a, top.asset_b] : null;
  const pairWeight = pair ? groupWeight(pair) : null;

  return (
    <div className="mt-5 pt-4 border-t border-border">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h3 className="card-title m-0">Correlation complex</h3>
        <span className="text-[11px] text-text-tertiary num">
          limit {fmtPct(cap)} · {ENFORCED.complex_pct.configKey}
        </span>
      </div>

      {/* Formed complexes ARE cap rows — same bar, same cap, same reading as the
          three groups above, because that is exactly what they are: a group of
          names sharing one allowance. */}
      {complexes.length > 0 && (
        <ul className="m-0 p-0 list-none mb-3">
          {complexes.map((c, i) => {
            const members = c.members ?? [];
            const w = groupWeight(members);
            return (
              <CapBar
                key={c.id ?? `complex-${i}`}
                row={{
                  key: members.join(" + ") || (c.id ?? "complex"),
                  weight: w,
                  cap,
                  utilisation: w !== null && cap !== 0 ? w / cap : null,
                  breached: false,
                } as CapRow}
              />
            );
          })}
        </ul>
      )}

      {isNum(topCorr) && isNum(threshold) && pair ? (
        <CorrelationMeter
          label={pair.join(" + ")}
          corr={topCorr}
          threshold={threshold}
          mean={isNum(summary?.mean_abs_corr) ? summary!.mean_abs_corr! : null}
          pairCount={isNum(summary?.pair_count) ? summary!.pair_count! : null}
        />
      ) : (
        <InlineGap>
          No <Ident>book_metrics.correlation_summary</Ident> on this run, so how close
          the book sits to forming a complex is unmeasured — not the same claim as it
          being far from one.
        </InlineGap>
      )}

      <p className="m-0 mt-2 text-[11.5px] text-text-secondary leading-[1.55]">
        {complexes.length > 0 ? (
          <>
            <span className="num">{complexes.length}</span> complex
            {complexes.length === 1 ? "" : "es"} formed. Members share one signal and
            one name&rsquo;s allowance — without it a 5% expected-return gap corners the
            book on whichever member scores highest (ADR-0116).
          </>
        ) : (
          <>
            No complex formed, so this cap constrained nothing on this run.
            {isNum(topCorr) && isNum(threshold) && pair && (
              <>
                {" "}
                The closest pair sits{" "}
                <span className="num">{(threshold - topCorr).toFixed(3)}</span> below the
                line
                {pairWeight !== null && (
                  <>
                    ; <span className="num">{pair.join(" + ")}</span> hold{" "}
                    <span className="num">{fmtPct(pairWeight)}</span> between them, which
                    a crossing would measure against{" "}
                    <span className="num">{fmtPct(cap)}</span> instead of two separate
                    single-name caps
                  </>
                )}
                .
              </>
            )}
          </>
        )}
      </p>

      {skipped.length > 0 && (
        <p className="m-0 mt-1.5 text-[11.5px] text-text-tertiary leading-[1.55]">
          <span className="num">{skipped.length}</span> group
          {skipped.length === 1 ? "" : "s"} left untouched:{" "}
          {skipped
            .map(
              (x) =>
                `${(x.members ?? []).join(" + ")} — ${x.reason ?? "no reason recorded"}`,
            )
            .join("; ")}
          .
        </p>
      )}

      {isNum(riskMultiple) && (
        <p className="m-0 mt-1.5 text-[11px] text-text-tertiary leading-[1.5]">
          A complex&rsquo;s RISK budget is <span className="num">×{riskMultiple}</span> one
          name&rsquo;s, and can bind while the capital bars above still show headroom
          (ADR-0118).
        </p>
      )}

      <p className="m-0 mt-1.5 text-[10.5px] text-text-tertiary leading-[1.5]">
        Source: <Ident>optimizer_result.complex_sizing</Ident> ·{" "}
        <Ident>book_metrics.correlation_summary</Ident>
      </p>
    </div>
  );
}

export function CapUtilisation({
  state,
  complexSizing,
  grossExposure,
  correlationSummary,
}: {
  state: AnalyticsState<CapUtilisationData>;
  /** ADR-0116/0118 complex machinery, from the same run's optimizer_result. */
  complexSizing?: ComplexSizing | null;
  /** book_metrics.gross_exposure — what each grouping's rows should add up to. */
  grossExposure?: number | null;
  /** book_metrics.correlation_summary — the measured distance to a complex. */
  correlationSummary?: CorrelationSummary | null;
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
  // A cap binds only on weight it can SEE. Sector and geography rows are built
  // from book_metrics' SECTOR_MAP / GEO_MAP, and a held ticker missing from either
  // map sits in no group at all — the bars look identical whether they describe the
  // whole book or two thirds of it. See lib/risk/capBreach.ts → capCoverage.
  const coverage = capCoverage(data, grossExposure);

  return (
    // A PLAIN SECTION, not a <details> (owner's direction, ADR-0183).
    //
    // It was a disclosure, then a disclosure forced `open` by default (ADR-0180),
    // which is two states where the page only ever wanted one. The argument for
    // keeping the toggle was that a reader might want the limit board beside it
    // without nineteen bars — but this card now OWNS the mandate row's last
    // column, so collapsing it buys no space for anything: the row's height is
    // set by the two cards beside it and closing this one left a stretched empty
    // box, which is why it needed an `[open]`-gated `h-full` at all.
    //
    // Deleting the disclosure deletes that whole apparatus: `open:h-full`, the
    // `open:flex` pair, and the `[&::details-content]` rule that existed only
    // because Chrome wraps a <details>'s content in a UA box the flex column
    // cannot reach through. A <section> flexes its own children, so the closing
    // note pins to the baseline with no browser-specific rule at all.
    <section
      className="card mb-6 h-full flex flex-col"
      aria-labelledby="risk-caps-heading"
    >
      <div className="card-header">
        <h2 id="risk-caps-heading" className="card-title m-0">
          Cap utilisation
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {state.status === "ok"
            ? `${totalRows} limit${totalRows === 1 ? "" : "s"} monitored · ${breaches.length} breach${
                breaches.length === 1 ? "" : "es"
              }`
            : "Single name · sector · geography"}
        </span>
      </div>

      {state.status === "loading" ? (
        <SectionSkeleton height={240} />
      ) : gap || !data ? (
        gap ? (
          <SectionGap copy={gap} tone={state.status === "query_error" ? "error" : "empty"} />
        ) : null
      ) : (
        <div className="card-body flex-1 flex flex-col">
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

          {/* flex-1 on the GROUPS, not `mt-auto` on the note below them: this is
              what absorbs the slack when the card is stretched to the mandate
              row's height, and it leaves the note's own `mt-4` intact for every
              layout where there is no slack to absorb. */}
          <div className="flex-1">
            {GROUPS.map((group) => (
              <CapGroupBlock
                key={group.id}
                group={group}
                rows={data[group.id]}
                limit={data.limits?.[group.id]}
              />
            ))}
            <ComplexCap
              sizing={complexSizing}
              summary={correlationSummary}
              singleName={data.single_name}
            />
          </div>

          <p className="m-0 mt-4 pt-3.5 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
            Bars are drawn against the cap, so a full bar sits exactly on the limit;
            the tick marks {(CAP_WARN_UTILISATION * 100).toFixed(0)}% of the limit,
            where the constraint starts to bind. Amber above that, red once breached.
            {coverage.gross !== null && (
              <>
                {" "}
                Single name / sector / geography account for{" "}
                {coverage.groups
                  .map((g) =>
                    g.share !== null
                      ? `${(g.share * 100).toFixed(0)}%`
                      : "an unmeasurable share",
                  )
                  .join(" / ")}{" "}
                of the book&rsquo;s {fmtPct(coverage.gross)} gross
                {coverage.complete
                  ? " — every held dollar sits inside a mapped group, so each cap can see the whole book."
                  : " — the shortfall is weight in no mapped group, where its cap cannot bind."}
              </>
            )}{" "}
            Source: <Ident>research_recommendations.cap_utilisation</Ident>.
          </p>
        </div>
      )}
    </section>
  );
}
