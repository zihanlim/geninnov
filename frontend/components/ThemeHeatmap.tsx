export interface HeatmapTheme {
  id: string;
  name: string;
  tier?: string;
  hype_score?: number;
  volume_score?: number;
  sentiment_score?: number;
  corr_score?: number;
  momentum_score?: number;
  delta_1d?: number;
}

interface Props<T extends HeatmapTheme> {
  themes: T[];
  onSelect?: (theme: T) => void;
}

// Diverging color: red (low) → gray (mid) → green (high) on a 0-100 scale
// Midpoint at 50; ±50 gives the saturation.
function cellColor(value: number | undefined): string {
  const v = value ?? 0;
  // Normalize around 50
  const t = Math.max(0, Math.min(100, v));
  const dev = (t - 50) / 50; // -1 .. +1
  if (dev >= 0) {
    // green: rgba(63, 185, 80, dev)
    const a = 0.15 + dev * 0.55;
    return `rgba(63, 185, 80, ${a.toFixed(2)})`;
  } else {
    const a = 0.15 + Math.abs(dev) * 0.55;
    return `rgba(248, 81, 73, ${a.toFixed(2)})`;
  }
}

function cellTextColor(value: number | undefined): string {
  const v = value ?? 0;
  return v >= 35 && v <= 65 ? "var(--text-secondary)" : "var(--text-primary)";
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

export default function ThemeHeatmap<T extends HeatmapTheme>({ themes, onSelect }: Props<T>) {
  if (themes.length === 0) {
    return (
      <div className="card p-8 text-center text-text-tertiary text-[13px]">
        No themes available for the heatmap. Run the daily pipeline to populate.
      </div>
    );
  }

  // Sort by hype_score desc
  const sorted = [...themes].sort((a, b) => (b.hype_score ?? 0) - (a.hype_score ?? 0));

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex-wrap gap-2">
        <div>
          <span className="card-title">Theme × Sub-score heatmap</span>
          <span className="text-text-tertiary text-[11px] ml-2">
            12 themes · 4 dimensions · red=low / green=high (0-100)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(248, 81, 73, 0.6)" }} />
            <span>&lt; 35</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(120, 130, 145, 0.2)" }} />
            <span>35-65</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(63, 185, 80, 0.6)" }} />
            <span>&gt; 65</span>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-3 py-2 w-[180px]">
                Theme
              </th>
              <th className="text-center text-[10.5px] uppercase tracking-[0.1em] text-text-tertiary font-semibold px-2 py-2 w-[40px]">
                Tier
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-border last:border-b-0 ${onSelect ? "cursor-pointer hover:bg-bg-elevated" : ""}`}
                onClick={() => onSelect?.(t)}
              >
                <td className="px-3 py-2 font-semibold text-text-primary">{t.name}</td>
                <td className="px-2 py-2 text-center text-text-tertiary text-[10.5px]">{tierBadge(t.tier)}</td>
                {SUBSCORES.map((s) => {
                  const v = t[s.key];
                  return (
                    <td
                      key={s.key}
                      className="px-1 py-1.5 text-center num font-semibold"
                      style={{
                        background: cellColor(v),
                        color: cellTextColor(v),
                      }}
                      title={`${s.label}: ${Math.round(v ?? 0)}`}
                    >
                      {v !== undefined ? Math.round(v) : "—"}
                    </td>
                  );
                })}
                <td
                  className="px-2 py-2 text-center num font-semibold"
                  style={{
                    background: cellColor(t.hype_score),
                    color: cellTextColor(t.hype_score),
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-border text-[11px] text-text-tertiary">
        Click any row to see the full score derivation. Sub-scores from{" "}
        <code className="num">scoring_config</code> (Volume 0.30, Sentiment 0.20, Correlation 0.30, Momentum 0.20).
      </div>
    </div>
  );
}
