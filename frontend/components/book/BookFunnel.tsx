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

import { Fragment, useMemo, useState } from "react";
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

  // ── Where the open card goes ────────────────────────────────────────────────
  // `position: fixed`, because the panel is a `.card` and `.card` carries
  // `overflow-hidden` — load-bearing, it is what clips the header fill flush to
  // the 10px radius. An absolutely-positioned card inside it was therefore cut
  // off at the panel's edge, which on the rightmost connector meant losing the
  // end of the sizer's explanation. A fixed element is positioned against the
  // viewport and escapes ancestor overflow (no ancestor here establishes a
  // containing block via transform/filter), so it can sit outside the panel.
  //
  // Coordinates come from the TRIGGER's own rect at open time rather than from
  // a static offset, which is also what puts the card next to the pointer: the
  // reader's cursor is on that label when it opens.
  const [tip, setTip] = useState<{ id: string; left: number; top: number } | null>(
    null,
  );
  const openTip = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 304; // w-[19rem]
    setTip({
      id,
      // Centred on the trigger, then clamped so a card on the rightmost
      // connector does not run off the viewport it just escaped into.
      left: Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8),
      top: r.bottom + 8,
    });
  };

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

        {/* The chain, and each step's account of itself directly beneath it.
            The explanations used to be a two-column definition list below the
            whole row, so "why did 12 candidates go?" was answered several
            hundred pixels from the `−12` that raised the question and in a
            different reading order. They are now the SECOND ROW of the same
            grid, each one starting in its own connector's column.

            EXPLICIT PLACEMENT, and a flex column below `lg`. The columns cannot
            be Tailwind classes because they are computed per index and Tailwind
            only generates literal class strings — so they are inline
            `gridColumn` / `gridRow`, which the browser ignores while the
            container is `flex`. That is what makes the narrow layout work with
            no second code path: DOM order is already node, connector, prose,
            node, … so stacked it reads in pipeline order.

            NINE TRACKS. Nodes land on the odd columns, connectors on the even
            ones, and each prose cell starts at its connector and spans into the
            node it produced. */}
        <div className="m-0 p-0 flex flex-col gap-3 lg:grid lg:gap-x-0 lg:gap-y-3 lg:items-stretch lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          {funnel.nodes.map((node, i) => {
            const edge = funnel.edges.find((e) => e.to === node.id);
            const edgeCol = i * 2;           // 2, 4, 6, 8 for i = 1..4
            return (
              <Fragment key={node.id}>
                {/* The connector carries the edge's label and cost. It is the
                    only place a removal is named, so it is never decoration. */}
                {i > 0 && edge && (
                  <div
                    className="relative group flex lg:flex-col items-center justify-center gap-1 py-1 lg:py-0 lg:px-1"
                    style={{ gridColumn: edgeCol, gridRow: 1 }}
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
                    {/* A BUTTON, not a span with a `title`. The card below opens
                        on hover AND on focus, so it is reachable by keyboard and
                        by tap; a `title` attribute is neither, and a hover-only
                        affordance on a touch screen is a fact the reader simply
                        cannot get to. */}
                    <button
                      type="button"
                      aria-describedby={`funnel-tip-${node.id}`}
                      onMouseEnter={(e) => openTip(node.id, e.currentTarget)}
                      onFocus={(e) => openTip(node.id, e.currentTarget)}
                      onMouseLeave={() => setTip((t) => (t?.id === node.id ? null : t))}
                      onBlur={() => setTip((t) => (t?.id === node.id ? null : t))}
                      className="text-[10px] num whitespace-nowrap underline decoration-dotted underline-offset-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      style={{
                        color: edge.notable ? "var(--warning)" : "var(--text-tertiary)",
                      }}
                    >
                      {edge.removed ? `−${edge.removed}` : ""} {edge.label}
                    </button>
                    <div
                      role="tooltip"
                      id={`funnel-tip-${node.id}`}
                      data-testid={`funnel-detail-${node.id}`}
                      // Centred on the connector and BELOW it, so it never covers
                      // the number it explains. `invisible` rather than unmounted:
                      // the text stays in the DOM, so Ctrl-F still finds "turnover
                      // at cap" and a screen reader can reach it through
                      // aria-describedby.
                      // Pointer events stay ON. The card is a child of the same `group`, so
                      // hovering INTO it keeps it open — which is what lets a reader
                      // select the complex chips or the turnover figures rather than
                      // watching them vanish as the cursor arrives.
                      // Rendered ALWAYS, hidden when not active, rather than
                      // mounted on demand: the text has to stay in the DOM for a
                      // browser find to reach "turnover at cap" and for
                      // aria-describedby to resolve.
                      className={`${
                        tip?.id === node.id ? "visible opacity-100" : "invisible opacity-0"
                      } transition-opacity fixed z-50 w-[19rem] max-w-[90vw] text-left card p-3 shadow-lg`}
                      style={
                        tip?.id === node.id
                          ? { left: tip.left, top: tip.top }
                          : { left: -9999, top: -9999 }
                      }
                    >
                      <div
                        className="num text-[10px] uppercase tracking-[0.08em] mb-1"
                        style={{
                          color: edge.notable ? "var(--warning)" : "var(--text-tertiary)",
                        }}
                      >
                        {edge.removed ? `−${edge.removed} ` : ""}
                        {edge.label}
                      </div>
                      <p className="m-0 text-[11.5px] leading-[1.55] text-text-secondary">
                        {edge.detail}
                      </p>
                      {edge.names?.length ? (
                        <ul className="m-0 mt-1.5 p-0 list-none flex flex-col gap-1">
                          {edge.names.map((n) => (
                            <li
                              key={n}
                              className="num text-[10.5px] text-text-tertiary rounded border border-border px-1.5 py-[2px] break-words"
                            >
                              {n}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                )}

                <div style={{ gridColumn: i * 2 + 1, gridRow: 1 }} className="min-w-0">
                  <Node node={node} emphasise={node.id === "published"}>
                    {node.id === "published" && publishedAssets.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {publishedAssets.map((pk) => {
                          const active = selectedAsset === pk.asset;
                          return (
                            <button
                              key={pk.asset}
                              type="button"
                              onClick={() => onSelectAsset?.(pk.asset)}
                              aria-pressed={active}
                              title={`Open the ${pk.asset} position`}
                              className="num text-[10.5px] px-1.5 py-0.5 rounded border transition-colors"
                              style={{
                                borderColor: active ? "var(--accent)" : "var(--border)",
                                background: active ? "var(--accent)" : "transparent",
                                color: active
                                  ? "var(--bg-primary)"
                                  : pk.direction === "long"
                                    ? "var(--long)"
                                    : "var(--short)",
                              }}
                            >
                              {pk.direction === "long" ? "▲" : "▼"}
                              {pk.asset}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </Node>
                </div>

              </Fragment>
            );
          })}
        </div>


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
              Select a ticker to open that position, with its own derivation, beside
              the book. A name the sizer did not fund has no published row and so has no
              lineage to show; it appears on the step that removed it.
            </>
          )}
        </p>

        {/* ── The screen, stage by stage ────────────────────────────────────
            The chain's first edge names only the stages that REMOVED something,
            because a cause is what a summary is for. But "the factor R-squared
            filter removed 0" is a fact a reader auditing the screen needs, and
            on this run six of the seven stages are exactly that.

            That listing lived in a separate collapsed `Audit -> Screening
            funnel` section: one dataset rendered twice, in two tabs, neither
            aware of the other — and briefly a sentence here pointing at the
            other one. A signpost between two panels is evidence they are one
            panel. So the detail now sits on the summary it details, closed by
            default. Same rule ADR-0204 applied to the lineage, which belongs to
            the position rather than to a panel across the page. */}
        {(inputs.screeningFunnel?.length ?? 0) > 0 && (
          <details className="mt-3 group" data-testid="funnel-stages">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[11px] text-text-tertiary hover:text-text-primary">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
              {" "}all {inputs.screeningFunnel!.length} screen stages, including those
              that removed nothing
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <caption className="sr-only">
                  Candidate attrition by screening stage.
                </caption>
                <thead>
                  <tr>
                    {["Stage", "Remaining", "Removed", "Why"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border ${
                          i === 1 || i === 2 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inputs.screeningFunnel!.map((st) => (
                    <tr key={st.stage}>
                      <td className="px-3 py-1.5 border-b border-border num text-[11.5px]">
                        {st.stage}
                      </td>
                      <td className="px-3 py-1.5 border-b border-border text-right num">
                        {st.remaining}
                      </td>
                      <td
                        className="px-3 py-1.5 border-b border-border text-right num"
                        style={{
                          color:
                            (st.removed ?? 0) > 0
                              ? "var(--short)"
                              : "var(--text-tertiary)",
                        }}
                      >
                        {(st.removed ?? 0) > 0 ? `−${st.removed}` : "0"}
                      </td>
                      <td className="px-3 py-1.5 border-b border-border text-text-secondary">
                        {st.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
