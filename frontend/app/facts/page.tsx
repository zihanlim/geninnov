"use client";

// frontend/app/facts/page.tsx
//
// /facts — every row the L5 reasoning agent cites, with provenance.
//
// A four-section table (ai_capex, china_ai, macro, valuation) that
// makes the system's "facts the L5 can cite" visible. The point is
// transparency: a reader of the L5 thesis on /research or /book can
// come here and see exactly which numbers the system can defend, with
// source and confidence. A fact NOT in this table is not citable;
// the L5 cites "the system has no data on X" rather than inventing.
//
// The data comes from `structured_facts` (m066, ADR-0218). The page
// is the read-side surface for the same layer the L5 reads from.

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { FreshnessLabel } from "@/components/status/FreshnessLabel";
import { QueryErrorState } from "@/components/status/EmptyState";

interface StructuredFact {
  id: number;
  entity: string;
  metric: string;
  value: number;
  unit: string;
  as_of: string;
  source: string;
  source_url: string | null;
  confidence: "high" | "medium" | "low";
  category: string;
  notes: string | null;
  created_at: string;
}

const CATEGORIES: { key: string; title: string; description: string }[] = [
  {
    key: "ai_capex",
    title: "AI Capex",
    description: "Hyperscaler capex, cloud growth, cash runways, depreciation cliff.",
  },
  {
    key: "china_ai",
    title: "China AI",
    description: "Chinese model releases, OpenRouter share, HBM and equipment milestones.",
  },
  {
    key: "macro",
    title: "Macro",
    description: "FOMC probabilities, equity risk premium, equity-bond correlation flag.",
  },
  {
    key: "valuation",
    title: "Valuation",
    description: "External research: MIT, Bain, JPM findings on AI revenue vs. capex.",
  },
  // The four below are AUTO-DERIVED (ADR-0222 Tier 1): re-shaped from tables the
  // pipeline already writes. Confidence is `medium` and source is
  // `auto-derived: <table>`. The hand-curated rows above are `high` and
  // `medium` from a human source; both tiers live in the same table and the
  // L5 cites them with the confidence attached.
  {
    key: "auto_macro",
    title: "Auto · Macro",
    description: "FRED yields, Fed Funds, VIX, S&P 500, NASDAQ 100, gold, oil, copper. Daily snapshot, auto-shaped from macro_indicators.",
  },
  {
    key: "auto_regime",
    title: "Auto · Regime",
    description: "Yield curve slope, HY OAS, VIX level, real rate, SPX breadth. From the regime_classifications row.",
  },
  {
    key: "auto_computable",
    title: "Auto · Computable Macro",
    description: "ERP, equity-bond correlation, NDX seasonality. From regime_classifications.computable_macro JSONB (ADR-0217).",
  },
  {
    key: "auto_themes",
    title: "Auto · Themes",
    description: "Per-theme hype, volume, sentiment, correlation, momentum. From the published themes run.",
  },
  // Auto-derived aggregates over the curated company-level rows
  // (sum/mean/min/max across the big-five hyperscalers, etc.). The
  // hand-curated `industry:hyperscaler:capex_2026_total_bn = 725` is
  // a JPM research view that ALSO includes smaller hyperscalers; the
  // auto-derived `*_sum` is the big-five slice. Both travel — the
  // L5 cites whichever scope the thesis asks for.
  {
    key: "auto_industry",
    title: "Auto · Industry",
    description: "Aggregates (sum/mean/min/max) over the curated company rows. E.g. top-5 hyperscaler capex sum.",
  },
  // Tier 2 (ADR-0222): LLM-extracted numeric claims from news
  // headlines. Confidence is `low` and the source is the article
  // name (theme_news.source). OFF by default; the LLM extraction
  // pass is gated by ANDROMEDA_NEWS_EXTRACTION=1 in the env. When
  // the pass is off, this section is empty — the L5 cites from
  // the other tiers.
  {
    key: "auto_news",
    title: "Auto · News",
    description: "Numeric claims LLM-extracted from recent news headlines. Low confidence; source is the article.",
  },
];

const CONFIDENCE_STYLES: Record<string, string> = {
  // The "Ledger" light theme (globals.css) — NOT the old dark-theme emerald/amber
  // /zinc builtins, which rendered pale text on pale tint and near-black on
  // zinc-800. These are the app's own AA-verified pairs: accent for emphasis
  // (high), warning for attention (medium), neutral outline for the weak tier.
  high: "bg-accent-dim text-accent",
  medium: "bg-warning-dim text-warning",
  low: "bg-bg-elevated text-text-secondary border border-border",
};

