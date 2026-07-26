// frontend/lib/chat/agent.ts
//
// The /ask agent: plan → execute → answer → verify → (retry once).
//
// WHY THIS SHAPE AND NOT A TOOL LOOP. The obvious build is an open loop — model
// calls a tool, sees the result, decides what to call next, repeats until it
// answers. It is also the wrong build here, for three reasons that are specific
// to this product rather than to agents in general:
//
//   1. COST. The key is shared with the nightly L5 book. An open loop's spend is
//      unbounded per question and decided by the model; this shape costs exactly
//      two completions, always, and the second one is the only one that writes
//      prose.
//   2. LATENCY. A reader is waiting. Bounded rounds mean a bounded wait, and the
//      tools inside a round run in PARALLEL rather than in whatever sequence the
//      model happened to imagine.
//   3. IT MIRRORS L5. The nightly pipeline is deterministic-then-stochastic:
//      pure functions gather and screen, one LLM call reasons, a guardrail
//      checks it. /ask is that same pipeline at request time. A reader who has
//      understood /method has already understood this.
//
// The model chooses WHICH facts to fetch and how to explain them. It never
// chooses what a number is.
//
// NO STREAMING, deliberately. The guardrail cannot verify a token that has
// already been shown to the reader, and an answer whose figures are checked
// after they are on screen is not checked. Waiting is the honest cost of the
// citation contract.

import { verifyAnswer } from "./guardrail";
import { LlmError, type Complete } from "./minimax";
import { PLAN_SYSTEM, buildAnswerPrompt, buildPlanPrompt, ANSWER_SYSTEM } from "./prompt";
import { runTool, TOOLS } from "./tools";
import type { AgentAnswer, AgentStep, ToolContext, ToolResult } from "./types";

/** Max tools per question. Enough for "why is X sized like that, given the regime". */
const MAX_TOOLS = 4;

interface PlannedCall {
  tool: string;
  args?: Record<string, unknown>;
  because?: string;
}

/**
 * Parse the planner's JSON.
 *
 * Tolerant about shape, strict about content: an unknown tool name is dropped
 * here rather than at execution, so a model that invents `get_prices` produces a
 * short plan instead of a step that reports its own failure to the reader.
 */
export function parsePlan(raw: string): { calls: PlannedCall[]; refusal: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { calls: [], refusal: null };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const refusal = typeof obj.cannot_answer === "string" && obj.cannot_answer.trim() ? obj.cannot_answer.trim() : null;
  const known = new Set(TOOLS.map((t) => t.name));
  const calls: PlannedCall[] = [];
  for (const entry of Array.isArray(obj.calls) ? obj.calls : []) {
    const c = (entry ?? {}) as Record<string, unknown>;
    const tool = typeof c.tool === "string" ? c.tool : "";
    if (!known.has(tool)) continue;
    if (calls.some((x) => x.tool === tool && JSON.stringify(x.args ?? {}) === JSON.stringify(c.args ?? {}))) continue;
    calls.push({
      tool,
      args: (c.args ?? {}) as Record<string, unknown>,
      because: typeof c.because === "string" ? c.because : "",
    });
    if (calls.length >= MAX_TOOLS) break;
  }
  return { calls, refusal };
}

/**
 * Strip markdown emphasis the renderer would show literally.
 *
 * `VerifiedProse` cannot render markdown: it marks each numeral at the character
 * offset the guardrail recorded, and a markdown renderer would rewrite the very
 * string those offsets index into. So the prompt asks for plain prose — and this
 * cleans up the times it asks in vain, which on the first live capture was every
 * time ("**Step one — conviction.**" reached the page with its asterisks).
 *
 * It runs BEFORE verification, never after. Stripping characters out of an
 * already-adjudicated string would shift every offset past the first `**` and
 * move each mark onto the wrong figure.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$|[.,;:!?)])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}

/** Pull the answer text out of the answering call's JSON. */
export function parseAnswer(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.answer === "string") return stripMarkdown(obj.answer.trim());
  } catch {
    // A model that ignored json mode and wrote prose is still usable — the
    // guardrail is what protects the reader, not the envelope.
    return stripMarkdown(raw.trim());
  }
  return stripMarkdown(raw.trim());
}

export interface RunArgs {
  question: string;
  ctx: ToolContext;
  complete: Complete;
}

export async function runChatAgent({ question, ctx, complete }: RunArgs): Promise<AgentAnswer> {
  const empty = { steps: [], verdicts: [], citations: [], unverified: [], verified: false, runDate: null };

  // ── 1. Plan ───────────────────────────────────────────────────────────────
  let planRaw: string;
  try {
    planRaw = await complete({ system: PLAN_SYSTEM, prompt: buildPlanPrompt(question), json: true });
  } catch (err) {
    return {
      ...empty,
      answer: "",
      error: err instanceof LlmError ? err.message : `Planning failed: ${String(err)}`,
    };
  }
  const { calls, refusal } = parsePlan(planRaw);

  if (refusal && !calls.length) {
    // The planner decided nothing in the book answers this. That is a real
    // outcome and gets returned as prose, not as an error — the reader asked
    // something out of scope and deserves to be told which.
    return { ...empty, answer: refusal, verified: true };
  }
  if (!calls.length) {
    return {
      ...empty,
      answer: "",
      error:
        "The planner did not name a readable source for this question, so nothing was fetched and nothing can be answered from the published book.",
    };
  }

  // ── 2. Execute — deterministic, parallel, and the only source of numbers ──
  const results: ToolResult[] = await Promise.all(
    calls.map((c) => runTool(c.tool, c.args ?? {}, ctx)),
  );
  const steps: AgentStep[] = calls.map((c, i) => ({
    tool: c.tool,
    args: c.args ?? {},
    because: c.because ?? "",
    result: results[i],
  }));

  const runDate =
    results.flatMap((r) => r.facts).find((f) => f.key.endsWith("run_date") && typeof f.value === "string")?.value ??
    results.flatMap((r) => r.facts).find((f) => f.runDate)?.runDate ??
    null;

  // Every tool came back empty-handed. Answering anyway would mean answering
  // from the model's memory of markets, which is the one thing this product must
  // never do — so the absences ARE the answer.
  if (results.every((r) => r.facts.length === 0)) {
    const why = results.map((r) => r.absence).filter(Boolean).join(" ");
    return {
      ...empty,
      steps,
      answer: why || "Nothing could be read for this question, so there is no sourced answer to give.",
      verified: true,
      runDate: typeof runDate === "string" ? runDate : null,
    };
  }

  // ── 3. Answer, then 4. verify, then retry once with the failures named ────
  let answer = "";
  let verification = verifyAnswer("", results, question);
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await complete({
        system: ANSWER_SYSTEM,
        prompt: buildAnswerPrompt(question, results, attempt === 1 ? verification.unverified : []),
        json: true,
      });
    } catch (err) {
      return {
        ...empty,
        steps,
        answer,
        runDate: typeof runDate === "string" ? runDate : null,
        error: err instanceof LlmError ? err.message : `Answering failed: ${String(err)}`,
      };
    }
    answer = parseAnswer(raw);
    verification = verifyAnswer(answer, results, question);
    if (verification.verified) break;
  }

  return {
    answer,
    steps,
    verdicts: verification.verdicts,
    citations: verification.citations,
    unverified: verification.unverified,
    verified: verification.verified,
    runDate: typeof runDate === "string" ? runDate : null,
  };
}
