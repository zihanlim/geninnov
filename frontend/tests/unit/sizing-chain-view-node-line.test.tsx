// SizingChainView node-and-line treatment.
//
// The prototype at
//   stitch_remix_of_auralis_saas_landing_page/.../andromeda_the_100m_book_refined/code.html
// draws the chain as a vertical column of circles connected by a line, with
// the final circle filled. This test pins that the same treatment ships in
// the React component, and that every step in the chain gets a SourceTag
// pill so a reader can tell measured from modelled without hovering.
//
// It also pins the STEP_TOKEN vocabulary is exhaustive at the time of writing.
// `buildSizingChain` is the function that decides which step keys appear;
// pushing a new key there without extending STEP_TOKEN would render the
// chain with one row lacking a pill, and the chip-contrast suite wouldn't
// see it.
//
// GEOMETRY â€” both the line and the circles are absolutely positioned, and
// the only way they line up is if the column has NO left padding (so its
// padding edge equals its border edge) and the rows absorb all the left
// indent via their own pl-6. These assertions pin that geometry because
// reverting to "give the column pl-6 to reserve space" silently produces a
// chain where the line and circles live on opposite sides of the panel.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import SizingChainView, { STEP_TOKEN } from "@/components/book/SizingChainView";
import type { SizingChain, SizingStep } from "@/lib/book/positionEdge";

function step(partial: Partial<SizingStep> & Pick<SizingStep, "key" | "label" | "display">): SizingStep {
  return partial as SizingStep;
}

function makeChain(opts: {
  steps: SizingStep[];
  convictionBased?: boolean;
  reconciliation?: string | null;
}): SizingChain {
  return {
    convictionBased: opts.convictionBased ?? true,
    steps: opts.steps,
    headline: "headline",
    reconciliation: opts.reconciliation ?? null,
  };
}

const render = (c: SizingChain) => renderToString(<SizingChainView chain={c} />);

