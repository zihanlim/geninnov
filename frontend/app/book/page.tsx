"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import SectionNav from "@/components/SectionNav";
import AnswerCards from "@/components/book/AnswerCards";

// Four anchored groups, in the order the page already rendered them. Labels are
// nouns and carry no figure — SectionNav is tested for the absence of digits,
// because a count here would be a number a reader cannot trace and it would go
// stale against the panel it labels.
const BOOK_SECTIONS = [
  { id: "holdings", label: "Holdings" },
  { id: "solidity", label: "How solid" },
  { id: "not-taken", label: "Not taken" },
  { id: "audit", label: "Audit" },
];
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";
import EdgeBars from "@/components/book/EdgeBars";
import SizingChainView from "@/components/book/SizingChainView";
import PositionMarginalRisk from "@/components/book/PositionMarginalRisk";
import AbstentionRoster from "@/components/book/AbstentionRoster";
import BookTurnover from "@/components/book/BookTurnover";
import PoolDepth, { type IndependentIdeas } from "@/components/book/PoolDepth";
import { WorkedExamplePanel } from "@/components/book/WorkedExamplePanel";
import type {
  PrimaryScenarioInput,
  SizingFinalInput,
} from "@/lib/book/workedExample";
import {
  distinguishPosition,
  positionRationale,
} from "@/lib/positionDistinction";
import Replication from "@/components/book/Replication";
import {
  positionStability,
  stabilityLabel,
  type ReplicationNames,
} from "@/lib/book/positionStability";
import ClearedNotTaken, {
  type CandidateRow,
  type CandidateCorrelations,
} from "@/components/book/ClearedNotTaken";
import { ScrollArea } from "@/components/ScrollArea";
import { PositionRow } from "@/components/book/PositionRow";
import {
  FACTOR_LABELS,
  SEVERITY_COLOR,
  fmtPct,
  fmtSigned,
  fmtUSD,
} from "@/lib/book/format";
import type { CapRow, Pick, ScenarioResult } from "@/lib/book/types";
import { BOOK_ROW_GRID, BOOK_ROW_MIN_W } from "@/lib/book/grid";
import { assessStaleness } from "@/lib/freshness";
import {
  buildSizingChain,
  edgeWeightsFromConfig,
  marginalContribution,
  resolvePositionEdge,
  topSibling,
  type BindingGroupCap,
  type CorrelationPairLite,
  type PositionEdgeRow,
  type ResolvedEdge,
  type ScoringConfigRow,
} from "@/lib/book/positionEdge";
import { severityRank } from '@/lib/risk/analytics';

/**
 * /book â€” the $100M long-short book, as ONE object.
 *
 * This replaces the split across /trades (TradeScore ranking), /portfolio
 * (sizes and risk scalars) and /research (thesis prose). Those were three
 * partial views of the same ten positions, drawn from three tables, with no
 * cross-links â€” so "why am I short KWEB at 8%?" could not be answered from any
 * single page. Everything a position claim depends on now lives in one row.
 */


interface FunnelStage {
  stage: string;
  remaining: number;
  removed: number;
  reason: string;
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
  candidate_correlations?: CandidateCorrelations | null;
  /** ADR-0048: independent-idea count per side, as the agent saw it. */
  independent_ideas?: IndependentIdeas | null;
  lens?: string | null;
}

/** picks arrives as jsonb (already an array) on most reads and as a JSON string on
 *  some, so both the current book and the previous one go through the same parser
 *  rather than each row growing its own inline try/catch. */
function parsePicks(raw: Pick[] | string | null | undefined): Pick[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Pick[];
    } catch {
      return [];
    }
  }
  return [];
}




