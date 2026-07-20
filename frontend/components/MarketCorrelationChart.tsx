"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface SignalHistory { run_date: string; mention_count_1d: number; price_corr: number; }

export default function MarketCorrelationChart({ themeId }: { themeId: string }) {
  const [data, setData] = useState<SignalHistory[]>([]);

  useEffect(() => {
    if (!themeId) return;
    supabase
      .from("theme_signals_history")
      .select("run_date, mention_count_1d, price_corr")
      .eq("theme_id", themeId)
      .order("run_date", { ascending: true })
      .limit(30)
      .then(({ data: rows }) => setData(rows ?? []));
  }, [themeId]);

  if (!data.length) {
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 h-48 flex items-center justify-center text-[#8b949e] text-sm">
        No historical data available
      </div>
    );
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-3">
        Mentions vs Correlation
      </h2>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="run_date" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <YAxis yAxisId="mentions" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <YAxis yAxisId="corr" orientation="right" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}
            labelStyle={{ color: "#e6edf3" }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line yAxisId="mentions" type="monotone" dataKey="mention_count_1d" stroke="#58a6ff" strokeWidth={1.5} dot={false} name="Mentions" />
          <Line yAxisId="corr" type="monotone" dataKey="price_corr" stroke="#d29922" strokeWidth={1.5} dot={false} name="Corr" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}