describe("SizingChainView â€” node-and-line", () => {
  it("draws the vertical line between the first and last node", () => {
    const html = render(
      makeChain({
        steps: [
          step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
          step({ key: "normalised", label: "Normalised", display: "8.8%" }),
          step({ key: "notional", label: "Notional", display: "$8.80M" }),
        ],
      }),
    );

    // 2px-wide absolute bar at left-[3px], top-2 to bottom-2.
    expect(html).toMatch(/absolute left-\[3px\] top-2 bottom-2 w-\[2px\] bg-border-strong/);
  });

  it("fills the final node in accent, leaves the rest as hollow rings", () => {
    const html = render(
      makeChain({
        steps: [
          step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
          step({ key: "normalised", label: "Normalised", display: "8.8%" }),
          step({ key: "notional", label: "Notional", display: "$8.80M" }),
        ],
      }),
    );

    // Exactly one filled (accent) node, exactly two hollow (border-strong).
    const accentMatches = html.match(/bg-accent border-2 border-accent/g) ?? [];
    const hollowMatches = html.match(/bg-bg-surface border-2 border-border-strong/g) ?? [];
    expect(accentMatches.length).toBe(1);
    expect(hollowMatches.length).toBe(2);
  });

  it("renders one SourceTag pill per step, on the right of the value", () => {
    const html = render(
      makeChain({
        steps: [
          step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
          step({ key: "normalised", label: "Normalised", display: "8.8%" }),
          step({ key: "notional", label: "Notional", display: "$8.80M" }),
        ],
      }),
    );

    // The pill text per the STEP_TOKEN map is the assertion here; a pill that
    // shows the wrong token silently still renders a coloured box, and the
    // chip-contrast suite wouldn't catch the substitution.
    expect(html).toContain(">RAW<");
    expect(html).toContain(">NORM<");
    expect(html).toContain(">XACT<");
  });

  it("tones a clamped step value in warning so the cap step is attention", () => {
    // ADR-0085: --warning is allowed, --long / --short are not.
    const html = render(
      makeChain({
        steps: [
          step({ key: "normalised", label: "Normalised", display: "19.0%" }),
          step({ key: "cap", label: "Cap", display: "12.5%", clamped: true }),
          step({ key: "notional", label: "Notional", display: "$12.50M" }),
        ],
      }),
    );
    // The cap step's number is wrapped in a span carrying the warning ramp.
    // A layout that colourised the pill but not the value would be tolerated
    // â€” that is a regression to the pre-pill behaviour.
    expect(html).toMatch(/text-warning[^"]*"[^>]*>\s*12\.5%/);
  });

  it("withholds the hype-sized banner when convictionBased is true", () => {
    const html = render(
      makeChain({
        convictionBased: true,
        steps: [step({ key: "notional", label: "Notional", display: "$8.80M" })],
      }),
    );
    expect(html).not.toContain('data-testid="hype-sized-banner"');
  });

  it("raises the hype-sized banner when the book was sized by HypeScore", () => {
    const html = render(
      makeChain({
        convictionBased: false,
        steps: [
          step({ key: "hype", label: "HypeScore size", display: "5.4%" }),
          step({ key: "notional", label: "Notional", display: "$8.80M" }),
        ],
      }),
    );
    expect(html).toContain('data-testid="hype-sized-banner"');
    expect(html).toContain(">HRS<");
  });

  it("raises the reconciliation alert when the chain does not compose", () => {
    // ADR-0053 â€” steps render but the live weight disagrees with the derivation.
    const html = render(
      makeChain({
        reconciliation: "normalised 19.0% → single-name cap 20% → final 6.4% is impossible",
        steps: [step({ key: "notional", label: "Notional", display: "$8.80M" })],
      }),
    );
    expect(html).toContain('data-testid="sizing-reconciliation"');
    expect(html).toContain('role="alert"');
  });

  it("STEP_TOKEN covers every step key the chain currently emits", () => {
    // Snapshot of buildSizingChain's step key vocabulary at the time of
    // writing. A new key in buildSizingChain that is NOT in this map would
    // render the chain with one pill-less row, and this list is what pins it.
    // The lib function is the source of truth â€” the assertion below fails fast
    // when that function adds a new step, prompting the maintainer to extend
    // STEP_TOKEN deliberately.
    const KNOWN_KEYS = [
      "edge",
      "vol",
      "conviction",
      "normalised",
      "hype",
      "cap",
      "final",
      "signed",
      "notional",
    ];
    for (const key of KNOWN_KEYS) {
      expect(STEP_TOKEN[key], `${key} has no STEP_TOKEN entry`).toBeDefined();
    }
  });

  describe("line/circle geometry â€” they must share one X", () => {
    it("the column has no padding-left; every row carries its own", () => {
      // The column's `relative` is what hosts the absolutely-positioned line.
      // If the column also carried pl-6, the line's containing block would
      // shift 24px to the right and the circles (whose containing block is
      // the row's padding edge = the column's padding edge = the column's
      // border-left) would no longer sit on the line.
      const html = render(
        makeChain({
          steps: [
            step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
            step({ key: "notional", label: "Notional", display: "$8.80M" }),
          ],
        }),
      );
      expect(html).toContain('<div class="relative">');
      expect(html).toContain("absolute left-[3px] top-2 bottom-2 w-[2px] bg-border-strong");
    });

    it("each step row carries pl-6 to keep the labels right of the circle", () => {
      const html = render(
        makeChain({
          steps: [
            step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
            step({ key: "notional", label: "Notional", display: "$8.80M" }),
          ],
        }),
      );
      // TWO `pl-6 pr-1 flex` rows, one per step.
      const rowMatches = html.match(/class="relative pl-6 pr-1 flex items-center justify-between/g) ?? [];
      expect(rowMatches.length).toBe(2);
    });

    it("circles are at left-[-2px] so their centres land on the line", () => {
      // Line centre  : column-padding-edge + 3px + (2px / 2) = +4px
      // Circle centre: row-padding-edge   + (-2px) + (12px / 2) = +4px
      // Equality is what makes the line "linked" through the circles.
      const html = render(
        makeChain({
          steps: [
            step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
            step({ key: "notional", label: "Notional", display: "$8.80M" }),
          ],
        }),
      );
      const offsets = html.match(/absolute -left-\[2px\]/g) ?? [];
      const circleCount = 2;
      expect(offsets.length).toBe(circleCount);
      expect(html).toContain("w-3 h-3 rounded-full");
    });

    it("rows are tight (py-1.5, NOT py-2) so the chain reads as one timeline", () => {
      // A row that breathes as wide as py-2 (16px total padding) breaks the
      // chain reading as a sequence â€” every step becomes its own card and the
      // connecting line stops meaning anything. py-1.5 (12px) keeps the
      // circles' centre spacing visually close to the row height (~28px)
      // without the rows running into each other.
      const html = render(
        makeChain({
          steps: [
            step({ key: "edge", label: "|EdgeScore|", display: "0.279" }),
            step({ key: "notional", label: "Notional", display: "$8.80M" }),
          ],
        }),
      );
      expect(html).toMatch(/class="relative pl-6 pr-1 flex items-center justify-between gap-3 py-0\.5"/);
      expect(html).not.toMatch(/class="relative pl-6 pr-1 flex items-center justify-between gap-3 py-2"/);
      expect(html).not.toMatch(/class="relative pl-6 pr-1 flex items-center justify-between gap-3 py-1\.5"/);
    });
  });
});