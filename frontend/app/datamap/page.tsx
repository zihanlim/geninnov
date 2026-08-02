"use client";

// frontend/app/datamap/page.tsx
//
// /datamap — a master map of the research process, as five lane cards.
//
// The five swimlanes (EXTERNAL DATA SOURCES · DETERMINISTIC QUANTITATIVE
// PIPELINE · SUPABASE TABLES · FRONTEND SURFACES · OFFLINE VERIFICATION)
// render as five equal-height cards in a single 5-column row. A card whose
// contents outgrow the shared height scrolls vertically inside the card.
//
// The data for the map is in `dataMap.ts` — every node is declared there, keyed
// by `type` (its swimlane) and ordered within a lane by `swimlaneOrder`. The
// renderer never hard-codes a node.
//
// Hover-trace and click-to-lock survive the lane layout: `traceConnected`
// walks `mapEdges` in both directions from the active node, and every node
// outside that connected set is dimmed. Edges themselves are not drawn — a
// scrollable card can't hold fixed SVG lines (endpoints move as the card
// scrolls, and cross-card lines would tangle across columns).
//
// Animations use only the existing CSS keyframes (fade-in, pulse-soft, shimmer,
// datamap-flow, datamap-node-glow). No new dependencies.

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Node,
  NodeType,
  mapNodes,
  mapEdges,
  sectionOrder,
  swimlaneOrder,
} from "@/components/datamap/dataMap";

/** Walk mapEdges from a starting node in both directions to find all reachable
 *  node IDs and the edge keys that form the traced path. */
function traceConnected(hoveredId: string): Set<string> {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const visitedUp = new Set<string>();
  const visitedDown = new Set<string>();
  const queueUp: string[] = [hoveredId];
  const queueDown: string[] = [hoveredId];

  while (queueUp.length) {
    const cur = queueUp.shift()!;
    if (visitedUp.has(cur)) continue;
    visitedUp.add(cur);
    for (const e of mapEdges) {
      if (e.to === cur && !visitedUp.has(e.from)) {
        upstream.add(e.from);
        queueUp.push(e.from);
      }
    }
  }

  while (queueDown.length) {
    const cur = queueDown.shift()!;
    if (visitedDown.has(cur)) continue;
    visitedDown.add(cur);
    for (const e of mapEdges) {
      if (e.from === cur && !visitedDown.has(e.to)) {
        downstream.add(e.to);
        queueDown.push(e.to);
      }
    }
  }

  // The hovered node itself is in both sets; union keeps it highlighted.
  const connected = new Set<string>([hoveredId]);
  upstream.forEach(id => connected.add(id));
  downstream.forEach(id => connected.add(id));
  return connected;
}

const NODE_W = 168;
const NODE_H = 70;

/** The five swimlanes, in display order. */
const LANE_ORDER: NodeType[] = ["source", "pipeline", "table", "surface", "verify"];

/** Card title per swimlane. Shared with the NodeTable companion below. */
const LANE_LABEL: Record<NodeType, string> = {
  source: "External Data Sources",
  pipeline: "Deterministic Quantitative Pipeline",
  table: "Supabase Tables (Representative)",
  surface: "Frontend Surfaces",
  verify: "Offline Verification",
};

