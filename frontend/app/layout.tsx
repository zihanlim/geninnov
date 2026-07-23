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
        <div className="min-h-screen grid grid-rows-[56px_1fr]">
          <TopBar />
          {children}
        </div>
        <LiveFeed />
      </body>
    </html>
  );
}
