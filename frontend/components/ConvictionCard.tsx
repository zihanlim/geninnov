import Sparkline from "./Sparkline";
import SubScoreBars from "./SubScoreBars";
import ScoreDeltaBadge from "./ScoreDeltaBadge";
import { toDisplayScore } from "@/lib/themeSignals";

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
  updated_at?: string;
  run_date?: string;
}

interface Props {
  rank: number;
  theme: ConvictionTheme;
  hero?: boolean;
  onOpenDerivation?: (theme: ConvictionTheme) => void;
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

export default function ConvictionCard({ rank, theme, hero = false, onOpenDerivation }: Props) {
  const score = Math.round(theme.hype_score ?? 0);
  const delta = theme.delta_1d ?? 0;
  const color = score >= 70 ? "#4d8fff" : score >= 50 ? "#3fb950" : "#f85149";

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

      <h3 className="text-[15px] font-semibold m-0 mb-1.5">{theme.name}</h3>
      <div className="text-[11px] text-text-tertiary mb-2 flex items-center gap-1.5">
        <span>HypeScore</span>
        <span className="num font-semibold text-text-primary">{score}</span>
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
          <div className={`text-[13px] font-semibold ${crowdingColor(theme.crowding)}`}>
            {theme.crowding
              ? theme.crowding[0].toUpperCase() + theme.crowding.slice(1)
              : "—"}
          </div>
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
