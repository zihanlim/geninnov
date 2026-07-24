import { toDisplayScore, type ThemeEdge } from "@/lib/themeSignals";
import { EdgeDirectionChip, ProvenanceDot, PositionsLink, isThemeAbstained } from "./ThemeEdgeChips";
import { isSynthetic, type ThemeProvenance } from "@/lib/themeProvenance";

export interface HeatmapTheme {
  id: string;
  name: string;
  tier?: string;
  /** 0–100. */
  hype_score?: number;
  /** Persisted as [0,1] — converted to 0–100 for the colour ramp below. */
  volume_score?: number;
  sentiment_score?: number;
  corr_score?: number;
  momentum_score?: number;
  delta_1d?: number;
}

interface Props<T extends HeatmapTheme> {
  themes: T[];
  onSelect?: (theme: T) => void;
  /** Resolved EdgeScore per theme_id — drives the long/short/abstain column. */
  edgeByTheme?: Record<string, ThemeEdge>;
  /** |EdgeScore| abstain threshold from scoring_config (live). */
  abstainThreshold?: number;
  /** Latest-run data_source per theme_id — drives the provenance dot. */
  provByTheme?: Record<string, ThemeProvenance>;
}

// Diverging color: red (low) → gray (mid) → green (high) on a 0-100 scale.
// Midpoint at 50; ±50 gives the saturation. A null value gets no fill at all,
// so an absent sub-score reads as absent rather than as a deep-red zero.
function cellColor(value: number | null): string {
  if (value === null) return "transparent";
  const t = Math.max(0, Math.min(100, value));
  const dev = (t - 50) / 50; // -1 .. +1
  // Ledger ink as translucent tints on warm paper: forest-green long, crimson
  // short. Lighter alpha than the old dark theme so ink text stays readable.
  if (dev >= 0) {
    const a = 0.08 + dev * 0.42;
    return `rgba(20, 122, 92, ${a.toFixed(2)})`;
  }
  const a = 0.08 + Math.abs(dev) * 0.42;
  return `rgba(159, 23, 42, ${a.toFixed(2)})`;
}

function cellTextColor(value: number | null): string {
  if (value === null) return "var(--text-tertiary)";
  return value >= 35 && value <= 65
    ? "var(--text-secondary)"
    : "var(--text-primary)";
}

const SUBSCORES = [
  { key: "volume_score", label: "Volume", short: "VOL" },
  { key: "sentiment_score", label: "Sent.", short: "SENT" },
  { key: "corr_score", label: "Corr", short: "CORR" },
  { key: "momentum_score", label: "Mom.", short: "MOM" },
] as const;

function tierBadge(tier?: string) {
  if (tier === "anchor") return "A";
  if (tier === "discovered") return "D";
  if (tier === "review") return "R";
  return "·";
}

