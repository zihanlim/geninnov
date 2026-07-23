interface SubScoreBarsProps {
  /**
   * All four values are on the 0–100 DISPLAY scale.
   *
   * `themes.*_score` columns persist [0,1] decimals while `hype_score` persists
   * 0–100. Passing the raw column straight in rendered a 0.5 sub-score as a
   * 0.5%-wide bar labelled "1". Callers must convert with `toDisplayScore`
   * from `@/lib/themeSignals`.
   *
   * `null`/`undefined` renders as an explicit "—" rather than a zero bar, so a
   * missing sub-score is never mistaken for a genuinely zero one.
   */
  volume?: number | null;
  sentiment?: number | null;
  correlation?: number | null;
  momentum?: number | null;
}

const COLORS = {
  volume: "var(--accent)",
  sentiment: "var(--long)",
  correlation: "var(--warning)",
  momentum: "var(--short)",
};

const LABELS = {
  volume: "Volume",
  sentiment: "Sent.",
  correlation: "Corr",
  momentum: "Mom.",
};

export default function SubScoreBars({
  volume,
  sentiment,
  correlation,
  momentum,
}: SubScoreBarsProps) {
  const rows: { key: keyof typeof LABELS; value: number | null }[] = [
    { key: "volume", value: volume ?? null },
    { key: "sentiment", value: sentiment ?? null },
    { key: "correlation", value: correlation ?? null },
    { key: "momentum", value: momentum ?? null },
  ];
  return (
    <div className="flex flex-col gap-1.5 mt-2.5">
      {rows.map(({ key, value }) => (
        <div
          key={key}
          className="grid grid-cols-[60px_1fr_28px] items-center gap-2 text-[11px]"
        >
          <span className="text-text-tertiary">{LABELS[key]}</span>
          <div className="h-1 bg-border rounded-sm overflow-hidden">
            {value !== null && (
              <div
                className="h-full rounded-sm transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.max(0, Math.min(100, value))}%`,
                  background: COLORS[key],
                }}
              />
            )}
          </div>
          <span className="num text-right text-text-secondary">
            {value === null ? "—" : Math.round(value)}
          </span>
        </div>
      ))}
    </div>
  );
}
