// The mandate: the constraints this book is run under, stated once.
//
// WHY THIS EXISTS
// ---------------
// /book says "sized by conviction across $100M", reports "$38.1M is held in cash",
// and tells a reader the US geography cap at 35% is binding. Every one of those is a
// mandate claim, and until this panel there was nowhere a reader could learn what the
// mandate WAS. The caps appeared only as per-name utilisation bars and one sentence
// inside a collapsed sizing panel; the capital base appeared only as prose.
//
// That is design goal 1 ("no naked numbers") failing at the level of the constraints
// the entire book is built under: a reader sees "35% — at limit" and cannot trace who
// chose 35%, against what, or whether the sizer and the risk board even agree it is
// 35%. They did not agree — riskBoard declared a 200% gross ceiling against a sizer
// enforcing 100%.
//
// WHAT IT REFUSES TO DO
// ---------------------
// It is READ-ONLY, and says so. Design goal 5: "No control may imply it can change
// the book. The frontend shows no COMMIT, no RECALCULATE, no SAVE. A button that
// implies a capability the system does not have is a lie with a hover state."
//
// A mandate control in this page would be exactly that lie. The book is built by a
// GitHub Actions job at 21:30 UTC; changing a cap at 14:00 changes nothing a reader
// can see until tomorrow, and nothing at all about the book already on screen. The
// honest statement — which the panel makes — is that the mandate is operator-set in
// scoring_config and takes effect on the next run.
//
// ENFORCED vs MONITORED
// ---------------------
// The two groups are rendered separately because they are different promises. The
// enforced caps are solver constraints (ADR-0107) clamped by the allocator
// (ADR-0037): a published book CANNOT breach one, and if it did that would be a bug.
// The monitored thresholds constrain nothing — there is no net-exposure or beta
// constraint anywhere in optimizer.py — so a breach of one is information about the
// book, not a defect in it. Rendering them in one list said those were the same
// event.

import { ENFORCED, MONITORED, BOOK_SHAPE, type LimitSource } from "@/lib/mandate";

/** A `scoring_config` row, as /risk already fetches them. */
export interface ConfigRow {
  param_name: string;
  value: string;
}

function Ident({ children }: { children: React.ReactNode }) {
  return <span className="num text-[10.5px] text-text-tertiary">{children}</span>;
}

/**
 * Each limit in its own units. Not every value on this panel is a percentage, and
 * rendering one as a percentage because most of them are is how |beta| 0.5 first
 * displayed as "50%" — a ratio dressed as a share of capital, which is a different
 * quantity and a wrong number (design goal 1).
 */
