"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/", label: "Conviction" },
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

  const etNow = new Date().toLocaleString("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const live = lastUpdated && Date.now() - new Date(lastUpdated).getTime() < 1000 * 60 * 60 * 36;

  return (
    <header className="sticky top-0 z-50 grid grid-cols-[220px_1fr_auto] items-center px-5 h-14 border-b border-border bg-bg-primary/85 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[0.08em] text-text-primary">
        <div className="w-[22px] h-[22px] rounded bg-gradient-to-br from-accent to-long grid place-items-center text-[11px] text-bg-primary font-bold">
          A
        </div>
        <span>ANDROMEDA</span>
      </Link>

      <nav className="flex gap-1 justify-self-center">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
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
      </nav>

      <div className="flex items-center gap-4 text-text-secondary text-[12px]">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-bg-elevated border border-border rounded-full text-[11px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              live ? "bg-long shadow-[0_0_8px_var(--long)]" : "bg-warning shadow-[0_0_8px_var(--warning)]"
            }`}
          />
          Data {live ? "live" : "stale"} · {formatTime(lastUpdated)} ET
        </span>
        <span className="text-text-tertiary num">{etNow}</span>
      </div>
    </header>
  );
}
