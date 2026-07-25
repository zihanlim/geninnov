// The disclosure caret has one home, and stays there.
//
// Two things are pinned here. First the sizing bug that prompted the component:
// six call sites styled a lucide icon `className="text-[10px]"`, which does
// nothing to an SVG — lucide sizes via width/height attributes and defaults to 24
// — so every caret rendered at 24x24 beside 11px text. A className cannot express
// this constraint, so it is asserted.
//
// Second, the rotation mechanism, which differs by disclosure kind: a native
// <details> rotates via the `group-open` selector (works before hydration), while
// a useState-driven button has no such selector and must be told. Getting these
// backwards produces a caret that silently never turns, which no type checks.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { DisclosureChevron } from "@/components/DisclosureChevron";

const render = (props: Parameters<typeof DisclosureChevron>[0] = {}) =>
  renderToString(<DisclosureChevron {...props} />);

describe("DisclosureChevron", () => {
  it("sizes the icon explicitly, not via a font-size class", () => {
    const html = render();
    expect(html).toContain('width="14"');
    expect(html).toContain('height="14"');
    // The class that looked like it was sizing the icon and never was.
    expect(html).not.toContain("text-[10px]");
  });

  it("is decorative — the adjacent Show/Hide text is the label", () => {
    expect(render()).toContain('aria-hidden="true"');
  });

  it("defers to group-open when no open prop is given (details case)", () => {
    const html = render();
    expect(html).toContain("group-open:rotate-90");
  });

  it("rotates from state when open is passed (button case)", () => {
    const open = render({ open: true });
    expect(open).toContain("rotate-90");
    // Must NOT rely on group-open here: a button has no such parent state, so a
    // group-open-only caret would never turn.
    expect(open).not.toContain("group-open:rotate-90");
  });

  it("does not rotate when explicitly closed", () => {
    expect(render({ open: false })).not.toContain("rotate-90");
  });

  it("keeps a caller's colour class", () => {
    expect(render({ className: "text-text-tertiary" })).toContain("text-text-tertiary");
  });
});

describe("the icon set has one home", () => {
  /** Every .tsx under components/ and app/, except the caret's own module. */
  function componentSources(): Array<[string, string]> {
    const root = path.resolve(__dirname, "../..");
    const out: Array<[string, string]> = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && e.name !== "DisclosureChevron.tsx") {
          out.push([path.relative(root, p), readFileSync(p, "utf8")]);
        }
      }
    };
    for (const d of ["app", "components"]) walk(path.join(root, d));
    return out;
  }

  it("scanned the tree", () => {
    expect(componentSources().length).toBeGreaterThan(30);
  });

  it("no component imports a chevron from lucide directly", () => {
    // The whole point of the component. A direct import is how the unsized-24px
    // bug spread to six files in the first place.
    const offenders = componentSources()
      .filter(([, src]) => /import\s*\{[^}]*Chevron[^}]*\}\s*from\s*["']lucide-react["']/.test(src))
      .map(([f]) => f);
    expect(
      offenders,
      `import { DisclosureChevron } from "@/components/DisclosureChevron" instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no disclosure still uses a Unicode caret glyph", () => {
    // Direction arrows are explicitly allowed — they are data, not chrome. Only
    // the caret glyphs are banned. Comments are stripped so the explanatory notes
    // in DiscoveredThemes and this suite's siblings do not trip it.
    const offenders = componentSources()
      .filter(([, src]) => {
        const code = src
          .replace(/\r\n/g, "\n")
          .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
          .split("\n")
          .map((l) => l.replace(/\/\/.*/, ""))
          .join("\n");
        return /[▸▶▾]/.test(code);
      })
      .map(([f]) => f);
    expect(offenders, `use <DisclosureChevron>:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
