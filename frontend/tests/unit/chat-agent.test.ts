// The /ask agent's control flow, with a scripted model.
//
// Every test here injects `complete`, so the suite never touches MiniMax. That
// is not only about speed: this key is shared with the nightly L5 book, and a
// test suite that spends it would degrade tomorrow's publication to the
// deterministic fallback. A test must never be able to do that.
//
// What is pinned is the behaviour that protects the reader when the model
// misbehaves — an invented tool, a fabricated figure, a dead provider — because
// those paths are the ones that will never be exercised by hand.

import { describe, expect, it, vi } from "vitest";
import { parseAnswer, parsePlan, runChatAgent, stripMarkdown } from "@/lib/chat/agent";
import { LlmError, type Complete } from "@/lib/chat/minimax";
import type { DbReader } from "@/lib/chat/types";

const BOOK_ROW = {
  run_date: "2026-07-25",
  picks: [{ asset: "UNH", direction: "long", weight: 0.088, notional: 8_800_000, thesis: "Overhang cleared." }],
  book_metrics: { gross_exposure: 1.48, net_exposure: 0.028, long_weight: 0.754, short_weight: 0.726, factor_tilts: {} },
};

const db = (tables: Record<string, Record<string, unknown>[]>): DbReader => ({
  async select(table) {
    return { rows: tables[table] ?? [], error: null };
  },
});

const ctx = { db: db({ research_recommendations: [BOOK_ROW], portfolio_positions: [] }) };

/** A model that returns the given strings in order. */
const scripted = (...replies: string[]) => {
  const queue = [...replies];
  // Typed with Complete's own parameter so `mock.calls[n][0].prompt` is checked
  // rather than `any` — the retry assertion below is only meaningful if the
  // prompt field it reads actually exists.
  return vi.fn(async (_args: Parameters<Complete>[0]) => queue.shift() ?? "{}");
};

describe("parsePlan", () => {
  it("drops a tool the model invented", () => {
    const { calls } = parsePlan(JSON.stringify({ calls: [{ tool: "get_prices" }, { tool: "book_summary" }] }));
    expect(calls.map((c) => c.tool)).toEqual(["book_summary"]);
  });

  it("caps the plan at four calls", () => {
    const { calls } = parsePlan(
      JSON.stringify({
        calls: [
          { tool: "book_summary" },
          { tool: "regime" },
          { tool: "risk_metrics" },
          { tool: "theme_scores" },
          { tool: "macro_indicators" },
        ],
      }),
    );
    expect(calls).toHaveLength(4);
  });

  it("de-duplicates an identical call", () => {
    const { calls } = parsePlan(JSON.stringify({ calls: [{ tool: "regime" }, { tool: "regime" }] }));
    expect(calls).toHaveLength(1);
  });

  it("survives prose where JSON was promised", () => {
    expect(parsePlan("I think I should look at the book.").calls).toHaveLength(0);
  });
});

describe("parseAnswer", () => {
  it("unwraps the JSON envelope", () => {
    expect(parseAnswer('{"answer":"UNH is 8.8% of the book."}')).toBe("UNH is 8.8% of the book.");
  });

  it("falls back to raw prose when the model ignored json mode", () => {
    expect(parseAnswer("UNH is 8.8% of the book.")).toBe("UNH is 8.8% of the book.");
  });

  it("strips markdown the renderer would print literally", () => {
    // VerifiedProse marks numerals at recorded character offsets, so it cannot
    // run a markdown renderer over the string those offsets index. The first
    // live capture showed "**Step one - conviction.**" on the page, asterisks
    // and all. Stripping happens here, BEFORE the guardrail scans, because
    // removing characters afterwards would shift every mark onto a later token.
    expect(parseAnswer('{"answer":"**Step one.** The weight is 8.8%."}')).toBe(
      "Step one. The weight is 8.8%.",
    );
    expect(stripMarkdown("`code` and *emphasis* here")).toBe("code and emphasis here");
    // A heading marker only counts at the start of a line; mid-sentence it is
    // just text, and rewriting it would corrupt prose to tidy up markup.
    expect(stripMarkdown("### Sizing\nThe weight is 8.8%.")).toBe("Sizing\nThe weight is 8.8%.");
    expect(stripMarkdown("rated ### by the desk")).toBe("rated ### by the desk");
    // A lone asterisk in prose is not emphasis and must survive.
    expect(stripMarkdown("2 * 3 is arithmetic")).toBe("2 * 3 is arithmetic");
  });
});

