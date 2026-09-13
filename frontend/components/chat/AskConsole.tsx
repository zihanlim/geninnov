"use client";
// frontend/components/chat/AskConsole.tsx
//
// The /ask conversation itself — suggestions, transcript, composer — extracted
// from `app/ask/page.tsx` so the TopBar popup and the full page run ONE
// implementation rather than two.
//
// WHY EXTRACTED RATHER THAN COPIED. The refusals in the page's docstring are
// behavioural, not cosmetic: no streaming (the citation guardrail cannot check a
// figure already on screen), no persistence, no answers from the model's own
// knowledge. A second copy of this composer would be a second place for those to
// be quietly relaxed, on the one surface in the product where an unchecked
// figure is the whole risk. `lib/chat/tools.ts` makes the same argument about
// importing the pages' own functions instead of copying them.
//
// `compact` is the ONLY difference between the two mounts, and it is presentation
// only — spacing, suggestion layout, and who supplies the heading. It changes
// nothing about what is asked, what is fetched, or what is rendered back.

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_LENS, isLens } from "@/lib/book/lensView";
import ReasoningStep from "@/components/chat/ReasoningStep";
import VerifiedProse from "@/components/chat/VerifiedProse";
import { EmptyState } from "@/components/status/EmptyState";
import { describeRemaining } from "@/lib/chat/quota";
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

/**
 * "Ask answers about the multi-asset book" — shown only when the page behind it is
 * showing a different one.
 *
 * `lib/chat/tools.ts` reads `research_recommendations` at a hardcoded
 * `lens: "multi_asset"` (ADR-0194: the credit book has no track record and is not
 * part of the falsifiable set), and `AskDock` puts this console in the TopBar of
 * EVERY page. So on `/book?lens=credit` a reader could take Ask's own suggested
 * question — "Why is the largest position sized the way it is?" — and get an
 * answer about a book with different positions, in a window floating over the one
 * they were reading. The tool does expose `book.lens` as a citable field, so an
 * answer CAN name the lens; nothing makes it, and a reader should not have to
 * notice its absence.
 *
 * Not a fix to the pin, which is deliberate. A fix to the silence around it.
 */
function BookScopeNote() {
  const lensParam = useSearchParams().get("lens");
  const otherBook =
    isLens(lensParam) && lensParam !== DEFAULT_LENS ? lensParam : null;
  if (!otherBook) return null;
  return (
    <p
      role="note"
      className="m-0 mb-4 text-[11.5px] leading-[1.6] text-text-tertiary"
      data-testid="ask-book-scope"
    >
      You are viewing the <strong>{otherBook}</strong> book, but Ask answers from the{" "}
      <strong>multi-asset</strong> book — the only one it reads (ADR-0194). Positions,
      exposures and risk figures in the answers below are that book&rsquo;s, not the
      one on the page behind this.
    </p>
  );
}

export default function AskConsole({
  compact = false,
  onTurnCountChange,
  autoFocus = false,
}: {
  /** Popup mount: tighter spacing, single-column suggestions, no page heading. */
  compact?: boolean;
  /** Lets the page lay itself out around an empty vs. active transcript. */
  onTurnCountChange?: (n: number) => void;
  autoFocus?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The LAST answered turn, not the last turn: an in-flight turn has `answer: null`, and a
  // transport failure never reached the guard, so neither carries a reading. Taking either
  // would blank a balance the reader was just shown.
  const lastAnswered = [...turns].reverse().find((t) => t.answer);
  const quotaNote = describeRemaining(lastAnswered?.answer?.remaining, Boolean(lastAnswered));

  useEffect(() => {
    onTurnCountChange?.(turns.length);
  }, [turns.length, onTurnCountChange]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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

  const empty = turns.length === 0;

  return (
    <>
      {/* Which book Ask is talking about, when the page behind it is a different one.
          `Suspense` is scoped to this note rather than to the console or the nav:
          `BookScopeNote` reads search params, and a client component doing that under
          the ROOT layout (which is where `AskDock` mounts this) bails static rendering
          out for every route unless it sits behind a boundary. A one-line note that
          appears a beat late is harmless; a nav or a composer that does is not. */}
      <Suspense fallback={null}>
        <BookScopeNote />
      </Suspense>
      {empty && (
        <ul
          className={`list-none p-0 m-0 grid gap-2 ${
            compact ? "mb-5" : "mb-8 sm:grid-cols-2"
          }`}
        >
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => ask(s)}
                className={`w-full text-left rounded-md border border-border bg-bg-surface leading-[1.5] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors ${
                  compact ? "px-2.5 py-2 text-[12px]" : "px-3 py-2.5 text-[12.5px]"
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ol className={`list-none p-0 m-0 ${compact ? "space-y-5" : "space-y-6"}`}>
        {turns.map((turn, i) => (
          <li key={i} className="space-y-3">
            {/* User turn — a right-aligned bubble, the chat convention the reader
                asked for. Neutral fill, not the crimson accent, so it is never
                mistaken for direction ink (ADR-0085). */}
            <div className="flex justify-end">
              <p className="m-0 max-w-[85%] rounded-2xl rounded-br-md border border-border bg-bg-elevated px-3.5 py-2 text-[13.5px] leading-[1.55] text-text-primary">
                {turn.question}
              </p>
            </div>

            {/* Assistant turn — left-aligned with the geninnov mark. Chat now,
                but STILL not an h-screen chat-app shell: no stream (the citation
                guardrail must check a figure before it is on screen). On the page
                the document scrolls, so Ctrl+F and deep links survive (goal 7); in
                the popup the panel scrolls, which is the one place an inner
                scroller is the right answer rather than a workaround. */}
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent text-[11px] font-bold leading-none text-white"
              >
                A
              </span>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-bg-surface px-4 py-3">
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
                        <VerifiedProse
                          answer={turn.answer.answer}
                          verdicts={turn.answer.verdicts ?? []}
                        />

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
                              <span className="num">{turn.answer.unverified.length}</span>{" "}
                              untraceable:{" "}
                              <span className="num">{turn.answer.unverified.join(", ")}</span> —
                              marked in the text and not sourced from the book
                            </span>
                          )}
                        </footer>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <form
        className={compact ? "mt-5" : "mt-8"}
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor={compact ? "ask-input-dock" : "ask-input"} className="sr-only">
          Ask a question about the published book
        </label>
        <textarea
          id={compact ? "ask-input-dock" : "ask-input"}
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
                that spends it more carefully than one who does not.

                The BALANCE is the other half of that disclosure and went unrendered
                until ADR-0160 — the route computed `remaining`, the Turn type carried
                it, and no element read it. Stated as a count of questions, never as a
                percentage meter: the guard counts questions, not tokens or dollars.

                "TWO OR THREE", not "two". `agent.ts` makes one plan call and then
                runs the answer step in a `for (attempt < 2)` loop, breaking early
                only when the guardrail verifies. So the happy path is two calls and
                a rejected first answer costs three. The old copy said "two model
                calls per question" flatly, which understated the bill by 50%
                exactly when the guardrail was doing its job — the one line on the
                site whose whole purpose is honesty about spend. */}
            {compact
              ? "Two model calls per question — three if an answer needs a retry. Shares the nightly book's quota."
              : "Answers take a few seconds — two model calls per question, or three if the first answer fails its citation check, on the quota the nightly book uses."}
            {quotaNote && <span className="block mt-1">{quotaNote}</span>}
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
    </>
  );
}
