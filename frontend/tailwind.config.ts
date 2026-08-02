import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // lib/ returns class strings too — severityChipClass in lib/risk/analytics.ts
    // is the entire visual scale of the /risk severity column. Without this glob
    // those classes compile only when some file under components/ or app/ happens
    // to use the same class, which is luck, not a build: bg-short survived only
    // because BookFactorTilt and PositionRiskAttribution use it, while
    // tracking-[0.04em] — which appears nowhere else in the tree — was dropped
    // silently. Scan lib/ so a class written here is a class that ships.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Two-pane gate. NOT a round number and NOT interchangeable with `xl` —
      // it is derived from BOOK_ROW_MIN_W ("min-w-[640px]", lib/book/grid.ts),
      // the width below which the seven position-row columns collide:
      //
      //   canvas 1400 − 64 (lg gutter, both sides) = 1336 content
      //   (1336 − 24 gap) / 2                      =  656 per pane
      //   656 − 640 required                       =   16px headroom
      //
      // At the old 1320px canvas the panes were 616px and every paired position
      // table would have opened its own horizontal scroller — forever, at every
      // viewport. If you "tidy" this into `xl` (1280px) that is exactly what
      // happens again, silently. See ADR-0084.
      // 1424, NOT 1440. A CSS media query matches the viewport width EXCLUDING a
      // classic scrollbar, and Windows/Linux Chrome uses classic space-taking
      // scrollbars (see the .scrollbar-none note in globals.css). So a maximised
      // 1440px window there reports ~1425px, and a `min-width:1440px` gate never
      // fires — the two-pane layout would be dead on the exact machine it was
      // built for. It is invisible in headless Chromium, which uses overlay
      // scrollbars and reports the full 1440.
      //
      // The pane arithmetic still clears BOOK_ROW_MIN_W (640px) at the new gate:
      //   viewport 1424 − 64 (lg gutter) = 1360 content (under the 1400 cap)
      //   (1360 − 24 gap) / 2            =  668 per pane, 28px of headroom.
      //
      // `figures` is a SECOND gate, and deliberately so — `wide` is derived from
      // the SideRail and the two-pane book row, which are nav and book concerns.
      // Borrowing it for the trends boards' plot ‖ figures split priced those
      // cards at a rail's breakpoint rather than at their own table's width, and
      // the visible cost was that a 1920px screen at Windows' default 150%
      // scaling reports 1280 CSS px and never saw the split at all.
      //
      // Derived from the intrinsic width of NarrativeTrends' SEVEN-column figures
      // table — the binding constraint of the pair, since ThemeTrends' four-column
      // table is only 249px. Both figures MEASURED in the browser (set the wrapper
      // to 1px, read scrollWidth), not estimated:
      //
      //   narrative table min-content, pr-3 gutters = 388px
      //   narrative table min-content, pr-2 gutters = 364px  ← see SeriesTable
      //   figures column at viewport 1248            = 371.7px, 7.7px headroom
      //
      // Do NOT re-derive this as (viewport − gutter − gap)/3. The chain from
      // viewport to column runs through the lg gutter, the TerminalPane, the card's
      // own p-4 and the 20px grid gap, and that shorthand overstates the column by
      // ~17px — enough to place the gate where the table still scrolls. Measure it.
      //
      // 1248, NOT 1280, for the same scrollbar reason `wide` is 1424 and not
      // 1440: a maximised 1280-logical window on Windows Chrome reports ~1265, so
      // an `xl` gate would be dead on the machine this was built for. Verified
      // 1248 splits / 1247 stacks, and 1265 clears with the table at 377px.
      //
      // Below this both boards stack, which is the right answer for the table —
      // at `lg` (1024px) the figures column is 297px against that 364px.
      screens: { wide: "1424px", figures: "1248px" },
      // Tailwind preflight defaults an uncoloured `border-b` to gray-200
      // (#e5e7eb), which is NOT in this palette. Measured on /book: 162 of 186
      // table cells carry `border-b` with no colour class, so 87% of the rules
      // on that page were painted by Tailwind rather than by the design system.
      // Under the old warm ground that was a visible clash — cool grey rules on
      // cream paper — and the cool surface swap accidentally camouflaged it
      // rather than fixing it.
      //
      // Keep this in step with --border in globals.css. It is the same colour;
      // Tailwind compiles to literal RGB and never reads the variable.
      borderColor: { DEFAULT: "#dfe3e7" },
      colors: {
        // "Ledger" light theme — see app/globals.css for the design rationale.
        // Surfaces (cool paper — adopted from stitch_remix technical_precision)
        "bg-primary": "#f6fafe",
        "bg-surface": "#ffffff",
        "bg-elevated": "#f0f4f8",
        "bg-hover": "#eaeef2",
        // Borders (cool hairline)
        border: "#dfe3e7",
        "border-strong": "#c6c6cd",
        // Ink
        "text-primary": "#171c1f",
        "text-secondary": "#45464d",
        // Darkened for WCAG AA (was #9c9182 at 2.80:1 on paper). Tailwind
        // compiles these to literal RGB at build time — the utility classes do
        // NOT read the :root variables — so this file and globals.css must be
        // changed together or only var() call sites move.
        "text-tertiary": "#5f6672",
        // Brand / attention
        // Crimson-pink #c50c3e → teal, 2026-07-29, from the Systematic Alabaster comp
        // set. ADR-0164. 5.04:1 over its own 10% tint (badge-tier-anchor) where the
        // crimson was 4.58:1, and ΔE 32.1 from --short under protanopia where the
        // crimson was 7.7 — below the ~10 floor at which two colours stop being
        // separable, for ~6% of males. Full derivation in globals.css.
        accent: "#00687a",          // interactive / active (teal)
        // Same colour at 10%. The tint-drift test asserts this rgb matches `accent`.
        "accent-dim": "rgba(0,104,122,0.10)",
        // BRAND GROUND — the supplied mark artwork's plate AND the 56px masthead
        // (ADR-0223, widening ADR-0113's fence from "the mark only"). Since
        // ADR-0224 also the ACTIVE lens chip in LensSelector (white ink); since
        // ADR-0225 the bottom-right Ask pill in AskProvider (white ink). Not a
        // general ink, not a panel; see globals.css for why it is fenced and for
        // what it replaced (--brand/--brand-dim, the last survivors of ADR-0085
        // §3, which lived in the masthead tile the real mark replaced). Its
        // utility consumers are the header surface (`bg-logo-plate` in TopBar.tsx),
        // the active lens chip (`bg-logo-plate` in LensSelector.tsx), and the Ask
        // pill (`bg-logo-plate` in AskProvider.tsx); BrandMark reads
        // var(--logo-plate) directly. Declared here so the palette-drift test in
        // chip-contrast.test.ts compares it against globals.css.
        "logo-plate": "#161b38",
        // Header ladder — light on the navy masthead (ADR-0223). The TopBar is
        // solid --logo-plate on every page, so its contents use these instead of
        // paper ink. Header-only; see globals.css for the measured contrast.
        "header-ink": "#ffffff",
        "header-muted": "#b6bbca",
        "header-tertiary": "#8d93a3",
        "header-raised": "#1f2740",
        "header-border": "rgba(255,255,255,0.12)",
        "header-focus": "#9ad9e4",
        "header-warning": "#e07a4a",
        // Direction (ledger ink: green long / crimson short)
        // 4.81:1 over its own 11% tint (badge-long / dir-pill-long); was #147a5c
        // at 4.14:1. --short needs no change at 6.07:1 tinted.
        long: "#126e53",
        "long-dim": "rgba(18,110,83,0.11)",
        short: "#9f172a",
        "short-dim": "rgba(159,23,42,0.10)",
        // AA plain and tinted on every surface a chip lands on; worst case 5.04:1
        // over the 12% tint on the page. Was #c2410c, which passed as plain text
        // but failed tinted on all three (3.96 / 4.18 / 4.35). See globals.css for
        // the derivation and tests/unit/chip-contrast.test.ts for the enforcement.
        warning: "#a83209",
        // Top of the severity ramp only — see globals.css for the derivation.
        // Kept in step with the :root value there; Tailwind compiles to literal
        // RGB and never reads the variable, so these two must move together.
        "warning-deep": "#7c2d12",
        // Keep the rgb() here in step with `warning` above — this is the same
        // colour at 12%, and a stale triplet silently splits the palette.
        "warning-dim": "rgba(168,50,9,0.12)",
        // Legacy alias (kept for backward compat)
        neutral: "#45464d",
        edge: "#dfe3e7",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Hanken Grotesk", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Menlo", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "shimmer": "shimmer 1.5s infinite",
        "pulse-soft": "pulseSoft 2s infinite",
        "slide-in": "slideIn 180ms ease-out",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        pulseSoft: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
        slideIn: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
