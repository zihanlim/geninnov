interface WatchItem {
  name: string;
  score: number;
  delta: number;
}

export default function Watchlist({ items }: { items: WatchItem[] }) {
  const max = Math.max(80, ...items.map((i) => i.score));
  return (
    <div className="flex flex-col gap-3">
      {items.map((t) => {
        const up = t.delta >= 0;
        const color = up ? "var(--long)" : "var(--short)";
        return (
          <div
            key={t.name}
            className="grid items-center gap-2.5 text-[13px]"
            style={{ gridTemplateColumns: "140px 1fr 70px 60px" }}
          >
            <span className="text-text-primary font-medium truncate">{t.name}</span>
            <div className="h-2 bg-bg-elevated rounded overflow-hidden">
              <div
                className="h-full rounded transition-[width] duration-500"
                style={{ width: `${(t.score / max) * 100}%`, background: color }}
              />
            </div>
            <span className="num text-right text-text-secondary">{t.score.toFixed(1)}</span>
            <span className={`num text-right font-semibold`} style={{ color }}>
              {up ? "↑" : "↓"} {Math.abs(t.delta).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
