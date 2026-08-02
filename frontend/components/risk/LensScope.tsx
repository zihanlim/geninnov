// frontend/components/risk/LensScope.tsx
//
// The two surfaces that state, on screen, which panels on /mandate and /risk
// did NOT follow the lens the reader chose.
//
// The boundary itself is decided in lib/risk/lensScope.ts; this file only
// renders it. See that module's header for why the boundary exists at all
// (migration 062 gave `research_recommendations` a lens key and deliberately
// did not give one to `portfolio_risk`, `portfolio_returns`,
// `portfolio_positions`, `portfolio_cumulative_return`,
// `book_holdings_performance`, `pick_outcomes` or `benchmark_returns` —
// ADR-0194: a second book must not write into the first book's record).
//
// Both exports return null under the default lens, and they check that
// THEMSELVES rather than trusting the call site to guard them. The default
// page is what a live submission is shown from; a call site that forgets its
// guard would put a banner on it, and "the component only renders when the
// caller remembers" is not an invariant, it is a habit.
//
// role="note", not role="alert". Nothing here is broken or degraded. A page
// showing the multi-asset drawdown beside the credit book's stress table is
// working exactly as designed and saying so — spending the attention ramp on
// context is the failure design goal 3 names, and it would train a reader to
// ignore the ramp on the day something really is wrong.

import { Ident } from "@/components/risk/SectionGap";
import { DEFAULT_LENS } from "@/lib/book/lensView";
import { lensLabel } from "@/components/LensSelector";
import { LENS_LESS_TABLES, PANEL_SCOPE, panelLabel, scopeOf } from "@/lib/risk/lensScope";

/**
 * The page-level statement of the boundary, rendered once under the header.
 *
 * `panels` is a list of PANEL KEYS — `lensLessPanels()` narrowed by the caller
 * to the ones this phase actually puts on screen. Keys, not labels, because
 * this component needs each panel's SCOPE as well as its name and there is
 * exactly one place that knows both. Naming them is the whole point: "some
 * figures below are multi-asset" is a sentence a reader cannot act on, because
 * it does not say which.
 *
 * The list is split rather than flattened. `scopeOf` already distinguishes a
 * panel that is ENTIRELY the multi-asset book from one that MIXES the two, and
 * discarding that at render produces a false statement about provenance from
 * the module whose only job is provenance: the risk-limit board values five of
 * its eleven rows from lens-less tables and six from the lens-following
 * analytics row, so "these are still the multi-asset published book" would
 * invite a reader to discount the credit book's own gross exposure as somebody
 * else's figure. Which half is the only actionable form of this disclosure.
 */
