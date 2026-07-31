"use client";
// frontend/components/book/BookFunnel.tsx
//
// The chain, drawn: how the day's candidates became the day's book.
//
// Replaces `PoolDepth`, which answered the same question ("why not five and
// five?") in prose and bars. Same measurement, same source columns, same
// vocabulary -- but the answer is a SEQUENCE, and a stack of counts does not
// show a sequence. The specific thing PoolDepth could not say: which STEP the
// missing position died at. On 2026-07-30 the agent chose five longs and the
// sizer zeroed one, and reading that off the page took three panels.
//
// WHY NOT SVG. The chain is five boxes and four connectors, and every figure in
// it is text a reader may want to select, search with Ctrl-F, or hear from a
// screen reader. In SVG all of that has to be rebuilt by hand. The connectors
// are the only graphic element and they are CSS borders. This is the same
// choice `SizingChainView` made for the per-position chain -- one idiom, not two.
//
// DIRECTION IS GLYPH + WORDMARK (design goal 3). The long/short split renders
// as an arrow AND a letter, never as colour alone: desaturate the page and the
// split still reads. Colour reinforces; it does not carry.
//
// THE SELECTION. Tickers in the final node are buttons. Clicking one selects
// the position whose lineage `WorkedExamplePanel` renders directly below, so
// the population view and the per-name view are one interaction apart rather
// than two panels that never refer to each other. ADR-0081 rendered exactly one
// lineage per page load, chosen by highest |EdgeScore|, "so it does not bloat
// the page" -- that reason survives selection untouched: all nine are
// reachable, one is rendered, and the |EdgeScore| pick becomes the DEFAULT
// rather than the only option.
//
// A NAME THE SIZER DROPPED IS NOT SELECTABLE, and that is not an oversight. It
// has no row in `picks`, so there is no lineage to render; offering a button
// that opens an empty panel would be worse than showing it as what it is. It
// renders on the edge that removed it, with the constraint that did the
// removing.

import { useMemo } from "react";
import {
  buildBookFunnel,
  funnelHeadline,
  type FunnelInputs,
  type FunnelNode,
} from "@/lib/book/bookFunnel";

/** The table every node but one reads from. Stated once under the chain so each
 *  card can show only the column, which is the part that differs. */
const SHARED_TABLE = "research_recommendations";

/** Long/short split as glyph + letter + count. Colour is the third signal. */
function Split({ long, short }: { long: number | null; short: number | null }) {
  if (long === null && short === null) return null;
  return (
    <span className="flex items-baseline gap-2 text-[11px] num">
      {long !== null && (
        <span style={{ color: "var(--long)" }} title={`${long} long`}>
          {"▲"}L&nbsp;{long}
        </span>
      )}
      {short !== null && (
        <span style={{ color: "var(--short)" }} title={`${short} short`}>
          {"▼"}S&nbsp;{short}
        </span>
      )}
    </span>
  );
}

