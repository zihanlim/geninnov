import type { Metadata } from "next";
import { Suspense } from "react";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import TopBar from "@/components/TopBar";
import Analytics from "@/components/Analytics";
import SideRail from "@/components/SideRail";
import LiveFeed from "@/components/LiveFeed";
import AskProvider from "@/components/chat/AskProvider";

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
  title: "geninnov Analytics — Quantitative Macro Research",
  description: "Systematic theme identification and trade generation · macro research at conviction scale.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Analytics />
        {/* grid-cols-[minmax(0,1fr)] pins the single column to the viewport
            (its default `auto` would size to min-content and blow past a phone).
            The min-w-0 wrapper is the other half: a grid *item* still has
            min-width:auto and would overflow its own cell to its min-content
            (the 640px position table). min-w-0 lets it shrink to the cell so
            wide tables scroll locally in their overflow-x-auto wrapper instead
            of scrolling the body. Both are needed — track AND item. */}
        {/* The rail is added as its own `auto` column BESIDE the existing
            minmax(0,1fr) track, never in place of it. TopBar spans both so it
            stays full-bleed. Both halves of the note above still apply to the
            content column — it keeps minmax(0,1fr) as its track and min-w-0 as
            its item, which is what lets a 640px table scroll inside its own
            wrapper instead of scrolling the body. */}
        {/* TopBar sits OUTSIDE the grid, not as a grid item and NOT wrapped.
            Both alternatives break `position: sticky` on it: a sticky element's
            containing block is its grid area, and row 1 is 56px tall, so there
            is nowhere for it to stick. Verified empirically — wrapping it in a
            col-span-2 div sent the header to top:-1200 after a 1200px scroll,
            while the deployed build held it at top:0. Leave it a sibling. */}
        {/* AskProvider owns the single Ask window's open state (shared by the
            TopBar Ask control and the bottom-right Ask pill) and renders that
            one window + the pill. It must wrap the page content so the FAB and
            the window are present on every route; the layout does not remount
            across client-side navigations, so the window and its transcript
            survive a route change. */}
        <AskProvider>
          <TopBar />
          <div className="min-h-[calc(100vh-56px)] grid grid-cols-[auto_minmax(0,1fr)]">
            <SideRail />
            <div className="min-w-0">{children}</div>
          </div>
        </AskProvider>
        {/* Suspense, because `LiveFeed` calls `useSearchParams` to learn whether a
            non-default `?lens=` is on screen (it qualifies its "Held tickers" count
            when one is). A client component reading search params under a server
            layout has to sit behind a boundary or `next build` bails out of static
            rendering for every route — this is a ROOT layout, so that would be all
            of them. Same reason `BookShell` wraps `BookPageInner`.
            No fallback: the strip is fixed chrome at the foot of the page and
            already renders em-dashes until its own fetch lands, so a skeleton here
            would only add a second flash of different placeholder. */}
        <Suspense fallback={null}>
          <LiveFeed />
        </Suspense>
      </body>
    </html>
  );
}
