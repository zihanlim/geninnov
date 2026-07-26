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

import { useRef, useState } from "react";
import Link from "next/link";
import ReasoningStep from "@/components/chat/ReasoningStep";
import VerifiedProse from "@/components/chat/VerifiedProse";
import { EmptyState } from "@/components/status/EmptyState";
import type { AgentAnswer } from "@/lib/chat/types";

interface Turn {
  question: string;
  /** null while in flight. */
  answer: (AgentAnswer & { remaining?: number | null }) | null;
  /** Transport-level failure, as opposed to an agent that answered with an error. */
  transportError?: string;
}

// Written as questions a sceptic would actually ask, not as feature demos. Each
// one is answerable entirely from persisted columns — a suggestion the agent
// then has to refuse would be a worse first impression than no suggestions.
const SUGGESTIONS = [
  "Why is the largest position sized the way it is?",
  "What macro regime is this book positioned for, and on what inputs?",
  "Which stress scenario hurts this book most?",
  "How much did the book turn over since the previous run?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setQuestion("");
    const index = turns.length;
    setTurns((prev) => [...prev, { question: trimmed, answer: null }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      setTurns((prev) =>
        prev.map((t, i) =>
          i === index
            ? res.ok
              ? { ...t, answer: data }
              : { ...t, transportError: data?.error ?? `Request failed (${res.status}).` }
            : t,
        ),
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((t, i) =>
          i === index
            ? { ...t, transportError: `The request did not complete: ${err instanceof Error ? err.message : String(err)}` }
            : t,
        ),
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <main className="mx-auto max-w-[880px] px-4 sm:px-6 wide:px-10 py-8 pb-16">
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

      {turns.length === 0 && (
        <ul className="list-none p-0 m-0 mb-8 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => ask(s)}
                className="w-full text-left px-3 py-2.5 rounded-md border border-border bg-bg-surface text-[12.5px] leading-[1.5] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ol className="list-none p-0 m-0 space-y-8">
        {turns.map((turn, i) => (
          <li key={i}>
            <p className="m-0 mb-3 text-[14px] font-semibold text-text-primary leading-[1.5]">
              {turn.question}
            </p>

            {turn.transportError && (
              <EmptyState
                title="The question could not be answered"
                cause={turn.transportError}
                severity="warning"
                compact
              />
            )}

            {!turn.answer && !turn.transportError && (
              <p className="m-0 text-[12.5px] text-text-tertiary" role="status">
                Reading the published run…
              </p>
            )}

            {turn.answer && (
              <div>
                {turn.answer.steps.length > 0 && (
                  <section className="mb-4">
                    <h2 className="text-[10.5px] uppercase tracking-[0.12em] text-text-tertiary font-semibold mb-2">
                      What it read
                    </h2>
                    <div className="space-y-1.5">
                      {turn.answer.steps.map((step, si) => (
                        <ReasoningStep key={si} step={step} index={si} />
                      ))}
                    </div>
                  </section>
                )}

                {turn.answer.error ? (
                  <EmptyState
                    title="No sourced answer"
                    cause={turn.answer.error}
                    remedy="The underlying figures are all on /book, /risk and /method, which need no agent to read."
                    severity="warning"
                    compact
                  />
                ) : (
                  <>
                    <VerifiedProse answer={turn.answer.answer} verdicts={turn.answer.verdicts ?? []} />

                    <footer className="mt-3 pt-2.5 border-t border-border text-[11px] text-text-tertiary flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        Run <span className="num">{turn.answer.runDate ?? "—"}</span>
                      </span>
                      <span>
                        <span className="num">{turn.answer.citations.length}</span> figure
                        {turn.answer.citations.length === 1 ? "" : "s"} traced to a source
                      </span>
                      {turn.answer.unverified.length > 0 && (
                        <span style={{ color: "var(--warning)" }}>
                          <span className="num">{turn.answer.unverified.length}</span> untraceable:{" "}
                          <span className="num">{turn.answer.unverified.join(", ")}</span> — marked
                          in the text and not sourced from the book
                        </span>
                      )}
                    </footer>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Ask a question about the published book
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          rows={2}
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention for a
            // composer where most inputs are one sentence.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          placeholder="Ask about a position, the regime, the risk numbers, or why something is not in the book."
          className="w-full resize-y rounded-md border border-border bg-bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-tertiary">
            {/* The cost of a question is disclosed rather than discovered: this
                shares an LLM quota with the nightly book, and a reader who knows
                that spends it more carefully than one who does not. */}
            Answers take a few seconds — two model calls per question, on the quota the nightly book
            uses.
          </span>
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="shrink-0 px-3.5 py-2 rounded-md border border-border bg-bg-elevated text-[12.5px] font-medium text-text-primary hover:bg-bg-hover disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "Reading…" : "Ask"}
          </button>
        </div>
      </form>
    </main>
  );
}