export default function DataMapPage() {
  const nodes = useMemo(() => mapNodes, []);

  // ID of the currently-hovered node (null = none).
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ID of the node locked by a click (null = none). Click takes priority over hover.
  const [clickedId, setClickedId] = useState<string | null>(null);

  // The specific node that was just clicked — cleared after the animation window so
  // a second click on the same node retriggers the flash.
  const [justClickedId, setJustClickedId] = useState<string | null>(null);

  // The active node to trace: clicked wins over hovered.
  const activeId = clickedId ?? hoveredId;

  // Set of all node IDs reachable from the active node via one or more edges
  // in either direction. Empty when no node is active.
  const hoveredNodeIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    return traceConnected(activeId);
  }, [activeId]);

  // Document-level click listener: clear clickedId when clicking anything
  // that is not a node card. This fires regardless of where the click lands.
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (!clickedId) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-node-id]")) {
        setClickedId(null);
      }
    }
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, [clickedId]);

  // Handle a node-card click: lock the node as active AND start the flash window.
  const handleNodeClick = (id: string) => {
    setClickedId(id);
    setJustClickedId(id);
    window.setTimeout(() => setJustClickedId(null), 750);
  };

  const shared = {
    hoveredNodeIds,
    onHovered: setHoveredId,
    onNodeClick: handleNodeClick,
    justClickedId,
  };

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <PageHeader
        title={
          <>
            ANDROMEDA{" "}
            <span
              className="font-mono"
              style={{ color: "var(--datamap-orange)" }}
            >
              //
            </span>{" "}
            DATA FLOW
          </>
        }
        lede="Every part of the research process, end to end. Hover a node to trace it — connected nodes stay lit, everything else dims."
        fine={
          <>
            Cross-cutting — does not answer a PM phase on its own, so it sits beside the
            nav. For the formulas behind a number see{" "}
            <a href="/method/build" className="text-accent hover:underline">/method/build</a>;
            for the audit log of what last ran see{" "}
            <a href="/method/evidence" className="text-accent hover:underline">/method/evidence</a>.
          </>
        }
      />

      <Legend />

      {/* ── The map: five equal-height lane cards in a 5-column row. ─────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mt-6">
        {LANE_ORDER.map((type) => (
          <LaneCard key={type} type={type} nodes={laneNodes(nodes, type)} {...shared} />
        ))}
      </div>

      <NodeTable nodes={nodes} />
    </main>
  );
}

/** Nodes of a single swimlane, ordered by `swimlaneOrder[type]`. */
function laneNodes(nodes: Node[], type: NodeType): Node[] {
  const order = swimlaneOrder[type];
  const idx = new Map(order.map((id, i) => [id, i]));
  return nodes
    .filter((n) => n.type === type)
    .sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
}

/** ── One swimlane card: header + scrollable body. ──────────────────────── */
function LaneCard({
  type,
  nodes,
  hoveredNodeIds,
  onHovered,
  onNodeClick,
  justClickedId,
}: {
  type: NodeType;
  nodes: Node[];
  hoveredNodeIds: Set<string>;
  onHovered: (id: string | null) => void;
  onNodeClick: (id: string) => void;
  justClickedId: string | null;
}) {
  const body =
    type === "pipeline" ? (
      <PipelineBody nodes={nodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
    ) : type === "table" ? (
      <GroupedBody groupBy="group" nodes={nodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
    ) : (
      <NodeList nodes={nodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
    );

  return (
    <section className="flex flex-col min-h-0 border border-border rounded-xl overflow-hidden bg-[var(--bg-elevated)] xl:h-[min(62vh,680px)] xl:min-h-[440px]">
      {/* Card header: colour dot, swimlane label, node count. */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: laneColor(type) }}
        />
        <h2 className="text-[12px] font-semibold m-0 text-text-primary leading-tight">
          {LANE_LABEL[type]}
        </h2>
        <span className="text-[11px] font-mono ml-auto text-text-tertiary shrink-0">
          {nodes.length}
        </span>
      </div>

      {/* Scrollable body — the whole card is the swimlane. */}
      <div className="datamap-lane-scroll flex-1 min-h-0 overflow-y-auto p-3">
        {body}
      </div>
    </section>
  );
}

/** ── Pipeline lane: layered by L0–L8 section, sub-grouped where grouped. ── */
function PipelineBody({
  nodes,
  hoveredNodeIds,
  onHovered,
  onNodeClick,
  justClickedId,
}: {
  nodes: Node[];
  hoveredNodeIds: Set<string>;
  onHovered: (id: string | null) => void;
  onNodeClick: (id: string) => void;
  justClickedId: string | null;
}) {
  // Bucket pipeline nodes by section (02–09), in `sectionOrder` reading order.
  const bySection = useMemo(() => {
    const out = new Map<string, Node[]>();
    for (const n of nodes) {
      const sec = n.section ?? "??";
      if (!out.has(sec)) out.set(sec, []);
      out.get(sec)!.push(n);
    }
    return out;
  }, [nodes]);

  const sectionEntries = sectionOrder
    .map((s) => ({ section: s, nodes: bySection.get(s.section) ?? [] }))
    .filter((s) => s.nodes.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {sectionEntries.map(({ section, nodes: secNodes }) => (
        <div key={section.section}>
          <div className="mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
              {section.section} · {section.title}
            </span>
          </div>
          {secNodes.some((n) => n.group) ? (
            <GroupedBody groupBy="group" nodes={secNodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
          ) : (
            <NodeList nodes={secNodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
          )}
        </div>
      ))}
    </div>
  );
}

/** ── Nodes grouped by a field (e.g. `group`), each with a sub-label. ────── */
function GroupedBody({
  groupBy,
  nodes,
  hoveredNodeIds,
  onHovered,
  onNodeClick,
  justClickedId,
}: {
  groupBy: "group";
  nodes: Node[];
  hoveredNodeIds: Set<string>;
  onHovered: (id: string | null) => void;
  onNodeClick: (id: string) => void;
  justClickedId: string | null;
}) {
  // Preserve first-encountered group order; nodes without a group go last.
  const groups = useMemo(() => {
    const out = new Map<string, Node[]>();
    const noGroup: Node[] = [];
    for (const n of nodes) {
      const g = n.group ?? "";
      if (!g) { noGroup.push(n); continue; }
      if (!out.has(g)) out.set(g, []);
      out.get(g)!.push(n);
    }
    const entries = Array.from(out.entries());
    if (noGroup.length) entries.push(["", noGroup]);
    return entries;
  }, [nodes, groupBy]);

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map(([label, groupNodes]) => (
        <div key={label || "__nogroup"}>
          {label && (
            <div className="mb-1">
              <span className="text-[9px] font-mono font-semibold tracking-widest uppercase text-text-tertiary">
                {label}
              </span>
            </div>
          )}
          <NodeList nodes={groupNodes} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
        </div>
      ))}
    </div>
  );
}

/** ── A wrapping row of node cards. ─────────────────────────────────────── */
function NodeList({
  nodes,
  hoveredNodeIds,
  onHovered,
  onNodeClick,
  justClickedId,
}: {
  nodes: Node[];
  hoveredNodeIds: Set<string>;
  onHovered: (id: string | null) => void;
  onNodeClick: (id: string) => void;
  justClickedId: string | null;
}) {
  return (
    <div className="flex flex-wrap content-start items-start gap-2">
      {nodes.map((n) => (
        <NodeCard key={n.id} node={n} hoveredNodeIds={hoveredNodeIds} onHovered={onHovered} onNodeClick={onNodeClick} justClickedId={justClickedId} />
      ))}
    </div>
  );
}

/** ── One node card. ───────────────────────────────────────────────────── */
function NodeCard({
  node,
  hoveredNodeIds,
  onHovered,
  onNodeClick,
  justClickedId,
}: {
  node: Node;
  hoveredNodeIds: Set<string>;
  onHovered: (id: string | null) => void;
  onNodeClick: (id: string) => void;
  justClickedId: string | null;
}) {
  const [hovered, setHovered] = useState(false);

  // Dim nodes that are neither hovered themselves nor connected to the hovered node.
  const isHovered = hoveredNodeIds.size > 0;
  const isHighlighted = isHovered && hoveredNodeIds.has(node.id);
  const isDimmed = isHovered && !hoveredNodeIds.has(node.id);

  const stroke = node.borderColor ?? (node.fill === "purple" ? "var(--datamap-purple)" : nodeStroke(node.type));
  const badge = node.badge;
  const isLlmBadge = badge === "🤖";
  // Badge follows the node border when it is overridden (cron TRIGGER → red);
  // otherwise the layer-target ink (purple for LLM, accent otherwise).
  const badgeFill = isLlmBadge
    ? "rgba(168,85,247,0.13)"
    : node.borderColor
    ? `color-mix(in srgb, ${node.borderColor} 13%, transparent)`
    : "rgba(0,104,122,0.13)";
  const badgeStroke = isLlmBadge
    ? "rgba(168,85,247,0.45)"
    : node.borderColor
    ? `color-mix(in srgb, ${node.borderColor} 45%, transparent)`
    : "rgba(0,104,122,0.40)";
  const badgeTextColor = isLlmBadge ? "var(--datamap-purple)" : node.borderColor ?? "var(--accent)";
  const isShadow = node.id === "L1b";

  return (
    <div
      data-node-id={node.id}
      className={`relative flex flex-col gap-0.5 px-3 pt-2 pb-2 rounded-lg border datamap-card transition-all${node.id === justClickedId ? " active" : ""}`}
      style={{
        width: NODE_W,
        height: NODE_H,
        background: node.fill === "purple"
          ? "rgba(168,85,247,0.08)"
          : node.type === "surface"
          ? "#ffffff"
          : "var(--bg-elevated)",
        borderColor: stroke,
        borderWidth: isHighlighted ? 2 : 1,
        opacity: isDimmed ? 0.25 : isHighlighted ? 1 : 0.92,
        cursor: "pointer",
        userSelect: "none",
        zIndex: isHighlighted ? 50 : hovered ? 40 : node.fill === "purple" ? 35 : 10,
      }}
      onMouseEnter={() => { setHovered(true); onHovered(node.id); }}
      onMouseLeave={() => { setHovered(false); onHovered(null); }}
      onClick={(e) => { e.stopPropagation(); onNodeClick(node.id); }}
      tabIndex={0}
      role="button"
      aria-label={`[${node.section ?? "—"}] ${node.name}: ${node.summary}${badge ? ` →${badge}` : ""}`}
      onFocus={() => { setHovered(true); onHovered(node.id); }}
      onBlur={() => { setHovered(false); onHovered(null); }}
    >
      {/* Section number badge — top-left, coloured to match node border. */}
      {node.section && (
        <span
          className="absolute top-1.5 left-1.5 inline-flex items-center justify-center rounded text-[8px] font-mono font-bold"
          style={{
            width: 20,
            height: 13,
            background: stroke,
            color: "#ffffff",
          }}
        >
          {node.section}
        </span>
      )}

      {/* Layer-target / LLM badge — top-right. */}
      {badge && (
        <span
          className="absolute top-1.5 right-1.5 inline-flex items-center justify-center rounded text-[8px] font-mono font-semibold"
          style={{
            width: 38,
            height: 13,
            background: badgeFill,
            border: `1px solid ${badgeStroke}`,
            color: badgeTextColor,
          }}
        >
          {badge}
        </span>
      )}

      {/* SHADOW pill — bottom-right. */}
      {isShadow && (
        <span
          className="absolute bottom-1.5 right-1.5 inline-flex items-center justify-center rounded text-[7.5px] font-mono font-semibold"
          style={{
            width: 48,
            height: 13,
            background: "rgba(168,50,9,0.10)",
            border: "1px solid rgba(168,50,9,0.35)",
            color: "var(--warning)",
          }}
        >
          SHADOW
        </span>
      )}

      {/* Node id (mono caption). */}
      <span
        className="text-[9.5px] font-mono tracking-wide mt-3"
        style={{ color: "var(--text-tertiary)" }}
      >
        {node.id}
      </span>

      {/* Node name. */}
      <span
        className="text-[12.5px] font-semibold leading-tight"
        style={{ color: "var(--text-primary)" }}
      >
        {truncate(node.name, 22)}
      </span>

      {/* Node summary. */}
      <span
        className="text-[10px] leading-tight"
        style={{ color: "var(--text-secondary)" }}
      >
        {truncate(node.summary, 28)}
      </span>
    </div>
  );
}

/** ── Helpers ─────────────────────────────────────────────────────────── */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function nodeStroke(t: NodeType): string {
  switch (t) {
    case "source":   return "var(--datamap-source)";
    case "pipeline": return "var(--datamap-compute)";
    case "table":    return "var(--datamap-db)";
    case "surface":  return "var(--datamap-frontend)";
    case "verify":   return "var(--datamap-verify)";
  }
}

/** The lane-card accent colour — matches the node border of that swimlane. */
function laneColor(type: NodeType): string {
  switch (type) {
    case "source":   return "var(--datamap-source)";
    case "pipeline": return "var(--datamap-compute)";
    case "table":    return "var(--datamap-db)";
    case "surface":  return "var(--datamap-frontend)";
    case "verify":   return "var(--datamap-verify)";
  }
}

/** ── Legend ───────────────────────────────────────────────────────────── */
function Legend() {
  return (
    <div className="mt-6 flex flex-col gap-3 text-[11px] text-text-tertiary">
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-mono uppercase tracking-[0.12em] shrink-0">Legend</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid var(--datamap-source)" }}
          />
          <span>External source</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid var(--datamap-compute)" }}
          />
          <span>Deterministic quantitative pipeline</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid var(--datamap-db)" }}
          />
          <span>Supabase table</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid var(--datamap-frontend)" }}
          />
          <span>Frontend surface</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "rgba(168,85,247,0.08)", border: "1.5px solid var(--datamap-purple)" }}
          />
          <span>LLM boundary</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded"
            style={{ background: "var(--bg-elevated)", border: "1.5px solid var(--datamap-verify)" }}
          />
          <span>Verification</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="font-mono uppercase tracking-[0.12em] shrink-0">Interact</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          <span>hover a node to trace its upstream + downstream path</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--warning)" }} />
          <span>click a node to lock the trace</span>
        </span>
      </div>
    </div>
  );
}

