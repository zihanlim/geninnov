import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import TopBar from "@/components/TopBar";
import LiveFeed from "@/components/LiveFeed";

// Hanken Grotesk for prose, JetBrains Mono for every figure (the "tape").
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Andromeda — Quantitative Macro Research",
  description: "Systematic theme identification and trade generation · macro research at conviction scale.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        {/* grid-cols-[minmax(0,1fr)]: the single column must be allowed to
            shrink below its min-content, otherwise a wide child (e.g. the
            640px min-width position table) sets a min-content floor that
            forces the whole page wider than a phone viewport — the column
            defaults to `auto`, which does exactly that. minmax(0,…) caps
            every page's <main> at the viewport so wide tables scroll locally
            in their own overflow-x-auto wrapper instead of scrolling the body. */}
        <div className="min-h-screen grid grid-cols-[minmax(0,1fr)] grid-rows-[56px_1fr]">
          <TopBar />
          {children}
        </div>
        <LiveFeed />
      </body>
    </html>
  );
}
