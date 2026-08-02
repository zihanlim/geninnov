"use client";

// frontend/app/datamap/page.tsx
//
// /datamap — an animated master map of the research process.
//
// A single visual page showing how data flows from external sources through
// the L0–L8 pipeline, into Supabase, and out to the frontend surfaces.
//
// The layout is vertical: sections 01–13 stack top-to-bottom (matching the
// reference HTML diagram). Within a section, nodes flex-wrap left-to-right.
// Edges are drawn in an SVG overlay that is sized to the DOM after the
// flex layout paints. Node positions are captured with a ResizeObserver so
// edge paths connect the right pixel coordinates even after wrap.
//
// The data for the map is in `dataMap.ts` — every node, edge, and section
// is declared there. The renderer never hard-codes a node.
//
// Animations use only the existing CSS keyframes (fade-in, pulse-soft, shimmer)
// and SVG stroke-dasharray. No new dependencies.

import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  EdgeKind,
  MapEdge,
  Node,
  NodeType,
  mapNodes,
  mapEdges,
  sectionOrder,
  swimlaneOrder,
} from "@/components/datamap/dataMap";

/** Pixel positions of every rendered node, relative to the map container. */
interface NodePos {
  id: string;
  x: number; // left edge
  y: number; // top edge
  w: number;
  h: number;
  cx: number; // x + w/2
  bottom: number; // y + h
}

const NODE_W = 168;
const NODE_H = 70;
const NODE_GAP = 14;
const SECTION_HDR = 40; // px, section header height
const SECTION_PAD = 8; // px, vertical padding between header and nodes
const NODE_ROW_H = NODE_H + NODE_GAP; // used for section row-height estimate

export default function DataMapPage() {
  const nodes = useMemo(() => mapNodes, []);
  const edges = useMemo(() => mapEdges, []);

  // Nodes grouped by their section string (e.g. "01", "11").
  const nodesBySection = useMemo(() => {
    const out = new Map<string, Node[]>();
    for (const s of sectionOrder) out.set(s.section, []);
    for (const n of nodes) {
      const sec = n.section ?? "??";
      if (!out.has(sec)) out.set(sec, []);
      const bucket = out.get(sec)!;
      bucket.push(n);
    }
    // Sort within section by swimlane-order position.
    out.forEach((list: Node[], sec: string) => {
      const lane = laneOf(sec);
      if (lane) {
        list.sort((a: Node, b: Node) => {
          const ai = swimlaneOrder[lane]?.indexOf(a.id) ?? 999;
          const bi = swimlaneOrder[lane]?.indexOf(b.id) ?? 999;
          return ai - bi;
        });
      }
    });
    return out;
  }, [nodes]);

  // All node positions, captured from the DOM after paint.
  const [nodePosMap, setNodePosMap] = useState<Map<string, NodePos>>(new Map());

  // Ref on the map container — used to observe node positions.
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Capture all node positions; re-run whenever the DOM changes.
    const observer = new ResizeObserver(() => {
      const mapEl = mapRef.current;
      if (!mapEl) return;
      const mapRect = mapEl.getBoundingClientRect();
      const newMap = new Map<string, NodePos>();
      const cards = Array.from(mapEl.querySelectorAll("[data-node-id]")) as HTMLElement[];
      for (const card of cards) {
        const el = card as HTMLElement;
        const rect = el.getBoundingClientRect();
        const id = el.dataset.nodeId!;
        newMap.set(id, {
          id,
          x: rect.left - mapRect.left,
          y: rect.top - mapRect.top,
          w: rect.width,
          h: rect.height,
          cx: rect.left - mapRect.left + rect.width / 2,
          bottom: rect.top - mapRect.top + rect.height,
        });
      }
      setNodePosMap(newMap);
    });

    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  // Edge paths computed from current node positions.
  const edgePaths = useMemo(() => {
    if (!nodePosMap.size) return [];
    return mapEdges.map((e): EdgePath | null => {
      const src = nodePosMap.get(e.from);
      const tgt = nodePosMap.get(e.to);
      if (!src || !tgt) return null;
      const kind = e.kind ?? "solid";
      const depth = clamp(Math.abs(tgt.y - src.bottom) * 0.55, 30, 200);
      const d = `M ${src.cx} ${src.bottom} C ${src.cx} ${src.bottom + depth}, ${tgt.cx} ${tgt.y - depth}, ${tgt.cx} ${tgt.y}`;
      const srcNode = nodes.find(n => n.id === e.from);
      const color = srcNode ? nodeBorderColor(srcNode) : edgeColor(kind);
      return { key: `${e.from}-${e.to}`, d, kind, label: e.label, from: e.from, to: e.to, color };
    }).filter((p): p is EdgePath => p !== null);
  }, [nodePosMap]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <PageHeader
        title="Data Map"
        lede="Every part of the research process, end to end. Hover a node to trace it; the page animates so a flow is legible at a glance."
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

      {/* ── The map itself: sections 01→13 stacked vertically. ────────── */}
      <div
        ref={mapRef}
        className="mt-6 relative rounded-xl border border-border overflow-hidden"
        style={{ minHeight: 400 }}
        role="img"
        aria-label="Animated map of the research process from data sources to frontend surfaces"
      >
        {/* SVG overlay: sized by ResizeObserver. pointer-events=none lets clicks pass through.
            Rendered first so sections/nodes stack on top at z-0. */}
        {nodePosMap.size > 0 && (
          <EdgeOverlay edgePaths={edgePaths} mapRef={mapRef} />
        )}

        {/* Sections stacked top-to-bottom. */}
        {sectionOrder.map((sec) => {
          const secNodes = nodesBySection.get(sec.section) ?? [];
          if (!secNodes.length) return null;
          return (
            <SectionBlock key={sec.section} section={sec} nodes={secNodes} />
          );
        })}
      </div>

      <NodeTable nodes={nodes} />
    </main>
  );
}

