// components/risk/LensScope.tsx — the two surfaces that state, on screen,
// which panels did not follow the lens the reader chose.
//
// Rendered through SSR (renderToStaticMarkup), the same pattern
// lens-selector.test.tsx and risk-answer-cards.test.tsx use: these are
// presentational components with no state, so the markup IS the behaviour and
// asserting against the real render is the only check that cannot drift from a
// copy of it.
//
// The first assertion is the one that matters. Under the default lens the
// three phase pages must render exactly as they did before the lens control
// existed — a live submission is shown from that page — and both components
// enforce that themselves rather than trusting the call site to guard them.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LensScopeBanner, LensScopeChip } from "@/components/risk/LensScope";
import { lensLessPanels, panelLabel, scopeOf } from "@/lib/risk/lensScope";

/**
 * Panel KEYS, not labels — the banner resolves both the reader-facing name and
 * the scope from the key, because it has to SPLIT the list and only
 * `lib/risk/lensScope.ts` knows which side each panel falls on.
 *
 * One of each on purpose: RiskLimitBoard is "mixed" (six of its rows follow the
 * lens), the other two are wholly "published".
 */
const PANELS = ["RiskLimitBoard", "DrawdownChart", "TrackRecord"];

/**
 * React escapes text nodes, and the real panel labels contain ampersands
 * ("Drawdown & return path", "Daily P&L history"). Escape the expectation
 * rather than picking ampersand-free labels for the test — the labels a reader
 * sees are the ones worth asserting on.
 */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("the default lens renders nothing at all", () => {
  it("LensScopeBanner is null under multi_asset", () => {
    expect(
      renderToStaticMarkup(<LensScopeBanner lens="multi_asset" panels={PANELS} />),
    ).toBe("");
  });

  it("LensScopeChip is null under multi_asset", () => {
    expect(
      renderToStaticMarkup(<LensScopeChip lens="multi_asset" panel="RiskLimitBoard" />),
    ).toBe("");
  });

  it("stays null even when handed a full lens-less panel list", () => {
    // The realistic call: a page passing `lensLessPanels()` unconditionally and
    // letting the component decide. Nothing may reach the default page.
    const html = renderToStaticMarkup(
      <LensScopeBanner lens="multi_asset" panels={lensLessPanels()} />,
    );
    expect(html).toBe("");
  });
});

describe("LensScopeBanner under a non-default lens", () => {
  const html = renderToStaticMarkup(<LensScopeBanner lens="credit" panels={PANELS} />);

  it("renders, and is findable by its test id", () => {
    expect(html).toContain('data-testid="lens-scope-banner"');
  });

  it("names the book the reader is actually looking at", () => {
    expect(html).toContain("Credit Lens");
  });

  it("names EVERY panel it was given, by its reader-facing label", () => {
    // "some figures below are multi-asset" is a sentence a reader cannot act
    // on, because it does not say which. Naming them is the whole point of the
    // banner, so a truncated or summarised list is a failure, not a style.
    for (const panel of PANELS) {
      expect(html, `banner did not name "${panel}"`).toContain(esc(panelLabel(panel)));
    }
  });

  it("separates wholly-multi-asset panels from part-multi-asset ones", () => {
    // The distinction `scopeOf` already draws, kept all the way to the screen.
    // Flattened, the banner tells a reader that the risk-limit board IS the
    // multi-asset book — so they discount "Gross exposure 148% vs 200%" as
    // another book's figure and conclude the credit book's gross is nowhere on
    // the page. It is right there, on the row above the one they discounted.
    expect(scopeOf("RiskLimitBoard")).toBe("mixed");
    expect(scopeOf("DrawdownChart")).toBe("published");

    const wholly = html.indexOf("Entirely the");
    const partly = html.indexOf("Part multi-asset");
    expect(wholly, "banner has no wholly-multi-asset sentence").toBeGreaterThan(-1);
    expect(partly, "banner has no part-multi-asset sentence").toBeGreaterThan(-1);

    // The mixed panel is named in the "part" sentence, not the "entirely" one.
    const partSentence = html.slice(partly);
    const wholeSentence = html.slice(wholly, partly > wholly ? partly : undefined);
    expect(partSentence).toContain(esc(panelLabel("RiskLimitBoard")));
    expect(wholeSentence).not.toContain(esc(panelLabel("RiskLimitBoard")));
    expect(wholeSentence).toContain(esc(panelLabel("DrawdownChart")));
  });

  it("omits a sentence it has no panels for, rather than dangling a colon", () => {
    const onlyPublished = renderToStaticMarkup(
      <LensScopeBanner lens="credit" panels={["DrawdownChart", "TrackRecord"]} />,
    );
    expect(onlyPublished).toContain("Entirely the");
    expect(onlyPublished).not.toContain("Part multi-asset");

    const onlyMixed = renderToStaticMarkup(
      <LensScopeBanner lens="credit" panels={["RiskLimitBoard"]} />,
    );
    expect(onlyMixed).toContain("Part multi-asset");
    expect(onlyMixed).not.toContain("Entirely the");
  });

  it("says WHY those panels cannot follow the lens", () => {
    expect(html).toContain("ADR-0194");
    expect(html).toContain("portfolio_risk");
    expect(html).toContain("pick_outcomes");
  });

  it("is a note, not an alert", () => {
    // Nothing here is broken. Spending the attention ramp on context trains a
    // reader to ignore it on the day something really is wrong (design goal 3).
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
  });

  it("in side form the body is one column: the same prose, stacked", () => {
    // The banner rendered beside a page header gets a ~480px slot. Its normal
    // two-column body would hand each column ~200px there and wrap the long
    // `Ident` table names mid-word, so `side` stacks the body instead. The
    // assertions are the same ones the full-width form is held to — the two
    // forms must not drift apart in what they say, only in how they lay it out.
    const side = renderToStaticMarkup(
      <LensScopeBanner lens="credit" panels={PANELS} side />,
    );
    expect(side).toContain('data-testid="lens-scope-banner"');
    expect(side).toContain("Credit Lens");
    for (const panel of PANELS) {
      expect(side, `side banner did not name "${panel}"`).toContain(esc(panelLabel(panel)));
    }
    // Two paragraphs out of the two-column grid's `lg:grid-cols-2` — if this
    // ever regresses to a wide-grid layout the reader is back to mid-word-wrapped
    // table names in the side slot.
    expect(side).not.toContain("lg:grid-cols-2");
  });

  it("in side form the standing explanation collapses behind a details", () => {
    // The card sits beside the page header, so it should match the header's
    // height. The "sourced from portfolio_risk…ADR-0194" paragraph is the bulk
    // of what made the card tall, so in `side` mode it hides behind a
    // `<details>` summary; the full-width form keeps it as a paragraph. Both
    // forms must still carry the text and its sources somewhere.
    const side = renderToStaticMarkup(
      <LensScopeBanner lens="credit" panels={PANELS} side />,
    );
    expect(side).toContain("<details");
    expect(side).toContain("why these can");
    expect(side).toContain("portfolio_risk");
    expect(side).toContain("pick_outcomes");
    // The explanation must not render as a visible paragraph in side form — it
    // is inside the collapsed details, and rendering it twice (or leaving it
    // visible) is exactly what the collapse is supposed to prevent. So nothing
    // before the `<details>` element carries the source names.
    const beforeDetails = side.slice(0, side.indexOf("<details"));
    expect(beforeDetails).not.toContain("portfolio_risk");

    const full = renderToStaticMarkup(<LensScopeBanner lens="credit" panels={PANELS} />);
    expect(full).not.toContain("<details");
    expect(full).toContain("portfolio_risk");
  });

  it("states the opposite case rather than rendering an empty frame", () => {
    // A phase whose panels all follow the lens still deserves the sentence —
    // "this is the credit book" is worth saying even when there is no boundary
    // to disclose. An empty list must not produce a card with a dangling
    // colon and no panels after it.
    const empty = renderToStaticMarkup(<LensScopeBanner lens="credit" panels={[]} />);
    expect(empty).toContain('data-testid="lens-scope-banner"');
    expect(empty).toContain("No panel on this page");
  });
});

