"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Market {
  slug: string;
  event_title: string;
  category: string;
  top_outcome: string;
  top_price: number;
  outcomes: string[];
  prices: number[];
  volume: number;
  end_date: string | null;
  url: string | null;
  fetched_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Fed: "var(--accent)",
  Rates: "var(--accent)",
  Inflation: "var(--warning)",
  Recession: "var(--short)",
  Oil: "var(--warning)",
  // Bitcoin orange darkened from the brand #f7931a, which renders at 2.20:1 on the
  // elevated surface — these are 9.5px uppercase labels, so it was the least legible
  // text on the site. #a85c08 is 4.80:1 and still unmistakably Bitcoin orange. Every
  // other entry here is a token, so the AA pass over globals.css/tailwind.config.ts
  // fixed those and silently missed this one: a hardcoded hex is invisible to a
  // token sweep.
  Bitcoin: "#a85c08",
  Crypto: "#a85c08",
  Equities: "var(--long)",
  Geopolitics: "var(--short)",
  Tariffs: "var(--warning)",
  Other: "var(--text-tertiary)",
};

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtEndDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const now = new Date();
  const days = Math.ceil((dt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const dateStr = d.slice(5); // MM-DD
  if (days < 0) return `${dateStr} (resolved)`;
  if (days === 0) return `${dateStr} (today)`;
  if (days < 30) return `${dateStr} (${days}d)`;
  return dateStr;
}

export default function PredictionMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("prediction_markets")
      .select("*")
      .order("volume", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setMarkets(data as Market[]);
        }
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="card p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary font-semibold mb-3">
          Prediction markets · Polymarket
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (markets.length === 0) {
    return null;
  }

  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary font-semibold">
            Prediction markets
          </div>
          <div className="text-[12px] text-text-tertiary mt-0.5">
            {markets.length} macro events · cited as evidence on the Q1 book
          </div>
        </div>
        <a
          href="https://polymarket.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-text-tertiary hover:text-accent"
        >
          Source: Polymarket ↗
        </a>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {markets.map((m) => {
          const catColor = CATEGORY_COLORS[m.category] ?? CATEGORY_COLORS.Other;
          const isBinary = m.outcomes.length === 2;
          return (
            <a
              key={m.slug}
              href={m.url ?? "https://polymarket.com"}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md border border-border bg-bg-elevated hover:border-border-strong transition-colors p-3 group"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span
                  className="text-[9.5px] uppercase tracking-[0.1em] font-semibold"
                  style={{ color: catColor }}
                >
                  {m.category}
                </span>
                <div className="flex items-center gap-2 text-[10px] text-text-tertiary num">
                  <span title="Trading volume">{fmtVol(m.volume)}</span>
                  <span>·</span>
                  <span>{fmtEndDate(m.end_date)}</span>
                </div>
              </div>
              <div className="text-[12.5px] font-semibold text-text-primary leading-tight mb-2 line-clamp-2 group-hover:text-accent">
                {m.event_title}
              </div>
              {/* Stacked probability bar */}
              <div className="flex h-2 rounded-sm overflow-hidden mb-2 border border-border">
                {m.prices.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      width: `${p * 100}%`,
                      background: i === 0 ? "var(--long)" : i === 1 ? "var(--short)" : "var(--text-tertiary)",
                    }}
                    title={`${m.outcomes[i]}: ${(p * 100).toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {m.outcomes.map((o, i) => {
                  const p = m.prices[i];
                  return (
                    <div key={i} className="flex items-center gap-1 text-[11px]">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{
                          background:
                            i === 0 ? "var(--long)" : i === 1 ? "var(--short)" : "var(--text-tertiary)",
                        }}
                      />
                      <span className="text-text-secondary truncate max-w-[140px]" title={o}>
                        {o}
                      </span>
                      <span
                        className="num font-semibold"
                        style={{
                          color: p >= 0.5 ? "var(--long)" : p >= 0.2 ? "var(--text-primary)" : "var(--text-tertiary)",
                        }}
                      >
                        {(p * 100).toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
