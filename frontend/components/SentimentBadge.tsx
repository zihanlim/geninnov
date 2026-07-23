interface Props {
  sentiment?: string | null;
  cycle?: string | null;
  size?: "sm" | "md";
}

const SENTIMENT_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  "risk-on": { label: "Upbeat", color: "#147a5c", bg: "rgba(20, 122, 92,0.12)" },
  "risk-off": { label: "Risk-off", color: "#9f172a", bg: "rgba(159, 23, 42,0.12)" },
};

const CYCLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  early: { label: "Early Cycle", color: "#e11048", bg: "rgba(225, 16, 72,0.12)" },
  mid: { label: "Mid Cycle", color: "#e11048", bg: "rgba(225, 16, 72,0.12)" },
  late: { label: "Late Cycle", color: "#e3b341", bg: "rgba(227,179,65,0.12)" },
  recession: { label: "Recession", color: "#9f172a", bg: "rgba(159, 23, 42,0.12)" },
};

function sentimentStyle(s?: string | null) {
  if (!s) return SENTIMENT_CONFIG["risk-off"];
  return SENTIMENT_CONFIG[s.toLowerCase()] ?? {
    label: "Uncertain",
    color: "var(--text-secondary)",
    bg: "rgba(120,130,145,0.12)",
  };
}

function cycleStyle(c?: string | null) {
  if (!c) return CYCLE_CONFIG["mid"];
  return CYCLE_CONFIG[c.toLowerCase()] ?? {
    label: c,
    color: "var(--text-secondary)",
    bg: "rgba(120,130,145,0.12)",
  };
}

export default function SentimentBadge({ sentiment, cycle, size = "md" }: Props) {
  const sent = sentimentStyle(sentiment);
  const cyc = cycleStyle(cycle);
  const isSm = size === "sm";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.1em] ${isSm ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}
        style={{ color: sent.color, background: sent.bg }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: sent.color }}
        />
        {sent.label} Sentiment
      </span>
      <span
        className={`inline-flex items-center rounded-full font-semibold uppercase tracking-[0.1em] ${isSm ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}
        style={{ color: cyc.color, background: cyc.bg }}
      >
        {cyc.label}
      </span>
    </div>
  );
}
