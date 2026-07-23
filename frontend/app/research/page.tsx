"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TradeDerivationDrawer from "@/components/TradeDerivationDrawer";
import CitationList, { Citation } from "@/components/CitationList";
import SentimentBadge from "@/components/SentimentBadge";
import MarketBar from "@/components/MarketBar";
import PredictionMarkets from "@/components/PredictionMarkets";
import ThesisBlock from "@/components/research/ThesisBlock";
import LensSelector, { Lens } from "@/components/LensSelector";
import {
  AdvisoryDerivation,
  canRenderAdvisoryBody,
} from "@/lib/derivations/advisory";

interface Pick {
  direction: "long" | "short";
  asset: string;
  theme_id?: string;
  theme_name?: string;
  thesis: string;
  catalysts?: string[];
  risk?: string;
  counter_thesis?: string;
  time_horizon?: string;
  factor_tilts?: Record<string, number>;
  notional?: number;
  hype_score?: number;
  trade_score?: number;
  weight?: number;
}

interface ResearchRecommendation {
  run_date: string;
  picks: Pick[];
  book_view: string;
  book_risks: string[];
  agent_run_id?: string;
  /** T18: persisted AdvisoryDerivation JSONB from q1_agent. */
  advisory_derivation?: AdvisoryDerivation | null;
}

interface Regime { cycle: string; sentiment: string }

const TOTAL_NOTIONAL = 100_000_000;

