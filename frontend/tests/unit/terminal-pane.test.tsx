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

describe("TerminalPane — the lock is desktop-only (ADR-0103 constraint 1)", () => {
  it("gates its inner scroller behind lg:, so mobile keeps ordinary page flow", () => {
    const out = html(
      <TerminalPane id="themes" title="Themes">
        <div>rows</div>
      </TerminalPane>
    );
    expect(out).toContain("lg:overflow-y-auto");
  });

  it("never ships an UNGATED overflow-y-auto", () => {
    // The whole failure mode in one assertion. `overflow-y-auto` without the `lg:` prefix
    // traps a 375px viewport inside a short scroller — the thing design goal 7 was
    // protecting, which ADR-0103 only bought an exemption from at >=1024px.
    const out = html(
      <TerminalPane id="themes" title="Themes">
        <div>rows</div>
      </TerminalPane>
    );
    const ungated = out.match(/(^|[^:])\boverflow-y-auto\b/g) ?? [];
    // Every occurrence must be the lg:-prefixed one.
    for (const m of ungated) expect(m).toMatch(/lg:overflow-y-auto|:overflow-y-auto/);
  });

  it("keeps min-h-0 on the pane and its scroll body", () => {
    // Without it a flex child will not shrink below its content, the shell grows past the
    // viewport, and the scroller silently never engages.
    const out = html(
      <TerminalPane id="themes" title="Themes">
        <div>rows</div>
      </TerminalPane>
    );
    expect((out.match(/min-h-0/g) ?? []).length).toBeGreaterThanOrEqual(2);
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

  it("still gates its scroller behind lg: in bare mode", () => {
    const out = html(
      <TerminalPane id="a" title="T" bare>
        x
      </TerminalPane>
    );
    expect(out).toContain("lg:overflow-y-auto");
    const bare = out.match(/(^|[^:])\boverflow-y-auto\b/g) ?? [];
    for (const m of bare) expect(m).toMatch(/lg:overflow-y-auto|:overflow-y-auto/);
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
