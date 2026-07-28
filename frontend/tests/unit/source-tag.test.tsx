// SourceTag — the inline provenance pill.
//
// Three rules worth pinning:
//
//  1. Every shipped token has at least one ramp that compiles. A typo in
//     `cls` would render an invisible pill and no test could catch it.
//  2. The label default is the token string, with the override opt-in. The
//     override route exists for callers that want "252D" rather than "252d"
//     (the prototype uses capitals), and for the rare case where the meaning
//     differs from the literal token (e.g. "OPT" rendered as "OPT-SOLVED").
//  3. The title comes from `detail` if set, otherwise from the chip map. A
//     SourceTag should never render without a hover title — it exists to
//     answer "what is this pill claiming", and removing the fallback is the
//     single easiest way to lose that answer.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SourceTag } from "@/components/source/SourceTag";
import { SOURCE_CHIPS, type SourceToken } from "@/lib/sourceTokens";

const TOKENS: SourceToken[] = Object.keys(SOURCE_CHIPS) as SourceToken[];

function render(props: Parameters<typeof SourceTag>[0]) {
  return renderToString(<SourceTag {...props} />);
}

describe("SourceTag", () => {
  it.each(TOKENS)("ships a non-empty class string for %s", (token) => {
    const html = render({ token });
    // Every token must colour AND round the pill. A pill that compiles but
    // renders transparent (e.g. an unknown utility class name) would pass a
    // shape check; asserting `rounded-full` AND the per-token colour class
    // catches the silent-fail case.
    expect(html).toContain("rounded-full");
    expect(html).toContain(SOURCE_CHIPS[token].cls);
  });

  it.each(TOKENS)("carries a hover title for %s by default", (token) => {
    const html = render({ token });
    expect(html).toContain(`title="${SOURCE_CHIPS[token].detail}"`);
    // aria-label mirrors the title so screen readers do not require a hover.
    expect(html).toContain(`aria-label="${SOURCE_CHIPS[token].detail}"`);
  });

  it("uses the token string as the rendered label by default", () => {
    const html = render({ token: "NORM" });
    expect(html).toContain(">NORM<");
    expect(html).not.toContain(">norm<");
  });

  it("honours a label override", () => {
    const html = render({ token: "HIST", label: "252D" });
    expect(html).toContain(">252D<");
    expect(html).not.toContain(">HIST<");
  });

  it("honours a detail override (replaces the chip-map sentence)", () => {
    // Apostrophe-free to dodge React HTML-entity escaping (it renders the
    // title with `&#x27;` rather than a literal single quote, and asserting
    // the literal would pass a real quote and fail the same source).
    const html = render({
      token: "EST",
      detail: "carried over from yesterdays run",
    });
    expect(html).toContain('title="carried over from yesterdays run"');
    expect(html).not.toContain('title="estimated or modelled figure"');
  });

  it("puts margin on the left by default; flips when marginLeft={false}", () => {
    expect(render({ token: "XACT" })).toContain("ml-2");
    expect(render({ token: "XACT", marginLeft: false })).not.toContain("ml-2");
  });

  it("forwards extra className into the rendered span", () => {
    const html = render({ token: "XACT", className: "align-baseline" });
    expect(html).toContain("align-baseline");
  });

  it("uses the warning ramp for estimated tokens, accent for measured", () => {
    // ADR-0085: status must not borrow direction ink. --long / --short are
    // forbidden; --accent and --warning are not. A token map that silently
    // swapped the ramps would still render a coloured pill, so we pin the
    // specific utility classes here.
    expect(SOURCE_CHIPS.XACT.cls).toContain("text-accent");
    expect(SOURCE_CHIPS.RAW.cls).toContain("text-accent");
    expect(SOURCE_CHIPS.NORM.cls).toContain("text-accent");
    expect(SOURCE_CHIPS.LIVE.cls).toContain("text-accent");
    expect(SOURCE_CHIPS.OPT.cls).toContain("text-accent");
    expect(SOURCE_CHIPS.HIST.cls).toContain("text-accent");

    expect(SOURCE_CHIPS.EST.cls).toContain("text-warning");
    expect(SOURCE_CHIPS.MOD.cls).toContain("text-warning");
    expect(SOURCE_CHIPS.HRS.cls).toContain("text-warning");
    expect(SOURCE_CHIPS.HYPO.cls).toContain("text-warning");

    expect(SOURCE_CHIPS.DEF.cls).toContain("text-text-secondary");
    expect(SOURCE_CHIPS.PRE.cls).toContain("text-text-secondary");

    // Direction ink — the rule itself, not a derived check.
    for (const token of TOKENS) {
      expect(SOURCE_CHIPS[token].cls, `${token} borrows direction ink`).not.toMatch(
        /\b(text-long|text-short)\b/,
      );
    }
  });
});