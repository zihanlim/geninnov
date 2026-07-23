"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Ordered as a portfolio manager's morning: what's moving → what we hold →
// what could go wrong → how it was derived. /book consolidates what used to be
// split across /trades, /portfolio and /research; those remain reachable while
// the consolidation beds in.
const NAV_ITEMS = [
  { href: "/", label: "Themes" },
  { href: "/book", label: "Book" },
  { href: "/risk", label: "Risk" },
  { href: "/method", label: "Method" },
];

const SECONDARY_NAV = [
  { href: "/trades", label: "Trade Ideas" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/research", label: "Research" },
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
  const [etNow, setEtNow] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    setEtNow(
      new Date().toLocaleString("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    );
  }, []);

  useEffect(() => {
    if (!lastUpdated) return;
    setLive(Date.now() - new Date(lastUpdated).getTime() < 1000 * 60 * 60 * 36);
  }, [lastUpdated]);

  return (
    <header className="sticky top-0 z-50 grid grid-cols-[220px_1fr_auto] items-center px-5 h-14 border-b border-border bg-bg-primary/85 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[0.08em] text-text-primary">
        <div className="w-[22px] h-[22px] rounded bg-gradient-to-br from-accent to-brand grid place-items-center text-[11px] text-white font-bold">
          A
        </div>
        <span>ANDROMEDA</span>
      </Link>

      <nav
        className="flex gap-1 justify-self-center items-center"
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
              className={`px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors ${
                isActive
                  ? "text-text-primary bg-bg-elevated"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <span className="w-px h-4 bg-border mx-1.5" />
        {SECONDARY_NAV.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                isActive
                  ? "text-text-primary bg-bg-elevated"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-4 text-text-secondary text-[12px]">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-bg-elevated border border-border rounded-full text-[11px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              live === null
                ? "bg-text-tertiary"
                : live
                  ? "bg-long shadow-[0_0_8px_var(--long)]"
                  : "bg-warning shadow-[0_0_8px_var(--warning)]"
            }`}
          />
          Data {live === null ? "—" : live ? "live" : "stale"} ·{" "}
          {formatTime(lastUpdated)} ET
        </span>
        <span className="text-text-tertiary num">{etNow ?? "—"}</span>
      </div>
    </header>
  );
}
