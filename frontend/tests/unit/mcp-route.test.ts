// frontend/tests/unit/mcp-route.test.ts
//
// Protocol conformance for the MCP endpoint, plus the two properties that make it safe to
// expose at all: it is read-only, and an absence is not an error.
//
// The tools are exercised against an injected DbReader, so no test can reach Supabase and
// none can spend anything.

import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();

vi.mock("@/lib/chat/db", () => ({
  supabaseReader: () => ({ select: selectMock }),
}));

import { GET, POST } from "@/app/api/mcp/route";
import { TOOLS } from "@/lib/chat/tools";

const PROTOCOL = "2025-06-18";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://andromeda-analytics.vercel.app/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

beforeEach(() => {
  selectMock.mockReset();
  // Default: every table reads as empty, which drives tools into their absence path.
  selectMock.mockResolvedValue({ rows: [], error: null });
});

describe("initialize", () => {
  it("echoes a protocol version it supports", async () => {
    const res = await post(rpc("initialize", { protocolVersion: PROTOCOL }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.protocolVersion).toBe(PROTOCOL);
    expect(body.result.serverInfo.name).toBe("andromeda");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("answers with its own latest version when the client asks for one it does not speak", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "1999-01-01" }));
    const body = await res.json();
    // The spec says respond with a version WE support and let the client decide — not error.
    expect(res.status).toBe(200);
    expect(body.result.protocolVersion).toBe(PROTOCOL);
  });

  it("does not advertise listChanged, because the registry is a constant", async () => {
    const body = await (await post(rpc("initialize", { protocolVersion: PROTOCOL }))).json();
    expect(body.result.capabilities.tools.listChanged).toBeUndefined();
  });

  it("states the no-recompute contract in its instructions", async () => {
    const body = await (await post(rpc("initialize", { protocolVersion: PROTOCOL }))).json();
    // A client that does not learn this treats an absence as a failure and retries.
    expect(body.result.instructions).toMatch(/absence IS the/i);
    expect(body.result.instructions).toMatch(/do not recompute|not recompute/i);
  });
});

describe("tools/list", () => {
  it("exposes every tool from the shared registry, with a schema per tool", async () => {
    const body = await (await post(rpc("tools/list"))).json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names.sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of body.result.tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema.required).toContain("facts");
    }
  });

  it("marks no argument required, since every tool resolves its own default", async () => {
    const body = await (await post(rpc("tools/list"))).json();
    for (const t of body.result.tools) {
      expect(t.inputSchema.required).toBeUndefined();
    }
  });

  it("declares an output schema that permits the absence case", async () => {
    // If the schema demanded a non-empty facts array, every honest "cannot see that"
    // answer would be a schema violation.
    const body = await (await post(rpc("tools/list"))).json();
    const schema = body.result.tools[0].outputSchema;
    expect(schema.required).not.toContain("absence");
    expect(schema.properties.absence.type).toContain("null");
    expect(schema.properties.facts.items.properties.value.type).toContain("null");
  });
});

describe("tools/call", () => {
  it("returns a text block and structuredContent that agree", async () => {
    const body = await (await post(rpc("tools/call", { name: "book_summary", arguments: {} }))).json();
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.structuredContent.tool).toBe("book_summary");
    expect(Array.isArray(body.result.structuredContent.facts)).toBe(true);
  });

  it("reports an empty book as an absence, not an error", async () => {
    const body = await (await post(rpc("tools/call", { name: "book_summary", arguments: {} }))).json();
    // The whole point: a stated absence is a complete answer. Flagging isError would
    // invite the client to retry a question that was already answered.
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.facts).toEqual([]);
    expect(body.result.structuredContent.absence).toBeTruthy();
    expect(body.result.content[0].text).toMatch(/ABSENCE:/);
  });

  it("renders a fact in its DISPLAY form, not with the unit tag appended", async () => {
    // The first version of renderText appended f.unit as a suffix, producing
    // "Positions in the book: 10 count" and "Gross exposure: 0.5933244069596506 pct".
    // `unit` is a type tag; the fix was to reuse /ask's displayFact so both surfaces
    // render one figure identically.
    selectMock.mockResolvedValue({
      rows: [
        {
          run_date: "2026-07-25",
          lens: "multi_asset",
          picks: [{ asset: "XLE", direction: "long", weight: 0.0613 }],
          book_metrics: { gross_exposure: 0.5933244069596506 },
        },
      ],
      error: null,
    });
    const body = await (await post(rpc("tools/call", { name: "book_summary", arguments: {} }))).json();
    const text: string = body.result.content[0].text;
    expect(text).not.toMatch(/\d\s+(pct|count|date|text|score)\b/);
    // A fractional pct is shown as a percentage, with the raw value still available.
    expect(text).toMatch(/59\.33%/);
  });

  it("treats an unknown tool as a protocol error, not a tool result", async () => {
    const body = await (await post(rpc("tools/call", { name: "delete_everything" }))).json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/Unknown tool/);
    expect(body.error.data.available).toEqual(expect.arrayContaining(["book_summary"]));
    expect(body.result).toBeUndefined();
  });

  it("rejects a call with no tool name", async () => {
    const body = await (await post(rpc("tools/call", {}))).json();
    expect(body.error.code).toBe(-32602);
  });

  it("never writes: the injected reader exposes select and nothing else", async () => {
    await post(rpc("tools/call", { name: "book_summary", arguments: {} }));
    expect(selectMock).toHaveBeenCalled();
    // Every table touched was a read. There is no insert/update/delete to assert against
    // because DbReader has no such method — this pins that the route uses that seam.
    for (const call of selectMock.mock.calls) {
      expect(typeof call[0]).toBe("string"); // table
      expect(typeof call[1]).toBe("string"); // columns
    }
  });

  it("surfaces a table read error as an absence rather than a 500", async () => {
    selectMock.mockResolvedValue({ rows: [], error: "permission denied" });
    const res = await post(rpc("tools/call", { name: "book_summary", arguments: {} }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.structuredContent.absence).toBeTruthy();
  });
});

describe("transport conformance", () => {
  it("406s nothing but returns 202 with no body for a notification", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("answers ping", async () => {
    const body = await (await post(rpc("ping"))).json();
    expect(body.result).toEqual({});
  });

  it("400s an unsupported MCP-Protocol-Version header", async () => {
    const res = await post(rpc("tools/list"), { "mcp-protocol-version": "2001-01-01" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.data.supported).toContain(PROTOCOL);
  });

  it("accepts a request with no protocol-version header at all", async () => {
    // The spec says assume 2025-03-26 rather than reject, so an un-negotiated client works.
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(200);
  });

  it("rejects a batch, rather than half-processing it", async () => {
    const res = await post([rpc("tools/list"), rpc("ping", undefined, 2)]);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/one message/i);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("rejects a missing jsonrpc version", async () => {
    const res = await post({ id: 1, method: "tools/list" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32600);
  });

  it("returns method-not-found for an unimplemented method", async () => {
    const body = await (await post(rpc("resources/list"))).json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.data.supported).toContain("tools/call");
  });

  it("blocks a cross-origin browser POST (DNS rebinding guard)", async () => {
    const res = await post(rpc("tools/list"), { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("allows a request with no Origin, which is every non-browser client", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(200);
  });

  it("405s GET, because there is no server-initiated stream", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
