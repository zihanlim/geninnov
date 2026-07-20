"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface TradeCandidate {
  id: string; theme_id: string; asset: string;
  direction: "long" | "short"; trade_score: number; hype_score: number;
  themes: { name: string };
}

export default function TradeIdeasTable() {
  const [longs, setLongs] = useState<TradeCandidate[]>([]);
  const [shorts, setShorts] = useState<TradeCandidate[]>([]);

  useEffect(() => {
    supabase
      .from("trade_candidates")
      .select("*, themes(name)")
      .order("trade_score", { ascending: false })
      .then(({ data }) => {
        const all = data ?? [];
        setLongs(all.filter((t: TradeCandidate) => t.direction === "long").slice(0, 5));
        setShorts(all.filter((t: TradeCandidate) => t.direction === "short").slice(0, 5));
      });
  }, []);

  const renderTable = (candidates: TradeCandidate[], direction: "long" | "short") => {
    const color = direction === "long" ? "text-[#3fb950]" : "text-[#f85149]";
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex-1">
        <h2 className={`text-sm font-mono uppercase tracking-widest mb-4 ${color}`}>
          {direction === "long" ? "▲ Long" : "▼ Short"}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8b949e] text-left text-xs">
              <th className="pb-2">Theme</th>
              <th className="pb-2">Asset</th>
              <th className="pb-2 text-right">Hype</th>
              <th className="pb-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-t border-[#30363d]">
                <td className="py-2">{c.themes?.name ?? "—"}</td>
                <td className="font-mono py-2">{c.asset}</td>
                <td className="text-right font-mono py-2 text-[#8b949e]">{Math.round(c.hype_score ?? 0)}</td>
                <td className={`text-right font-mono py-2 font-bold ${color}`}>
                  {c.trade_score?.toFixed(2) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex gap-6 flex-wrap">
      {renderTable(longs, "long")}
      {renderTable(shorts, "short")}
    </div>
  );
}
