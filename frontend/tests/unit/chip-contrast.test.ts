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
import { DELTA_CHIPS, LIMIT_STATUS_CHIPS } from "@/lib/risk/riskChips";

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
  ...Object.entries(LIMIT_STATUS_CHIPS).map(([k, v]): [string, string] => [
    `LIMIT_STATUS_CHIPS.${k}`,
    v.cls,
  ]),
  ...Object.entries(DELTA_CHIPS).map(([k, cls]): [string, string] => [
    `DELTA_CHIPS.${k}`,
    cls,
  ]),
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
      // The not-held variants. Pinned because their whole job is to be
      // DIFFERENT from the two above: a filled pill means the book holds this
      // side, a hollow one means it considered and declined. Delete these and
      // ClearedNotTaken silently falls back to rendering candidates in the
      // held-position treatment, which is the collision they were added to fix.
      "dir-pill-cand-long",
      "dir-pill-cand-short",
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

  // All four bands now. `severe` was `bg-short text-white` until --warning-deep
  // was added for exactly this band — the ramp needed a level above solid
  // --warning, which `high` owns. methodTones' ok/bad are still outstanding and
  // are NOT asserted here; they need a positive non-direction tone, which is a
  // separate decision from this one.
  it.each(["severe", "high", "moderate", "low"] as const)(
    "severity band %s is not painted with direction ink",
    (band) => {
      const cls = severityChipClass(band);
      expect(
        cls,
        `severity band "${band}" uses direction ink (${cls}). Severity is attention, not direction — that is what --warning is for. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
    },
  );

  it.each(Object.entries(TONE_CLS))(
    "methodTones.%s box is not painted with direction ink",
    (tone, cls) => {
      expect(
        cls,
        `/method tone "${tone}" uses direction ink (${cls}). These are verdicts about a computation, not book directions — and on /method a green "reconciles" callout renders near green LONG rows. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
    },
  );

  it.each(Object.entries(TONE_LABEL_CLS))(
    "methodTones.%s label is not painted with direction ink",
    (tone, cls) => {
      expect(cls).not.toMatch(DIRECTION_INK);
    },
  );

  it.each(Object.entries(LIMIT_STATUS_CHIPS))(
    "LIMIT_STATUS_CHIPS.%s is not painted with direction ink",
    (name, chip) => {
      expect(
        chip.cls,
        `risk-limit status "${name}" uses direction ink (${chip.cls}). On /risk this chip renders in the same viewport as PositionRiskAttribution's long and short rows, so a green OK is the exact hue of a LONG pill. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
      expect(
        chip.fill,
        `risk-limit status "${name}" fills its utilisation meter with direction ink (${chip.fill}).`,
      ).not.toMatch(/var\(--(?:long|short)\)/);
    },
  );

  it.each(Object.entries(DELTA_CHIPS))(
    "DELTA_CHIPS.%s is not painted with direction ink",
    (name, cls) => {
      expect(
        cls,
        `delta verdict "${name}" uses direction ink (${cls}). The signed-value exemption does not reach this chip: \`higherIsWorse\` decouples the hue from the sign, so a falling Sharpe and a falling VaR take opposite colours on the same glyph. See ADR-0085.`,
      ).not.toMatch(DIRECTION_INK);
    },
  );

  it("leaves no direction ink on a badge outside the direction vocabulary", () => {
    // The inline call sites, not just the vocabularies. `badge badge-long` on a
    // success/verified/regime/tier chip was the largest remaining group of
    // goal-3 violations; this stops them coming back one component at a time.
    //
    // TWO patterns, because one was not enough. This swept for `badge badge-long`
    // only, and a chip written with UTILITY classes — `badge bg-short-dim
    // text-short` — is the same violation in a spelling the sweep could not see.
    // Three shipped chips survived the 2026-07-26 goal-3 pass that way:
    // RiskLimitBoard's OK/BREACHED board, DeltaChip, and DiscoveredThemes' method
    // tag. So the second pattern is the boxed-chip SIGNATURE: a direction tint and
    // direction ink on one line.
    //
    // It is deliberately the pair, not either alone. A bare `text-short` is the
    // signed-value case the header exempts (it carries its own +/− glyph); a bare
    // `bg-short-dim` is a row tint, not a chip. Only tint-plus-ink is a chip, and a
    // legitimate direction chip has `.badge-long` / `.dir-pill-long` to use instead.
    const RULES: Array<[RegExp, string]> = [
      [/badge\s+badge-(long|short)|"badge-(long|short)"/, "badge-long/badge-short"],
      [
        /bg-(long|short)-dim[\w/[\]-]*[\s"'`].*\btext-(long|short)\b/,
        "direction tint + direction ink (a chip in utility-class spelling)",
      ],
    ];
    const roots = ["app", "components"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          for (const line of src.split("\n")) {
            if (/^\s*(\/\/|\*)/.test(line)) continue; // a comment explaining the ban is not a violation
            for (const [re, why] of RULES) {
              if (re.test(line)) offenders.push(`${p} [${why}]: ${line.trim().slice(0, 90)}`);
            }
          }
        }
      }
    };
    for (const r of roots) walk(path.resolve(__dirname, "../..", r));
    expect(
      offenders,
      `direction ink used outside the direction vocabulary:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the utility-spelling sweep actually fires on the chips it was written for", () => {
    // A negative control. The first rule shipped for weeks while three chips in the
    // second spelling walked past it, so an added pattern that silently matches
    // nothing would repeat exactly that failure — a guard whose regex is subtly
    // wrong looks identical to a clean codebase.
    const utilityChipRule = /bg-(long|short)-dim[\w/[\]-]*[\s"'`].*\btext-(long|short)\b/;
    for (const line of [
      `  breached: { label: "BREACHED", badge: "bg-short-dim text-short" },`,
      `  const cls = worse ? "bg-short-dim text-short" : "bg-long-dim text-long";`,
      `    className="text-[10px] rounded bg-long-dim text-long"`,
    ]) {
      expect(utilityChipRule.test(line), `rule missed: ${line.trim()}`).toBe(true);
    }
    // And does NOT fire on the two exempted shapes.
    for (const line of [
      `  const cls = v >= 0 ? "text-long" : "text-short";`, // signed value, no tint
      `    className={crowded ? "bg-short-dim/20" : ""}`, // row tint, no ink
    ]) {
      expect(utilityChipRule.test(line), `rule over-fired: ${line.trim()}`).toBe(false);
    }
  });

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

  it("separates a held direction from one we passed over, by FILL not hue", () => {
    // The distinction ClearedNotTaken depends on. Hue must stay on both — the
    // table sorts shorts first and a reader scans that column by colour — so the
    // thing that has to differ is the fill: `dir-pill-long` is solid because the
    // book holds it, `dir-pill-cand-long` is an outline because the book declined
    // it. Collapse the two and one encoding carries two opposite claims.
    const found = Object.fromEntries(cssChipVariants());

    for (const side of ["long", "short"]) {
      const held = found[`dir-pill-${side}`];
      const cand = found[`dir-pill-cand-${side}`];

      expect(cand, `.dir-pill-cand-${side} is not defined`).toBeDefined();
      expect(
        cand,
        `.dir-pill-cand-${side} must keep direction ink — the hue still says which side the idea was on`,
      ).toMatch(DIRECTION_INK);

      expect(
        held,
        `.dir-pill-${side} must stay FILLED — a solid pill is what "the book holds this" looks like`,
      ).toMatch(new RegExp(`bg-${side}-dim`));
      expect(
        cand,
        `.dir-pill-cand-${side} must NOT carry a -dim fill — a filled pill is reserved for positions actually held`,
      ).not.toMatch(/bg-\w+-dim/);
      expect(
        cand,
        `.dir-pill-cand-${side} must carry a border — with no fill, the outline is the only thing giving it a box`,
      ).toMatch(/border/);
    }
  });

  it("ClearedNotTaken renders the candidate pill, never the held one", () => {
    // The rule above is about the classes; this is about the one component that
    // has to choose correctly between them. It rendered
    // `style={{color: var(--long)}}` inline until 2026-07-26 — a THIRD spelling of
    // direction ink that neither the `badge badge-long` sweep nor the utility-class
    // sweep can see, on rows the book explicitly did not take.
    const src = readFileSync(
      path.resolve(__dirname, "../../components/book/ClearedNotTaken.tsx"),
      "utf8",
    );
    expect(
      src,
      "ClearedNotTaken must use the hollow candidate pill for the Side column",
    ).toMatch(/dir-pill-cand-(long|short)/);
    expect(
      src,
      'ClearedNotTaken must not colour a declined candidate with inline var(--long)/var(--short) — that is the held-position ink, and it is invisible to the class sweeps',
    ).not.toMatch(/direction === "short" \? "var\(--short\)" : "var\(--long\)"/);
  });
});