describe("runChatAgent", () => {
  it("answers from tool facts and reports the run date", async () => {
    const complete = scripted(
      JSON.stringify({ calls: [{ tool: "book_summary", because: "to see the whole book" }] }),
      JSON.stringify({ answer: "UNH is 8.8% of the book, published 2026-07-25." }),
    );
    const out = await runChatAgent({ question: "how big is UNH?", ctx, complete });

    expect(out.verified).toBe(true);
    expect(out.runDate).toBe("2026-07-25");
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].because).toBe("to see the whole book");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("retries ONCE when a figure does not trace, and names it to the model", async () => {
    const complete = scripted(
      JSON.stringify({ calls: [{ tool: "book_summary" }] }),
      JSON.stringify({ answer: "Gross exposure is 210.0%." }),
      JSON.stringify({ answer: "Gross exposure is 148.00%." }),
    );
    const out = await runChatAgent({ question: "how levered is it?", ctx, complete });

    expect(complete).toHaveBeenCalledTimes(3);
    // The retry prompt has to name the offending token, or the model has no
    // information it did not already have and mostly returns the same answer.
    const retryPrompt = complete.mock.calls[2][0].prompt;
    expect(retryPrompt).toContain("210.0%");
    expect(retryPrompt).toContain("REJECTED");
    expect(out.verified).toBe(true);
  });

  it("ships the second attempt marked rather than silently, when it still fails", async () => {
    const complete = scripted(
      JSON.stringify({ calls: [{ tool: "book_summary" }] }),
      JSON.stringify({ answer: "Gross is 210.0%." }),
      JSON.stringify({ answer: "Gross is 205.0%." }),
    );
    const out = await runChatAgent({ question: "how levered?", ctx, complete });

    expect(complete).toHaveBeenCalledTimes(3); // one retry, not a loop
    expect(out.verified).toBe(false);
    expect(out.unverified).toContain("205.0%");
    // The verdicts carry offsets so the UI can mark the figure in place.
    expect(out.verdicts.some((v) => v.grounding === "unverified")).toBe(true);
  });

  it("returns the absences as the answer when every tool came back empty", async () => {
    const complete = scripted(JSON.stringify({ calls: [{ tool: "book_summary" }] }));
    const out = await runChatAgent({
      question: "what is in the book?",
      ctx: { db: db({ research_recommendations: [] }) },
      complete,
    });

    // One completion, not two: with nothing fetched there is nothing to write
    // about, and asking the model to write anyway is asking it to answer from
    // its own memory of markets.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(out.answer).toMatch(/has no rows/);
    expect(out.verified).toBe(true);
  });

  it("relays a planner refusal as prose, not as an error", async () => {
    const complete = scripted(
      JSON.stringify({ calls: [], cannot_answer: "This book does not cover live prices." }),
    );
    const out = await runChatAgent({ question: "what is AAPL trading at?", ctx, complete });

    expect(out.answer).toBe("This book does not cover live prices.");
    expect(out.error).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("surfaces a provider failure without inventing an answer", async () => {
    const complete = vi.fn(async () => {
      throw new LlmError("MiniMax quota is exhausted.", true);
    });
    const out = await runChatAgent({ question: "how big is UNH?", ctx, complete });

    expect(out.answer).toBe("");
    expect(out.error).toMatch(/quota is exhausted/);
  });

  it("does not answer when the planner names no readable source", async () => {
    const complete = scripted(JSON.stringify({ calls: [] }));
    const out = await runChatAgent({ question: "?", ctx, complete });
    expect(out.error).toMatch(/did not name a readable source/);
    expect(out.answer).toBe("");
  });
});
