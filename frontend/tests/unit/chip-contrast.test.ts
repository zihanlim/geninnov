// The AA floor, enforced.
//
// docs/design-goals.md §8 makes WCAG AA 4.5:1 a floor rather than a polish pass.
// It was being checked by hand, and hand-checking missed things twice:
//
//   1. The severity `high` band shipped bg-[#3a2615]/text-[#f0883e] — a pre-Ledger
//      dark-theme pair drawing a dark-brown chip on cream paper — for as long as
//      the light theme existed.
//   2. The 2026-07-24 contrast pass measured --warning against paper and card and
//      never against --bg-hover, the surface a table row lands on when a reader
//      mouses over a near-limit chip. There #c2410c was 4.36:1 plain and 3.71:1
//      over its own tint. It read as "AA-compliant" in three separate comments.
//
// Both are the same failure: a chip is a foreground token over a background token
// over a SURFACE, and checking any two of the three proves nothing. So this test
// enumerates the real chip definitions — imported, not copied, so they cannot
// drift — resolves them against the real palette, composites translucent tints
// over every surface a chip can land on, and asserts the floor.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "@/tailwind.config";
import { severityChipClass } from "@/lib/risk/analytics";
import { STATUS_CHIPS } from "@/lib/statusChips";
import { TONE_CLS, TONE_LABEL_CLS, type Tone } from "@/lib/methodTones";

const AA_SMALL_TEXT = 4.5;

const PALETTE = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, string>;
const GLOBALS = readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);

// ── colour plumbing ─────────────────────────────────────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgba | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const p = rgba[1].split(",").map((s) => Number(s.trim()));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  return null;
}

/** Tailwind ships these; the project palette does not redefine them. */
const BUILTIN: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** `bg-warning-dim`, `text-text-secondary`, `bg-long-dim/60` → a colour.
 *
 *  The opacity modifier REPLACES the colour's alpha; it does not compound it.
 *  Verified against the compiled stylesheet: `bg-long-dim/40` emits
 *  `background-color:rgba(18,110,83,.4)`, not .11 × .4. This matters more than it
 *  looks — an earlier version of this resolver multiplied, and that arithmetic
 *  passed `badge-tier-discovered` at 4.39:1 when the browser was rendering it at
 *  2.29:1. A checker that models the platform wrongly is worse than no checker,
 *  because it certifies the bug. */
function resolveUtility(cls: string, prefix: "bg" | "text"): Rgba | null {
  if (!cls.startsWith(`${prefix}-`)) return null;
  const [name, opacity] = cls.slice(prefix.length + 1).split("/");
  const raw = PALETTE[name] ?? BUILTIN[name];
  if (!raw) return null;
  const c = parseColor(raw);
  if (!c) return null;
  return opacity ? { ...c, a: Number(opacity) / 100 } : c;
}

const srgb = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgba) =>
  0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);