/** ── One section: dark header + flex-wrap row of node cards. ───────────── */
function SectionBlock({
  section,
  nodes,
}: {
  section: { section: string; title: string };
  nodes: Node[];
}) {
  // For section 12 and section 03, group nodes by their `group` field and render sub-group labels.
  const isGrouped = section.section === "12" || section.section === "03" || section.section === "05";

  if (isGrouped) {
    // Group nodes by group field; nodes without a group go into a single block.
    const groups = new Map<string, Node[]>();
    for (const n of nodes) {
      const g = n.group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(n);
    }
    const groupEntries = Array.from(groups.entries());

    return (
      <div className="relative max-w-full overflow-hidden">
        {/* Section header. */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border"
          style={{ background: "rgba(10,14,23,0.04)" }}>
          <span
            className="inline-flex items-center justify-center w-6 h-4 rounded text-[9px] font-mono font-bold shrink-0"
            style={{ background: "rgba(10,14,23,0.10)", color: "var(--text-secondary)" }}
          >
            {section.section}
          </span>
          <span className="text-[12px] font-medium text-text-secondary">
            {section.title}
          </span>
          <span className="text-[11px] text-text-tertiary ml-auto font-mono">
            {nodes.length} node{nodes.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Grouped node rows with sub-group labels. */}
        {groupEntries.map(([groupLabel, groupNodes]) => (
          <div key={groupLabel}>
            {/* Sub-group label. */}
            {groupLabel && (
              <div className="px-4 pt-3 pb-1">
                <span
                  className="inline-flex items-center text-[9px] font-mono font-semibold tracking-widest uppercase"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {groupLabel}
                </span>
              </div>
            )}
            <div
              className="flex flex-wrap justify-center items-start gap-3 px-4 pb-3"
              style={{ minHeight: NODE_H + 16 }}
            >
              {groupNodes.map((n) => (
                <NodeCard key={n.id} node={n} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative max-w-full overflow-hidden">
      {/* Section header. */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border"
        style={{ background: "rgba(10,14,23,0.04)" }}>
        <span
          className="inline-flex items-center justify-center w-6 h-4 rounded text-[9px] font-mono font-bold shrink-0"
          style={{ background: "rgba(10,14,23,0.10)", color: "var(--text-secondary)" }}
        >
          {section.section}
        </span>
        <span className="text-[12px] font-medium text-text-secondary">
          {section.title}
        </span>
        <span className="text-[11px] text-text-tertiary ml-auto font-mono">
          {nodes.length} node{nodes.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Node row — flex-wrap, centred so partial rows look balanced. */}
      <div
        className="flex flex-wrap justify-center items-start gap-3 px-4 py-3"
        style={{ minHeight: NODE_H + 16 }}
      >
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
      </div>
    </div>
  );
}

/** ── One node card. ───────────────────────────────────────────────────── */
function NodeCard({ node }: { node: Node }) {
  const [hovered, setHovered] = useState(false);

  const stroke = node.borderColor ?? (node.tint === "purple" ? "var(--datamap-purple)" : nodeStroke(node.type));
  const badge = node.badge;
  const isLlmBadge = badge === "🤖";
  const badgeFill = isLlmBadge ? "rgba(168,85,247,0.13)" : "rgba(0,104,122,0.13)";
  const badgeStroke = isLlmBadge ? "rgba(168,85,247,0.45)" : "rgba(0,104,122,0.40)";
  const badgeTextColor = isLlmBadge ? "var(--datamap-purple)" : "var(--accent)";
  const isShadow = node.id === "L1b";
  const isTinted = node.tint && node.tint !== "purple";

  return (
    <div
      data-node-id={node.id}
      className="relative flex flex-col gap-0.5 px-3 pt-2 pb-2 rounded-lg border datamap-card transition-all"
      style={{
        width: NODE_W,
        height: NODE_H,
        background: node.tint === "purple"
          ? "rgba(168,85,247,0.05)"
          : isTinted
          ? `var(--datamap-tint-${node.tint})`
          : node.type === "surface"
          ? "#ffffff"
          : "var(--bg-elevated)",
        borderColor: stroke,
        borderWidth: 1,
        opacity: hovered ? 1 : 0.92,
        cursor: "pointer",
        userSelect: "none",
        zIndex: hovered ? 40 : node.tint === "purple" ? 35 : 10,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      role="button"
      aria-label={`[${node.section ?? "—"}] ${node.name}: ${node.summary}${badge ? ` →${badge}` : ""}`}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {/* Section number badge — top-left. */}
      {node.section && (
        <span
          className="absolute top-1.5 left-1.5 inline-flex items-center justify-center rounded text-[8px] font-mono font-bold"
          style={{
            width: 20,
            height: 13,
            background: "rgba(10,14,23,0.10)",
            color: "var(--text-secondary)",
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

/** ── SVG edge overlay. ─────────────────────────────────────────────────── */
interface EdgePath {
  key: string;
  d: string;
  kind: EdgeKind;
  label?: string;
  from: string;
  to: string;
  /** Colour inherited from the source node's border color. */
  color: string;
}

function EdgeOverlay({
  edgePaths,
  mapRef,
}: {
  edgePaths: EdgePath[];
  mapRef: React.RefObject<HTMLDivElement>;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!mapRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = mapRef.current!.getBoundingClientRect();
      setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, [mapRef]);

  if (!dims.w || !dims.h) return null;

  return (
    <svg
      width={dims.w}
      height={dims.h}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0, pointerEvents: "none", fill: "none" }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="dm-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <marker
          id="dm-arrow-purple"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>

      {edgePaths.map((ep) => {
        const animated = ep.kind !== "dashed";
        const color = ep.color;
        const mid = bezierMid(ep.d);

        return (
          <g key={ep.key} style={{ color }} opacity={0.75}>
            {animated ? (
              <>
                {/* Dim static spine. */}
                <path
                  d={ep.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.25}
                  opacity={0.3}
                  markerEnd={`url(#dm-arrow${ep.kind === "purple" ? "-purple" : ""})`}
                />
                {/* Animated dash overlay. */}
                <path
                  d={ep.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="4 8"
                  style={{ animation: "datamap-flow 1.6s linear infinite" }}
                />
              </>
            ) : (
              <path
                d={ep.d}
                fill="none"
                stroke={color}
                strokeWidth={1.25}
                strokeDasharray="3 4"
                opacity={0.6}
                markerEnd={`url(#dm-arrow${ep.kind === "purple" ? "-purple" : ""})`}
              />
            )}
            {/* Edge label, if any. */}
            {ep.label && mid && (
              <>
                <rect
                  x={mid.x - 28}
                  y={mid.y - 7}
                  width={56}
                  height={14}
                  rx={3}
                  fill="var(--datamap-label-bg)"
                />
                <text
                  x={mid.x}
                  y={mid.y + 4}
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  letterSpacing="0.08em"
                >
                  {ep.label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Approximate midpoint of a cubic bezier at t=0.5 (good enough for label placement). */
function bezierMid(d: string): { x: number; y: number } | null {
  // Parse M x0 y0 C x1 y1, x2 y2, x3 y3
  const m = d.match(
    /M\s*([\d.]+)\s+([\d.]+)\s+C\s*([\d.]+)\s+([\d.]+),\s*([\d.]+)\s+([\d.]+),\s*([\d.]+)\s+([\d.]+)/,
  );
  if (!m) return null;
  const [, x0, y0, x1, y1, x2, y2, x3, y3] = m.map(Number);
  const t = 0.5;
  const mt = 1 - t;
  return {
    x: mt ** 3 * x0 + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
    y: mt ** 3 * y0 + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3,
  };
}

/** ── Helpers ─────────────────────────────────────────────────────────── */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The effective border colour of a node — mirrors the NodeCard stroke logic. */
function nodeBorderColor(n: { borderColor?: string; tint?: string; type: NodeType }): string {
  if (n.borderColor) return n.borderColor;
  if (n.tint === "purple") return "var(--datamap-purple)";
  return nodeStroke(n.type);
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

function edgeColor(kind: EdgeKind): string {
  switch (kind) {
    case "purple": return "var(--datamap-purple)";
    case "dashed": return "var(--datamap-dashed)";
    case "solid": return "var(--accent)";
  }
}

/** Which swimlane a section belongs to (for ordering within a section). */
function laneOf(sec: string): NodeType | null {
  if (sec === "01") return "source";
  if (["02","03","04","05","06","07","08","09","10","11"].includes(sec)) return "pipeline";
  if (sec === "12") return "table";
  if (sec === "13") return "surface";
  if (sec === "14") return "verify";
  return null;
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
          <span>L0–L8 pipeline</span>
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-mono uppercase tracking-[0.12em] shrink-0">Edges</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-px" style={{ background: "var(--accent)" }} />
          <span>flow — primary</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-px" style={{ background: "var(--datamap-purple)" }} />
          <span>flow — LLM call</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-px border-t border-dashed" style={{ borderColor: "var(--datamap-dashed)" }} />
          <span>shadow / optional / reference (static)</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="font-mono uppercase tracking-[0.12em] shrink-0">Interact</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          <span>hover a node to trace its upstream + downstream path</span>
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

  const labels: Record<NodeType, string> = {
    source: "External data sources",
    pipeline: "L0–L8 pipeline",
    table: "Supabase tables (representative)",
    surface: "Frontend surfaces",
    verify: "Offline verification",
  };

  return (
    <div className="mt-10">
      <h2 className="text-[15px] font-semibold m-0 mb-3">All nodes, in text</h2>
      <p className="m-0 mb-5 text-[12.5px] text-text-secondary max-w-[80ch]">
        Same content as the map above, in case the SVG is hard to read on your
        device or you prefer a list. Each row links to the doc that records it.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        {(Object.keys(grouped) as NodeType[]).map((k) => (
          <section key={k}>
            <h3 className="text-[11px] font-mono uppercase tracking-[0.12em] text-text-tertiary m-0 mb-2">
              {labels[k]}
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
