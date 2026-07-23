import Sparkline from "./Sparkline";
import SubScoreBars from "./SubScoreBars";
import ScoreDeltaBadge from "./ScoreDeltaBadge";
import { toDisplayScore, edgeRationale, type ThemeEdge } from "@/lib/themeSignals";
import { EdgeDirectionChip, ProvenanceDot, PositionsLink } from "./ThemeEdgeChips";
import { isSynthetic, provenanceLabel, type ThemeProvenance } from "@/lib/themeProvenance";

export interface ConvictionTheme {
  id: string;
  name: string;
  tier: "anchor" | "discovered" | "review" | string;
  hype_score: number;
  volume_score?: number;
  sentiment_score?: number;
  corr_score?: number;
  momentum_score?: number;
  delta_1d?: number;
  history?: number[];
  /** Latest 1-day mention count from theme_signals_history. */
  mention_count_1d?: number | null;
  /**
   * Percentile band of the current HypeScore within this theme's own history.
   * "high" = crowded consensus, "low" = fading attention. Undefined when there
   * is insufficient history — never guessed.
   */
  crowding?: "healthy" | "low" | "high" | string;
  /** Raw crowding percentile (0–100) within this theme's own 30d history.
   * Undefined under 5 observations — surface a "NEW" chip, not a bare "—". */
  crowding_pct?: number;
  /** How many scored observations back this theme's history (for the NEW chip). */
  history_obs?: number;
  updated_at?: string;
  run_date?: string;
}

interface Props {
  rank: number;
  theme: ConvictionTheme;
  hero?: boolean;
  onOpenDerivation?: (theme: ConvictionTheme) => void;
  /** Resolved EdgeScore breakdown for this theme (direction + rationale). */
  edge?: ThemeEdge;
  /** |EdgeScore| below which the engine abstains (scoring_config, live). */
  abstainThreshold?: number;
  /** Latest-run data_source provenance for the HypeScore. */
  provenance?: ThemeProvenance;
}

// Rank only. The previous labels asserted "High conviction" / "Emerging" purely
// from position in the list — a conviction claim the system never computed.
function rankLabel(rank: number): string {
  return `#${rank} by HypeScore`;
}

function tierBadge(tier: string) {
  if (tier === "anchor") return <span className="badge badge-tier-anchor">ANCHOR</span>;
  if (tier === "discovered") return <span className="badge badge-tier-discovered">DISCOVERED</span>;
  if (tier === "review") return <span className="badge badge-warning">REVIEW</span>;
  return <span className="badge badge-neutral">{tier.toUpperCase()}</span>;
}

function crowdingColor(c?: string) {
  if (c === "low" || c === "healthy") return "text-long";
  if (c === "high") return "text-warning";
  return "text-text-secondary";
}

