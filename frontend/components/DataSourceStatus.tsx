"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function DataSourceStatus() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("themes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastUpdated(data[0].updated_at);
      });
  }, []);

  return (
    <div className="text-right">
      {lastUpdated ? (
        <p className="text-xs text-[#3fb950]">● Live</p>
      ) : (
        <p className="text-xs text-[#f85149]">○ No data</p>
      )}
    </div>
  );
}