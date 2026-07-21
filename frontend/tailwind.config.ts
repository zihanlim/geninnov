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
        // Surfaces
        "bg-primary": "#0a0e14",
        "bg-surface": "#11151c",
        "bg-elevated": "#161b24",
        "bg-hover": "#1c2230",
        // Borders
        border: "#1f2733",
        "border-strong": "#2a3344",
        // Text
        "text-primary": "#e6edf3",
        "text-secondary": "#8b96a8",
        "text-tertiary": "#5a6477",
        // Accents
        accent: "#4d8fff",
        "accent-dim": "rgba(77,143,255,0.12)",
        // Direction
        long: "#3fb950",
        "long-dim": "#1f3a25",
        short: "#f85149",
        "short-dim": "#3a1f1f",
        warning: "#d29922",
        "warning-dim": "#3a2f15",
        // Legacy alias (kept for backward compat)
        neutral: "#58a6ff",
        edge: "#30363d",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "shimmer": "shimmer 1.5s infinite",
        "pulse-soft": "pulseSoft 2s infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        pulseSoft: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
      },
    },
  },
  plugins: [],
};

export default config;
