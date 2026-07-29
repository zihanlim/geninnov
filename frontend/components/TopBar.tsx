"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import LiveNewsDock from "@/components/live/LiveNewsDock";
import AskDock from "@/components/chat/AskDock";
import { resolveRunDates } from "@/lib/homeFreshness";
import { PHASES, phaseNumber } from "@/lib/method/phases";

// Ordered as a portfolio manager's morning: what's moving → what we'd put on →
// what could go wrong → how it was derived.
//
// /trades, /portfolio and /research used to sit beside these as a SECONDARY_NAV,
// labelled "legacy links (redirects)". The consolidation finished at ADR-0040 and
// all three became `redirect("/book")` — the header was offering four items that
// all landed on one page, which showed a reader this project's migration history
// for no benefit. The entries went (ADR-0054) and the routes stayed.
//
// /portfolio was added back here for a day as the HELD book and removed again the
// same day (ADR-0151 → ADR-0152). The held book IS a different object from the
// published one, so it was not the duplicate ADR-0025 retired — but it answers a
// question `task.md` does not ask. Q1 wants "top five long and short trades, and
// why"; the $100M in it is scale framing, not a mandate to run money, and neither
// question asks what the book EARNED. A fifth destination reporting NAV also makes
// "what is your track record?" the obvious next question, which six sessions of
// data cannot answer.
//
// Note the ordering comment above once read "what we hold" for /book. It does not
// hold anything — it is what the research RECOMMENDS, and nobody has paid to put it
// on. That distinction is real and is why the held book still exists in the data
// and on /risk; it just does not need a destination.
//
// Four, then. If a fifth is ever proposed, the bar is design-goals' own: a
// destination earns its place by being a different OBJECT the brief asks for, never
// by being a second view of one — and never by being a true thing nobody asked.
// ADR-0170 — the nav IS the process, one tab per phase, at the owner's
// direction. Everything above this line is the reasoning that produced the
// four object-shaped destinations it replaces; it is kept because the costs it
// names are now being PAID, not because it still describes the header.
//
// Derived from PHASES rather than written here, so the strip and the process map
// on /method cannot disagree about how many phases there are or what they are
// called. `tab` is the short label; `name` is the full title the pages use.
//
// Six items where the comment below tuned padding for four: the row is
// `overflow-x-auto`, so on a narrow viewport this scrolls rather than dropping a
// phase. A sequence that hides its last step is worse than one that scrolls.
const NAV_ITEMS = PHASES.map((p) => ({
  href: p.route as string,
  label: p.tab,
  n: phaseNumber(p),
}));

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
  // The run the book currently reflects, for the LiveNewsDock caveat. Read from
  // `pipeline_runs.run_date` and NOT from the `themes.updated_at` already fetched
  // beside it: updated_at is a WRITE timestamp that lags the run_date it belongs
  // to, and sourcing a displayed run date from it is the exact bug `/` was fixed
  // for — the landing page dated a 07-25 run as 07-24 while its own status bar
  // said 07-25. `resolveRunDates` is the same pure resolver `/` uses, so the two
  // cannot drift; updated_at stays a fallback there rather than the source.
  const [pipeRunDate, setPipeRunDate] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("themes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastUpdated(data[0].updated_at);
      });
    supabase
      .from("pipeline_runs")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.run_date) setPipeRunDate(data[0].run_date);
      });
  }, []);

  const runDate = resolveRunDates({
    pipeRunDate: pipeRunDate ?? undefined,
    themeUpdatedAt: lastUpdated ?? undefined,
  }).display;

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
      {/* The mark is the real logo now, not the gradient `A` tile that stood in
          for one. `aria-label` is unconditional because the wordmark is hidden
          below sm — under 640px the link was previously a coloured square with
          a letter in it and no accessible name at all. It is also why the
          responsive wordmark below is not an accessibility problem: the
          ACCESSIBLE name is fixed at every width, and only the visible lockup
          sheds parts as the row runs out of room.

          `ANALYTICS` and the descriptor are gated to `lg`, not `md`, and the
          gate is measured rather than tasteful. At 768 the row already spends
          ~700px of its 768 (logo 124 + nav 230 + cluster 290 + gutters/gaps
          56) because `Next run 21:30 UTC` appears at exactly that breakpoint;
          adding ~95px of wordmark there pushes `Method` back out of the
          `overflow-x-auto` nav track, which is the collision the track exists
          to contain and not a thing to re-create for a longer name. At 1024
          there is ~260px of slack, and the two lines cost only the WIDER of
          them (~200px) because they stack — the descriptor at 10px/0.14em and
          the wordmark at 14px/0.08em come out within a few px of each other,
          which is why this is a lockup and not two stray labels. */}
      <Link
        href="/"
        aria-label="Andromeda Analytics — home"
        className="flex items-center gap-2.5 text-text-primary shrink-0"
      >
        <BrandMark />
        <span className="hidden sm:flex flex-col justify-center leading-none">
          <span className="font-semibold tracking-[0.08em]">
            ANDROMEDA<span className="hidden lg:inline"> ANALYTICS</span>
          </span>
          {/* Tertiary ink, not secondary: this is the descriptor under a name,
              and at secondary it competes with the four nav items beside it.
              --text-tertiary measures 5.52:1 on the page, so the AA floor is
              cleared at 10px as well — goal 8 is a contrast rule, and the size
              here is bounded by the 56px bar rather than by it. */}
          <span className="hidden lg:block mt-[3px] text-[10px] tracking-[0.14em] text-text-tertiary">
            QUANTITATIVE MACRO RESEARCH
          </span>
        </span>
      </Link>

      {/* `overflow-x-auto` CONTAINS the nav in its own grid track. `min-w-0` alone
          lets the track shrink but does nothing to the CONTENT, so the four items
          (230px natural) simply painted outward into the logo and the tool cluster
          either side. Measured on the deployed build at 375: `Method` ended at 237
          against a cluster starting at 210, and this row is over-subscribed before
          any of that -- logo + nav + Ask + run-state already want ~457px of a 375px
          screen. Adding the `Live news` control made a pre-existing overlap worse
          (27px -> 48px, with `Themes` pushed to -14), which is what surfaced it.
          Contained, the items scroll within their track instead of colliding; the
          row still cannot show all four at 375, but nothing overlaps and nothing is
          painted off the left edge. */}
      <nav
        // NOT `justify-self-center` (on the grid item): that sizes the item to its
        // CONTENT and centres it in the track, so it can never shrink -- `min-w-0`
        // and `overflow-x-auto` were both inert and the items overflowed the track
        // in both directions. NOT `justify-center` either: centred flex content that
        // overflows spills past the START edge, which no scroll can reach. The items
        // carry `first:ml-auto last:mr-auto` instead -- the autos split the slack and
        // centre the row when it fits, and collapse to zero when it does not, leaving
        // it left-aligned and scrollable.
        className="flex wide:hidden gap-0.5 sm:gap-1 items-center min-w-0 overflow-x-auto scrollbar-none"
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
              // `md:px-3`, not `sm:px-3`: at 640 the roomier padding cost 24px across
              // four items and left the row 3px short of fitting `Method`, which then
              // scrolled out of view for the sake of 3px. The tighter padding holds
              // until there is real room for it.
              className={`shrink-0 first:ml-auto last:mr-auto px-2.5 md:px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors ${
                isActive
                  ? "text-text-primary bg-bg-elevated"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {/* The number is the point — it is what makes the strip read as a
                  sequence rather than as six unrelated places. Muted so it
                  locates without competing with the label, and aria-hidden
                  because "01 Mandate" read aloud is worse than "Mandate". */}
              <span aria-hidden="true" className="num text-text-tertiary mr-1.5 text-[11px]">
                {item.n}
              </span>
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
            SideRail is untouched: the rail mirrors the destinations.

            It OPENS A PANEL rather than navigating, at the owner's direction —
            which makes the sentence above literally true of the interaction and
            not just of the styling: a tool now behaves like one, answering where
            the reader already is instead of taking them somewhere. `/ask` still
            exists and the panel links to it; it is published in `llms.txt` and is
            the only mount that can hold a Ctrl+F-able, deep-linkable transcript.
            Both mount the same `AskConsole`. */}
        <AskDock />
        {/* Beside `Ask` for the same reason `Ask` is here rather than in the nav:
            both are ways of READING the site, not things it publishes, so they form
            one cluster of tools and the nav stays four destinations. It sits left of
            the run-state group, which is the order it had on `/` — tool, then state. */}
        <LiveNewsDock runDate={runDate} />
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
          {/* `lg`, not `sm`. Measured at 640 the run-state group was 159px of a 269px
              cluster and the nav was 49px short of its four items — the timestamp was
              the single biggest claim on that row, and it is the most redundant thing
              on it: the word beside it already says live or stale, and the exact
              minute matters to nobody at 640px who cannot also see it at 1024. Moving
              it to `lg` returns 65px and the nav fits again. */}
          <span className="hidden lg:inline">
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
