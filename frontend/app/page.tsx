"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ThemeFeed from "@/components/ThemeFeed";
import HypeGauge from "@/components/HypeGauge";
import MarketCorrelationChart from "@/components/MarketCorrelationChart";
import DataSourceStatus from "@/components/DataSourceStatus";

interface Theme {
  id: string; name: string; tier: string;
  hype_score: number; volume_score: number; sentiment_score: number;
  corr_score: number; momentum_score: number; updated_at: string;
}

export default function ThemeDashboard() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selected, setSelected] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("themes")
      .select("*")
      .order("hype_score", { ascending: false })
      .then(({ data }) => {
        setThemes(data ?? []);
        if (data?.length) setSelected(data[0]);
        setLoading(false);
      });
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight">ANDROMEDA</h1>
          <p className="text-[#8b949e] text-sm mt-1">Market Theme Identification Platform</p>
        </div>
        <DataSourceStatus />
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-[#8b949e]">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ThemeFeed themes={themes} selected={selected} onSelect={setSelected} />
            {selected && <HypeGauge theme={selected} />}
          </div>
          {selected && (
            <div className="mt-6">
              <MarketCorrelationChart themeId={selected.id} key={selected.id} />
            </div>
          )}
        </>
      )}
    </main>
  );
}