export default function ThemeHeatmap<T extends HeatmapTheme>({
  themes,
  onSelect,
  edgeByTheme,
  abstainThreshold = 0.15,
  provByTheme,
}: Props<T>) {
  if (themes.length === 0) {
    return (
      <div className="card p-8 text-center text-text-tertiary text-[13px]">
        No themes available for the heatmap. Run the daily pipeline to populate.
      </div>
    );
  }

  // Sort by hype_score desc
  const sorted = [...themes].sort((a, b) => (b.hype_score ?? 0) - (a.hype_score ?? 0));

  // How many themes carry a synthetic (mock/mixed) HypeScore this run — an
  // honesty count so a PM knows the heatmap is not all live signal.
  const syntheticCount = provByTheme
    ? sorted.filter((t) => isSynthetic(provByTheme[t.id]?.data_source ?? null)).length
    : 0;

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex-wrap gap-2">
        <div>
          <span className="card-title">Theme × Sub-score heatmap</span>
          <span className="text-text-tertiary text-[11px] ml-2">
            {themes.length} theme{themes.length === 1 ? "" : "s"} · 4 dimensions ·
            red=low / green=high (0–100)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(159, 23, 42, 0.6)" }} />
            <span>&lt; 35</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(120, 130, 145, 0.2)" }} />
            <span>35-65</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(20, 122, 92, 0.6)" }} />
            <span>&gt; 65</span>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[12px]">
          <caption className="sr-only">
            Theme sub-score heatmap · {themes.length} themes × 4 sub-scores
            (Volume, Sentiment, Correlation, Momentum) plus HypeScore, 1-day
            delta, the resolved EdgeScore trade direction, signal provenance,
            and a link to each theme&apos;s positions in the book.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-3 py-2 w-[180px]">
                Theme
              </th>
              <th className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2 w-[40px]">
                Tier
              </th>
              <th
                className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2 w-[92px]"
                title="Resolved trade side from EdgeScore = 0.35·Trend + 0.25·Regime + 0.20·Carry + 0.20·Value"
              >
                Trade
              </th>
              {SUBSCORES.map((s) => (
                <th
                  key={s.key}
                  className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2"
                  title={s.label}
                >
                  {s.short}
                </th>
              ))}
              <th className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2 w-[60px]">
                Hype
              </th>
              <th className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2 w-[60px]">
                Δ1d
              </th>
              <th className="text-right text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-3 py-2 w-[80px]">
                Book
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-border last:border-b-0 ${onSelect ? "cursor-pointer hover:bg-bg-elevated" : ""}`}
                onClick={() => onSelect?.(t)}
              >
                <td className="px-3 py-2 font-semibold text-text-primary">
                  <span className="flex items-center gap-2 min-w-0">
                    <ProvenanceDot source={provByTheme?.[t.id]?.data_source ?? null} size={7} />
                    <span className="truncate">{t.name}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-center text-text-tertiary text-[10.5px]">{tierBadge(t.tier)}</td>
                <td className="px-2 py-2 text-center whitespace-nowrap">
                  <EdgeDirectionChip
                    edge={edgeByTheme?.[t.id]}
                    abstainThreshold={abstainThreshold}
                  />
                </td>
                {SUBSCORES.map((s) => {
                  // Sub-scores persist as [0,1]; the ramp is 0–100.
                  const v = toDisplayScore(t[s.key]);
                  return (
                    <td
                      key={s.key}
                      className="px-1 py-1.5 text-center num font-semibold"
                      style={{
                        background: cellColor(v),
                        color: cellTextColor(v),
                      }}
                      title={
                        v === null
                          ? `${s.label}: not scored this run`
                          : `${s.label}: ${Math.round(v)}`
                      }
                    >
                      {v === null ? "—" : Math.round(v)}
                    </td>
                  );
                })}
                <td
                  className="px-2 py-2 text-center num font-semibold"
                  style={{
                    background: cellColor(t.hype_score ?? null),
                    color: cellTextColor(t.hype_score ?? null),
                  }}
                >
                  {t.hype_score !== undefined ? Math.round(t.hype_score) : "—"}
                </td>
                <td
                  className="px-2 py-2 text-center num text-[11px]"
                  style={{
                    color:
                      (t.delta_1d ?? 0) > 0
                        ? "var(--long)"
                        : (t.delta_1d ?? 0) < 0
                          ? "var(--short)"
                          : "var(--text-tertiary)",
                  }}
                >
                  {t.delta_1d !== undefined
                    ? `${t.delta_1d >= 0 ? "+" : ""}${t.delta_1d.toFixed(1)}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <PositionsLink
                    themeId={t.id}
                    held={isThemeAbstained(edgeByTheme?.[t.id], abstainThreshold)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border text-[11px] text-text-tertiary flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span>
          Click any row for the full score derivation. Sub-scores are min-max
          normalised across these {themes.length} themes on the run date and
          weighted per <code className="num">scoring_config</code> — see{" "}
          <a href="/method" className="text-accent hover:underline">
            Method
          </a>{" "}
          for the live weights and formula.
        </span>
        <span className="flex items-center gap-2 ml-auto">
          <span className="uppercase tracking-[0.08em]">Dot:</span>
          <span className="flex items-center gap-1">
            <ProvenanceDot source="real" size={7} /> real
          </span>
          <span className="flex items-center gap-1">
            <ProvenanceDot source="mixed" size={7} /> mixed
          </span>
          <span className="flex items-center gap-1">
            <ProvenanceDot source="mock" size={7} /> mock
          </span>
          {syntheticCount > 0 && (
            <span className="text-warning font-semibold">
              · {syntheticCount} synthetic
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
