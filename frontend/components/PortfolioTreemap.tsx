interface Position {
  id: string; theme: string; asset: string;
  direction: "long" | "short"; notional: number; weight: number;
  hype_score: number;
}

export default function PortfolioTreemap({ positions }: { positions: Position[] }) {
  if (!positions.length) {
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 h-48 flex items-center justify-center text-[#8b949e] text-sm">
        No positions available
      </div>
    );
  }

  // Simple CSS grid treemap
  const total = positions.reduce((s, p) => s + (p.weight ?? 0), 0);

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-3">Position Weights</h2>
      <div className="flex flex-wrap gap-1">
        {positions.map((p) => {
          const pct = ((p.weight ?? 0) * 100).toFixed(1);
          const color = p.direction === "long" ? "bg-[#3fb950]" : "bg-[#f85149]";
          return (
            <div
              key={p.id}
              className={`${color} rounded px-2 py-1 text-xs text-[#0d1117] font-mono font-bold`}
              style={{ opacity: 0.7 + ((p.weight ?? 0) / (total || 1)) * 0.3 }}
              title={`${p.asset} ${p.direction} ${pct}%`}
            >
              {p.asset} {pct}%
            </div>
          );
        })}
      </div>
    </div>
  );
}
