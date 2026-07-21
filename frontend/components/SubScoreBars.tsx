interface SubScoreBarsProps {
  volume?: number;
  sentiment?: number;
  correlation?: number;
  momentum?: number;
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

export default function SubScoreBars({ volume, sentiment, correlation, momentum }: SubScoreBarsProps) {
  const rows: { key: keyof typeof LABELS; value: number }[] = [
    { key: "volume", value: volume ?? 0 },
    { key: "sentiment", value: sentiment ?? 0 },
    { key: "correlation", value: correlation ?? 0 },
    { key: "momentum", value: momentum ?? 0 },
  ];
  return (
    <div className="flex flex-col gap-1.5 mt-2.5">
      {rows.map(({ key, value }) => (
        <div key={key} className="grid grid-cols-[60px_1fr_28px] items-center gap-2 text-[11px]">
          <span className="text-text-tertiary">{LABELS[key]}</span>
          <div className="h-1 bg-border rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, value))}%`,
                background: COLORS[key],
              }}
            />
          </div>
          <span className="num text-right text-text-secondary">{Math.round(value)}</span>
        </div>
      ))}
    </div>
  );
}
