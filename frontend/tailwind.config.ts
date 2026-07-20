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
        bg: { primary: "#0d1117", surface: "#161b22" },
        edge: "#30363d",
        long: "#3fb950",
        short: "#f85149",
        neutral: "#58a6ff",
        "text-primary": "#e6edf3",
        "text-secondary": "#8b949e",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "bar-grow": "barGrow 300ms ease-out",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        barGrow: { "0%": { width: "0%" }, "100%": { width: "var(--bar-width)" } },
      },
    },
  },
  plugins: [],
};

export default config;
