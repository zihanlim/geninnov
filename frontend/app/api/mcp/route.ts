// frontend/app/api/mcp/route.ts
//
// The published book as an MCP server.
//
// WHY THIS IS ALMOST FREE. `/ask` (ADR-0087) already built the hard part: a set of
// read-only tools that import the SAME modules the pages render, so an answer cannot
// disagree with the page it describes. Those tools were reachable only through our own
// LLM. This exposes the identical registry over Model Context Protocol, so a reader's own
// Claude or GPT can interrogate the book with our functions instead of scraping our HTML.
//
// It runs NO LLM. `/ask` plans with a model and pays for it out of the same MiniMax quota
// that writes the nightly book, which is why that route is spend-capped. Here the caller
// brings their own model and we only execute tools, so there is no quota to protect and no
// rate limit for one. The reads are anon-key reads of public-read rows — the same rows the
// static pages already serve to any visitor — so this reveals nothing new either.
//
// WHAT IT CAN CHANGE: nothing (design goal 5). `supabaseReader()` exposes `select` and
// nothing else, the anon key cannot write a domain table under RLS, and there is no path
// here that re-runs, re-sizes, re-ranks or re-publishes anything. That is the same bar
// `/ask` had to clear.
//
// TRANSPORT: Streamable HTTP (MCP 2025-06-18), the successor to the retired HTTP+SSE
// transport. Deliberately the minimum viable shape:
//
//   * one endpoint, POST only. GET returns 405, which the spec explicitly allows and
//     which is honest: we have no server-initiated notifications to stream. Our tool set
//     is static, so we do not declare `listChanged` and never send one.
//   * `application/json` responses rather than SSE. Also explicitly allowed — a tool call
//     here is a handful of Supabase selects, not a long-running job with progress to
//     report, and a stream would be ceremony.
//   * stateless: no `Mcp-Session-Id` is issued, so there is no session to expire and
//     nothing to hold in memory between calls. The spec makes session IDs a MAY.

import { NextResponse } from "next/server";
import { supabaseReader } from "@/lib/chat/db";
import { displayFact } from "@/lib/chat/prompt";
import { TOOLS, TOOL_BY_NAME, runTool } from "@/lib/chat/tools";
import type { Fact } from "@/lib/chat/types";

/** Versions of the MCP spec this server implements, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const LATEST = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INFO = {
  name: "andromeda",
  title: "Andromeda — the published $100M book",
  version: "1.0.0",
} as const;

// Shown to the client once, at initialize. It states the one rule that makes the rest of
// the tools trustworthy, because a client that does not know it will treat an absence as
// a failure and retry instead of reporting it.
const INSTRUCTIONS = [
  "Andromeda publishes one $100M long-short book per weekday, after the US close.",
  "Every tool here reads that published run and returns FACTS, each carrying the",
  "`table.column` it came from. Quote those numbers; do not recompute or combine them —",
  "a figure you derive yourself is not traceable to a source and the platform treats it",
  "as unverified. When a tool returns an `absence` and no facts, the absence IS the",
  "answer: say what is missing rather than substituting an estimate.",
].join(" ");

// JSON-RPC 2.0 error codes used here.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type Id = string | number | null;

const ok = (id: Id, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });

const fail = (id: Id, code: number, message: string, data?: unknown, status = 200) =>
  NextResponse.json(
    { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } },
    { status },
  );

/**
 * A ToolSpec's `args` map is `{name: what it means}`. Every tool here takes zero or one
 * string argument, so the JSON Schema is mechanical — and generated rather than
 * hand-written, because a hand-copied schema is one more thing to drift from the tool it
 * describes.
 *
 * Nothing is marked `required`: each tool already resolves its own default (the latest
 * run, the largest position) and stating a false requirement would make a client ask the
 * model for an argument it does not need.
 */
function inputSchemaFor(args: Record<string, string>) {
  const properties: Record<string, { type: "string"; description: string }> = {};
  for (const [name, description] of Object.entries(args)) {
    properties[name] = { type: "string", description };
  }
  return { type: "object" as const, properties, additionalProperties: false };
}

/**
 * Declared for every tool, because the whole point of the surface is that a figure
 * arrives WITH its source. A client that validates against this cannot silently accept a
 * bare number.
 *
 * The spec requires that a declared output schema always be satisfied, so this describes
 * the absence case too: `facts` may be empty and `absence` non-null, which is a valid
 * result and not an error.
 */
const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    tool: { type: "string", description: "The tool that produced this result." },
    facts: {
      type: "array",
      description:
        "Each figure with the persisted source it came from. Empty when the tool could " +
        "not read anything, in which case `absence` says why.",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string", description: "Human-readable name of the figure." },
          value: {
            type: ["number", "string", "null"],
            description: "null means not computable — never treat it as zero.",
          },
          source: { type: "string", description: "`table.column` this value was read from." },
          unit: { type: ["string", "null"] },
          runDate: { type: ["string", "null"], description: "The published run this belongs to." },
        },
        required: ["key", "label", "value", "source"],
      },
    },
    absence: {
      type: ["string", "null"],
      description:
        "Why the tool returned no facts. Non-null with empty `facts` is a complete " +
        "answer, not a failure — report it rather than guessing.",
    },
    notes: {
      type: ["object", "null"],
      description: "Prose the tool returned (a thesis, catalysts). Quotable, never a source for a number.",
    },
  },
  required: ["tool", "facts"],
};

