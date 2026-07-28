"use client";
// frontend/app/ask/page.tsx
//
// /ask — interrogate the published book.
//
// The page is a normal scrolling document, not a chat app shell. That is goal 7
// applied literally: `h-screen` with an inner scroller photographs well and
// breaks Ctrl+F, deep links and long transcripts. The conversation grows down
// the page and the page scrolls, like every other surface here.
//
// SINCE 2026-07-27 THIS IS NOT THE ONLY MOUNT. `Ask` in the TopBar opens the same
// console as a floating panel (`components/chat/AskDock.tsx`), so a question can
// be asked from wherever the reader already is. This route stays, and the panel
// links to it, for two reasons that are not sentiment: it is published in
// `llms.txt` as a documented entry point, and it is the only mount where a long
// transcript remains Ctrl+F-able and deep-linkable — which is the property the
// paragraph above is about. The conversation itself lives in `AskConsole` and is
// shared with the panel, never copied.
//
// What this page will NOT do, and why each refusal is deliberate:
//
//   • It does not stream. The citation guardrail cannot check a figure that is
//     already on screen.
//   • It does not persist history. Nothing here writes to the domain database,
//     which keeps goal 5 ("affordances match capability") true in the only sense
//     that matters — no control on this site edits the book.
//   • It does not answer from the model's own knowledge. Every answer is built
//     from tool reads, and when the tools come back empty the absences ARE the
//     answer.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AskConsole from "@/components/chat/AskConsole";

export default function AskPage() {
  // Lifted out of AskConsole only so the PAGE can lay itself out around an empty
  // vs. active transcript. The console still owns the turns; this is a count.
  const [turnCount, setTurnCount] = useState(0);
  const onTurnCountChange = useCallback((n: number) => setTurnCount(n), []);

  // The book the agent will read from, shown beside the composer so the empty
  // state grounds the question instead of facing a blank page — the "active
  // context" the reference agent UIs surface. Read-only; a failed read just
  // leaves the panel out (never a fabricated placeholder).
  const [runFacts, setRunFacts] = useState<{
    runDate: string | null;
    positions: number;
    longs: number;
    shorts: number;
    gross: number | null;
    net: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("research_recommendations")
      .select("run_date, picks, book_metrics")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled || !data?.[0]) return;
        const rec = data[0] as {
          run_date: string | null;
          picks: unknown;
          book_metrics: unknown;
        };
        const picks = (
          typeof rec.picks === "string" ? JSON.parse(rec.picks) : rec.picks
        ) as Array<{ direction?: string }> | null;
        const bm = (
          typeof rec.book_metrics === "string"
            ? JSON.parse(rec.book_metrics)
            : rec.book_metrics
        ) as { gross_exposure?: number; net_exposure?: number } | null;
        setRunFacts({
          runDate: rec.run_date,
          positions: picks?.length ?? 0,
          longs: picks?.filter((p) => p.direction === "long").length ?? 0,
          shorts: picks?.filter((p) => p.direction === "short").length ?? 0,
          gross: typeof bm?.gross_exposure === "number" ? bm.gross_exposure : null,
          net: typeof bm?.net_exposure === "number" ? bm.net_exposure : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Empty state is a centred "ask console": header + prompts + input sit in the
  // middle of the viewport rather than clinging to the top over a half-page void
  // (the sparseness the page read as before). The moment a question is asked the
  // layout reverts to a top-aligned scrolling document, because a growing
  // transcript is goal 7 — it must scroll the page, deep-link and Ctrl+F.
  const empty = turnCount === 0;

  return (
    <main
      className={`mx-auto px-4 sm:px-6 wide:px-10 pb-16 ${
        empty
          ? "max-w-[1080px] flex min-h-[calc(100vh-9rem)] flex-col justify-center"
          : "max-w-[880px] py-8"
      }`}
    >
      <div
        className={
          empty
            ? "grid items-start gap-x-12 gap-y-10 wide:grid-cols-[minmax(0,1fr)_236px]"
            : ""
        }
      >
        <div className="min-w-0">
          <header className="mb-6">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary m-0">
              Ask the book
            </h1>
            <p className="mt-2 mb-0 text-[13px] leading-[1.65] text-text-secondary max-w-[62ch]">
              Questions are answered from the published run only — the same rows{" "}
              <Link href="/book" className="text-accent hover:underline">/book</Link>,{" "}
              <Link href="/risk" className="text-accent hover:underline">/risk</Link> and{" "}
              <Link href="/method" className="text-accent hover:underline">/method</Link> render. The
              agent fetches values and explains them; it never calculates one, and every figure it
              writes is checked against what it fetched before you see it.
            </p>
          </header>

          <AskConsole onTurnCountChange={onTurnCountChange} />
        </div>

        {empty && (
          <aside className="wide:pt-1">
            <div className="rounded-lg border border-border bg-bg-surface p-4">
              <p className="m-0 mb-3 text-[10px] uppercase tracking-[0.13em] font-semibold text-text-tertiary">
                What it reads
              </p>
              {runFacts ? (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                  <dt className="text-text-tertiary">Run</dt>
                  <dd className="num m-0 text-right text-text-primary">
                    {runFacts.runDate ?? "—"}
                  </dd>
                  <dt className="text-text-tertiary">Book</dt>
                  <dd className="num m-0 text-right text-text-primary">
                    {runFacts.longs}L / {runFacts.shorts}S
                  </dd>
                  <dt className="text-text-tertiary">Gross</dt>
                  <dd className="num m-0 text-right text-text-primary">
                    {runFacts.gross != null ? `${(runFacts.gross * 100).toFixed(1)}%` : "—"}
                  </dd>
                  <dt className="text-text-tertiary">Net</dt>
                  <dd className="num m-0 text-right text-text-primary">
                    {runFacts.net != null ? `${(runFacts.net * 100).toFixed(1)}%` : "—"}
                  </dd>
                </dl>
              ) : (
                <div className="skeleton h-[76px] rounded" />
              )}
              <p className="m-0 mt-3.5 pt-3 border-t border-border text-[11px] leading-[1.55] text-text-tertiary">
                Every answer is built from these rows — the agent fetches each value
                and never invents one.
              </p>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
