interface Theme { id: string; name: string; tier: string; hype_score: number; }
interface Props { themes: Theme[]; selected: Theme | null; onSelect: (t: Theme) => void; }

export default function ThemeFeed({ themes, selected, onSelect }: Props) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-4">Trending Themes</h2>
      <div className="space-y-2">
        {themes.map((theme) => {
          const isSelected = selected?.id === theme.id;
          const barWidth = Math.round(theme.hype_score ?? 0);
          return (
            <button
              key={theme.id}
              onClick={() => onSelect(theme)}
              className={`w-full text-left px-3 py-2 rounded transition-all duration-200 ${
                isSelected ? "bg-[#30363d]" : "hover:bg-[#1c2128]"
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">
                  {theme.name}
                  {theme.tier === "anchor" && <span className="ml-2 text-xs text-[#58a6ff]">anchor</span>}
                  {theme.tier === "discovered" && <span className="ml-2 text-xs text-[#3fb950]">discovered</span>}
                  {theme.tier === "review" && <span className="ml-2 text-xs text-[#d29922]">review</span>}
                </span>
                <span className="font-mono text-sm text-[#8b949e]">{barWidth}</span>
              </div>
              <div className="h-1 bg-[#30363d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#58a6ff] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}