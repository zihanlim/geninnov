"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CitationList, { Citation } from "@/components/CitationList";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import {
  DEFAULT_EDGE_WEIGHTS,
  edgeRationale,
  plainRationale,
  fetchThemeEdge,
  type EdgeWeights,
  type ThemeEdge,
} from "@/lib/themeSignals";
import ThesisBlock from "@/components/research/ThesisBlock";
import CollapsibleSection from "@/components/CollapsibleSection";
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";
import EdgeBars from "@/components/book/EdgeBars";
import SizingChainView from "@/components/book/SizingChainView";
import PositionMarginalRisk from "@/components/book/PositionMarginalRisk";
import AbstentionRoster from "@/components/book/AbstentionRoster";
import {
  buildSizingChain,
  edgeWeightsFromConfig,
  marginalContribution,
  resolvePositionEdge,
  topSibling,
  type CorrelationPairLite,
  type PositionEdgeRow,
  type ResolvedEdge,
  type ScoringConfigRow,
} from "@/lib/book/positionEdge";

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
  correlation_pairs?: CorrelationPairLite[] | null;
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
  // Edge for positions' themes only (fast path when position rows lack columns).
  const [edgeByTheme, setEdgeByTheme] = useState<Record<string, ThemeEdge>>({});
  // Edge for EVERY theme — drives the abstention roster.
  const [allEdgeByTheme, setAllEdgeByTheme] = useState<Record<string, ThemeEdge>>({});
  const [themeNames, setThemeNames] = useState<Record<string, string>>({});
  // Migration-025 edge columns on portfolio_positions, keyed by asset.
  const [posEdgeByAsset, setPosEdgeByAsset] = useState<
    Record<string, PositionEdgeRow>
  >({});
  // Live EdgeScore weights + abstain threshold from scoring_config.
  const [edgeWeights, setEdgeWeights] = useState<EdgeWeights>(DEFAULT_EDGE_WEIGHTS);
  const [weightsResolved, setWeightsResolved] = useState<
    Record<keyof EdgeWeights, boolean>
  >({ trend: false, regime: false, carry: false, value: false, sentiment: false, abstainThreshold: false });
  const [loading, setLoading] = useState(true);
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // The book row, the live scoring weights, the per-position edge columns,
      // and the full theme roster are independent reads — fire them together.
      const [recRes, cfgRes, posRes, themesRes] = await Promise.all([
        supabase
          .from("research_recommendations")
          .select(
            "run_date, picks, book_view, book_risks, agent_run_id, advisory_derivation, book_metrics, scenario_results, cap_utilisation, screening_funnel, correlation_pairs, lens"
          )
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("scoring_config").select("param_name, value"),
        supabase
          .from("portfolio_positions")
          .select(
            "asset, theme_id, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol"
          ),
        supabase.from("themes").select("id, name"),
      ]);

      // Live EdgeScore weights + abstain threshold. Missing rows fall back to the
      // migration-024 defaults, and `resolved` records which were actually found.
      const cfg = edgeWeightsFromConfig(
        (cfgRes.data as ScoringConfigRow[] | null) ?? null,
        DEFAULT_EDGE_WEIGHTS
      );
      setEdgeWeights(cfg.weights);
      setWeightsResolved(cfg.resolved);

      // Per-position edge columns (migration 025), keyed by asset.
      const posMap: Record<string, PositionEdgeRow> = {};
      for (const row of (posRes.data as PositionEdgeRow[] | null) ?? []) {
        if (row.asset) posMap[row.asset] = row;
      }
      setPosEdgeByAsset(posMap);

      // Theme id → name, for the abstention roster and position links.
      const names: Record<string, string> = {};
      const allThemeIds: string[] = [];
      for (const row of (themesRes.data as { id: string; name: string }[] | null) ??
        []) {
        if (row.id) {
          names[row.id] = row.name;
          allThemeIds.push(row.id);
        }
      }
      setThemeNames(names);

      // The abstention roster needs the latest edge for EVERY theme, not just the
      // ten that made the book. This is the read that surfaces "scored, not traded".
      if (allThemeIds.length) {
        const { byTheme: allEdge } = await fetchThemeEdge(allThemeIds);
        setAllEdgeByTheme(allEdge);
      }

      const { data, error } = recRes;
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

        // EdgeScore per position theme — the theme-latest fallback when a
        // position row carries no edge columns (ADR-0031/0032).
        const themeIds = Array.from(
          new Set(picks.map((p) => p.theme_id).filter((x): x is string => !!x))
        );
        if (themeIds.length) {
          const { byTheme } = await fetchThemeEdge(themeIds);
          setEdgeByTheme(byTheme);
        }

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

  // Resolve the EdgeScore for every position once: position columns first, theme
  // latest as fallback (positionEdge.resolvePositionEdge). Keyed by "asset" — the
  // stable identity a pick joins on.
  const edgeByAsset = useMemo(() => {
    const m: Record<string, ResolvedEdge> = {};
    for (const p of rec?.picks ?? []) {
      m[p.asset] = resolvePositionEdge(
        posEdgeByAsset[p.asset],
        p.theme_id ? edgeByTheme[p.theme_id] : undefined
      );
    }
    return m;
  }, [rec, posEdgeByAsset, edgeByTheme]);

  // Σ conviction across every sized position with a non-null conviction — the
  // normalisation denominator the sizing chain shows.
  const convictionSum = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const p of rec?.picks ?? []) {
      const c = edgeByAsset[p.asset]?.conviction;
      if (c !== null && c !== undefined && Number.isFinite(c)) {
        sum += Math.abs(c);
        any = true;
      }
    }
    return any ? sum : null;
  }, [rec, edgeByAsset]);

  const allPicks = useMemo(
    () =>
      (rec?.picks ?? []).map((p) => ({
        asset: p.asset,
        direction: p.direction,
        notional: p.notional,
      })),
    [rec]
  );

  const correlationPairs = rec?.correlation_pairs ?? null;

  const bm = rec?.book_metrics ?? null;

  // Plain-English lead. A reader should learn what this book SAYS before meeting
  // any notation — the formula is method, not the headline.
  const plainSummary = useMemo(() => {
    if (!rec) return "No book has been generated yet.";
    const n = longs.length + shorts.length;
    if (n === 0)
      return "No positions cleared the screen today — every theme was scored but held out for weak or conflicting signal.";
    const sides =
      shorts.length === 0
        ? `${longs.length} long position${longs.length === 1 ? "" : "s"} and no shorts`
        : longs.length === 0
          ? `${shorts.length} short position${shorts.length === 1 ? "" : "s"} and no longs`
          : `${longs.length} long and ${shorts.length} short position${
              longs.length + shorts.length === 1 ? "" : "s"
            }`;
    const net = bm?.net_exposure;
    const tilt =
      net === null || net === undefined
        ? ""
        : Math.abs(net) < 0.05
          ? " It is close to market-neutral."
          : ` It leans net ${net > 0 ? "long" : "short"} at ${fmtPct(Math.abs(net), 0)} of capital.`;
    return `Today's book holds ${sides}, sized by conviction across $100M.${tilt}`;
  }, [rec, longs, shorts, bm]);
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
          <p className="m-0 text-text-primary text-[14.5px] leading-[1.55] max-w-[62ch]">
            {plainSummary}
          </p>
          <p className="m-0 mt-2 text-text-tertiary text-[12px] leading-[1.5] max-w-[62ch]">
            Each side is the sign of its <span className="num">EdgeScore</span>; each
            size is conviction (<span className="num">|Edge| / vol</span>) capped by
            position, sector and geography limits. Expand any position for the full
            derivation.
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <Stat
              label="Positions"
              value={String(rec.picks.length)}
              hint="Names held after screening"
            />
            <Stat
              label="Longs / Shorts"
              value={`${longs.length} / ${shorts.length}`}
              hint="Split of the two sides"
              warn={shorts.length === 0 && longs.length > 0}
              warnHint="A long-only book is not a long-short book"
            />
            <Stat
              label="Gross"
              value={fmtPct(bm?.gross_exposure)}
              hint="Long + short — total capital at risk"
            />
            <Stat
              label="Net"
              value={
                bm?.net_exposure === undefined
                  ? "—"
                  : `${bm.net_exposure >= 0 ? "+" : ""}${fmtPct(bm.net_exposure)}`
              }
              hint="Long − short — directional tilt"
            />
            <Stat
              label="Deployed"
              value={fmtUSD(
                rec.picks.reduce((s, p) => s + (p.notional ?? 0), 0)
              )}
              hint="Capital allocated of $100M"
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
                edgeByAsset={edgeByAsset}
                edgeWeights={edgeWeights}
                convictionSum={convictionSum}
                allPicks={allPicks}
                correlationPairs={correlationPairs}
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
                edgeByAsset={edgeByAsset}
                edgeWeights={edgeWeights}
                convictionSum={convictionSum}
                allPicks={allPicks}
                correlationPairs={correlationPairs}
                scenarios={rec.scenario_results ?? []}
                emptyNote="This book has no short positions. A $100M long-short mandate with zero shorts carries full directional market exposure — check the screening funnel for why no theme produced a negative TradeScore."
              />
            </>
          )}

          {/* ── Abstention roster ───────────────────────────────────────── */}
          <AbstentionRoster
            edgeByTheme={allEdgeByTheme}
            themeNames={themeNames}
            abstainThreshold={edgeWeights.abstainThreshold}
            thresholdIsLive={weightsResolved.abstainThreshold}
          />

          {/* ── Screening funnel (collapsed — audit detail) ────────────── */}
          <CollapsibleSection
            title="Screening funnel"
            summary={
              rec.screening_funnel && rec.screening_funnel.length > 0
                ? `${rec.screening_funnel[rec.screening_funnel.length - 1]?.remaining ?? "—"} names cleared ${rec.screening_funnel.length} filters`
                : "how the universe was filtered to the book"
            }
          >
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
          </CollapsibleSection>

          {/* ── Book risks (collapsed — expand for the tail risks) ─────── */}
          {canRenderAdvisoryBody(advisory) &&
            rec.book_risks &&
            rec.book_risks.length > 0 && (
              <CollapsibleSection
                title="Cross-cutting book risks"
                summary={`${rec.book_risks.length} things that could break the book`}
              >
                <div className="card-body">
                  <ul className="m-0 pl-[18px] leading-[1.8] text-text-primary text-[13.5px]">
                    {rec.book_risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </CollapsibleSection>
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
  edgeByAsset,
  edgeWeights,
  convictionSum,
  allPicks,
  correlationPairs,
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
  edgeByAsset: Record<string, ResolvedEdge>;
  edgeWeights: EdgeWeights;
  convictionSum: number | null;
  allPicks: { asset: string; direction: "long" | "short"; notional?: number }[];
  correlationPairs: CorrelationPairLite[] | null;
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
        <div className="card overflow-x-auto">
          {/* Column legend for the dense row grid below. */}
          <div
            className="min-w-[640px] px-[18px] py-2 grid items-center gap-3 border-b border-border bg-bg-elevated text-[10px] uppercase tracking-[0.08em] text-text-tertiary"
            style={{ gridTemplateColumns: "28px 1fr 132px 78px 78px 78px 24px" }}
          >
            <span>#</span>
            <span>Asset · theme · rationale</span>
            <span className="text-right">Weight · notional</span>
            <span className="text-right">Edge</span>
            <span className="text-right">Conv.</span>
            <span className="text-right">Cap</span>
            <span />
          </div>
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
              edge={edgeByAsset[p.asset]}
              edgeWeights={edgeWeights}
              convictionSum={convictionSum}
              allPicks={allPicks}
              correlationPairs={correlationPairs}
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
  edge,
  edgeWeights,
  convictionSum,
  allPicks,
  correlationPairs,
  scenarios,
}: {
  pick: Pick;
  rank: number;
  open: boolean;
  onToggle: () => void;
  citations?: Citation[];
  advisory: AdvisoryDerivation | null;
  cap?: CapRow;
  edge?: ResolvedEdge;
  edgeWeights: EdgeWeights;
  convictionSum: number | null;
  allPicks: { asset: string; direction: "long" | "short"; notional?: number }[];
  correlationPairs: CorrelationPairLite[] | null;
  scenarios: ScenarioResult[];
}) {
  const isLong = pick.direction === "long";
  const dirColor = isLong ? "var(--long)" : "var(--short)";
  const showProse = canRenderAdvisoryBody(advisory);
  const themeName = pick.theme_name ?? pick.theme ?? null;

  const hasEdge =
    !!edge &&
    (edge.trend_signal !== null ||
      edge.regime_bias !== null ||
      edge.carry_signal !== null ||
      edge.value_signal !== null);
  const conviction = edge?.conviction ?? null;

  // Always-visible plain-English rationale (never hidden behind expand). The
  // numeric component breakdown (edgeRationale) becomes the hover title and the
  // expanded EdgeScore bars — a reader gets the "why" without decoding values.
  const rationale = hasEdge && edge ? plainRationale(edge, edgeWeights) : null;
  const rationaleDetail = hasEdge && edge ? edgeRationale(edge) : undefined;

  // The sizing derivation — conviction × inverse-vol → cap → notional.
  const sizingChain = buildSizingChain({
    direction: pick.direction,
    edge:
      edge ?? {
        edge_score: null,
        trend_signal: null,
        regime_bias: null,
        carry_signal: null,
        value_signal: null,
        sentiment_signal: null,
        conviction: null,
        vol: null,
        direction: null,
        run_date: null,
        source: "none",
      },
    weight: pick.weight,
    signedWeight: pick.signed_weight,
    notional: pick.notional,
    hypeScore: pick.hype_score,
    cap: cap
      ? {
          weight: cap.weight,
          cap: cap.cap,
          utilisation: cap.utilisation,
          breached: cap.breached,
        }
      : undefined,
    convictionSum,
  });

  const marginal = marginalContribution(
    { asset: pick.asset, direction: pick.direction, notional: pick.notional },
    allPicks
  );
  const sibling = topSibling(pick.asset, correlationPairs);

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
      {/* A div, not a button: the theme name is an <a>, which cannot be nested
          inside a <button>. Keyboard + ARIA are wired by hand to keep the row a
          single toggle target while the inner link stays independently focusable. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className="w-full min-w-[640px] text-left px-[18px] py-3.5 hover:bg-bg-elevated transition-colors grid items-center gap-3 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        style={{ gridTemplateColumns: "28px 1fr 132px 78px 78px 78px 24px" }}
      >
        <span className="num text-text-tertiary text-[12px]">#{rank}</span>
        <span className="flex flex-col min-w-0 gap-0.5">
          <span className="flex items-baseline gap-2 min-w-0">
            <span
              className="num font-semibold text-[14px]"
              style={{ color: dirColor }}
            >
              {pick.asset}
            </span>
            {pick.theme_id && themeName ? (
              <Link
                href={`/?theme=${pick.theme_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-text-secondary text-[12px] truncate hover:text-accent hover:underline"
                title={`Attention trend for ${themeName}`}
              >
                {themeName}
              </Link>
            ) : (
              <span className="text-text-secondary text-[12px] truncate">
                {themeName ?? "—"}
              </span>
            )}
          </span>
          {/* Always-visible PLAIN rationale — the "why this side". Numeric
              component breakdown is the hover title + the expanded bars. */}
          <span className="text-text-secondary text-[11.5px] truncate" title={rationaleDetail}>
            {rationale ?? "EdgeScore not persisted for this position"}
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
        {/* EdgeScore — the number whose sign is the side. */}
        <span
          className="num text-right text-[12px] font-semibold"
          style={{ color: hasEdge ? dirColor : "var(--text-tertiary)" }}
          title="EdgeScore = 0.35·Trend + 0.25·Regime + 0.20·Carry + 0.20·Value"
        >
          {edge && edge.edge_score !== null ? fmtSigned(edge.edge_score) : "—"}
        </span>
        {/* Conviction chip — |Edge|/vol, always visible. */}
        <span className="text-right">
          {conviction !== null ? (
            <span
              className="num text-[11px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              title="Conviction = |EdgeScore| / vol — the inverse-vol sizing weight"
            >
              {conviction.toFixed(1)}×
            </span>
          ) : (
            <span
              className="text-text-tertiary text-[11px]"
              title="No conviction persisted — this position was sized by HypeScore"
            >
              hype
            </span>
          )}
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
      </div>

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
                      background: "rgba(159, 23, 42, 0.06)",
                      borderColor: "rgba(159, 23, 42, 0.3)",
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

              {/* P1 — marginal contribution to the whole book. */}
              <SubHead className="mt-4">Contribution to book</SubHead>
              <PositionMarginalRisk marginal={marginal} sibling={sibling} />
            </div>

            <div>
              <SubHead>
                Why {isLong ? "long" : "short"} — EdgeScore decomposition
              </SubHead>
              {hasEdge && edge ? (
                <div className="mb-4">
                  <EdgeBars
                    edge={edge}
                    weights={edgeWeights}
                    direction={pick.direction}
                  />
                  {edge.source === "theme_latest" && (
                    <p className="m-0 mt-2 text-[10.5px] text-text-tertiary leading-[1.5]">
                      From the theme&apos;s latest{" "}
                      <code className="num">theme_signals_history</code> row — the
                      position row carried no edge columns, so this is the theme
                      signal, not necessarily the one that sized this book.
                    </p>
                  )}
                </div>
              ) : (
                <p className="m-0 mb-4 text-[12px] text-text-tertiary leading-[1.6]">
                  Direction is <code className="num">sign(EdgeScore)</code>, where{" "}
                  <code className="num">
                    EdgeScore = 0.35·Trend + 0.25·Regime + 0.20·Carry +
                    0.20·Value
                  </code>
                  . No component was persisted for this position or its
                  theme&apos;s latest run. See{" "}
                  <Link href="/method#edgescore" className="text-accent">
                    Method §4
                  </Link>
                  .
                </p>
              )}

              <SubHead>Sizing — conviction × inverse-vol</SubHead>
              <div className="mb-1">
                <SizingChainView chain={sizingChain} />
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
