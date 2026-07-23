"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CitationList, { Citation } from "@/components/CitationList";
import { StatusBadge } from "@/components/status/StatusBadge";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import ThesisBlock from "@/components/research/ThesisBlock";
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";

/**
 * /book — the $100M long-short book, as ONE object.
 *
 * This replaces the split across /trades (TradeScore ranking), /portfolio
 * (sizes and risk scalars) and /research (thesis prose). Those were three
 * partial views of the same ten positions, drawn from three tables, with no
 * cross-links — so "why am I short KWEB at 8%?" could not be answered from any
 * single page. Everything a position claim depends on now lives in one row.
 */

interface Pick {
  direction: "long" | "short";
  asset: string;
  theme?: string;
  theme_id?: string;
  theme_name?: string;
  thesis?: string;
  catalysts?: string[];
  risk?: string;
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  notional?: number;
  weight?: number;
  signed_weight?: number;
  hype_score?: number;
  trade_score?: number;
}

interface FunnelStage {
  stage: string;
  remaining: number;
  removed: number;
  reason: string;
}

interface ScenarioResult {
  scenario_name: string;
  label: string;
  estimated_book_return: number;
  estimated_dollar_pnl: number;
  severity: string;
  contribution_breakdown: string[];
}

interface BookMetrics {
  computed: boolean;
  factor_tilts: Record<string, number>;
  gross_exposure: number;
  net_exposure: number;
  long_weight: number;
  short_weight: number;
  sector_weights: Record<string, number>;
  geo_weights: Record<string, number>;
}

interface CapRow {
  key: string;
  weight: number;
  cap: number;
  utilisation: number;
  breached: boolean;
}

interface Recommendation {
  run_date: string;
  picks: Pick[];
  book_view: string | null;
  book_risks: string[] | null;
  agent_run_id?: string;
  advisory_derivation?: AdvisoryDerivation | null;
  book_metrics?: BookMetrics | null;
  scenario_results?: ScenarioResult[] | null;
  cap_utilisation?: {
    single_name: CapRow[];
    sector: CapRow[];
    geo: CapRow[];
    limits: Record<string, number>;
    violations: string[];
  } | null;
  screening_funnel?: FunnelStage[] | null;
  lens?: string | null;
}

