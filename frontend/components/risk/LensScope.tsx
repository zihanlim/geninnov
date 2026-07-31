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
import { LENS_OPTIONS } from "@/components/LensSelector";
import { LENS_LESS_TABLES, PANEL_SCOPE, panelLabel, scopeOf } from "@/lib/risk/lensScope";

/** The reader-facing name of a lens, falling back to the raw value. */
function lensLabel(lens: string): string {
  return LENS_OPTIONS.find((o) => o.value === lens)?.label ?? lens;
}

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
}: {
  lens: string;
  panels: string[];
}) {
  if (lens === DEFAULT_LENS) return null;

  const wholly = panels.filter((p) => scopeOf(p) === "published").map(panelLabel);
  // Everything not wholly multi-asset is "mixed" — including an unclassified
  // panel, which `scopeOf` resolves to mixed on purpose. Mixed is the safer
  // sentence to put an unknown in: it says some of this panel is the other
  // book without asserting that all of it is.
  const partly = panels.filter((p) => scopeOf(p) !== "published").map(panelLabel);

  return (
    <div
      className="card mb-6"
      role="note"
      aria-labelledby="lens-scope-title"
      data-testid="lens-scope-banner"
    >
      <div className="card-header">
        <h2 id="lens-scope-title" className="card-title m-0">
          You are reading the {lensLabel(lens)} book
        </h2>
        <span className="num text-[11px] text-text-tertiary">
          {panels.length} panel{panels.length === 1 ? "" : "s"} drawing on the
          multi-asset book
        </span>
      </div>
      <div className="p-[18px] pt-3 text-[12.5px] text-text-secondary leading-[1.65] max-w-[92ch]">
        {panels.length > 0 ? (
          <>
            <p className="m-0">
              Every figure below is read from the {lensLabel(lens)} book published
              for this run, with these exceptions.
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
                <strong>Part multi-asset</strong> — some rows follow the lens and
                the rest are the multi-asset book&rsquo;s, inside one panel under
                one heading:{" "}
                <span className="text-text-primary">{partly.join(", ")}</span>.
                Which rows are which is in each panel&rsquo;s own marker.
              </p>
            )}
            <p className="m-0 mt-2">
              The multi-asset figures among them are sourced from{" "}
              {LENS_LESS_TABLES.map((t, i) => (
                <span key={t}>
                  {i > 0 ? (i === LENS_LESS_TABLES.length - 1 ? " and " : ", ") : ""}
                  <Ident>{t}</Ident>
                </span>
              ))}
              , and migration 062 gave none of them a lens column on purpose
              (ADR-0194): a second book must not write into the first book&rsquo;s
              record. There is one realised return series, one set of held
              positions and one forward track record, and they belong to the
              multi-asset book that has published every day since inception. So
              whatever a panel named above draws from those tables is not this
              book&rsquo;s risk, drawdown or record — it is the multi-asset
              book&rsquo;s, shown beside it.
            </p>
          </>
        ) : (
          <p className="m-0">
            Every figure below is read from the {lensLabel(lens)} book published
            for this run. No panel on this page draws on the lens-less tables
            (ADR-0194), so nothing here is the multi-asset book&rsquo;s.
          </p>
        )}
      </div>
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
export function LensScopeChip({ lens, panel }: { lens: string; panel: string }) {
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
      data-testid="lens-scope-chip"
      className="text-[11px] text-text-tertiary whitespace-nowrap"
    >
      {label}
    </span>
  );
}
