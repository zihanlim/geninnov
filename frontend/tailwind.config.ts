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
      screens: { wide: "1424px" },
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
        // 4.58:1 over its own 10% tint (badge-tier-anchor); was #d40e43 at 4.08:1.
        accent: "#c50c3e",          // interactive / active (crimson-pink)
        "accent-dim": "rgba(197,12,62,0.10)",
        brand: "#9f172a",           // primary crimson — emphasis
        "brand-dim": "rgba(159,23,42,0.09)",
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