/** ── NodeTable — accessibility companion ────────────────────────────────── */
function NodeTable({ nodes }: { nodes: Node[] }) {
  const grouped = useMemo(() => {
    const out: Record<NodeType, Node[]> = { source: [], pipeline: [], table: [], surface: [], verify: [] };
    for (const n of nodes) out[n.type].push(n);
    return out;
  }, [nodes]);

  return (
    <div className="mt-10">
      <h2 className="text-[15px] font-semibold m-0 mb-3">All nodes, in text</h2>
      <p className="m-0 mb-5 text-[12.5px] text-text-secondary max-w-[80ch]">
        Same content as the map above, in case the cards are hard to read on your
        device or you prefer a list. Each row links to the doc that records it.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        {(Object.keys(grouped) as NodeType[]).map((k) => (
          <section key={k}>
            <h3 className="text-[11px] font-mono uppercase tracking-[0.12em] text-text-tertiary m-0 mb-2">
              {LANE_LABEL[k]}
            </h3>
            <ul className="m-0 p-0 list-none space-y-2">
              {grouped[k].map((n) => (
                <li
                  key={n.id}
                  className="text-[12.5px] border-l-2 border-transparent hover:border-border pl-3 py-0.5"
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="num text-text-tertiary text-[10.5px]">{n.id}</span>
                    <span className="font-semibold text-text-primary">{n.name}</span>
                    {n.badge && (
                      <span
                        className="text-[9px] font-mono font-semibold px-1 py-px rounded"
                        style={{
                          backgroundColor: n.badge === "🤖" ? "rgba(168,85,247,0.13)" : "rgba(0,104,122,0.13)",
                          color: n.badge === "🤖" ? "var(--datamap-purple)" : "var(--accent)",
                        }}
                      >
                        {n.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-text-secondary mt-0.5">{n.summary}</div>
                  {n.doc ? (
                    <div className="text-text-tertiary text-[11px] mt-0.5 num">{n.doc}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
