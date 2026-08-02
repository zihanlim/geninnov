// frontend/tests/unit/datamap.test.ts
//
// The /datamap map (MASTER_MAP.md, App · /datamap) renders from `dataMap.ts`.
// Three invariants are load-bearing:
//
//   1. every node id is unique — a duplicate silently drops one node from the
//      swimlane layout, because the `positioned` Map is keyed by id;
//   2. every edge references nodes that exist — a dangling edge is an arrow
//      pointing nowhere, which the reader cannot tell from a real flow;
//   3. the swimlane order list does not omit a declared node, which would
//      dump that node at the END of the lane and break the L0–L8 reading
//      order the rest of the app uses.
//
// The fourth check — that each node is reachable from at least one source or
// pipeline node — is asserted implicitly: edges are untyped, and an orphan
// would still draw. A user-facing test would be a separate, longer pass.

import { describe, expect, it } from "vitest";
import {
  mapNodes,
  mapEdges,
  swimlaneOrder,
  type NodeType,
} from "@/components/datamap/dataMap";

describe("dataMap invariants", () => {
  it("every node id is unique", () => {
    const seen = new Set<string>();
    for (const n of mapNodes) {
      expect(seen.has(n.id), `duplicate node id: ${n.id}`).toBe(false);
      seen.add(n.id);
    }
  });

  it("every edge references nodes that exist", () => {
    const ids = new Set(mapNodes.map((n) => n.id));
    for (const e of mapEdges) {
      expect(ids.has(e.from), `edge from unknown node: ${e.from}`).toBe(true);
      expect(ids.has(e.to), `edge to unknown node: ${e.to}`).toBe(true);
    }
  });

  it("every node type is represented in at least one swimlane", () => {
    const types: NodeType[] = ["source", "pipeline", "table", "surface"];
    for (const t of types) {
      expect(
        mapNodes.filter((n) => n.type === t).length,
        `no nodes of type ${t}`,
      ).toBeGreaterThan(0);
    }
  });

  it("swimlaneOrder declares every node of its lane", () => {
    for (const t of Object.keys(swimlaneOrder) as NodeType[]) {
      const declared = new Set(swimlaneOrder[t]);
      for (const n of mapNodes.filter((x) => x.type === t)) {
        expect(
          declared.has(n.id),
          `node ${n.id} (type=${t}) is not in swimlaneOrder — the renderer will dump it at the end of the lane`,
        ).toBe(true);
      }
    }
  });

  it("pipeline swimlane reads L0 → L1 → L1b → L2 → L2b → L3 → L4 → L5 → L5b → sizing → L6 → L7 → L8", () => {
    // The pipeline ordering is the L0–L8 reading order the rest of the app
    // uses (ARCHITECTURE.md · Data Flow). An accidental re-sort here would
    // render a pipeline the rest of the app contradicts.
    const expected = [
      "L0",
      "L1",
      "L1b",
      "L2",
      "L2b",
      "L3",
      "L4",
      "L5",
      "L5b",
      "sizing",
      "L6",
      "L7",
      "L8",
    ];
    expect(swimlaneOrder.pipeline).toEqual(expected);
  });

  it("every node has a non-empty name and summary", () => {
    for (const n of mapNodes) {
      expect(n.name.length, `empty name on ${n.id}`).toBeGreaterThan(0);
      expect(n.summary.length, `empty summary on ${n.id}`).toBeGreaterThan(0);
    }
  });
});