describe("LensScopeChip under a non-default lens", () => {
  const html = renderToStaticMarkup(
    <LensScopeChip lens="credit" panel="RiskLimitBoard" />,
  );

  it("renders, and is findable by its test id", () => {
    expect(html).toContain('data-testid="lens-scope-chip"');
  });

  it("says 'multi-asset book' only for a panel that is wholly multi-asset", () => {
    // A published panel gets the flat claim...
    const published = renderToStaticMarkup(
      <LensScopeChip lens="credit" panel="DrawdownChart" />,
    );
    expect(scopeOf("DrawdownChart")).toBe("published");
    expect(published).toContain(">multi-asset book<");

    // ...and a mixed one must not, because it would be false. Five of the
    // limit board's eleven rows come from the lens-less tables; the other six
    // are the credit book's own net/gross exposure, caps and turnover. A chip
    // reading "multi-asset book" over that invites a reader to discard six
    // figures that are exactly what they came for. The visible TEXT has to
    // carry it: a `title` is invisible on touch and to anyone who does not
    // hover, so it cannot be where the distinction lives.
    expect(scopeOf("RiskLimitBoard")).toBe("mixed");
    expect(html).toContain(">part multi-asset<");
    expect(html).not.toContain(">multi-asset book<");
  });

  it("carries the fuller explanation in a title, naming the panel's sources", () => {
    expect(html).toContain("title=");
    expect(html).toContain("portfolio_risk");
    expect(html).toContain("ADR-0194");
  });

  it("the mixed title says which half is which, not just that it is mixed", () => {
    expect(html).toContain("research_recommendations");
    expect(html).toContain("Credit Lens");
  });

  it("still renders for a panel nobody classified, and says so", () => {
    // The fail-loud default reaches the chip too: an unclassified panel gets a
    // marker AND a title that names the omission, rather than a marker whose
    // title lists no sources and reads like a bug.
    const unknown = renderToStaticMarkup(
      <LensScopeChip lens="credit" panel="SomePanelNobodyClassified" />,
    );
    expect(unknown).toContain('data-testid="lens-scope-chip"');
    expect(unknown).toContain("not classified");
  });

  it("renders under every non-default lens, not just credit", () => {
    for (const lens of ["rates", "equity", "fx", "commodity"]) {
      const out = renderToStaticMarkup(
        <LensScopeChip lens={lens} panel="DrawdownChart" />,
      );
      expect(out, lens).toContain("multi-asset book");
    }
  });
});