function fmtLimit(key: string, value: number): string {
  if (key === "total_capital") return `$${(value / 1_000_000).toFixed(0)}M`;
  if (key === "crowded_multiplier") return `× ${value}`;
  if (key === "hhi") return value.toLocaleString("en-US");
  // A beta is a regression coefficient against the index, not a share of anything.
  if (key === "beta_abs") return value.toFixed(2);
  return `${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;
}

interface Row {
  key: string;
  label: string;
  note: string;
  value: number;
  configKey: string;
}

const ENFORCED_ROWS: Row[] = [
  {
    key: "total_capital",
    label: "Capital base",
    note: "What the book is sized against. Whatever the limits refuse is held as cash, not redeployed.",
    value: ENFORCED.total_capital.value,
    configKey: ENFORCED.total_capital.configKey,
  },
  {
    key: "single_name_pct",
    label: "Single name",
    note: "No one position may exceed this share of the book.",
    value: ENFORCED.single_name_pct.value,
    configKey: ENFORCED.single_name_pct.configKey,
  },
  {
    key: "sector_pct",
    label: "Sector",
    note: "Applied to every sector group, with no minimum member count.",
    value: ENFORCED.sector_pct.value,
    configKey: ENFORCED.sector_pct.configKey,
  },
  {
    key: "geo_pct",
    label: "Geography",
    note: "Applied to every geography group, with no minimum member count.",
    value: ENFORCED.geo_pct.value,
    configKey: ENFORCED.geo_pct.configKey,
  },
  {
    key: "gross_exposure_pct",
    label: "Gross exposure",
    note: "Long + short. A ceiling the sizer reaches from below — it is not a target.",
    value: ENFORCED.gross_exposure_pct.value,
    configKey: ENFORCED.gross_exposure_pct.configKey,
  },
  {
    key: "complex_pct",
    label: "Correlation complex",
    note: "Names correlated above 0.70 are one idea, so they share one name's allowance.",
    value: ENFORCED.complex_pct.value,
    configKey: ENFORCED.complex_pct.configKey,
  },
  {
    key: "crowded_multiplier",
    label: "Crowded-name cap",
    note: "A name specs already crowd gets half its single-name cap. Only ever tightens.",
    value: ENFORCED.crowded_multiplier.value,
    configKey: ENFORCED.crowded_multiplier.configKey,
  },
  {
    key: "turnover_pct",
    label: "Turnover (day-over-day)",
    note: "Distance from yesterday's published book. Applies only when a prior book exists — a first day is not a breach of stillness.",
    value: ENFORCED.turnover_pct.value,
    configKey: ENFORCED.turnover_pct.configKey,
  },
];

const MONITORED_ROWS: Row[] = [
  { key: "var_95_pct", label: "VaR 95%", note: "1-day, as a share of capital.", value: MONITORED.var_95_pct.value, configKey: MONITORED.var_95_pct.configKey },
  { key: "cvar_95_pct", label: "CVaR 95%", note: "The tail beyond VaR.", value: MONITORED.cvar_95_pct.value, configKey: MONITORED.cvar_95_pct.configKey },
  { key: "max_drawdown_pct", label: "Max drawdown", note: "Peak-to-trough on the realised curve.", value: MONITORED.max_drawdown_pct.value, configKey: MONITORED.max_drawdown_pct.configKey },
  { key: "net_exposure_pct", label: "Net exposure", note: "Long − short. Nothing in the sizer targets this.", value: MONITORED.net_exposure_pct.value, configKey: MONITORED.net_exposure_pct.configKey },
  { key: "beta_abs", label: "|Beta| to SPX", note: "Nothing in the sizer targets this either.", value: MONITORED.beta_abs.value, configKey: MONITORED.beta_abs.configKey },
  { key: "hhi", label: "Concentration (HHI)", note: "Herfindahl on the 0–10 000 scale; 2 000 ≈ five equal names.", value: MONITORED.hhi.value, configKey: MONITORED.hhi.configKey },
];

function SourceChip({ source }: { source: LimitSource }) {
  // Both use badge-neutral and are told apart by their TEXT, not their hue.
  //
  // --long/--short are fenced to book direction (design goal 3) and this is not a
  // direction. --warning would be wrong too: a code default is not a fault, it is
  // simply a value with no database row, which is the correct state for the book
  // shape and the lens. So the label carries the distinction, which is the same
  // principle goal 3 applies to direction — hue may reinforce, never carry.
  return source === "scoring_config" ? (
    <span className="badge badge-neutral" title="Read from the scoring_config table">
      config
    </span>
  ) : (
    <span
      className="badge badge-neutral"
      title="No scoring_config row; this is the documented fallback in backend/services/mandate.py"
    >
      code default
    </span>
  );
}

function LimitTable({
  rows,
  sourceOf,
  caption,
}: {
  rows: Row[];
  sourceOf: (configKey: string) => LimitSource;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {["Limit", "Value", "Source", "What it means"].map((h, i) => (
              <th
                key={h}
                className={`px-[16px] py-2.5 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                  i === 1 ? "text-right" : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-[16px] py-2.5 border-b border-border font-medium text-text-primary whitespace-nowrap">
                {row.label}
              </td>
              <td className="px-[16px] py-2.5 border-b border-border text-right num text-text-primary whitespace-nowrap">
                {fmtLimit(row.key, row.value)}
              </td>
              <td className="px-[16px] py-2.5 border-b border-border whitespace-nowrap">
                <SourceChip source={sourceOf(row.configKey)} />
                <div className="mt-0.5">
                  <Ident>{row.configKey}</Ident>
                </div>
              </td>
              <td className="px-[16px] py-2.5 border-b border-border text-text-secondary text-[12px] leading-[1.5]">
                {row.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MandatePanel({
  config,
  lens,
}: {
  /** scoring_config rows, so each limit can say where its value came from. */
  config: ConfigRow[] | null;
  /** The lens the published run used, from the book row. */
  lens: string | null;
}) {
  const present = new Set((config ?? []).map((r) => r.param_name));
  const sourceOf = (configKey: string): LimitSource =>
    present.has(configKey) ? "scoring_config" : "code_default";

  return (
    <section className="card mb-6" id="mandate">
      <div className="card-header">
        <span className="card-title">The mandate</span>
        <span className="text-[11px] text-text-tertiary">
          What this book is allowed to be
        </span>
      </div>

      <div className="card-body">
        <p className="m-0 mb-4 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
          Every figure on <span className="num">/book</span> is produced under these
          constraints. The board below measures the published book against them.
        </p>

        <h3 className="m-0 mb-1 text-[13px] font-semibold text-text-primary">
          Enforced — the sizer cannot breach these
        </h3>
        <p className="m-0 mb-2 text-[11.5px] text-text-tertiary leading-[1.55] max-w-[92ch]">
          Entered into the optimizer as constraints (ADR-0107) and clamped by the
          heuristic allocator (ADR-0037). A published book breaching one of these
          would be a bug, not a market event.
        </p>
        <LimitTable
          rows={ENFORCED_ROWS}
          sourceOf={sourceOf}
          caption="Constraints the sizer enforces, with the scoring_config key each is read from."
        />

        <h3 className="m-0 mt-6 mb-1 text-[13px] font-semibold text-text-primary">
          Monitored — reported, but not enforced
        </h3>
        <p className="m-0 mb-2 text-[11.5px] text-text-tertiary leading-[1.55] max-w-[92ch]">
          Nothing in the backend constrains any of these. There is no net-exposure
          constraint and no beta target anywhere in the sizer, so a book can and does
          cross them. A breach here is information about the book; a breach above
          would be a defect in it.
        </p>
        <LimitTable
          rows={MONITORED_ROWS}
          sourceOf={sourceOf}
          caption="Thresholds the risk board reports against, none of which constrain sizing."
        />

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[8px] border border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-1">
              Book shape
            </div>
            <div className="text-[13px] text-text-primary">
              At most{" "}
              <span className="num">{BOOK_SHAPE.max_longs}</span> long and{" "}
              <span className="num">{BOOK_SHAPE.max_shorts}</span> short
            </div>
            <div className="mt-1 text-[11.5px] text-text-tertiary leading-[1.5]">
              Enforced when the agent selects names, not by the sizer.{" "}
              <SourceChip source="code_default" />
            </div>
          </div>

          <div className="rounded-[8px] border border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-1">
              Lens
            </div>
            <div className="text-[13px] text-text-primary num">{lens ?? "—"}</div>
            <div className="mt-1 text-[11.5px] text-text-tertiary leading-[1.5]">
              Which asset classes the candidate pool is filtered to before the agent
              sees it (ADR-0015). A per-run argument, not a standing limit.
            </div>
          </div>
        </div>

        {/* Design goal 5, stated rather than implied by the absence of a button. */}
        <p className="m-0 mt-4 pt-3 border-t border-border text-[11.5px] text-text-tertiary leading-[1.6] max-w-[92ch]">
          <span className="font-semibold text-text-secondary">
            This page cannot change any of these.
          </span>{" "}
          The mandate is operator-set in <Ident>scoring_config</Ident> and read once
          per run; a change takes effect on the next scheduled run at 21:30 UTC and
          never alters a book already published. The values above are mirrored in{" "}
          <Ident>backend/services/mandate.py</Ident>, and{" "}
          <Ident>mandate-drift.test.ts</Ident> fails the build if the two disagree.
        </p>
      </div>
    </section>
  );
}
