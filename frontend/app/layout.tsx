import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TopBar from "@/components/TopBar";
import LiveFeed from "@/components/LiveFeed";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Andromeda — Quantitative Macro Research",
  description: "Systematic theme identification and trade generation · macro research at conviction scale.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <div className="min-h-screen grid grid-rows-[56px_1fr]">
          <TopBar />
          {children}
        </div>
        <LiveFeed />
      </body>
    </html>
  );
}