function Node({
  node,
  emphasise,
  children,
}: {
  node: FunnelNode;
  emphasise?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border bg-bg-primary p-3 min-w-0 flex flex-col gap-1.5"
      style={{
        borderColor: emphasise ? "var(--accent)" : "var(--border)",
        // The final node is where the reader's eye should land: it is the book.
        borderWidth: emphasise ? 2 : 1,
      }}
      data-testid={`funnel-node-${node.id}`}
    >
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-text-tertiary">
        {node.label}
      </div>
      {node.total === null ? (
        // Goal 2: absence is stated with its cause. A zero here would claim the
        // screen found nothing, which is a different and much worse assertion.
        <>
          <div className="num text-[20px] text-text-tertiary leading-none">{"—"}</div>
          <div className="text-[11px] text-text-tertiary leading-[1.5]">{node.cause}</div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="num text-[22px] text-text-primary leading-none">
              {node.total}
            </span>
            <span className="text-[11px] text-text-tertiary">{node.unit}</span>
          </div>
          <Split long={node.long} short={node.short} />
        </>
      )}
      {/* Rendered directly under the count it qualifies, not in the prose block
          below the chain: a reader who reads "42 candidates, 29 long" on the
          credit page and looks away has already taken a number that is not this
          book's. The qualifier has to be inside the same card. */}
      {node.note && (
        <p className="m-0 text-[10.5px] text-text-tertiary leading-[1.45]">{node.note}</p>
      )}
      {children}
      {/* Goal 1: the figure names the column it came from, on the same card.
          `break-all` split every one of these mid-word at a ~200px column
          (`research_recommendations.scree | ning_funnel`, `pick | s`), which is
          a citation a reader has to reassemble before they can check it. The
          shared table prefix is stated ONCE under the chain instead, so each
          card carries the part that differs; a source on another table keeps its
          full name and is the only place a table appears up here. */}
      <div className="text-[10px] text-text-tertiary num mt-auto pt-1 leading-[1.45]">
        {node.source.split(" + ").map((s, i) => (
          <span key={s} className="block">
            {i > 0 ? "+ " : ""}
            {s.startsWith(SHARED_TABLE + ".") ? s.slice(SHARED_TABLE.length + 1) : s}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BookFunnel({
  inputs,
  selectedAsset,
  onSelectAsset,
}: {
  inputs: FunnelInputs;
  /** Which ticker's lineage is showing below, so the chip can mark itself. */
  selectedAsset?: string | null;
  onSelectAsset?: (asset: string) => void;
}) {
  const funnel = useMemo(() => buildBookFunnel(inputs), [inputs]);
  const headline = useMemo(() => funnelHeadline(funnel), [funnel]);

  if (!funnel.available) return null;

  const published = funnel.nodes.find((n) => n.id === "published");
  const publishedAssets = (inputs.picks ?? [])
    .map((p) => ({ asset: String(p?.asset ?? ""), direction: p?.direction ?? null }))
    .filter((p) => p.asset);

  return (
    <section
      className="card mb-6"
      data-testid="book-funnel"
      aria-label="How the candidate pool became the published book"
    >
      <div className="card-header">
        <h2 className="card-title m-0">From pool to book</h2>
        <span className="text-[11px] text-text-tertiary">
          Every step, and what it cost
        </span>
      </div>
      <div className="card-body">
        {headline && (
          // Only rendered when the agent MET five-and-five and the sizer then
          // cut it. On a run where the pool was genuinely thin this is absent,
          // so the sentence cannot become wallpaper.
          <p
            className="m-0 mb-4 text-[12.5px] leading-[1.6] text-text-primary max-w-[80ch]"
            data-testid="funnel-headline"
          >
            {headline}
          </p>
        )}

        {/* The chain. Vertical below `lg` -- a five-across row of boxes at phone
            width is four line-broken numbers and no legible flow.
            NINE TRACKS, NOT FIVE. Each `<li>` is `display: contents`, so it emits
            TWO grid items (its connector and its node) rather than one; five
            columns therefore wrapped the chain mid-flow, putting `Agent selected`
            on a second row under `L1 screen` and breaking the left-to-right
            reading the panel exists for. The tracks alternate 1fr/auto so the
            nodes share a width and the connectors take only the label. */}
        <ol className="m-0 p-0 list-none grid gap-0 items-stretch lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          {funnel.nodes.map((node, i) => {
            const edge = funnel.edges.find((e) => e.to === node.id);
            return (
              <li key={node.id} className="min-w-0 contents">
                {/* The connector carries the edge's label and cost. It is the
                    only place a removal is described, so it is never decoration. */}
                {i > 0 && edge && (
                  <div
                    className="flex lg:flex-col items-center justify-center gap-1 py-2 lg:py-0 lg:px-1"
                    data-testid={`funnel-edge-${node.id}`}
                  >
                    <div
                      className="shrink-0 lg:w-full lg:h-0 h-6 w-0 border-l lg:border-l-0 lg:border-t"
                      style={{
                        borderColor: edge.notable ? "var(--warning)" : "var(--border)",
                        borderWidth: edge.notable ? 2 : 1,
                      }}
                      aria-hidden
                    />
                    <span
                      className="text-[10px] num whitespace-nowrap"
                      style={{
                        color: edge.notable ? "var(--warning)" : "var(--text-tertiary)",
                      }}
                    >
                      {/* `−0` is noise, not information: an edge that removed
                          nothing should read as a step, not as a cost of zero.
                          Live on the credit lens, where the agent took all three
                          available ideas. */}
                      {edge.removed ? `−${edge.removed}` : ""} {edge.label}
                    </span>
                  </div>
                )}
                <Node node={node} emphasise={node.id === "published"}>
                  {node.id === "published" && publishedAssets.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {publishedAssets.map((p) => {
                        const active = selectedAsset === p.asset;
                        return (
                          <button
                            key={p.asset}
                            type="button"
                            onClick={() => onSelectAsset?.(p.asset)}
                            aria-pressed={active}
                            title={`Show the lineage for ${p.asset}`}
                            className="num text-[10.5px] px-1.5 py-0.5 rounded border transition-colors"
                            style={{
                              borderColor: active ? "var(--accent)" : "var(--border)",
                              background: active ? "var(--accent)" : "transparent",
                              color: active
                                ? "var(--bg-primary)"
                                : p.direction === "long"
                                  ? "var(--long)"
                                  : "var(--short)",
                            }}
                          >
                            {p.direction === "long" ? "▲" : "▼"}
                            {p.asset}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Node>
              </li>
            );
          })}
        </ol>

        {/* The prose for each step, below the chain rather than inside a box.
            A connector that had to hold this text would set the column width
            for the whole row, and the numbers are what the row is for. */}
        <dl className="m-0 mt-4 grid gap-2.5 sm:grid-cols-2 text-[12px] leading-[1.55]">
          {funnel.edges.map((edge) => (
            <div key={edge.to} className="min-w-0">
              <dt
                className="num text-[10.5px] uppercase tracking-[0.08em]"
                style={{
                  color: edge.notable ? "var(--warning)" : "var(--text-tertiary)",
                }}
              >
                {edge.label}
                {edge.removed ? ` · −${edge.removed}` : ""}
              </dt>
              <dd className="m-0 text-text-secondary">
                {edge.detail}
                {edge.names?.length ? (
                  <span className="num text-[11px] text-text-tertiary">
                    {" "}
                    {edge.names.join(" · ")}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>

        {/* The table the columns above belong to. Goal 1 asks that a reader can
            follow any figure to its origin without asking; the cards carry the
            column and this carries the table, which is the same claim split
            across two lines rather than repeated five times. */}
        <p className="m-0 mt-4 text-[11px] text-text-tertiary leading-[1.55] max-w-[80ch]">
          Columns above are on <span className="num">{SHARED_TABLE}</span> for the
          published run unless another table is named.
          {published && (
            <>
              {" "}
              Select a ticker to trace that position through the pipeline, step by step,
              in the panel below. A name the sizer did not fund has no published row and
              so has no lineage to show; it appears on the step that removed it.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
