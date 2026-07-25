"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DisclosureChevron } from "@/components/DisclosureChevron";

// Surfaces the output of the L1 theme-DISCOVERY process (scripts/theme_discovery.py):
// candidate themes found by clustering the news corpus two independent ways — LDA
// topics and sentence-embedding (SBERT→UMAP→HDBSCAN) clusters — and keeping where
// they agree. This is the Q2 "systematically identify trending themes" step made
// visible: the 8 board themes are the curated anchors; this is what the engine
// proposes on its own. Candidates are SHADOW-mode — an operator promotes them, so
// nothing here silently enters the live book.

interface DiscoveredRow {
  run_date: string;
  label: string;
  terms: string[] | null;
  tier: number; // 2 = both methods agree, 3 = single method
  methods: string[] | null;
  corpus_size: number | null;
  status: string;
}

const METHOD_LABEL: Record<string, string> = {
  lda: "LDA",
  embedding: "Embeddings",
};

function TermChips({ terms }: { terms: string[] | null }) {
  if (!terms || terms.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {terms.slice(0, 8).map((t) => (
        <span
          key={t}
          className="num text-[10.5px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary"
        >
          {t}
        </span>
      ))}
    </span>
  );
}

export default function DiscoveredThemes() {
  const [rows, setRows] = useState<DiscoveredRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("discovered_themes")
      .select("run_date, label, terms, tier, methods, corpus_size, status")
      .order("run_date", { ascending: false })
      .limit(60)
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        // Scope to the most recent discovery run only.
        const latest = data?.[0]?.run_date ?? null;
        setRows((data ?? []).filter((r) => r.run_date === latest) as DiscoveredRow[]);
      });
  }, []);

  const tier2 = (rows ?? []).filter((r) => r.tier === 2);
  const tier3 = (rows ?? []).filter((r) => r.tier === 3);
  const runDate = rows?.[0]?.run_date ?? null;
  const corpus = rows?.[0]?.corpus_size ?? null;

  return (
    <div className="card">
      <div className="card-header flex-wrap gap-2">
        <div>
          <span className="card-title">Discovered themes</span>
          <span className="text-text-tertiary text-[11px] ml-2">
            LDA ∩ embedding agreement · shadow candidates, not yet promoted
          </span>
        </div>
        {runDate && (
          <span className="text-[11px] text-text-tertiary num">
            run {runDate}
            {corpus ? ` · ${corpus} headlines` : ""}
          </span>
        )}
      </div>

      <div className="p-4">
        {error ? (
          <div className="text-[12.5px] text-text-tertiary leading-[1.6]">
            Could not read <code className="num">discovered_themes</code>: {error}.
          </div>
        ) : rows === null ? (
          <div className="skeleton h-[80px]" />
        ) : rows.length === 0 ? (
          <div className="text-[12.5px] text-text-secondary leading-[1.6]">
            No discovery run has been recorded yet. The discovery job
            (<code className="num">scripts/theme_discovery.py</code>) clusters the
            accumulated <code className="num">theme_news</code> corpus two ways and
            writes candidates here; it runs at bootstrap and monthly, separate from
            the daily refresh.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Tier 2 — both methods agree. The confident candidates. */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] uppercase tracking-[0.1em] text-text-secondary font-semibold">
                  Both methods agree
                </span>
                <span className="badge badge-long">{tier2.length}</span>
                <span className="text-[11px] text-text-tertiary">
                  an LDA topic and an embedding cluster share ≥2 terms
                </span>
              </div>
              {tier2.length === 0 ? (
                <div className="text-[12px] text-text-tertiary">
                  No two-method agreement this run — the corpus did not produce a
                  topic and a cluster that overlap. Single-method candidates below.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tier2.map((r) => (
                    <div
                      key={r.label}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-border rounded-md px-3 py-2"
                    >
                      <span className="font-semibold text-text-primary text-[13px]">
                        {r.label}
                      </span>
                      <TermChips terms={r.terms} />
                      <span className="flex gap-1 ml-auto">
                        {(r.methods ?? []).map((m) => (
                          <span
                            key={m}
                            className="text-[10px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded bg-long-dim text-long"
                          >
                            {METHOD_LABEL[m] ?? m}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tier 3 — one method only. Weaker signal, shown compactly. */}
            {tier3.length > 0 && (
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-text-secondary font-semibold">
                    Single method
                  </span>
                  <span className="badge badge-neutral">{tier3.length}</span>
                  <span className="text-[11px] text-text-tertiary">
                    surfaced by one method only — lower confidence
                  </span>
                  {/* Was two spans swapping a `▸`/`▾` glyph. One span now, with the
                      shared caret — same group-open mechanics, one icon source. */}
                  <span className="text-text-tertiary text-[11px] ml-auto flex items-center gap-1">
                    <span className="group-open:hidden">Show</span>
                    <span className="hidden group-open:inline">Hide</span>
                    <DisclosureChevron className="text-text-tertiary" />
                  </span>
                </summary>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {tier3.map((r) => (
                    <div
                      key={r.label}
                      className="border border-border rounded-md px-2.5 py-1.5 flex items-center gap-2"
                      title={`${(r.methods ?? []).map((m) => METHOD_LABEL[m] ?? m).join(", ")} · ${(r.terms ?? []).join(", ")}`}
                    >
                      <span className="text-[12px] text-text-secondary">{r.label}</span>
                      <span className="text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
                        {(r.methods ?? []).map((m) => METHOD_LABEL[m] ?? m).join("/")}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="text-[11px] text-text-tertiary leading-[1.55] border-t border-border pt-2.5">
              Candidates are found by clustering the news corpus with two
              independent methods and keeping where they agree — see{" "}
              <a href="/method" className="text-accent hover:underline">
                Method
              </a>
              . They stay in <code className="num">shadow</code> status until an
              operator promotes one onto the live board; nothing here enters the
              book automatically.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
