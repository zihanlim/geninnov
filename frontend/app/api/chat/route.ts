// frontend/app/api/chat/route.ts
//
// The first server-side endpoint in this codebase.
//
// Everything else on this site is a static page reading Supabase with the anon
// key from the browser. This route exists because /ask needs three things a
// browser must not have: the MiniMax key, the service key for the spend guard,
// and the guarantee that the citation guardrail ran before any prose reached a
// reader. See ADR-0087.
//
// ORDER MATTERS. Rate limit, THEN spend. Every refusal above returns before a
// single token is bought.

import { NextResponse } from "next/server";
import { runChatAgent } from "@/lib/chat/agent";
import { guardClient, supabaseReader } from "@/lib/chat/db";
import { completeWithMiniMax, providerConfigured } from "@/lib/chat/minimax";
import { checkRateLimit, clientIp } from "@/lib/chat/rateLimit";

// Node, not edge: the guard uses node:crypto, and the Supabase client is happier
// here. Nothing about this route benefits from edge latency — it is dominated by
// two LLM completions.
export const runtime = "nodejs";
// Two completions at up to 60s each, plus the tool reads. Must exceed
// 2 × CHAT_LLM_TIMEOUT_MS or the function dies before the agent's own deadline
// fires, turning a clean "MiniMax did not answer" into an opaque 504.
export const maxDuration = 140;
export const dynamic = "force-dynamic";

const MAX_QUESTION_CHARS = 500;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const question = String((body as { question?: unknown })?.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    // A cap on the prompt is part of the spend guard, not input hygiene: the
    // question is echoed into both completions.
    return NextResponse.json(
      { error: `Questions are capped at ${MAX_QUESTION_CHARS} characters; this one is ${question.length}.` },
      { status: 400 },
    );
  }

  const verdict = await checkRateLimit(guardClient(), clientIp(request.headers));
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.message }, { status: 429 });
  }

  if (!providerConfigured()) {
    return NextResponse.json(
      { error: "No LLM provider is configured (MINIMAX_API_KEY is unset), so /ask cannot answer." },
      { status: 503 },
    );
  }

  const result = await runChatAgent({
    question,
    ctx: { db: supabaseReader() },
    complete: completeWithMiniMax,
  });

  // An agent-level error is a 200 with an `error` field, not an HTTP error: the
  // steps it did complete are still worth showing, and the reader is owed the
  // reason rather than a status code.
  return NextResponse.json({
    ...result,
    remaining: verdict.cap !== undefined && verdict.used !== undefined ? Math.max(0, verdict.cap - verdict.used) : null,
  });
}
