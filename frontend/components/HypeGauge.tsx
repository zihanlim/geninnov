interface Theme {
  name: string; hype_score: number; volume_score: number;
  sentiment_score: number; corr_score: number; momentum_score: number;
}

function GaugeBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#8b949e] w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[#30363d] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs w-8 text-right text-[#8b949e]">{Math.round(value * 100)}</span>
    </div>
  );
}

export default function HypeGauge({ theme }: { theme: Theme }) {
  const scoreColor = theme.hype_score >= 50
    ? "text-[#58a6ff]"
    : theme.hype_score >= 30
    ? "text-[#d29922]"
    : "text-[#f85149]";

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium">{theme.name}</h2>
        <div className={`font-mono text-2xl font-bold ${scoreColor}`}>
          {Math.round(theme.hype_score ?? 0)}
        </div>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">Hype Score breakdown</p>
      <div className="space-y-3">
        <GaugeBar label="Volume" value={theme.volume_score ?? 0} color="bg-[#58a6ff]" />
        <GaugeBar label="Sentiment" value={theme.sentiment_score ?? 0} color="bg-[#3fb950]" />
        <GaugeBar label="Correlation" value={theme.corr_score ?? 0} color="bg-[#d29922]" />
        <GaugeBar label="Momentum" value={theme.momentum_score ?? 0} color="bg-[#f85149]" />
      </div>
    </div>
  );
}