const fmtUSD = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `$${(n / 1_000_000).toFixed(1)}M`;
const fmtPct = (n?: number | null, dp = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `${(n * 100).toFixed(dp)}%`;
const fmtSigned = (n?: number | null, dp = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}`;

const SEVERITY_COLOR: Record<string, string> = {
  low: "var(--text-secondary)",
  moderate: "var(--warning)",
  high: "#e8833a",
  severe: "var(--short)",
};

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
          <div className="skeleton h-[180px]" />
        </main>
      }
    >
      <BookPageInner />
    </Suspense>
  );
}

function BookPageInner() {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("research_recommendations")
        .select(
          "run_date, picks, book_view, book_risks, agent_run_id, advisory_derivation, book_metrics, scenario_results, cap_utilisation, screening_funnel, lens"
        )
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setRecError(error.message);
        setLoading(false);
        return;
      }

      const r = data as Recommendation | null;
      if (r) {
        const picks = Array.isArray(r.picks)
          ? r.picks
          : typeof r.picks === "string"
            ? (() => {
                try {
                  return JSON.parse(r.picks as unknown as string) as Pick[];
                } catch {
                  return [];
                }
              })()
            : [];
        setRec({ ...r, picks });

        if (r.agent_run_id) {
          const { data: run } = await supabase
            .from("research_agent_runs")
            .select("citations")
            .eq("id", r.agent_run_id)
            .maybeSingle();
          const c = (run as { citations?: Citation[] } | null)?.citations;
          setCitations(Array.isArray(c) && c.length ? c : undefined);
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  const longs = useMemo(
    () => (rec?.picks ?? []).filter((p) => p.direction === "long"),
    [rec]
  );
  const shorts = useMemo(
    () => (rec?.picks ?? []).filter((p) => p.direction === "short"),
    [rec]
  );

  const bm = rec?.book_metrics ?? null;
  const advisory = rec?.advisory_derivation ?? null;
  const isFallback = advisory?.fallback_used === true;
  const worstScenario = useMemo(() => {
    const s = rec?.scenario_results ?? [];
    if (!s.length) return null;
    return s.reduce((w, c) =>
      c.estimated_book_return < w.estimated_book_return ? c : w
    );
  }, [rec]);

  // Per-asset worst-case, parsed from the scenario contribution breakdowns.
  const capByAsset = useMemo(() => {
    const m = new Map<string, CapRow>();
    for (const r of rec?.cap_utilisation?.single_name ?? []) m.set(r.key, r);
    return m;
  }, [rec]);

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-6 flex-wrap">
        <div className="min-w-[300px]">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            The $100M Book
          </h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Top longs and shorts with thesis, sizing derivation, and stress
            exposure. Expand any position for the full chain.
          </p>
        </div>
        <div className="text-right text-text-secondary text-[12px] shrink-0">
          <div>
            <span className="text-text-tertiary mr-1.5">RUN DATE</span>
            <span className="num">{rec?.run_date ?? "—"}</span>
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">LENS</span>
            <span className="num">{rec?.lens ?? "—"}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[120px]" />
          <div className="skeleton h-[300px]" />
        </div>
      ) : recError ? (
        <div className="card">
          <QueryErrorState
            what="The book"
            message={recError}
            source="research_recommendations"
          />
        </div>
      ) : !rec ? (
        <div className="card">
          <EmptyState
            title="No book has been constructed"
            cause="research_recommendations has no rows. The L5 agent writes one row per run; it has never completed a run that produced output."
            remedy="Run scripts/daily_refresh.py with MINIMAX_API_KEY or ANTHROPIC_API_KEY set. Check /method for which pipeline stages last ran."
            source="research_recommendations"
          />
        </div>
      ) : (
        <>
          {/* ── Fallback banner ─────────────────────────────────────────── */}
          {isFallback && (
            <div
              className="card p-4 mb-5 border"
              style={{
                borderColor: "var(--warning)",
                background: "rgba(210, 153, 34, 0.07)",
              }}
              data-testid="fallback-banner"
            >
              <div className="text-[13px] font-semibold text-warning mb-1">
                This book is a deterministic fallback, not an investable
                recommendation.
              </div>
              <p className="m-0 text-[12.5px] text-text-secondary leading-[1.6]">
                The L5 agent could not produce a verified LLM synthesis for this
                run, so positions were selected by HypeScore rank alone and the
                thesis text is templated. Counter-theses, catalysts and risk notes
                are withheld because they carry no reasoning behind them.
                {advisory?.unavailable_reason
                  ? ` Reason: ${advisory.unavailable_reason}`
                  : ""}
              </p>
            </div>
          )}

          {/* ── Book header stats ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            <Stat label="Positions" value={String(rec.picks.length)} />
            <Stat
              label="Longs / Shorts"
              value={`${longs.length} / ${shorts.length}`}
              warn={shorts.length === 0 && longs.length > 0}
              warnHint="A long-only book is not a long-short book"
            />
            <Stat label="Gross" value={fmtPct(bm?.gross_exposure)} />
            <Stat
              label="Net"
              value={
                bm?.net_exposure === undefined
                  ? "—"
                  : `${bm.net_exposure >= 0 ? "+" : ""}${fmtPct(bm.net_exposure)}`
              }
            />
            <Stat
              label="Deployed"
              value={fmtUSD(
                rec.picks.reduce((s, p) => s + (p.notional ?? 0), 0)
              )}
            />
            <Stat
              label="Worst scenario"
              value={
                worstScenario
                  ? `${(worstScenario.estimated_book_return * 100).toFixed(1)}%`
                  : "—"
              }
              hint={worstScenario?.label}
              color={worstScenario ? "var(--short)" : undefined}
            />
          </div>

          {/* ── Book view ──────────────────────────────────────────────── */}
          <div className="mb-6">
            <ThesisBlock
              advisory={
                advisory ?? {
                  field_id: "book.view",
                  generated_by: "none",
                  display_status: "unavailable",
                  body: null,
                  method_id: "none",
                  evidence_ids: [],
                  citation_status: "not_attempted",
                  fallback_used: false,
                  computed_at: rec.run_date,
                  as_of: rec.run_date,
                  unavailable_reason:
                    "This run predates provenance tracking, so its thesis cannot be verified.",
                }
              }
              citations={citations}
            />
          </div>

          {/* ── Positions ──────────────────────────────────────────────── */}
          {rec.picks.length === 0 ? (
            <div className="card mb-6">
              <EmptyState
                title="The book has no positions"
                cause="The recommendation row exists but its picks array is empty, so nothing was sized."
                remedy="Check the screening funnel below to see which filter removed every candidate."
                source="research_recommendations.picks"
              />
            </div>
          ) : (
            <>
              <PositionSection
                title="Longs"
                glyph="▲"
                color="var(--long)"
                picks={longs}
                openAsset={openAsset}
                setOpenAsset={setOpenAsset}
                citations={citations}
                advisory={advisory}
                capByAsset={capByAsset}
                scenarios={rec.scenario_results ?? []}
              />
              <PositionSection
                title="Shorts"
                glyph="▼"
                color="var(--short)"
                picks={shorts}
                openAsset={openAsset}
                setOpenAsset={setOpenAsset}
                citations={citations}
                advisory={advisory}
                capByAsset={capByAsset}
                scenarios={rec.scenario_results ?? []}
                emptyNote="This book has no short positions. A $100M long-short mandate with zero shorts carries full directional market exposure — check the screening funnel for why no theme produced a negative TradeScore."
              />
            </>
          )}

          {/* ── Screening funnel ───────────────────────────────────────── */}
          <div className="card mb-6">
            <div className="card-header">
              <span className="card-title">Screening funnel</span>
              <span className="text-[11px] text-text-tertiary">
                What was rejected, and why
              </span>
            </div>
            {rec.screening_funnel && rec.screening_funnel.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">
                    Candidate attrition by screening stage.
                  </caption>
                  <thead>
                    <tr>
                      {["Stage", "Remaining", "Removed", "Why"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-[18px] py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                            i === 1 || i === 2 ? "text-right" : "text-left"
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rec.screening_funnel.map((s) => (
                      <tr key={s.stage}>
                        <td className="px-[18px] py-2.5 border-b border-border font-medium">
                          {s.stage}
                        </td>
                        <td className="px-[14px] py-2.5 border-b border-border text-right num">
                          {s.remaining}
                        </td>
                        <td
                          className="px-[14px] py-2.5 border-b border-border text-right num"
                          style={{
                            color: s.removed > 0 ? "var(--short)" : "var(--text-tertiary)",
                          }}
                        >
                          {s.removed > 0 ? `−${s.removed}` : "0"}
                        </td>
                        <td className="px-[18px] py-2.5 border-b border-border text-text-secondary text-[12px]">
                          {s.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No funnel recorded for this run"
                cause="screening_funnel is populated by q1_agent.screen_candidates from migration 022 onward. This row predates it, or the agent did not reach the screening stage."
                remedy="Re-run the pipeline; the next run records attrition per filter."
                source="research_recommendations.screening_funnel"
                compact
              />
            )}
          </div>

          {/* ── Book risks ─────────────────────────────────────────────── */}
          {canRenderAdvisoryBody(advisory) &&
            rec.book_risks &&
            rec.book_risks.length > 0 && (
              <div
                className="card p-7"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "rgba(248,81,73,0.3)",
                }}
              >
                <h3 className="text-[18px] font-semibold m-0 mb-1">
                  Cross-cutting book risks
                </h3>
                <div className="text-text-secondary text-[13px] mb-4">
                  What kills the book if it goes wrong.
                </div>
                <ul className="m-0 pl-[18px] leading-[1.8] text-text-primary text-[13.5px]">
                  {rec.book_risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

          <div className="mt-6 text-[12px] text-text-secondary">
            Stress scenarios, correlation structure and cap headroom for this
            book are on{" "}
            <Link href="/risk" className="text-accent hover:underline">
              Risk &amp; Stress
            </Link>
            . The scoring method behind every number is on{" "}
            <Link href="/method" className="text-accent hover:underline">
              Method
            </Link>
            .
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  color,
  warn,
  warnHint,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  warn?: boolean;
  warnHint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary mb-1.5">
        {label}
      </div>
      <div
        className="num text-[20px] font-semibold leading-[1.1]"
        style={{ color: warn ? "var(--warning)" : color }}
      >
        {value}
      </div>
      {(hint || (warn && warnHint)) && (
        <div className="text-[11px] text-text-secondary mt-1 leading-[1.4]">
          {warn && warnHint ? warnHint : hint}
        </div>
      )}
    </div>
  );
}

function PositionSection({
  title,
  glyph,
  color,
  picks,
  openAsset,
  setOpenAsset,
  citations,
  advisory,
  capByAsset,
  scenarios,
  emptyNote,
}: {
  title: string;
  glyph: string;
  color: string;
  picks: Pick[];
  openAsset: string | null;
  setOpenAsset: (a: string | null) => void;
  citations?: Citation[];
  advisory: AdvisoryDerivation | null;
  capByAsset: Map<string, CapRow>;
  scenarios: ScenarioResult[];
  emptyNote?: string;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-[16px] font-semibold m-0 mb-3 flex items-center gap-2">
        <span style={{ color }}>{glyph}</span> {title}
        <span className="text-text-tertiary text-[12px] font-normal">
          ({picks.length})
        </span>
      </h2>
      {picks.length === 0 ? (
        <div className="card">
          <EmptyState
            title={`No ${title.toLowerCase()} in this book`}
            cause={
              emptyNote ??
              `The sized book contains no ${title.toLowerCase()} positions.`
            }
            source="research_recommendations.picks"
            severity={emptyNote ? "warning" : "info"}
            compact
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          {picks.map((p, i) => (
            <PositionRow
              key={`${p.asset}-${i}`}
              pick={p}
              rank={i + 1}
              open={openAsset === `${title}-${p.asset}-${i}`}
              onToggle={() =>
                setOpenAsset(
                  openAsset === `${title}-${p.asset}-${i}`
                    ? null
                    : `${title}-${p.asset}-${i}`
                )
              }
              citations={citations}
              advisory={advisory}
              cap={capByAsset.get(p.asset)}
              scenarios={scenarios}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PositionRow({
  pick,
  rank,
  open,
  onToggle,
  citations,
  advisory,
  cap,
  scenarios,
}: {
  pick: Pick;
  rank: number;
  open: boolean;
  onToggle: () => void;
  citations?: Citation[];
  advisory: AdvisoryDerivation | null;
  cap?: CapRow;
  scenarios: ScenarioResult[];
}) {
  const isLong = pick.direction === "long";
  const dirColor = isLong ? "var(--long)" : "var(--short)";
  const showProse = canRenderAdvisoryBody(advisory);
  const themeName = pick.theme_name ?? pick.theme ?? null;

  // Per-position scenario lines, parsed from the breakdown strings the backend
  // already emits (e.g. "  TLT (long): +8.0% × +4% = +0.32%").
  const perScenario = scenarios
    .map((s) => ({
      label: s.label,
      severity: s.severity,
      line: s.contribution_breakdown.find((b) =>
        b.trim().startsWith(`${pick.asset} (`)
      ),
    }))
    .filter((s) => s.line);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-[18px] py-3.5 hover:bg-bg-elevated transition-colors grid items-center gap-3"
        style={{ gridTemplateColumns: "28px 1fr 130px 90px 90px 90px 24px" }}
      >
        <span className="num text-text-tertiary text-[12px]">#{rank}</span>
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="num font-semibold text-[14px]" style={{ color: dirColor }}>
            {pick.asset}
          </span>
          <span className="text-text-secondary text-[12px] truncate">
            {themeName ?? "—"}
          </span>
        </span>
        <span className="text-right">
          <span className="num text-[13px] font-semibold">
            {fmtPct(pick.weight)}
          </span>
          <span className="text-text-tertiary text-[11px] num ml-1.5">
            {fmtUSD(pick.notional)}
          </span>
        </span>
        <span className="num text-right text-[12px] text-text-secondary">
          {pick.hype_score?.toFixed(1) ?? "—"}
        </span>
        <span
          className="num text-right text-[12px] font-semibold"
          style={{ color: dirColor }}
        >
          {fmtSigned(pick.trade_score)}
        </span>
        <span className="text-right">
          {cap ? (
            <span
              className="num text-[11px]"
              title={`${(cap.weight * 100).toFixed(1)}% of a ${(cap.cap * 100).toFixed(0)}% single-name cap`}
              style={{
                color: cap.breached
                  ? "var(--short)"
                  : cap.utilisation > 0.8
                    ? "var(--warning)"
                    : "var(--text-tertiary)",
              }}
            >
              {(cap.utilisation * 100).toFixed(0)}% cap
            </span>
          ) : (
            <span className="text-text-tertiary text-[11px]">—</span>
          )}
        </span>
        <span className="text-text-tertiary text-[12px] text-right">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="px-[18px] pb-5 pt-1 bg-bg-elevated/40">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <SubHead>Thesis</SubHead>
              {showProse && pick.thesis ? (
                <CitationList text={pick.thesis} citations={citations} />
              ) : (
                <p className="m-0 text-[12.5px] text-text-tertiary leading-[1.6]">
                  {pick.thesis
                    ? "Withheld — this run's thesis did not pass citation verification, so it is not shown."
                    : "No thesis persisted for this position."}
                </p>
              )}

              {showProse && pick.counter_thesis && (
                <>
                  <SubHead className="mt-4">Counter-thesis</SubHead>
                  <div
                    className="rounded-md px-3 py-2.5 text-[12.5px] leading-[1.6] border"
                    style={{
                      background: "rgba(248, 81, 73, 0.06)",
                      borderColor: "rgba(248, 81, 73, 0.3)",
                    }}
                  >
                    {pick.counter_thesis}
                  </div>
                </>
              )}

              {showProse && pick.catalysts && pick.catalysts.length > 0 && (
                <>
                  <SubHead className="mt-4">Catalysts</SubHead>
                  <ul className="m-0 pl-[18px] leading-[1.7] text-[12.5px]">
                    {pick.catalysts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              {pick.time_horizon && (
                <div className="text-[11px] text-text-tertiary mt-3">
                  Horizon:{" "}
                  <span className="num text-text-secondary">
                    {pick.time_horizon}
                  </span>
                </div>
              )}
            </div>

            <div>
              <SubHead>Sizing</SubHead>
              <div className="rounded-[8px] border border-border overflow-hidden text-[12px]">
                <Row
                  k="Raw weight (HypeScore / 100)"
                  v={
                    pick.hype_score === undefined
                      ? "—"
                      : (pick.hype_score / 100).toFixed(3)
                  }
                />
                <Row k="Final weight" v={fmtPct(pick.weight)} />
                <Row
                  k="Signed weight"
                  v={
                    pick.signed_weight !== undefined
                      ? fmtPct(pick.signed_weight)
                      : fmtPct(isLong ? pick.weight : -(pick.weight ?? 0))
                  }
                />
                <Row
                  k="Single-name cap"
                  v={
                    cap
                      ? `${(cap.weight * 100).toFixed(1)}% of ${(cap.cap * 100).toFixed(0)}%${cap.breached ? " — BREACHED" : ""}`
                      : "—"
                  }
                  warn={cap?.breached}
                />
                <Row k="Notional" v={fmtUSD(pick.notional)} last />
              </div>

              {pick.factor_tilts && Object.keys(pick.factor_tilts).length > 0 && (
                <>
                  <SubHead className="mt-4">Factor tilts</SubHead>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pick.factor_tilts).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[11.5px] num bg-bg-elevated text-text-secondary px-2 py-1 rounded border border-border"
                      >
                        {k} {fmtSigned(v)}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <SubHead className="mt-4">Under stress</SubHead>
              {perScenario.length > 0 ? (
                <ul className="m-0 pl-0 list-none space-y-1">
                  {perScenario.map((s) => (
                    <li
                      key={s.label}
                      className="text-[12px] num flex justify-between gap-3"
                    >
                      <span className="text-text-secondary">{s.label}</span>
                      <span
                        style={{
                          color:
                            SEVERITY_COLOR[s.severity] ?? "var(--text-secondary)",
                        }}
                      >
                        {s.line?.split("=").pop()?.trim() ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[12px] text-text-tertiary leading-[1.6]">
                  No per-position stress contribution recorded. Scenario results
                  are written to{" "}
                  <code className="num">
                    research_recommendations.scenario_results
                  </code>
                  ; see <Link href="/risk" className="text-accent">Risk</Link>.
                </p>
              )}

              {showProse && pick.risk && (
                <>
                  <SubHead className="mt-4">Risk</SubHead>
                  <p className="m-0 text-[12.5px] leading-[1.7]">{pick.risk}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2 ${className}`}
    >
      {children}
    </div>
  );
}

function Row({
  k,
  v,
  last,
  warn,
}: {
  k: string;
  v: string;
  last?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2 flex justify-between gap-3 ${last ? "" : "border-b border-border"}`}
      style={last ? { background: "var(--bg-elevated)" } : undefined}
    >
      <span className="text-text-secondary">{k}</span>
      <span
        className="num font-semibold text-right"
        style={{ color: warn ? "var(--short)" : undefined }}
      >
        {v}
      </span>
    </div>
  );
}