function PickCard({
  pick,
  rank,
  citations,
  onOpen,
  thesisAdvisory,
}: {
  pick: Pick;
  rank: number;
  citations?: Citation[];
  onOpen: (p: Pick) => void;
  /** Parent AdvisoryDerivation — if unavailable, the thesis body must not render. */
  thesisAdvisory?: AdvisoryDerivation | null;
}) {
  const isLong = pick.direction === "long";
  const notional = pick.notional ? `$${(pick.notional / 1_000_000).toFixed(1)}M` : null;
  const weight =
    pick.weight !== undefined
      ? `${(pick.weight * 100).toFixed(1)}%`
      : pick.notional
        ? `${((pick.notional / 100_000_000) * 100).toFixed(1)}%`
        : null;

  const hasCitations = (citations?.length ?? 0) > 0;

  return (
    <div
      className="card p-7 mb-4 cursor-pointer hover:border-border-strong transition-colors"
      onClick={() => onOpen(pick)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(pick);
        }
      }}
    >
      <div className="flex items-baseline justify-between mb-1 gap-2.5 flex-wrap">
        <h3 className="text-[20px] font-semibold m-0 flex items-baseline gap-2.5">
          <span style={{ color: isLong ? "var(--long)" : "var(--short)" }}>
            {isLong ? "▲" : "▼"} {isLong ? "Long" : "Short"} #{rank}:
          </span>
          <span className="num">{pick.asset}</span>
          {pick.theme_name && (
            <span className="text-text-tertiary text-[12px] font-normal">· {pick.theme_name}</span>
          )}
        </h3>
        {notional && weight && (
          <span className={`badge ${isLong ? "badge-long" : "badge-short"}`} style={{ fontSize: 10 }}>
            {weight} / {notional}
          </span>
        )}
      </div>
      <div className="text-text-secondary text-[13px] mb-5">
        HypeScore {pick.hype_score?.toFixed(1) ?? "—"} · TradeScore{" "}
        <span style={{ color: isLong ? "var(--long)" : "var(--short)" }}>
          {pick.trade_score !== undefined
            ? `${pick.trade_score >= 0 ? "+" : ""}${pick.trade_score.toFixed(2)}`
            : "—"}
        </span>
        {/* "Conviction: HIGH" was hardcoded here for every pick in every book.
            The system computes no conviction measure, so nothing is shown in
            its place — HypeScore and TradeScore above are the actual ranking
            signals. */}
        {hasCitations && (
          <span className="text-accent text-[11px] ml-1.5">· {citations!.length} citations</span>
        )}
        <span className="text-text-tertiary text-[11px] ml-2">· click for derivation</span>
      </div>

      {pick.thesis && canRenderAdvisoryBody(thesisAdvisory) && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2 flex items-center gap-2">
            Thesis
            {hasCitations && (
              <span className="text-accent normal-case font-normal text-[10.5px]">
                ({citations!.length} sources)
              </span>
            )}
          </div>
          <CitationList text={pick.thesis} citations={citations} />
        </div>
      )}
      {pick.thesis && !canRenderAdvisoryBody(thesisAdvisory) && (
        <div
          className="mb-4 rounded-md px-3 py-2.5 text-[12px] leading-[1.6] border"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "rgba(248, 81, 73, 0.3)",
            color: "var(--text-secondary)",
          }}
        >
          Thesis unavailable for this run.
        </div>
      )}

      {pick.factor_tilts && Object.keys(pick.factor_tilts).length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2">
            Factor tilts
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(pick.factor_tilts).map(([k, v]) => (
              <span
                key={k}
                className="text-[12px] num bg-bg-elevated text-text-secondary px-2 py-1 rounded border border-border"
              >
                {k}: {typeof v === "number" ? (v >= 0 ? "+" : "") + v.toFixed(2) : v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Everything below is LLM-authored advisory prose and must clear the
          same provenance gate as the thesis body. The fallback path populates
          counter_thesis, catalysts and risk too, so gating only `thesis` meant
          a fallback run rendered "Thesis unavailable" with heuristic prose
          immediately beneath it. */}
      {canRenderAdvisoryBody(thesisAdvisory) && pick.counter_thesis && (
        <div className="mb-4">
          <div
            className="rounded-md px-3 py-2.5 text-[12.5px] leading-[1.6] border"
            style={{
              background: "rgba(248, 81, 73, 0.06)",
              borderColor: "rgba(248, 81, 73, 0.3)",
              color: "var(--text-primary)",
            }}
          >
            <span className="text-[10px] uppercase tracking-[0.12em] text-short font-semibold mr-2">
              Counter-thesis
            </span>
            {pick.counter_thesis}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {canRenderAdvisoryBody(thesisAdvisory) && pick.catalysts && pick.catalysts.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2">
              Catalysts
            </div>
            <ul className="m-0 pl-[18px] leading-[1.7] text-[13px] text-text-primary">
              {pick.catalysts.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {canRenderAdvisoryBody(thesisAdvisory) && pick.risk && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-text-secondary font-semibold mb-2">
              Risk
            </div>
            <p className="m-0 leading-[1.7] text-[13px] text-text-primary">{pick.risk}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20"><div className="skeleton h-[180px]" /></main>}>
      <ResearchPageInner />
    </Suspense>
  );
}

function ResearchPageInner() {
  const searchParams = useSearchParams();
  const rawLens = searchParams?.get("lens");
  const validLenses: Lens[] = ["multi_asset", "credit", "rates", "equity", "fx", "commodity"];
  const lens: Lens = (validLenses as string[]).includes(rawLens ?? "")
    ? (rawLens as Lens)
    : "multi_asset";
  const [rec, setRec] = useState<ResearchRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regime, setRegime] = useState<Regime | null>(null);
  const [openPick, setOpenPick] = useState<Pick | null>(null);
  const [citations, setCitations] = useState<Citation[] | undefined>(undefined);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [recRes, regimeRes] = await Promise.all([
        supabase
          .from("research_recommendations")
          // `book_metrics_summary` and `scenario_table` were selected here but
          // are not columns on research_recommendations. PostgREST rejects an
          // unknown column with 400/42703 and drops the WHOLE select, so this
          // page rendered "No Q1 recommendations yet" unconditionally — even
          // with a valid row present. The structured equivalents added in
          // migration 021 (book_metrics, scenario_results) are rendered on
          // /book and /risk.
          .select("run_date, picks, book_view, book_risks, agent_run_id, advisory_derivation")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("regime_classifications")
          // `narrative` is not a column on regime_classifications — selecting
          // it 400s the query and blanks the regime badge.
          .select("cycle, sentiment")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const recData = recRes.data as ResearchRecommendation | null;
      if (recData) {
        // Ensure picks is an array (JSONB may be array or null)
        if (Array.isArray(recData.picks)) {
          setRec(recData);
        } else if (typeof recData.picks === "string") {
          try {
            setRec({ ...recData, picks: JSON.parse(recData.picks) });
          } catch {
            setRec({ ...recData, picks: [] });
          }
        } else {
          setRec({ ...recData, picks: [] });
        }
        // Ensure book_risks is an array
        if (recData.agent_run_id) {
          const { data: runData } = await supabase
            .from("research_agent_runs")
            .select("citations, prompt_version")
            .eq("id", recData.agent_run_id)
            .maybeSingle();
          if (runData) {
            const r = runData as {
              citations?: Citation[];
              prompt_version?: string;
            };
            setCitations(Array.isArray(r.citations) ? r.citations : undefined);
            setPromptVersion(r.prompt_version ?? null);
          }
        }
      } else {
        setRec(null);
      }

      setRegime((regimeRes.data as Regime) ?? null);
      setLoading(false);
    }
    load();
  }, []);

  const longs = (rec?.picks ?? []).filter((p) => p.direction === "long").slice(0, 5);
  const shorts = (rec?.picks ?? []).filter((p) => p.direction === "short").slice(0, 5);

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">
            Q1 Research · $100M Long-Short Book
          </h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Top 5 long + top 5 short with macro view, factor tilts, and book risks.{" "}
            <span className="text-text-tertiary text-[12px]">
              Click any pick for full derivation.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LensSelector value={lens} onChange={() => undefined} />
          <div className="text-right text-text-secondary text-[12px]">
          {rec?.run_date && (
            <div>
              <span className="text-text-tertiary mr-1.5">RUN DATE</span>
              <span className="num">{rec.run_date}</span>
            </div>
          )}
          {/* Read from the agent run, not hardcoded. The literal
              "q1-agent-v2.0.0" here disagreed with the persisted
              prompt_version ("v2.1.0") and would never have tracked a change. */}
          <div className="mt-1">
            <span className="text-text-tertiary mr-1.5">PROMPT v</span>
            <span className="num">{promptVersion ?? "—"}</span>
          </div>
          {regime && (
            <div className="mt-2">
              <SentimentBadge sentiment={regime.sentiment} cycle={regime.cycle} size="sm" />
            </div>
          )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[180px]" />
          <div className="skeleton h-[180px]" />
          <div className="skeleton h-[180px]" />
        </div>
      ) : !rec ? (
        <div className="card p-12 text-center text-text-tertiary text-[13px]">
          <p className="m-0 mb-2">No Q1 recommendations yet.</p>
          <p className="m-0 text-text-secondary text-[12px]">
            Run the daily pipeline (<code className="num">daily_refresh.py</code>) to generate the book.
            See{" "}
            <Link href="/" className="text-accent hover:underline">
              Conviction dashboard
            </Link>{" "}
            for theme status.
          </p>
        </div>
      ) : (
        <>
          {/* Market bar */}
          <div className="mb-6">
            <MarketBar />
          </div>

          {/* Sentiment */}
          {regime && (
            <div className="mb-4">
              <SentimentBadge sentiment={regime.sentiment} cycle={regime.cycle} />
            </div>
          )}

          {/* Prediction markets — cited macro context for the Q1 thesis */}
          <div className="mb-6">
            <PredictionMarkets />
          </div>

          {/* Book View — ThesisBlock enforces the strict unavailable policy.
              Rendered unconditionally: a row written before the
              advisory_derivation column existed carries no provenance, and
              short-circuiting on its absence hid the section entirely instead
              of stating that the thesis is unavailable. Incomplete items stay
              visible; canRenderAdvisoryBody already treats a null advisory as
              untrusted, so the synthesized value below only supplies the
              reason text. */}
          <div className="mb-4">
            <ThesisBlock
              advisory={
                rec.advisory_derivation ?? {
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
              className=""
            />
          </div>

          {longs.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[16px] font-semibold m-0 mb-4 flex items-center gap-2">
                <span style={{ color: "var(--long)" }}>▲</span> Top {longs.length} Longs
              </h2>
              {longs.map((p, i) => (
                <PickCard
                  key={`long-${i}`}
                  pick={p}
                  rank={i + 1}
                  citations={citations}
                  onOpen={setOpenPick}
                  thesisAdvisory={rec.advisory_derivation}
                />
              ))}
            </section>
          )}

          {shorts.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[16px] font-semibold m-0 mb-4 flex items-center gap-2">
                <span style={{ color: "var(--short)" }}>▼</span> Top {shorts.length} Shorts
              </h2>
              {shorts.map((p, i) => (
                <PickCard
                  key={`short-${i}`}
                  pick={p}
                  rank={i + 1}
                  citations={citations}
                  onOpen={setOpenPick}
                  thesisAdvisory={rec.advisory_derivation}
                />
              ))}
            </section>
          )}

          {/* book_risks is LLM-authored and is populated by the fallback path
              too, so it clears the same gate as the thesis body. */}
          {canRenderAdvisoryBody(rec.advisory_derivation) &&
            rec.book_risks && rec.book_risks.length > 0 && (
            <div
              className="card p-7"
              style={{ background: "var(--bg-elevated)", borderColor: "rgba(248,81,73,0.3)" }}
            >
              <h3 className="text-[20px] font-semibold m-0 mb-1">Cross-cutting book risks</h3>
              <div className="text-text-secondary text-[13px] mb-5">
                What kills the book if it goes wrong.
              </div>
              <ul className="m-0 pl-[18px] leading-[1.8] text-text-primary text-[13.5px]">
                {rec.book_risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <TradeDerivationDrawer
        pick={openPick}
        open={openPick !== null}
        onClose={() => setOpenPick(null)}
        totalNotional={TOTAL_NOTIONAL}
      />
    </main>
  );
}
