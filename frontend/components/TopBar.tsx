"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Ordered as a portfolio manager's morning: what's moving → what we hold →
// what could go wrong → how it was derived.
//
// /trades, /portfolio and /research used to sit beside these as a SECONDARY_NAV,
// labelled "legacy links (redirects)" in this file, "while the consolidation beds
// in". The consolidation finished at ADR-0040 and all three page components are now
// nothing but `redirect("/book")` — so the header offered four separate items that
// all land on the same page, and showed a reader this project's migration history
// for no benefit. The ROUTES stay, so bookmarks and inbound links still resolve;
// only the header entries are gone (ADR-0054).
const NAV_ITEMS = [
  { href: "/", label: "Themes" },
  { href: "/book", label: "Book" },
  { href: "/risk", label: "Risk" },
  { href: "/method", label: "Method" },
];

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default function TopBar() {
  const pathname = usePathname();
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("themes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastUpdated(data[0].updated_at);
      });
  }, []);

  // Clock-dependent values are computed AFTER mount, never during render.
  // `new Date()` at render time produces one value on the server and a
  // different one in the browser, which is a hydration mismatch — one of the
  // four React hydration errors thrown on every page of this app.
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!lastUpdated) return;
    setLive(Date.now() - new Date(lastUpdated).getTime() < 1000 * 60 * 60 * 36);
  }, [lastUpdated]);

  return (
    <header className="sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 sm:px-5 h-14 border-b border-border bg-bg-primary/85 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[0.08em] text-text-primary shrink-0">
        <div className="w-[22px] h-[22px] rounded bg-gradient-to-br from-accent to-brand grid place-items-center text-[11px] text-white font-bold shrink-0">
          A
        </div>
        <span className="hidden sm:inline">ANDROMEDA</span>
      </Link>

      <nav
        className="flex wide:hidden gap-0.5 sm:gap-1 justify-self-center items-center min-w-0"
        aria-label="Primary"
      >
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`px-2.5 sm:px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors ${
                isActive
                  ? "text-text-primary bg-bg-elevated"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Ribbon cluster: grouped cells divided by internal hairlines rather than
          floated pills with gaps. That is the one structural idea worth taking
          from the comps' top bar — a run-state group reads as one instrument
          when its cells share a border, and as loose chrome when they don't. */}
      <div className="flex items-center gap-2 justify-self-end">
        {/* /ask is a TOOL, not a fifth destination.
            The four-destination rule in design-goals.md is about what the
            product IS — themes, book, risk, method — and adding "Ask" to that
            list would claim the chat is a peer of the book rather than a way of
            reading it. So it sits outside the nav, styled as a control, and the
            nav stays four items in both the bar and the rail. It is also why
            SideRail is untouched: the rail mirrors the destinations. */}
        <Link
          href="/ask"
          aria-current={pathname?.startsWith("/ask") ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12px] font-medium whitespace-nowrap transition-colors ${
            pathname?.startsWith("/ask")
              ? "border-border-strong bg-bg-elevated text-text-primary"
              : "border-border bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          }`}
        >
          <MessageSquareText size={13} aria-hidden strokeWidth={1.75} />
          Ask
        </Link>
        <div className="flex items-stretch text-text-secondary text-[12px] border border-border rounded-md overflow-hidden bg-bg-elevated divide-x divide-border">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap">
          {/* Was bg-long — direction green spent on a freshness state, which is
              goal 3's failure mode (ADR-0085). The words "live"/"stale" already
              carry the meaning, so the dot only has to separate the three cases:
              neutral ink for fresh, --warning for stale, tertiary for unknown. */}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              live === null
                ? "bg-text-tertiary"
                : live
                  ? "bg-text-secondary"
                  : "bg-warning"
            }`}
          />
          Data {live === null ? "—" : live ? "live" : "stale"}
          <span className="hidden sm:inline">
            {" · "}
            {formatTime(lastUpdated)} ET
          </span>
        </span>
        {/* Replaces a stamp of TODAY'S date, which told a reader nothing about a
            product that publishes once a day. The cadence does. This is static
            copy on purpose — no ticking element, because the pipeline is a
            21:30 UTC weekday job and live-updating chrome would misrepresent it. */}
        <span className="hidden md:inline-flex items-center px-2.5 py-1 text-[11px] text-text-tertiary whitespace-nowrap">
          Next run <span className="num ml-1">21:30 UTC</span>
        </span>
        </div>
      </div>
    </header>
  );
}
