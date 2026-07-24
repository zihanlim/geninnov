import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // "Ledger" light theme — see app/globals.css for the design rationale.
        // Surfaces (warm paper)
        "bg-primary": "#f6f3ee",
        "bg-surface": "#ffffff",
        "bg-elevated": "#fcfaf6",
        "bg-hover": "#f0ebe2",
        // Borders (warm hairline)
        border: "#e7e0d3",
        "border-strong": "#d6ccb9",
        // Ink
        "text-primary": "#1c1815",
        "text-secondary": "#6b6156",
        // Darkened for WCAG AA (was #9c9182 at 2.80:1 on paper). Tailwind
        // compiles these to literal RGB at build time — the utility classes do
        // NOT read the :root variables — so this file and globals.css must be
        // changed together or only var() call sites move.
        "text-tertiary": "#756b5e",
        // Brand / attention
        accent: "#d40e43",          // interactive / active (crimson-pink), AA 4.81:1
        "accent-dim": "rgba(212,14,67,0.10)",
        brand: "#9f172a",           // primary crimson — emphasis
        "brand-dim": "rgba(159,23,42,0.09)",
        // Direction (ledger ink: green long / crimson short)
        long: "#147a5c",
        "long-dim": "rgba(20,122,92,0.11)",
        short: "#9f172a",
        "short-dim": "rgba(159,23,42,0.10)",
        warning: "#c2410c",         // AA 4.68:1 (was #f97316 at 2.53:1)
        "warning-dim": "rgba(194,65,12,0.12)",
        // Legacy alias (kept for backward compat)
        neutral: "#6b6156",
        edge: "#e7e0d3",
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