/**
 * Render facts for a client that reads only the text block.
 *
 * Uses `/ask`'s own `displayFact`, not a local formatter. Two surfaces rendering one
 * figure differently is the defect `lib/chat/tools.ts` opens by warning about, and the
 * first draft here proved the point: it appended `f.unit` as a suffix and emitted
 * "Positions in the book: 10 count" and "Gross exposure: 0.5933244069596506 pct".
 * `unit` is a type tag; turning it into a display form is what that function is for.
 */
function renderText(toolName: string, facts: Fact[], absence?: string, notes?: unknown): string {
  const lines: string[] = [];
  for (const f of facts) {
    lines.push(`${f.label}: ${displayFact(f)}  [${f.source}]`);
  }
  if (absence) lines.push(`ABSENCE: ${absence}`);
  if (notes && typeof notes === "object") {
    for (const [k, v] of Object.entries(notes as Record<string, unknown>)) {
      lines.push(`${k}: ${Array.isArray(v) ? v.join(" | ") : String(v)}`);
    }
  }
  if (lines.length === 0) lines.push(`${toolName} returned nothing and gave no reason.`);
  return lines.join("\n");
}

/**
 * DNS-rebinding guard, which the spec makes a MUST for this transport.
 *
 * A browser on any origin can POST here, and without this check a page the reader is
 * merely visiting could drive the endpoint from their machine. Requests with no `Origin`
 * (curl, an MCP client, a server) are allowed — the attack needs a browser, and a browser
 * always sends one.
 */
function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "andromeda-analytics.vercel.app" ||
      h.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get("origin"))) {
    return fail(null, INVALID_REQUEST, "Origin not allowed.", undefined, 403);
  }

  // An explicit unsupported version is a 400 per the spec. Absent, the spec says assume
  // 2025-03-26 rather than reject — a client that never negotiated still works.
  const declared = req.headers.get("mcp-protocol-version");
  if (declared && !SUPPORTED_PROTOCOL_VERSIONS.includes(declared as typeof LATEST)) {
    return fail(
      null,
      INVALID_REQUEST,
      `Unsupported MCP-Protocol-Version: ${declared}`,
      { supported: SUPPORTED_PROTOCOL_VERSIONS },
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(null, PARSE_ERROR, "Request body is not valid JSON.", undefined, 400);
  }

  // The spec requires a single message, not a batch — so an array is rejected rather than
  // half-processed.
  if (Array.isArray(body)) {
    return fail(null, INVALID_REQUEST, "Batched requests are not supported; send one message.", undefined, 400);
  }
  if (!body || typeof body !== "object") {
    return fail(null, INVALID_REQUEST, "Request body must be a JSON-RPC object.", undefined, 400);
  }

  const msg = body as { jsonrpc?: string; id?: Id; method?: string; params?: unknown };
  const id: Id = msg.id ?? null;

  if (msg.jsonrpc !== "2.0") {
    return fail(id, INVALID_REQUEST, 'Missing or wrong "jsonrpc": expected "2.0".', undefined, 400);
  }
  if (typeof msg.method !== "string") {
    return fail(id, INVALID_REQUEST, "Missing method.", undefined, 400);
  }

  // A notification has no id and takes no response body — 202 with nothing, per the spec.
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      const asked = (msg.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      // Echo the client's version when we speak it; otherwise answer with our latest and
      // let the client decide whether to continue.
      const negotiated =
        asked && SUPPORTED_PROTOCOL_VERSIONS.includes(asked as typeof LATEST) ? asked : LATEST;
      return ok(id, {
        protocolVersion: negotiated,
        // Tools only. No prompts, no resources, no logging — and no `listChanged`,
        // because the registry is a module-level constant that cannot change at runtime.
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return isNotification ? new NextResponse(null, { status: 202 }) : ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: inputSchemaFor(t.args),
          outputSchema: OUTPUT_SCHEMA,
        })),
      });

    case "tools/call": {
      const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof p.name !== "string") {
        return fail(id, INVALID_PARAMS, "tools/call requires a string `name`.");
      }
      // An unknown tool is a PROTOCOL error, not a tool result with isError — the client
      // asked for something that does not exist, which is a different fault from a tool
      // that ran and could not answer.
      if (!TOOL_BY_NAME.has(p.name)) {
        return fail(id, INVALID_PARAMS, `Unknown tool: ${p.name}`, {
          available: TOOLS.map((t) => t.name),
        });
      }
      const args =
        p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
          ? (p.arguments as Record<string, unknown>)
          : {};

      const out = await runTool(p.name, args, { db: supabaseReader() });
      const facts = out.facts ?? [];

      return ok(id, {
        content: [{ type: "text", text: renderText(p.name, facts, out.absence, out.notes) }],
        structuredContent: {
          tool: out.tool,
          facts,
          absence: out.absence ?? null,
          notes: out.notes ?? null,
        },
        // A stated absence is an ANSWER, not an error — flagging it would invite a client
        // to retry a question that was fully answered by "we cannot see that". `runTool`
        // never throws; it converts a failure into an absence, so this stays false.
        isError: false,
      });
    }

    default:
      if (isNotification) return new NextResponse(null, { status: 202 });
      return fail(id, METHOD_NOT_FOUND, `Method not supported: ${msg.method}`, {
        supported: ["initialize", "ping", "tools/list", "tools/call"],
      });
  }
}

/**
 * No server-initiated stream. The spec's prescribed answer for that is 405, and saying so
 * is better than holding open a stream that will never carry a message.
 */
export async function GET() {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: METHOD_NOT_FOUND,
        message:
          "This MCP endpoint does not offer a server-initiated SSE stream. POST JSON-RPC to it instead.",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