export default function BookPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
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
  // Edge for EVERY theme â€” drives the abstention roster.
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
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  // Per-position replication stability (ADR-0057) â€” which names the agent picked in
  // every rerun on identical inputs. Read separately from the book because it is a
  // deliberate harness run, not part of the daily job.
  const [repl, setRepl] = useState<ReplicationNames | null>(null);
  const [prevBook, setPrevBook] = useState<{ date: string; assets: string[] } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // The book row, the live scoring weights, the per-position edge columns,
      // and the full theme roster are independent reads â€” fire them together.
      const [recRes, cfgRes, posRes, themesRes, candRes] = await Promise.all([
        supabase
          .from("research_recommendations")
          .select(
            "run_date, picks, book_view, book_risks, agent_run_id, advisory_derivation, book_metrics, scenario_results, cap_utilisation, screening_funnel, correlation_pairs, candidate_correlations, independent_ideas, lens"
          )
          .order("run_date", { ascending: false })
          // Two rows, not one: the second is the previous run_date, which is what
          // "would you get the same answer tomorrow?" is measured against.
          .limit(2),
        supabase.from("scoring_config").select("param_name, value"),
        supabase
          .from("portfolio_positions")
          .select(
            "asset, theme_id, edge_score, trend_signal, regime_bias, carry_signal, value_signal, sentiment_signal, conviction, vol"
          ),
        supabase.from("themes").select("id, name"),
        // The L1 pool, so the page can show what cleared the screen and was still
        // not taken â€” the "why isn't X in the book?" question had no answer here.
        supabase
          .from("trade_candidates")
          .select("asset, direction, edge_score, theme_id, run_date, via_conviction")
          .order("run_date", { ascending: false })
          .limit(200),
      ]);

      // Live EdgeScore weights + abstain threshold. Missing rows fall back to the
      // migration-024 defaults, and `resolved` records which were actually found.
      // Replication names, keyed to the run they were measured on.
      supabase
        .from("backtest_results")
        .select("end_date, notes")
        .eq("test_name", "book_replication")
        .order("end_date", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const row = (data ?? [])[0] as { end_date: string; notes: string } | undefined;
          if (!row) return;
          try {
            const n = JSON.parse(row.notes ?? "{}");
            setRepl({
              stable: n.stable_names ?? [],
              unstable: n.unstable_names ?? [],
              endDate: row.end_date ?? null,
              samples: n.samples ?? 0,
            });
          } catch {
            /* advisory only â€” a parse failure must not blank the book */
          }
        });

      const recRows = (recRes.data as Recommendation[] | null) ?? [];
      if (recRows.length > 1) {
        setPrevBook({
          date: recRows[1].run_date,
          // Same string-or-array tolerance as the current row below: picks comes
          // back as jsonb from one client path and as a string from another.
          assets: parsePicks(recRows[1].picks)
            .map((p) => p.asset)
            .filter(Boolean),
        });
      }

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

      // Latest run_date only â€” an older vintage would list names that were never
      // candidates for today's book.
      const candRows = (candRes.data as (CandidateRow & { run_date: string })[] | null) ?? [];
      const latestCandDate = candRows[0]?.run_date ?? null;
      setCandidates(candRows.filter((c) => c.run_date === latestCandDate));

      // Theme id â†’ name, for the abstention roster and position links.
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

      // .limit(2) returns an array; the newest row is the current book and the
      // second (when present) is the previous run_date, used for turnover.
      const r = (data as Recommendation[] | null)?.[0] ?? null;
      if (r) {
        const picks = parsePicks(r.picks);
        setRec({ ...r, picks });

        // EdgeScore per position theme â€” the theme-latest fallback when a
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
  // latest as fallback (positionEdge.resolvePositionEdge). Keyed by "asset" â€” the
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

  // Î£ conviction across every sized position with a non-null conviction â€” the
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
  // any notation â€” the formula is method, not the headline.
  const plainSummary = useMemo(() => {
    if (!rec) return "No book has been generated yet.";
    const n = longs.length + shorts.length;
    if (n === 0)
      return "No positions cleared the screen today â€” every theme was scored but held out for weak or conflicting signal.";
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
    // Cash is a POSITION, not a rounding error. Once the caps genuinely bind, a
    // book that cannot be filled inside its own limits deploys less than $100M â€”
    // and a reader who is told "sized across $100M" while the notionals add to
    // $60M is owed the difference and the reason for it.
    const deployed = (rec.picks ?? []).reduce((s, p) => s + (p.notional ?? 0), 0);
    const cash = 100_000_000 - deployed;
    const cashNote =
      cash > 500_000
        ? ` ${fmtUSD(cash)} is held in cash: at ${n} name${n === 1 ? "" : "s"} the` +
          ` book cannot take more without breaching its own position limits.`
        : "";
    return `Today's book holds ${sides}, sized by conviction across $100M.${tilt}${cashNote}`;
  }, [rec, longs, shorts, bm]);
  // Judged from the book's own run_date against business days, so a Friday book
  // read on Sunday is not falsely flagged.
  const staleness = useMemo(() => assessStaleness(rec?.run_date), [rec?.run_date]);
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

  // Group caps (geography, sector) sitting at their limit â€” the book's binding
  // constraint. A name scaled below its normalised conviction weight is inside one of
  // these (ADR-0037 clamps a capped group and banks the freed capital as cash), so the
  // sizing chain names them instead of the false "no cap binding".
  const bindingGroupCaps = useMemo<BindingGroupCap[]>(() => {
    const out: BindingGroupCap[] = [];
    const scan = (group: string, rows: CapRow[] | undefined) => {
      for (const r of rows ?? [])
        if (typeof r.utilisation === "number" && r.utilisation >= 0.999)
          out.push({ group, key: r.key, cap: r.cap });
    };
    scan("geography", rec?.cap_utilisation?.geo);
    scan("sector", rec?.cap_utilisation?.sector);
    return out;
  }, [rec]);

  // â”€â”€ Theme focus (?theme=<id>) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A "positions â†’" link from the heatmap/cards lands here. Honour the param so
  // the deep-link is meaningful: name the theme's positions if it holds any, or
  // â€” the case that used to dead-end silently on an abstained theme â€” say plainly
  // that it was held out and point at the abstention roster.
  const focusThemeId = useSearchParams().get("theme");
  const focusName = focusThemeId ? themeNames[focusThemeId] ?? null : null;
  // Picks store the theme NAME (`theme`), not the theme_id â€” theme_id is null on
  // L5 output â€” so match on the name resolved from the URL's id, with theme_id as
  // a forward-compatible fallback for when the agent starts populating it.
  const focusPicks = useMemo(() => {
    if (!focusThemeId) return [];
    return (rec?.picks ?? []).filter(
      (p) =>
        (p.theme_id && p.theme_id === focusThemeId) ||
        (!!focusName && (p.theme === focusName || p.theme_name === focusName))
    );
  }, [rec, focusThemeId, focusName]);
  // A known theme (named, or carrying an EdgeScore) with no positions is held out.
  const focusIsKnown =
    !!focusThemeId &&
    (focusName !== null ||
      !!allEdgeByTheme[focusThemeId] ||
      !!edgeByTheme[focusThemeId]);
  // ADR-0081 — Worked example lineage panel helpers. Three small lookups the panel
  // calls by-asset. All three read from data the page already loaded; the panel is
  // strictly additive (a read-only reordering of the same lineage).
  const pickByAsset = useMemo(() => {
    const m: Record<string, Pick> = {};
    for (const p of rec?.picks ?? []) m[p.asset] = p;
    return m;
  }, [rec]);
  const maContextForAsset = useCallback(
    (asset: string): Pick["ma_context"] => pickByAsset[asset]?.ma_context ?? null,
    [pickByAsset]
  );
  const sizingForAsset = useCallback(
    (asset: string): SizingFinalInput => {
      const pick = pickByAsset[asset];
      const edge = edgeByAsset[asset] ?? {
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
      };
      const chain = pick
        ? buildSizingChain({
            direction: pick.direction,
            edge,
            weight: pick.weight,
            signedWeight: pick.signed_weight,
            notional: pick.notional,
            hypeScore: pick.hype_score,
            cap: capByAsset.get(asset),
            bindingGroupCaps,
          })
        : null;
      if (!chain) return { display: "—", convictionBased: false };
      const finalStep = chain.steps[chain.steps.length - 1];
      return {
        display: finalStep?.display ?? "—",
        convictionBased: chain.convictionBased,
      };
    },
    [pickByAsset, edgeByAsset, capByAsset, bindingGroupCaps]
  );
  const primaryScenarioForAsset = useCallback(
    (asset: string): PrimaryScenarioInput | null => {
      const scenarios = rec?.scenario_results ?? [];
      // The same parse the row uses (PickRow.perScenario) — worst severity first,
      // then first scenario that names the asset in its contribution_breakdown.
      const sorted = [...scenarios].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity)
      );
      for (const s of sorted) {
        const line = s.contribution_breakdown.find((b) =>
          b.trim().startsWith(`${asset} (`)
        );
        if (!line) continue;
        // The backend emits e.g. "  TLT (long): +8.0% × +4% = +0.32%" — the
        // final "= <value>%" is the per-position contribution.
        const m = line.match(/=\s*([^\s=]+)\s*$/);
        return {
          label: s.label,
          contribution: m ? m[1] : line.trim(),
        };
      }
      return null;
    },
    [rec]
  );

  const focusHeldOut = focusIsKnown && focusPicks.length === 0;

  // No `overflow-x-hidden` on the <main> below. With overflow-x hidden and
  // overflow-y visible, CSS computes overflow-y to `auto` — which makes <main> a
  // scroll container, and a `position: sticky` child then pins to IT (as tall as
  // the whole page) rather than to the viewport, so the section nav would
  // silently never stick. Containment is already handled one level up:
  // layout.tsx's grid-cols-[minmax(0,1fr)] track plus the min-w-0 item let wide
  // tables scroll inside their own overflow-x-auto wrappers.
  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
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
            <span
              className="num"
              style={staleness.stale ? { color: "var(--warning)" } : undefined}
            >
              {rec?.run_date ?? "â€”"}
            </span>
          </div>
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">LENS</span>
            <span className="num">{rec?.lens ?? "â€”"}</span>
          </div>
        </div>
      </div>

      {/* A dead run is invisible otherwise: the page keeps rendering the last book
          it has, with a date nobody reads as a warning. On 2026-07-24 the pipeline
          aborted on a single dropped quote and the site went on presenting the
          previous day's positions as the current $100M book. */}
      {staleness.stale && staleness.message && (
        <div
          role="alert"
          className="mb-6 rounded-[10px] border px-4 py-3 text-[13px] leading-[1.6]"
          style={{
            borderColor: "var(--warning)",
            // --warning at 8%. Keep in step with the token in globals.css.
            background: "rgba(168, 50, 9, 0.08)",
          }}
        >
          <span className="font-semibold" style={{ color: "var(--warning)" }}>
            Stale book â€”{" "}
          </span>
          <span className="text-text-secondary">{staleness.message}</span>
        </div>
      )}

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
          {/* â”€â”€ Theme-focus banner (from a "positions â†’" deep link) â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {focusThemeId && focusIsKnown && (
            <div
              className="card p-4 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2"
              style={
                focusHeldOut
                  ? { borderColor: "var(--border-strong)" }
                  : { borderColor: "var(--long)", background: "var(--long-dim, rgba(18,110,83,0.06))" }
              }
              data-testid="theme-focus-banner"
            >
              <div className="text-[13px] leading-[1.55] min-w-0 flex-1">
                {focusHeldOut ? (
                  <>
                    <span className="font-semibold text-text-primary">
                      {focusName ?? "This theme"}
                    </span>{" "}
                    <span className="text-text-secondary">
                      is held out of the current book â€” it produced no net-edge
                      position this run, so there is nothing to size. See the exact
                      component conflict in the abstention roster below.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-text-primary">
                      {focusName ?? "This theme"}
                    </span>{" "}
                    <span className="text-text-secondary">
                      holds {focusPicks.length} position
                      {focusPicks.length === 1 ? "" : "s"} in the book:{" "}
                      <span className="num text-text-primary">
                        {focusPicks.map((p) => p.asset).join(", ")}
                      </span>
                      .
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[12px]">
                {focusHeldOut && (
                  <a
                    href="#abstention-roster"
                    className="text-accent hover:underline whitespace-nowrap"
                  >
                    See the roster â†“
                  </a>
                )}
                <Link
                  href="/book"
                  className="text-text-tertiary hover:text-text-secondary whitespace-nowrap"
                >
                  Clear
                </Link>
              </div>
            </div>
          )}

          {/* â”€â”€ Fallback banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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

          {/* â”€â”€ Book header stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {/* gap-2 (8px), against the 24px page gutter. A metric strip reads as
              ONE instrument rather than six loose cards when its internal gap is
              roughly a third of the gutter separating it from everything else —
              the grouping is carried by the spacing ratio, not by a border. */}
          {/* The four questions a PM arrives with, before the detail strip.
              Two of these facts — what changed, and what is binding — were three
              screens down and on another route respectively; they are the two a
              reader needs first. Every figure here is read from the same `rec`
              the panels below render, so nothing can disagree with anything. */}
          <AnswerCards
            current={(rec.picks ?? []).map((p) => p.asset).filter(Boolean)}
            previous={prevBook?.assets ?? null}
            previousDate={prevBook?.date ?? null}
            gross={bm?.gross_exposure ?? null}
            net={bm?.net_exposure ?? null}
            deployed={(rec.picks ?? []).reduce((s, p) => s + (p.notional ?? 0), 0)}
            cash={
              100_000_000 -
              (rec.picks ?? []).reduce((s, p) => s + (p.notional ?? 0), 0)
            }
            worstLabel={worstScenario?.label ?? null}
            worstReturn={worstScenario?.estimated_book_return ?? null}
            bindingCaps={bindingGroupCaps}
            capsKnown={Boolean(rec?.cap_utilisation)}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
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
              hint="Long + short â€” total capital at risk"
            />
            <Stat
              label="Net"
              value={
                bm?.net_exposure === undefined
                  ? "â€”"
                  : `${bm.net_exposure >= 0 ? "+" : ""}${fmtPct(bm.net_exposure)}`
              }
              hint="Long âˆ’ short â€” directional tilt"
            />
            <Stat
              label="Deployed"
              value={fmtUSD(
                rec.picks.reduce((s, p) => s + (p.notional ?? 0), 0)
              )}
              hint={(() => {
                const dep = rec.picks.reduce((s, p) => s + (p.notional ?? 0), 0);
                const cash = 100_000_000 - dep;
                return cash > 500_000
                  ? `of $100M â€” ${fmtUSD(cash)} in cash, held back by position limits`
                  : "Capital allocated of $100M";
              })()}
            />
            <Stat
              label="Worst scenario"
              value={
                worstScenario
                  ? `${(worstScenario.estimated_book_return * 100).toFixed(1)}%`
                  : "â€”"
              }
              hint={worstScenario?.label}
              color={worstScenario ? "var(--short)" : undefined}
            />
          </div>

          {/* â”€â”€ Book view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {/* The nav sits below the header banners and the summary tiles: the
              tiles ARE the answer this page exists to give, so they are never
              something a reader has to navigate to. */}
          <SectionNav items={BOOK_SECTIONS} />

          <section id="holdings" aria-label="Holdings and thesis">
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

          {/* â”€â”€ Positions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
              {/* Longs ‖ Shorts. The one pairing on this page where two panels
                  are genuinely comparable rather than merely adjacent: same
                  columns, same row shape, and the question "is this book
                  lopsided?" is answered by seeing them side by side.
                  Gated at `wide` (1440px), NOT `xl`: below that each pane is
                  narrower than BOOK_ROW_MIN_W (640px) and every position row
                  would open its own horizontal scroller. See tailwind.config.ts.
                  items-start so a 5-row side is not stretched to match an 8-row
                  side; [&>*]:mb-0 because each PositionSection carries its own
                  bottom margin, which would otherwise double up inside the grid.
                  [&>*]:min-w-0 because a grid item defaults to min-width:auto and
                  refuses to shrink below the 640px row grid nested inside it —
                  without it the section stretched to 642px and scrolled the body
                  on a 375px phone instead of letting each row's ScrollArea scroll. */}
              <div className="grid wide:grid-cols-2 gap-6 items-start [&>*]:mb-0 [&>*]:min-w-0 mb-6">
              <PositionSection
                title="Longs"
                glyph="â–²"
                color="var(--long)"
                picks={longs}
                openAsset={openAsset}
                setOpenAsset={setOpenAsset}
                citations={citations}
                repl={repl}
                bookRunDate={rec.run_date}
                advisory={advisory}
                capByAsset={capByAsset}
                bindingGroupCaps={bindingGroupCaps}
                edgeByAsset={edgeByAsset}
                edgeWeights={edgeWeights}
                convictionSum={convictionSum}
                allPicks={allPicks}
                correlationPairs={correlationPairs}
                ideas={rec?.independent_ideas ?? null}
                scenarios={rec.scenario_results ?? []}
              />
              <PositionSection
                title="Shorts"
                glyph="â–¼"
                color="var(--short)"
                picks={shorts}
                openAsset={openAsset}
                setOpenAsset={setOpenAsset}
                citations={citations}
                repl={repl}
                bookRunDate={rec.run_date}
                advisory={advisory}
                capByAsset={capByAsset}
                bindingGroupCaps={bindingGroupCaps}
                edgeByAsset={edgeByAsset}
                edgeWeights={edgeWeights}
                convictionSum={convictionSum}
                allPicks={allPicks}
                correlationPairs={correlationPairs}
                ideas={rec?.independent_ideas ?? null}
                scenarios={rec.scenario_results ?? []}
                emptyNote="This book has no short positions. A $100M long-short mandate with zero shorts carries full directional market exposure â€” check the screening funnel for why no theme produced a negative TradeScore."
              />
              </div>

              {/* ADR-0081 — Worked example lineage panel. Additive, collapsed by default
                  (a native `<details>`), rendered only when there are picks. Same data
                  the rows above already show, in the order the pipeline performed it. */}
              <WorkedExamplePanel
                picks={rec.picks}
                edgeByAsset={edgeByAsset}
                edgeByTheme={edgeByTheme}
                maContextForAsset={maContextForAsset}
                sizingForAsset={sizingForAsset}
                primaryScenarioForAsset={primaryScenarioForAsset}
              />
            </>
          )}


          {/* â”€â”€ Pool depth: the answer to "why not five and five?" â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {/* Three independent readings of one question — "how solid is this
              book?" — that were stacked full-width across ~975px and read as a
              sequence. Side by side they read as what they are: corroboration.
              lg:2-up then wide:3-up, since none of the three carries a table
              with a large min-width. */}
          </section>

          <section id="solidity" aria-label="How solid this book is">
          <div className="grid lg:grid-cols-2 wide:grid-cols-3 gap-6 items-start [&>*]:mb-0 mb-6">
          <PoolDepth
            ideas={rec?.independent_ideas ?? null}
            heldLongs={(rec?.picks ?? []).filter((p) => p.direction === "long").length}
            heldShorts={(rec?.picks ?? []).filter((p) => p.direction === "short").length}
          />

          {/* â”€â”€ Turnover vs the previous run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <BookTurnover
            current={(rec?.picks ?? []).map((p) => p.asset).filter(Boolean)}
            previous={prevBook?.assets ?? null}
            previousDate={prevBook?.date ?? null}
          />

          {/* â”€â”€ Same inputs, run again: agent churn as against market churn â”€ */}
          <Replication />
          </div>

          {/* â”€â”€ Abstention roster â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          </section>

          <section id="not-taken" aria-label="Cleared the screen but not taken">
          <ClearedNotTaken
            candidates={candidates}
            heldAssets={new Set((rec?.picks ?? []).map((p) => p.asset))}
            heldDirections={Object.fromEntries(
              (rec?.picks ?? []).map((p) => [p.asset, p.direction])
            )}
            themeNames={themeNames}
            correlations={rec?.candidate_correlations ?? {}}
          />

          <AbstentionRoster
            edgeByTheme={allEdgeByTheme}
            themeNames={themeNames}
            abstainThreshold={edgeWeights.abstainThreshold}
            thresholdIsLive={weightsResolved.abstainThreshold}
            // Themes that traded, taken from the PUBLISHED BOOK â€” the same source
            // the positions table above renders (ADR-0040). It used to come from
            // portfolio_positions, which disagrees with the book for the several
            // minutes L5 takes: L1 writes its full candidate set there first and it
            // is only reconciled down after the agent picks. During that window
            // every theme looked traded, so this panel printed "Every scored theme
            // cleared the |Edge| >= 0.15 conviction bar" while /method showed
            // Inflation at +0.117 â€” a confidently wrong sentence, on a page whose
            // own positions table listed seven names from four themes.
            tradedThemeIds={
              new Set(
                (rec?.picks ?? [])
                  .map((p) => p.theme_id || posEdgeByAsset[p.asset]?.theme_id)
                  .filter((t): t is string => Boolean(t))
              )
            }
            focusThemeId={focusHeldOut ? focusThemeId : null}
          />

          {/* â”€â”€ Screening funnel (collapsed â€” audit detail) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          </section>

          <section id="audit" aria-label="Audit detail">
          <CollapsibleSection
            title="Screening funnel"
            summary={
              rec.screening_funnel && rec.screening_funnel.length > 0
                ? `${rec.screening_funnel[rec.screening_funnel.length - 1]?.remaining ?? "â€”"} names cleared ${rec.screening_funnel.length} filters`
                : "how the universe was filtered to the book"
            }
          >
            {rec.screening_funnel && rec.screening_funnel.length > 0 ? (
              <ScrollArea hint={false}>
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
                          {s.removed > 0 ? `âˆ’${s.removed}` : "0"}
                        </td>
                        <td className="px-[18px] py-2.5 border-b border-border text-text-secondary text-[12px]">
                          {s.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
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

          {/* â”€â”€ Book risks (collapsed â€” expand for the tail risks) â”€â”€â”€â”€â”€â”€â”€ */}
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
          </section>

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
  bindingGroupCaps,
  edgeByAsset,
  edgeWeights,
  convictionSum,
  allPicks,
  correlationPairs,
  ideas,
  scenarios,
  repl,
  bookRunDate,
  emptyNote,
}: {
  title: string;
  glyph: string;
  color: string;
  picks: Pick[];
  openAsset: string | null;
  setOpenAsset: (a: string | null) => void;
  citations?: Citation[];
  repl?: ReplicationNames | null;
  bookRunDate?: string | null;
  advisory: AdvisoryDerivation | null;
  capByAsset: Map<string, CapRow>;
  bindingGroupCaps: BindingGroupCap[];
  edgeByAsset: Record<string, ResolvedEdge>;
  edgeWeights: EdgeWeights;
  convictionSum: number | null;
  allPicks: { asset: string; direction: "long" | "short"; notional?: number }[];
  correlationPairs: CorrelationPairLite[] | null;
  ideas: IndependentIdeas | null;
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
        <ScrollArea className="card" frameClassName="rounded-[10px]">
          {/* Column legend for the dense row grid below. */}
          <div
            className={`${BOOK_ROW_MIN_W} ${BOOK_ROW_GRID} px-[18px] py-2 grid items-center gap-3 border-b border-border bg-bg-elevated text-[10px] uppercase tracking-[0.08em] text-text-tertiary`}
          >
            <span>#</span>
            <span>Asset Â· theme Â· rationale</span>
            <span className="text-right">Weight Â· notional</span>
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
              repl={repl}
              bookRunDate={bookRunDate}
              advisory={advisory}
              cap={capByAsset.get(p.asset)}
              bindingGroupCaps={bindingGroupCaps}
              edge={edgeByAsset[p.asset]}
              edgeWeights={edgeWeights}
              convictionSum={convictionSum}
              allPicks={allPicks}
              correlationPairs={correlationPairs}
              ideas={ideas}
              scenarios={scenarios}
            />
          ))}
        </ScrollArea>
      )}
    </section>
  );
}
