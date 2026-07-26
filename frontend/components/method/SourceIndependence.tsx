"use client";
import { useEffect, useState } from "react";
import {
  fetchSourceIndependence,
  independenceSentence,
  type SourceIndependence as SI,
} from "@/lib/themeProvenance";

// How many independent providers the attention signal rests on (ADR-0094).
//
// Shipped because of what the number turned out to be: `theme_news` held 1,005 rows on
// 2026-07-26 and every one carried `source = 'brave'`. Reddit is fetched by the pipeline
// and tagged, but `REDDIT_CLIENT_ID` is not a repo secret, so `reddit_client` returns []
// rather than fabricating posts. HypeScore's attention, volume and sentiment therefore all
// rest on ONE provider — while the page said "Brave News + Reddit".
//
// A corroboration gate ("promote a theme only when N independent source types agree") is
// what the worldmonitor review suggested and is NOT implementable at one source: it would
// either always pass or never pass. Disclosing the count is what is true and useful.

export default function SourceIndependence() {
  const [si, setSi] = useState<SI | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSourceIndependence().then((r) => {
      if (r.error) setError(r.error);
      else setSi(r.independence);
    });
  }, []);

  const single = si?.independentSources === 1;

  return (
    <div className="card mt-3" id="source-independence">
      <div className="card-header flex-wrap gap-2">
        <span className="card-title">Provider independence</span>
        <span className="text-[11px] text-text-tertiary num">
          {si ? `${si.independentSources} of ${si.contributing.length + si.absent.length} contributing` : ""}
        </span>
      </div>

      {si === null && !error ? (
        <div className="px-4 py-4">
          <div className="skeleton h-[18px]" />
        </div>
      ) : error ? (
        <p className="m-0 px-4 py-4 text-[12.5px] text-text-tertiary leading-[1.6]">
          Could not read <code className="num">theme_news.source</code>: {error}. The number
          of independent providers behind these scores is therefore unknown — not one, and
          not many.
        </p>
      ) : (
        <>
          <p className="m-0 px-4 pt-3.5 text-[12.5px] leading-[1.6] max-w-[82ch]">
            {single && (
              <span className="font-semibold" style={{ color: "var(--warning)" }}>
                Single-sourced.{" "}
              </span>
            )}
            <span className="text-text-secondary">{independenceSentence(si!)}</span>
          </p>
          <div className="px-4 pb-3.5 pt-2">
            <table className="w-full border-collapse text-[12px]">
              <caption className="sr-only">
                Providers the pipeline fetches, and how many attention items each supplied.
              </caption>
              <tbody>
                {si!.contributing.map((c) => (
                  <tr key={c.source}>
                    <td className="py-1 num text-text-primary">{c.source}</td>
                    <td className="py-1 num text-right text-text-secondary">{c.items}</td>
                    <td className="py-1 pl-3 text-text-tertiary text-[11.5px]">
                      {si!.topSourceShare !== null && c === si!.contributing[0]
                        ? `${Math.round(si!.topSourceShare * 100)}% of the corpus`
                        : ""}
                    </td>
                  </tr>
                ))}
                {si!.absent.map((s) => (
                  <tr key={s}>
                    <td className="py-1 num text-text-tertiary">{s}</td>
                    {/* An em dash, not 0: the provider is fetched, so "contributed nothing"
                        and "supplied zero of a corpus it was part of" are different claims. */}
                    <td className="py-1 num text-right text-text-tertiary">—</td>
                    <td className="py-1 pl-3 text-text-tertiary text-[11.5px]">
                      fetched by the pipeline, contributed nothing
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 px-4 py-3 border-t border-border text-[11px] text-text-tertiary leading-[1.6] max-w-[90ch]">
            A corroboration gate — promote a theme only once several independent providers
            agree — is not implementable at one provider: it would either always pass or
            never pass. The count is disclosed instead. Source:{" "}
            <code className="num">theme_news.source</code>.
          </p>
        </>
      )}
    </div>
  );
}