export default function FactsPage() {
  const [rows, setRows] = useState<StructuredFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("structured_facts")
      .select(
        "id, entity, metric, value, unit, as_of, source, source_url, " +
        "confidence, category, notes, created_at"
      )
      .order("as_of", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setLoading(false);
          return;
        }
        const arr = (data || []) as unknown as StructuredFact[];
        setRows(arr);
        setLoading(false);
        if (arr.length > 0 && arr[0].created_at) {
          setLastUpdated(arr[0].created_at);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byCategory = useMemo(() => {
    const m: Record<string, StructuredFact[]> = {};
    for (const r of rows) {
      (m[r.category] ||= []).push(r);
    }
    return m;
  }, [rows]);

  const totalByCategory = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        count: (byCategory[c.key] || []).length,
      })),
    [byCategory]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Structured Facts"
        lede="The numbers the L5 reasoning agent cites, with provenance. A fact not in this table is not citable — the L5 cites absence, not invention."
      />

      <div className="mt-2 mb-6">
        {lastUpdated && (
          <FreshnessLabel
            observed_age_seconds={Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(lastUpdated).getTime()) / 1000
              )
            )}
            observed_at={lastUpdated}
          />
        )}
        {!lastUpdated && !loading && (
          <span className="text-xs text-text-secondary">No facts loaded yet</span>
        )}
        {loading && (
          <span className="text-xs text-text-secondary">Loading…</span>
        )}
      </div>

      {error && (
        <QueryErrorState
          what="structured_facts"
          message={error}
        />
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-border bg-bg-surface p-6">
          <p className="m-0 font-medium text-text-primary">No facts loaded yet.</p>
          <p className="mt-2 m-0 text-[13px] text-text-secondary">
            The <code className="rounded bg-bg-elevated px-1 font-mono text-[12px] text-text-primary">structured_facts</code>{" "}
            table is empty. Run the loader against the seed JSON to populate it:
          </p>
          <pre className="mt-3 rounded bg-bg-surface p-3 text-[12px] font-mono text-text-secondary overflow-auto border border-border">
{`python -m backend.data.structured_facts_loader \\
    --path data/structured_facts_seed.json`}
          </pre>
        </div>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {totalByCategory.map((c) => (
          <div
            key={c.key}
            className="rounded-lg border border-border bg-bg-surface p-4"
          >
            <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-text-tertiary">
              {c.title}
            </div>
            <div className="mt-1 text-2xl font-semibold num text-text-primary">
              {c.count}
            </div>
            <div className="text-[11px] text-text-tertiary">rows</div>
            <div className="mt-3 text-[12px] text-text-secondary">{c.description}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-8">
        {CATEGORIES.map((c) => {
          const list = byCategory[c.key] || [];
          if (list.length === 0) return null;
          return (
            <section
              key={c.key}
              id={c.key}
              // `scroll-mt-20` leaves room for the sticky TopBar (h-14 = 56px)
              // when an anchor jump lands here, so the heading isn't hidden
              // underneath the bar.
              className="rounded-lg border border-border bg-bg-surface p-5 scroll-mt-20"
            >
              <h2 className="text-[16px] font-semibold text-text-primary m-0">
                {c.title}{" "}
                <span className="text-[13px] font-normal text-text-tertiary">
                  · {list.length} {list.length === 1 ? "row" : "rows"}
                </span>
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-text-tertiary">
                      <th className="py-2 pr-3 font-medium">Entity / Metric</th>
                      <th className="py-2 pr-3 font-medium">Value</th>
                      <th className="py-2 pr-3 font-medium">Unit</th>
                      <th className="py-2 pr-3 font-medium">As of</th>
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 pr-3 font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-border align-top"
                      >
                        <td className="py-2 pr-3 font-mono text-[12px] text-text-primary">
                          <div>{r.entity}</div>
                          <div className="text-text-tertiary">{r.metric}</div>
                          {r.notes && (
                            <div className="mt-1 text-text-tertiary font-sans normal-case text-[12px]">
                              {r.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono num text-text-primary">
                          {typeof r.value === "number"
                            ? r.value.toLocaleString()
                            : String(r.value)}
                        </td>
                        <td className="py-2 pr-3 text-text-secondary">{r.unit}</td>
                        <td className="py-2 pr-3 text-text-secondary">
                          {r.as_of?.slice(0, 10) || "—"}
                        </td>
                        <td className="py-2 pr-3 text-text-secondary">
                          {r.source_url ? (
                            <a
                              href={r.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-border hover:text-text-primary"
                            >
                              {r.source}
                            </a>
                          ) : (
                            r.source
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 text-[11px] ${
                              CONFIDENCE_STYLES[r.confidence] ||
                              CONFIDENCE_STYLES.medium
                            }`}
                          >
                            {r.confidence}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-10 rounded-lg border border-border bg-bg-surface p-5">
        <div className="font-medium text-text-primary">How to read this</div>
        <p className="mt-2 m-0 text-[13px] text-text-secondary">
          The L5 reasoning agent cites from this table as{" "}
          <code className="rounded bg-bg-elevated px-1 font-mono text-[12px] text-text-primary">
            [structured_facts:&lt;entity&gt;:&lt;metric&gt;]
          </code>
          . The cite is verified against the row in this table; a fabricated cite
          (one not in this table) is rejected by the guardrail. A fact that is
          not here is not citable — the L5 cites absence as absence, not as a
          guess.
        </p>
        <p className="mt-2 m-0 text-[13px] text-text-secondary">
          The <code className="rounded bg-bg-elevated px-1 font-mono text-[12px] text-text-primary">as_of</code> column is the date
          the fact is true as of, not the date the row was loaded; a quarterly
          update writes a new row rather than overwriting history, so the
          trajectory of one quantity is preserved.
        </p>
      </div>
    </div>
  );
}
