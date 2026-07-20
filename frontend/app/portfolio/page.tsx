"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PortfolioTreemap from "@/components/PortfolioTreemap";

interface Position {
  id: string; theme: string; asset: string;
  direction: "long" | "short"; notional: number; weight: number;
  hype_score: number;
}
interface Risk {
  total_capital: number; var_95: number; cvar_95: number;
  sharpe: number; beta: number; concentration_hhi: number;
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("portfolio_positions").select("*").order("weight", { ascending: false }),
      supabase.from("portfolio_risk").select("*").limit(1).single(),
    ]).then(([posRes, riskRes]) => {
      setPositions(posRes.data ?? []);
      setRisk(riskRes.data ?? null);
    });
  }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <h1 className="text-2xl font-mono font-bold mb-6">$100M Portfolio</h1>

      {risk && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: "VaR (95%)", value: fmt(risk.var_95), color: "text-[#f85149]" },
            { label: "CVaR (95%)", value: fmt(risk.cvar_95), color: "text-[#f85149]" },
            { label: "Sharpe", value: risk.sharpe?.toFixed(2) ?? "—", color: "text-[#e6edf3]" },
            { label: "Beta", value: risk.beta?.toFixed(2) ?? "—", color: "text-[#58a6ff]" },
            { label: "HHI", value: risk.concentration_hhi?.toFixed(0) ?? "—", color: "text-[#d29922]" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <p className="text-xs text-[#8b949e] mb-1">{label}</p>
              <p className={`font-mono text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6">
        <PortfolioTreemap positions={positions} />
      </div>

      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-4">Positions</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8b949e] text-left text-xs">
              <th className="pb-2">Theme</th>
              <th className="pb-2">Asset</th>
              <th className="pb-2">Direction</th>
              <th className="pb-2 text-right">Notional</th>
              <th className="pb-2 text-right">Weight</th>
              <th className="pb-2 text-right">Hype</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="border-t border-[#30363d]">
                <td className="py-2">{p.theme}</td>
                <td className="font-mono py-2">{p.asset}</td>
                <td className={`py-2 ${p.direction === "long" ? "text-[#3fb950]" : "text-[#f85149]"}`}>
                  {p.direction.toUpperCase()}
                </td>
                <td className="text-right font-mono py-2">{fmt(p.notional)}</td>
                <td className="text-right font-mono py-2">{((p.weight ?? 0) * 100).toFixed(1)}%</td>
                <td className="text-right font-mono py-2 text-[#8b949e]">{Math.round(p.hype_score ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