export default function ConvictionCard({
  rank,
  theme,
  hero = false,
  onOpenDerivation,
  edge,
  abstainThreshold = 0.15,
  provenance,
}: Props) {
  const score = Math.round(theme.hype_score ?? 0);
  const delta = theme.delta_1d ?? 0;
  const color = score >= 70 ? "#4d8fff" : score >= 50 ? "#3fb950" : "#f85149";
  const synthetic = isSynthetic(provenance?.data_source ?? null);
  const pct = theme.crowding_pct;
  const hasPct = typeof pct === "number";

  return (
    <div
      className={`flex flex-col rounded-[10px] p-[18px] border cursor-pointer transition-all duration-200 relative group ${
        hero
          ? "bg-gradient-to-b from-[#1a2230] to-[#131822] border-border-strong"
          : "bg-bg-surface border-border hover:border-border-strong hover:bg-bg-elevated"
      }`}
      onClick={() => onOpenDerivation?.(theme)}
      data-testid={onOpenDerivation ? "theme-derivation-trigger" : undefined}
      role={onOpenDerivation ? "button" : undefined}
      tabIndex={onOpenDerivation ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onOpenDerivation) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDerivation(theme);
        }
      }}
    >
      {hero && (
        <div
          className="absolute top-0 inset-x-0 h-0.5 rounded-t-[10px]"
          style={{ background: "linear-gradient(90deg, var(--accent) 0%, var(--long) 100%)" }}
        />
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-tertiary uppercase tracking-[0.15em] font-semibold">
          {rankLabel(rank)}
        </span>
        {tierBadge(theme.tier)}
      </div>

      <div className="flex items-center gap-2 mb-1.5">
        <ProvenanceDot source={provenance?.data_source ?? null} />
        <h3 className="text-[15px] font-semibold m-0 flex-1 min-w-0 truncate">{theme.name}</h3>
      </div>

      {/* The trade the theme implies: long / short / abstain from EdgeScore,
          with the one-line IC-defensible rationale beneath. */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <EdgeDirectionChip edge={edge} abstainThreshold={abstainThreshold} />
        <PositionsLink themeId={theme.id} className="ml-auto text-[11px] text-text-tertiary hover:text-accent transition-colors whitespace-nowrap" />
      </div>
      {edge && edge.edge_score !== null && (
        <div className="text-[10.5px] text-text-secondary leading-[1.5] mb-2 num">
          {edgeRationale(edge)}
        </div>
      )}

      <div className="text-[11px] text-text-tertiary mb-2 flex items-center gap-1.5">
        <span>HypeScore</span>
        <span className="num font-semibold text-text-primary">{score}</span>
        {synthetic && (
          <span
            className="text-warning font-semibold"
            title={provenanceLabel(provenance?.data_source ?? null)}
          >
            {provenance?.data_source === "mock" ? "· synthetic" : "· partly synthetic"}
          </span>
        )}
        <span>·</span>
        <ScoreDeltaBadge delta={delta} variant="1d" />
        {onOpenDerivation && (
          <span
            className="ml-auto text-[10px] text-text-tertiary group-hover:text-accent transition-colors uppercase tracking-[0.08em] hidden md:inline"
            title="Click to view score derivation"
          >
            ⓘ derive
          </span>
        )}
      </div>

      {/* No thesis here. This slot previously rendered a hardcoded per-theme
          string ("Powell signals September cut...") that looked like analysis
          but was authored in the frontend. A theme-level thesis is L5 output
          and belongs on /book, where it carries a citation trail. */}

      {theme.history && theme.history.length > 0 && (
        <div className="mt-2">
          <Sparkline points={theme.history} color={color} height={32} />
          <div className="text-[9.5px] text-text-tertiary mt-1 leading-tight">
            HypeScore is a same-day cross-sectional rank — this line is rank-over-time.
          </div>
        </div>
      )}

      {/* Sub-scores persist as [0,1]; SubScoreBars renders on 0–100. */}
      <SubScoreBars
        volume={toDisplayScore(theme.volume_score)}
        sentiment={toDisplayScore(theme.sentiment_score)}
        correlation={toDisplayScore(theme.corr_score)}
        momentum={toDisplayScore(theme.momentum_score)}
      />

      <div className="grid grid-cols-3 gap-2.5 pt-3 mt-3 border-t border-border">
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
            Mentions
          </div>
          <div className="text-[13px] font-semibold num">
            {theme.mention_count_1d ?? "—"}
          </div>
        </div>
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5"
            title="Where today's HypeScore sits within this theme's own 30-day range"
          >
            Crowding
          </div>
          {hasPct ? (
            <>
              <div className={`text-[13px] font-semibold ${crowdingColor(theme.crowding)}`}>
                {Math.round(pct as number)}
                <span className="text-[9px] align-top">th</span>
                <span className="text-[10px] font-normal text-text-tertiary ml-1">pct</span>
              </div>
              <div className="text-[9.5px] text-text-tertiary leading-tight" title="Attention vs this theme's own 30-day range">
                {(pct as number) >= 80
                  ? "crowded"
                  : (pct as number) <= 20
                    ? "fading"
                    : "in-range"}{" "}
                vs own 30d
              </div>
            </>
          ) : (
            <div
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] border border-border text-text-tertiary"
              title="Fewer than 5 scored observations — a within-history percentile would be noise dressed as signal"
            >
              new
              <span className="num opacity-70">
                &lt;5 obs
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary mb-0.5">
            Δ1d
          </div>
          <div className="text-[13px] font-semibold num">
            {theme.delta_1d === undefined ? (
              <span
                className="text-text-tertiary"
                title="No prior scored run in theme_signals_history"
              >
                —
              </span>
            ) : (
              <ScoreDeltaBadge delta={delta} variant="1d" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
