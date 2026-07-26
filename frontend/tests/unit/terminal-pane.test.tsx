// The `/` terminal pane (ADR-0103).
//
// ADR-0103 reversed design goal 7's inner-scroller ban for one page, and paid for it with
// four constraints. Two of them live in this component and are asserted here, because
// both fail SILENTLY on the surface anyone would check: a desktop screenshot looks
// identical whether or not the scroller is `lg:` gated, and a missing `id` costs nothing
// until someone follows a link.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import TerminalPane from "@/components/home/TerminalPane";

const html = (ui: React.ReactElement) => renderToString(ui);

describe("TerminalPane — a pane never scrolls its own content", () => {
  // These three assertions are INVERTED from what they were. They used to pin
  // ADR-0103's inner-scroller mechanism (`lg:overflow-y-auto` + `min-h-0` on the
  // pane and its body). That mechanism was removed at the owner's direction
  // because it made every pane guess a height for content it could not measure,
  // and the guesses clipped: at 1920 the regime pane rendered "FACTOR TILT OF
  // BOO", printed five factor betas as "+0"/"-0", and carried a vertical AND a
  // horizontal scrollbar inside one card. Six panes each owned a scroll context
  // on one screen.
  //
  // The rule now is the one design goal 7 always stated: the PAGE scrolls, the
  // card sizes to its content. These tests guard the reversal so a future edit
  // cannot quietly reintroduce a per-pane scroller.

  it("ships no overflow-y scroller of its own, gated or otherwise", () => {
    const out = html(
      <TerminalPane id="themes" title="Themes">
        <div>rows</div>
      </TerminalPane>
    );
    expect(out).not.toMatch(/overflow-y-(auto|scroll)/);
  });

  it("ships no overflow-y scroller in bare mode either", () => {
    const out = html(
      <TerminalPane id="themes" title="Themes" bare>
        <div>rows</div>
      </TerminalPane>
    );
    expect(out).not.toMatch(/overflow-y-(auto|scroll)/);
  });

  it("does not trap scroll chaining with overscroll-contain", () => {
    // overscroll-contain only matters when the element scrolls. With no scroller
    // it is dead weight, and leaving it behind is the tell that a scroller is
    // about to come back.
    for (const bare of [false, true]) {
      const out = html(
        <TerminalPane id="themes" title="Themes" bare={bare}>
          <div>rows</div>
        </TerminalPane>
      );
      expect(out).not.toContain("overscroll-contain");
    }
  });
});

describe("TerminalPane — every pane is addressable (ADR-0103 constraint 3)", () => {
  it("renders the id it was given as a hash target", () => {
    expect(html(<TerminalPane id="headlines" title="Headlines">x</TerminalPane>)).toContain(
      'id="headlines"'
    );
  });

  it("labels itself for assistive tech with the visible title", () => {
    const out = html(<TerminalPane id="crowd" title="What the crowd is pricing">x</TerminalPane>);
    expect(out).toContain('aria-label="What the crowd is pricing"');
  });
});

describe("TerminalPane — chrome", () => {
  it("renders the title and optional meta, and omits meta cleanly when absent", () => {
    const withMeta = html(
      <TerminalPane id="a" title="Themes" meta="8 themes">
        x
      </TerminalPane>
    );
    expect(withMeta).toContain("Themes");
    expect(withMeta).toContain("8 themes");

    const without = html(<TerminalPane id="a" title="Themes">x</TerminalPane>);
    expect(without).toContain("Themes");
    // No empty meta span left behind.
    expect(without).not.toContain("text-text-tertiary");
  });

  it("passes caller grid placement through without swallowing it", () => {
    const out = html(
      <TerminalPane id="a" title="T" className="lg:col-span-2 lg:row-span-2">
        x
      </TerminalPane>
    );
    expect(out).toContain("lg:col-span-2");
    expect(out).toContain("lg:row-span-2");
  });

  it("stacks with a bottom margin on mobile and drops it inside the lg grid", () => {
    // The grid supplies its own gap; a margin that survived into it would double-space
    // the panes and push the last row out of the locked shell.
    const out = html(<TerminalPane id="a" title="T">x</TerminalPane>);
    expect(out).toContain("mb-4");
    expect(out).toContain("lg:mb-0");
  });
});

describe("TerminalPane — bare mode (the double-header fix)", () => {
  // Every component this page panes is already a card with its own heading. The first
  // build wrapped them in a second one, so each pane rendered its title twice and spent
  // ~40px of a locked viewport restating itself. Caught in a screenshot, not an
  // assertion — so it gets an assertion.
  it("renders no card chrome of its own, leaving the child's header the only one", () => {
    const out = html(
      <TerminalPane id="themes" title="Theme scores" bare>
        <div className="card">child card</div>
      </TerminalPane>
    );
    expect(out).not.toContain("card-header");
    expect(out).not.toContain("card-title");
  });

  it("keeps its stacking margin below lg and drops it inside the grid", () => {
    // What bare mode still owes the layout now that it owns no scroller: panes
    // stack with a gap on a phone, and the grid's own gap takes over at lg.
    const out = html(
      <TerminalPane id="a" title="T" bare>
        x
      </TerminalPane>
    );
    expect(out).toContain("mb-4");
    expect(out).toContain("lg:mb-0");
  });

  it("still carries the id and the accessible name", () => {
    // The child's visual heading is not a section label to assistive tech.
    const out = html(
      <TerminalPane id="crowd" title="What the crowd is pricing" bare>
        x
      </TerminalPane>
    );
    expect(out).toContain('id="crowd"');
    expect(out).toContain('aria-label="What the crowd is pricing"');
  });
});
