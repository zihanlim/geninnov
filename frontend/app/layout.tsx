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
        {/* grid-cols-[minmax(0,1fr)] pins the single column to the viewport
            (its default `auto` would size to min-content and blow past a phone).
            The min-w-0 wrapper is the other half: a grid *item* still has
            min-width:auto and would overflow its own cell to its min-content
            (the 640px position table). min-w-0 lets it shrink to the cell so
            wide tables scroll locally in their overflow-x-auto wrapper instead
            of scrolling the body. Both are needed — track AND item. */}
        <div className="min-h-screen grid grid-cols-[minmax(0,1fr)] grid-rows-[56px_1fr]">
          <TopBar />
          <div className="min-w-0">{children}</div>
        </div>
        <LiveFeed />
      </body>
    </html>
  );
}