/** Flatten a translucent colour onto an opaque one. */
const composite = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function contrast(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every opaque surface a chip can actually be rendered on: the page, a card, and
 *  a raised/hovered row (table rows use `hover:bg-bg-elevated`).
 *
 *  --bg-hover is deliberately NOT here. It is the darkest surface, so including it
 *  would look like the safest choice — but it appears in exactly five places, none
 *  of which contain a chip: `.filter-btn:hover`, `.filter-btn-active`, the
 *  `.skeleton` gradient, and the nav-item hover in TopBar and LensSelector. Adding
 *  it fails five chips (dir-pill-long, badge-long, badge-tier-anchor,
 *  badge-tier-discovered, StatusBadge.exact) and the only way to satisfy it is to
 *  darken --long and --accent for a rendering that never happens. A floor should
 *  bind on cases that exist.
 *
 *  If a chip is ever placed inside a filter button or a hovered nav item, add
 *  "bg-hover" here and darken those tokens — in that order. */
const SURFACES = ["bg-primary", "bg-surface", "bg-elevated"] as const;

/** Worst-case contrast for a chip's class string across all surfaces. */
function worstCase(cls: string): { ratio: number; surface: string } {
  const parts = cls.split(/\s+/).filter(Boolean);
  const fg = parts.map((p) => resolveUtility(p, "text")).find(Boolean);
  const bg = parts.map((p) => resolveUtility(p, "bg")).find(Boolean);
  if (!fg) throw new Error(`chip class has no resolvable text colour: "${cls}"`);

  let worst = { ratio: Infinity, surface: "" };
  for (const s of SURFACES) {
    const surface = parseColor(PALETTE[s])!;
    // No bg utility means the chip is transparent and sits directly on the surface.
    const behind = bg ? composite(bg, surface) : surface;
    const ratio = contrast(composite(fg, behind), behind);
    if (ratio < worst.ratio) worst = { ratio, surface: s };
  }
  return worst;
}

// ── the chips under test, imported rather than copied ───────────────────────────

const SEVERITY_BANDS = ["severe", "high", "moderate", "low", "unknown"];

/** `.badge-*` / `.dir-pill-*` variants, read out of globals.css @apply rules.
 *  exec-loop rather than [...matchAll()] — the tsconfig target predates it. */
function cssChipVariants(): Array<[string, string]> {
  const re = /\.((?:badge|dir-pill)-[\w-]+)\s*\{\s*@apply\s+([^;]+);/g;
  const out: Array<[string, string]> = [];
  for (let m = re.exec(GLOBALS); m !== null; m = re.exec(GLOBALS)) {
    out.push([m[1], m[2].replace(/\s+/g, " ").trim()]);
  }
  return out;
}

/** The /method <Note> callouts: a tinted box whose BODY text and whose TONE LABEL
 *  are different colours on the same background, so both pairings need checking. */
function methodToneChips(): Array<[string, string]> {
  return (Object.keys(TONE_CLS) as Tone[]).flatMap((tone): Array<[string, string]> => {
    const box = TONE_CLS[tone];
    const bg = box.split(/\s+/).find((c) => c.startsWith("bg-")) ?? "";
    return [
      [`Note.${tone} body`, box],
      [`Note.${tone} label`, `${bg} ${TONE_LABEL_CLS[tone]}`],
    ];
  });
}

const CHIPS: Array<[string, string]> = [
  ...SEVERITY_BANDS.map((b): [string, string] => [
    `severityChipClass("${b}")`,
    severityChipClass(b),
  ]),
  ...Object.entries(STATUS_CHIPS).map(([k, v]): [string, string] => [
    `StatusBadge.${k}`,
    v.cls,
  ]),
  ...cssChipVariants(),
  ...methodToneChips(),
];

describe("chip contrast", () => {
  it("found every chip definition", () => {
    // A silently-empty enumeration would make every assertion below vacuous.
    //
    // Assert the NAMED set, not a count. `>= 6` was written when there were six
    // variants and there are now eight, so the guard had two chips of slack: both
    // `.dir-pill` fills could be deleted, or any badge renamed, and this test still
    // passed while `it.each(CHIPS)` below quietly stopped measuring them. A floor
    // that cannot see a removal is not a floor — which is the whole reason this
    // file exists rather than a comment asserting the palette is AA-compliant.
    //
    // Subset, not equality: a NEW variant is picked up by `it.each(CHIPS)` and
    // measured automatically, and must not need a test edit to be covered.
    const found = cssChipVariants().map(([name]) => name);
    for (const required of [
      "badge-long",
      "badge-short",
      "badge-warning",
      "badge-neutral",
      "badge-tier-anchor",
      "badge-tier-discovered",
      "dir-pill-long",
      "dir-pill-short",
    ]) {
      expect(
        found,
        `.${required} is no longer enumerated from globals.css — it was either renamed or deleted, and nothing below is measuring it`,
      ).toContain(required);
    }
    expect(CHIPS.length).toBeGreaterThanOrEqual(16);
  });

  it.each(CHIPS)("%s clears AA 4.5:1 on every surface", (_name, cls) => {
    const { ratio, surface } = worstCase(cls);
    expect(
      ratio,
      `"${cls}" is ${ratio.toFixed(2)}:1 on --${surface}, under the ${AA_SMALL_TEXT}:1 floor`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it("resolves every colour it claims to check", () => {
    // Guards the plumbing: an unresolvable token would silently drop out of the
    // `.find(Boolean)` above and leave a chip untested rather than failing.
    for (const [name, cls] of CHIPS) {
      const parts = cls.split(/\s+/).filter(Boolean);
      const colourish = parts.filter((p) => /^(bg|text)-/.test(p));
      for (const p of colourish) {
        const resolved =
          resolveUtility(p, "bg") ?? resolveUtility(p, "text");
        expect(resolved, `${name}: cannot resolve "${p}" to a palette colour`).not.toBeNull();
      }
    }
  });

  it("uses palette tokens only — no raw hex or rgb in any chip class", () => {
    for (const [name, cls] of CHIPS) {
      expect(cls, `${name} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(cls, `${name} hardcodes a colour`).not.toMatch(/rgba?\(/);
    }
  });
});

/** Colours a component is allowed to hardcode, each with the reason. Anything else
 *  fails, which is the point: a raw hex is invisible to a token sweep, so the
 *  2026-07-24 AA pass over globals.css/tailwind.config.ts moved the tokens and left
 *  #f0883e, #3a2615, #e8833a and #e11048 behind — three of them illegible on paper,
 *  the fourth two palette moves stale. Adding an entry here should feel like a
 *  decision. */
const HARDCODED_ALLOWED: Record<string, string> = {
  "#ffffff": "plain white — a Tailwind builtin, not a palette colour",
  "#000000": "plain black — a Tailwind builtin, not a palette colour",
  "#a85c08":
    "Bitcoin brand orange, darkened from #f7931a for AA. Deliberately off-palette: " +
    "it identifies an external brand rather than carrying a semantic. See PredictionMarkets.tsx.",
};

describe("no hardcoded palette colours", () => {
  /** Source files, comments stripped — a hex in prose is history, not a colour. */
  function sourceFiles(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const root = path.resolve(__dirname, "../..");
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const raw = readFileSync(p, "utf8")
            // Normalise CRLF first. The checkout is CRLF on Windows, and `.` does
            // not match \r (it is a line terminator in JS regex), so a `//.*$`
            // strip silently matches nothing on every line — which left this
            // scanner reporting its own explanatory comments as offences.
            .replace(/\r\n/g, "\n")
            // Blank block comments out but keep their newlines, so reported line
            // numbers still point at the real line.
            .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
            .split("\n")
            // No `$` anchor — see the CRLF note above.
            .map((l) => l.replace(/\/\/.*/, ""))
            .join("\n");
          out.push([path.relative(root, p), raw]);
        }
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(root, d));
    return out;
  }

  it("scanned the tree", () => {
    expect(sourceFiles().length).toBeGreaterThan(40);
  });

  it("reads colours from tokens, not hex literals", () => {
    const offences: string[] = [];
    for (const [file, src] of sourceFiles()) {
      const re = /#[0-9a-fA-F]{6}\b/g;
      for (let m = re.exec(src); m !== null; m = re.exec(src)) {
        const hex = m[0].toLowerCase();
        if (HARDCODED_ALLOWED[hex]) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offences.push(`${file}:${line} ${hex}`);
      }
    }
    expect(
      offences,
      `hardcoded colours — use a var(--token) or add a justified entry to ` +
        `HARDCODED_ALLOWED:\n  ${offences.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("palette integrity", () => {
  /** globals.css :root vars are the runtime source; tailwind.config.ts is compiled
   *  to literal RGB at build time and does NOT read them. Both must be edited
   *  together or only half the call sites move. */
  it("keeps globals.css :root in step with tailwind.config.ts", () => {
    const re = /--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi;
    const vars: Array<[string, string]> = [];
    for (let m = re.exec(GLOBALS); m !== null; m = re.exec(GLOBALS)) {
      vars.push([m[1], m[2]]);
    }
    expect(vars.length).toBeGreaterThanOrEqual(10);

    const drift: string[] = [];
    for (const [name, hex] of vars) {
      const configured = PALETTE[name];
      if (!configured) continue; // e.g. --font-* or vars with no utility class
      if (configured.toLowerCase() !== hex.toLowerCase()) {
        drift.push(`--${name}: globals.css ${hex} vs tailwind.config.ts ${configured}`);
      }
    }
    expect(drift, `palette drift:\n  ${drift.join("\n  ")}`).toEqual([]);
  });

  /** A `*-dim` token is its base colour at low alpha. Encoding the triplet by
   *  hand means darkening the base silently leaves the tint on the old hue — the
   *  exact split that shipped alongside #c2410c. */
  it("keeps every *-dim tint on its base colour's rgb", () => {
    const drift: string[] = [];
    for (const [name, value] of Object.entries(PALETTE)) {
      if (!name.endsWith("-dim")) continue;
      const base = PALETTE[name.replace(/-dim$/, "")];
      if (!base) continue;
      const tint = parseColor(value);
      const solid = parseColor(base);
      if (!tint || !solid) continue;
      if (tint.r !== solid.r || tint.g !== solid.g || tint.b !== solid.b) {
        drift.push(
          `${name} is rgb(${tint.r},${tint.g},${tint.b}) but ` +
            `${name.replace(/-dim$/, "")} is rgb(${solid.r},${solid.g},${solid.b})`,
        );
      }
    }
    expect(drift, `tint drift:\n  ${drift.join("\n  ")}`).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Goal 3 — direction ink is not borrowed by anything that is not a direction.
 *
 * SCOPE, per ADR-0085: the ENUMERATED CHIP VOCABULARIES only — STATUS_CHIPS and
 * the severity scale. Inline signed-value colouring (green P&L, crimson
 * drawdown) is deliberately NOT covered: it already carries its sign from
 * fmtSigned's +/- glyph, and bringing it in is a separate decision that needs
 * its own ADR. Do not widen this without one.
 *
 * What this cannot catch: it sees that a chip does not NAME a direction token.
 * It cannot see that `corr >= 0 ? "short" : "long"` is a risk verdict wearing
 * direction's clothes — meaning is not checkable from a class string.
 * ──────────────────────────────────────────────────────────────────────────── */
const DIRECTION_INK =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration)-(?:long|short)(?:-dim)?\b/;

describe("goal 3 — direction ink stays with direction", () => {
  it.each(Object.entries(STATUS_CHIPS))(
    "STATUS_CHIPS.%s is not painted with direction ink",
    (name, chip) => {
      expect(
        chip.cls,
        `provenance status "${name}" uses direction ink (${chip.cls}). Forest-green means LONG and crimson means SHORT; a provenance chip wearing either teaches a reader that the hue means two unrelated things — and on /book they render inches apart. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
    },
  );

  // The severity scale is NOT asserted yet, and that is a stated gap rather than
  // an oversight. `severityChipClass("severe")` is `bg-short text-white` — the
  // direction crimson, used for severity — and it fails this rule today.
  //
  // It cannot be fixed by pointing at another existing token. The escalation is
  // solid-crimson `severe` → solid-orange `high` → orange tint → grey outline, so
  // `severe` has to out-rank `high`, and `--warning` is already spent on `high`.
  // The Ledger has no red that is not --short and no green that is not --long, so
  // both this and methodTones' ok/bad need a NEW non-direction token, measured
  // against all three surfaces. That is a palette addition with its own ADR, not
  // a rename — see the ADR-0085 follow-up. Asserting it here before the token
  // exists would only force someone to weaken the rule to get CI green.
  it.each(["moderate", "low"] as const)(
    "severity band %s is not painted with direction ink",
    (band) => {
      const cls = severityChipClass(band);
      expect(
        cls,
        `severity band "${band}" uses direction ink (${cls}). Severity is attention, not direction — that is what --warning is for. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
    },
  );

  it("keeps the direction chips themselves on direction ink", () => {
    // The inverse assertion. If a refactor ever neutralises .badge-long or
    // .dir-pill-long, the vocabulary above would pass while the one thing that
    // IS a direction stopped looking like one.
    const found = Object.fromEntries(cssChipVariants());
    for (const name of ["badge-long", "badge-short", "dir-pill-long", "dir-pill-short"]) {
      expect(found[name], `.${name} is no longer defined`).toBeDefined();
      expect(
        found[name],
        `.${name} must keep its direction ink — it is the one place the hue is correct`,
      ).toMatch(DIRECTION_INK);
    }
  });
});
