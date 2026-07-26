// frontend/lib/chat/minimax.ts
//
// The MiniMax call, in TypeScript, for the request-time agent.
//
// This is a deliberate port of `_llm_complete` in backend/services/q1_agent.py
// rather than a fresh integration, because that function has scars this one
// would otherwise have to earn again:
//
//   • MiniMax-M3 is a REASONING model. It emits a <think> block before the
//     answer and both come out of the same token budget, so a small max_tokens
//     produces HTTP 200 with an unterminated <think> and no answer at all. That
//     read as "JSON decode failed" for two iterations before anyone looked at
//     the raw body. Hence the generous ceiling and the unclosed-block stripping.
//   • The endpoint is OpenAI-shaped but is NOT OpenAI: there is no top-level
//     system parameter, so the system prompt is folded in as a system message.
//   • `response_format: json_object` is what suppresses the <think> block and
//     the surrounding prose. It is the difference between a parseable answer and
//     a hopeful regex.
//
// It differs from the Python in one respect that matters: the deadline. The
// batch job could afford a 900-second call; a browser waiting on /ask cannot, so
// the timeout here is short and enforced with AbortSignal, which — unlike the
// requests inter-byte timeout that let one L5 call run 45 minutes — is a real
// wall clock.

const ENDPOINT = process.env.MINIMAX_ENDPOINT || "https://api.minimax.io/v1/chat/completions";
const MODEL = process.env.MINIMAX_MODEL_ID || "MiniMax-M3";

/**
 * Wall-clock ceiling for one completion. Two completions happen per question
 * (plan, then answer), so this is roughly half the worst case a reader waits.
 * Vercel's function timeout must exceed 2× this — see `maxDuration` in the
 * route.
 */
const TIMEOUT_MS = Number(process.env.CHAT_LLM_TIMEOUT_MS || 60_000);

/**
 * Token ceiling per call. Generous for the same reason the Python is: the
 * reasoning block spends this budget too, and a ceiling that fits most answers
 * and not the hard ones fails intermittently, which is the worst kind of limit.
 */
const MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 8_000);

export class LlmError extends Error {
  constructor(
    message: string,
    /** True when retrying later might work (quota, timeout, 5xx). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Drop MiniMax <think> blocks and markdown fences.
 *
 * Ported line for line from `_strip_reasoning_and_fences`, including the two
 * cases that look redundant and are not: an UNCLOSED fence (a truncated
 * response) and an UNCLOSED <think> (the model hit the ceiling mid-reasoning, so
 * there is no answer anywhere in the response). Leaving either in place turns a
 * budget problem into a parse error that describes the JSON instead.
 */
export function stripReasoningAndFences(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  out = out.replace(/<think>[\s\S]*$/g, "");
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  out = out.replace(/^\s*```(?:json)?\s*/, "");
  out = out.replace(/\s*```\s*$/, "");
  return out.trim();
}

/** The seam every test uses instead of the network. */
export type Complete = (args: {
  system: string;
  prompt: string;
  json?: boolean;
}) => Promise<string>;

export function providerConfigured(): boolean {
  return Boolean(process.env.MINIMAX_API_KEY);
}

export const completeWithMiniMax: Complete = async ({ system, prompt, json = true }) => {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    throw new LlmError("MINIMAX_API_KEY is not set — /ask cannot answer.", false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          // No top-level system parameter on this endpoint — see the header.
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmError(`MiniMax did not answer within ${TIMEOUT_MS / 1000}s.`, true);
    }
    throw new LlmError(`MiniMax request failed: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // 429 is the one worth naming: this key's quota is shared with the nightly
    // L5 book, and a chat that quietly burns it regresses tomorrow's publication
    // to the deterministic template. Surfacing it as such is the difference
    // between "the chat is down" and "stop asking, the book is at risk".
    const quota = resp.status === 429;
    throw new LlmError(
      quota
        ? "MiniMax quota is exhausted. /ask shares its key with the nightly L5 book, so this is left to recover rather than retried."
        : `MiniMax API error ${resp.status}: ${body.slice(0, 200)}`,
      resp.status >= 500,
    );
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const cleaned = stripReasoningAndFences(text);
  if (!cleaned) {
    // Empty after stripping means the budget went entirely on reasoning. Say
    // that, rather than letting it surface downstream as malformed JSON.
    throw new LlmError(
      `MiniMax returned no answer — the ${MAX_TOKENS}-token budget was spent before the response began. Raise CHAT_MAX_TOKENS or shorten the question.`,
      true,
    );
  }
  return cleaned;
};