export function LensScopeBanner({
  lens,
  panels,
  side = false,
}: {
  lens: string;
  panels: string[];
  /**
   * Render the body as ONE column, for a banner placed in a narrow right-hand
   * slot beside a page header rather than full-width across the page.
   *
   * The two-column body exists because a full-width card's 92ch measure left
   * ~700px empty. In a ~480px side slot the same grid would give each column
   * ~200px — the long `Ident` table names wrap mid-word and the prose gets a
   * broken measure. So the slot hands `side` and the card drops back to a
   * stacked body: same sentences, same order, one column. The card header and
   * the `panels.length === 0` single-sentence body are unaffected either way.
   */
  side?: boolean;
}) {
  // The full-width form is still default-lens-suppressed: under the default
  // lens it would add a redundant banner under the side one (the side one
  // now renders there too) with no boundary to disclose. The `side` form
  // renders under every lens so the /risk header row keeps the same
  // three-column shape on both views.
  if (lens === DEFAULT_LENS && !side) return null;

  const wholly = panels.filter((p) => scopeOf(p) === "published").map(panelLabel);
  // Everything not wholly multi-asset is "mixed" — including an unclassified
  // panel, which `scopeOf` resolves to mixed on purpose. Mixed is the safer
  // sentence to put an unknown in: it says some of this panel is the other
  // book without asserting that all of it is.
  const partly = panels.filter((p) => scopeOf(p) !== "published").map(panelLabel);

  // The standing explanation — which lens-less tables the excepted figures
  // come from and why migration 062 left them lens-less. Extracted once so the
  // full-width form renders it as a paragraph and the `side` form can collapse
  // it behind a `<details>` without duplicating the text. (In `side` mode the
  // card sits in a ~480px slot beside the page header; collapsing the
  // explanation instead of squeezing it is what lets the card match the
  // header's height.)
  const why = (
    <>
      The multi-asset figures among them are sourced from{" "}
      {LENS_LESS_TABLES.map((t, i) => (
        <span key={t}>
          {i > 0 ? (i === LENS_LESS_TABLES.length - 1 ? " and " : ", ") : ""}
          <Ident>{t}</Ident>
        </span>
      ))}
      , and migration 062 gave none of them a lens column on purpose
      (ADR-0194): a second book must not write into the first book&rsquo;s
      record. There is one realised return series and one forward track
      record, and they belong to the multi-asset book that has published
      every day since inception. The held positions are the exception:
      migration 068 / ADR-0222 gave <Ident>portfolio_positions</Ident> a lens
      column, so it is not one of the lens-less tables above. So whatever a
      panel named above draws from the lens-less tables is not this
      book&rsquo;s risk, drawdown or record &mdash; it is the multi-asset
      book&rsquo;s, shown beside it.
    </>
  );

  return (
    <div
      className={side ? "card h-full flex flex-col overflow-hidden" : "card mb-6"}
      role="note"
      aria-labelledby="lens-scope-title"
      data-testid="lens-scope-banner"
    >
      <div className="card-header">
        <h2 id="lens-scope-title" className="card-title m-0">
          You are reading the {lensLabel(lens)} book
        </h2>
        {/* The "N panels drawing on the multi-asset book" subtext only makes
            sense when there ARE lens-less panels to count. Under the default
            lens every panel follows the lens, so the count is always 0 and
            the line is noise. */}
        {lens !== DEFAULT_LENS && (
          <span className="num text-[11px] text-text-tertiary">
            {panels.length} panel{panels.length === 1 ? "" : "s"} drawing on the
            multi-asset book
          </span>
        )}
      </div>
      {/* TWO COLUMNS, because one 92ch measure inside a 1344px card left 700px of
          it empty and stacked four paragraphs into a 292px tower (measured at
          1440 and 1280 — the body was 644px at both, so the dead space GREW with
          the viewport). The split is editorial rather than decorative: WHICH
          panels are excepted on the left, WHY they are on the right. The left is
          what a reader acts on and the right is the standing explanation, so a
          reader who has read the right column once never needs it again.

          Each column keeps its own `max-w-[92ch]` — this fills the card, it does
          not abandon the measure. At 1440 a column is ~650px (~80ch); the cap
          only binds past ~1500px of card, which is where a single column would
          have started running long anyway. `min-w-0` because the right column
          holds seven inline `Ident` table names and a grid cell defaults to
          min-content: without it the longest identifier sets the column width
          and pushes the left one under it. Single column below `lg`, where two
          would each be under 45ch.

          The `side` form is DIFFERENT: it lives in a fixed ~175px cell beside
          the page header, so only the intro sentence stays visible and the
          panel lists plus the standing explanation sit behind a single
          `<details>`. The full-width form keeps its two-column split and the
          explanation as a visible paragraph. */}
      {side ? (
        <div className="flex-1 flex flex-col p-[14px] pt-2.5 text-[12px] text-text-secondary leading-[1.5] min-w-0">
          {lens === DEFAULT_LENS ? (
            // Default-lens body: no boundary to disclose (every panel follows
            // the lens), so the "with these exceptions" sentence and the Show
            // disclosure below it would both be empty. A single sentence
            // states the page's own provenance — the default book — and stops.
            <p className="m-0">
              Every figure below is read from the {lensLabel(lens)} book
              published for this run. No panel on this page draws on the
              lens-less tables (ADR-0194), so every figure here is the
              multi-asset published book.
            </p>
          ) : (
            <>
              <p className="m-0">
                Every figure below is read from the {lensLabel(lens)} book published
                for this run, with these exceptions.
              </p>
              <details className="group mt-1.5">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[11px] text-text-tertiary hover:text-text-primary">
                  <span className="group-open:hidden">Show</span>
                  <span className="hidden group-open:inline">Hide</span>
                  {" "}which panels &amp; why
                </summary>
                <div className="mt-2 space-y-2">
                  {wholly.length > 0 && (
                    <p className="m-0">
                      Entirely the <strong>multi-asset</strong> published book —
                      nothing in them follows the lens:{" "}
                      <span className="text-text-primary">{wholly.join(", ")}</span>.
                    </p>
                  )}
                  {partly.length > 0 && (
                    <p className="m-0">
                      <strong>Part multi-asset</strong> — some rows follow the lens
                      and the rest are the multi-asset book&rsquo;s, inside one panel
                      under one heading:{" "}
                      <span className="text-text-primary">{partly.join(", ")}</span>.
                      Which rows are which is in each panel&rsquo;s own marker.
                    </p>
                  )}
                  <p className="m-0">{why}</p>
                </div>
              </details>
            </>
          )}
        </div>
      ) : panels.length > 0 ? (
        <div className="p-[18px] pt-3 text-[12.5px] text-text-secondary leading-[1.65]">
          <div className="grid gap-x-9 gap-y-2 lg:grid-cols-2 [&>*]:min-w-0">
            <div className="max-w-[92ch]">
              <p className="m-0">
                Every figure below is read from the {lensLabel(lens)} book
                published for this run, with these exceptions.
              </p>
              {wholly.length > 0 && (
                <p className="m-0 mt-2">
                  Entirely the <strong>multi-asset</strong> published book —
                  nothing in them follows the lens:{" "}
                  <span className="text-text-primary">{wholly.join(", ")}</span>.
                </p>
              )}
              {partly.length > 0 && (
                <p className="m-0 mt-2">
                  <strong>Part multi-asset</strong> — some rows follow the lens
                  and the rest are the multi-asset book&rsquo;s, inside one panel
                  under one heading:{" "}
                  <span className="text-text-primary">{partly.join(", ")}</span>.
                  Which rows are which is in each panel&rsquo;s own marker.
                </p>
              )}
            </div>
            {/* `m-0`, not `mt-2`: at one column the grid's own `gap-y-2` already
                supplies exactly that gap, and at two it would push this column
                8px below the one beside it for no reason. */}
            <p className="m-0 max-w-[92ch]">{why}</p>
          </div>
        </div>
      ) : (
        // One sentence and nothing to pair it with — a two-column grid here
        // would be a half-empty row, which is the defect above in miniature.
        <div className="p-[18px] pt-3 text-[12.5px] text-text-secondary leading-[1.65]">
          <p className="m-0 max-w-[92ch]">
            Every figure below is read from the {lensLabel(lens)} book published
            for this run. No panel on this page draws on the lens-less tables
            (ADR-0194), so nothing here is the multi-asset book&rsquo;s.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The per-panel marker, for a card whose heading would otherwise read as the
 * active lens's own figure.
 *
 * Deliberately quiet — this sits in a card header beside a title, and a loud
 * chip on eight cards is the visual noise the default-lens invariant exists to
 * keep off the page in the first place. The `title` carries the full
 * explanation for a reader who stops on it.
 *
 * It gates on the LENS only, not on WHETHER to render. Which panels get a chip
 * is the call site's decision, made with `showScopeNote(lens, panel)`; this
 * component's own job is the one guarantee no call site is allowed to skip.
 *
 * The SCOPE it does read, and the text changes with it. A flat "multi-asset
 * book" over the risk-limit board would be false — five of its eleven rows come
 * from the lens-less tables and six from the lens-following analytics row — and
 * a reader who took the chip at face value would discount the credit book's own
 * gross exposure as another book's figure and conclude it is nowhere on the
 * page. `scopeOf` already knows the difference; discarding it at render is how
 * the provenance module ends up misstating provenance. The hover `title` is not
 * a substitute: it is invisible on touch and to anyone who does not hover.
 */
export function LensScopeChip({
  lens,
  panel,
  pill = false,
}: {
  lens: string;
  panel: string;
  /**
   * Render the marker as a pill (`badge badge-neutral`) for a card whose header
   * hosts it, instead of the bare text line used above an AnswerRow.
   *
   * A pill lives INSIDE the card's `card-header`, so it occupies no layout slot
   * above the card — a block `<ScopeNote>` wrapper pushed the card down by the
   * marker's own height, which under a non-default lens broke the paired-grid
   * alignment (PositionRiskAttribution's chip above it sat its top ~27px below
   * the chip-less PositioningCrowding beside it). The two forms say exactly the
   * same thing in the same visible words; only the container differs.
   */
  pill?: boolean;
}) {
  if (lens === DEFAULT_LENS) return null;

  const scope = scopeOf(panel);
  const sources = PANEL_SCOPE[panel]?.sources ?? [];
  const known = sources.length > 0;
  // "part multi-asset" also covers the unclassified panel, which `scopeOf`
  // resolves to mixed: it is the weaker of the two claims, and the title says
  // outright that nobody classified it.
  const label = scope === "published" ? "multi-asset book" : "part multi-asset";
  const detail = !known
    ? `This panel is not classified in lib/risk/lensScope.ts, so it is treated as part multi-asset until it is. Assume some or all of these figures are the multi-asset published book, not the ${lensLabel(lens)} book.`
    : scope === "published"
      ? `Read from ${sources.join(", ")}. None of these follows the lens (ADR-0194 — a second book must not write into the first book's record), so every figure in this panel is the multi-asset published book, not the ${lensLabel(lens)} book.`
      : `Read from ${sources.join(", ")}. The research_recommendations sources follow the lens and are the ${lensLabel(lens)} book's; the lens-less ones have no lens column (ADR-0194 — a second book must not write into the first book's record) and are the multi-asset published book. Both are in this panel.`;

  return (
    <span
      role="note"
      title={detail}
      aria-label={label}
      data-testid="lens-scope-chip"
      className={
        pill
          // `rounded-full` matches the fully-rounded pill geometry of the book
          // page's SourceTag pills (book?position=GEV) — the lens-scope chip
          // shares the `badge` base which rounds at 4px, and `rounded-full`
          // wins the cascade because Tailwind emits it after `rounded`.
          ? "badge badge-neutral whitespace-nowrap text-[10px] rounded-full"
          : "text-[11px] text-text-tertiary whitespace-nowrap"
      }
    >
      {pill ? label.toUpperCase() : label}
    </span>
  );
}
