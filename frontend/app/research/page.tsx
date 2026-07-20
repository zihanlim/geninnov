"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ResearchSection {
  id: string; section: string; content: string;
}

export default function ResearchPage() {
  const [sections, setSections] = useState<ResearchSection[]>([]);

  useEffect(() => {
    supabase
      .from("research_output")
      .select("*")
      .order("section")
      .then(({ data }) => setSections(data ?? []));
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6 max-w-4xl">
      <h1 className="text-2xl font-mono font-bold mb-6">Research: Top 5 Long / Short</h1>
      <div className="space-y-6">
        {sections.map((s) => (
          <div key={s.id} className="bg-[#161b22] border border-[#30363d] rounded-lg p-6">
            <h2 className="text-sm font-mono text-[#58a6ff] uppercase tracking-widest mb-3">{s.section}</h2>
            <div className="text-sm leading-relaxed text-[#c9d1d9]">
              {s.content.split("\n").map((para, i) => (
                <p key={i} className="mb-3">{para}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
