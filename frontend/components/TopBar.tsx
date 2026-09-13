"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import LiveNewsDock from "@/components/live/LiveNewsDock";
import AskDock from "@/components/chat/AskDock";
import DataMapDock from "@/components/datamap/DataMapDock";
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

/**
 * Format an ISO instant as HH:MM in a fixed zone. `timeZone` pins the zone.
 * The visible chips always pass "America/New_York" (the market's clock, which
 * is what the product is about); the tooltip's "Local" line passes `undefined`
 * so it falls back to the browser's own zone (SGT for the owner).
 *
 * Never formatted in the DEFAULT zone at render time — the server runs in UTC,
 * so a default-zone string made during render would make the client disagree
 * after hydration, the clock-mismatch class this file already documents. The
 * tooltip's local line is browser-zone and renders only after mount.
 */
function formatTime(iso: string | null, timeZone?: string): string;
function formatTime(date: Date, timeZone?: string): string;
function formatTime(value: string | Date | null, timeZone?: string): string {
  if (value === null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * The next fire of the daily-refresh cron — weekday (Mon–Fri) 21:30 UTC,
 * `.github/workflows/daily-refresh.yml`. The exact occurrence matters, not
 * just the time of day, for zones with DST: "21:30 UTC" is 17:30 ET in
 * summer and 16:30 in winter, so the local rendering must know WHICH weekday.
 * Pure; exported for test.
 */
export function nextRunUtc(now: Date = new Date()): Date {
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    d.setUTCHours(21, 30, 0, 0);
    if (d <= now) continue;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    return d;
  }
  return now;
}

/** Width of the fade at each end, in px. Wide enough to read as "continues"
 *  rather than as a rendering artefact; narrow enough not to swallow a label. */
const FADE = 24;

/**
 * The mask for a horizontally scrollable strip: fade whichever end has content
 * beyond it, and return null when nothing is clipped.
 *
 * Pure and exported for test — the interesting cases are the boundaries (no
 * overflow at all, scrolled hard to either end) and they are the ones a browser
 * check is least likely to catch by eye.
 */
export function scrollFadeMask(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): string | null {
  // 1px of slack: fractional layout widths mean scrollWidth can exceed
  // clientWidth by a sub-pixel on a strip that visually fits, which would fade
  // an edge with nothing behind it.
  const overflowing = scrollWidth - clientWidth > 1;
  if (!overflowing) return null;
  const atStart = scrollLeft <= 1;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
  if (atStart && atEnd) return null;
  const from = atStart ? "black 0" : `transparent 0, black ${FADE}px`;
  const to = atEnd ? "black 100%" : `black calc(100% - ${FADE}px), transparent 100%`;
  return `linear-gradient(to right, ${from}, ${to})`;
}

export default function TopBar() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const [fadeMask, setFadeMask] = useState<string | null>(null);

  const syncFades = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setFadeMask(scrollFadeMask(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);

  // Measured after mount, never during render: it needs layout, and computing it
  // on the server would produce a mask the client immediately disagrees with —
  // the hydration-mismatch class this file already documents for clock values.
  //
  // ResizeObserver rather than a window resize listener: the nav is a grid track
  // whose width changes when the TOOL CLUSTER beside it grows — `Next run 21:30
  // UTC` appears at md, and the run-state cell widens once data loads — with no
  // window resize involved at all.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    syncFades();
    const ro = new ResizeObserver(syncFades);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [syncFades]);

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

  // The run-state tooltip: the ET values are the visible face of the market's
  // clock; the UTC and SGT equivalents live in a tooltip because the product's
  // schedule is UTC while its owner works in SGT. Both anchors are computed
  // AFTER mount (browser-zone output at render time would be a hydration
  // mismatch — the same class `live` avoids) and are `fixed`-positioned.
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const openTip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Right-anchor the card instead of hanging its left edge off `r.right`.
    // The trigger sits at the far right of the bar, so a left-anchored tooltip
    // starts flush against the screen edge and reads as cut off; anchoring its
    // right edge just inside the trigger's keeps it on-screen at every width.
    // `tipRef.current` is the card (its only consumer), so the measured width
    // stays honest even when `max-w-[90vw]` has shrunk it.
    const w = tipRef.current?.getBoundingClientRect().width ?? 192;
    setTip({ top: r.bottom + 6, left: r.right - w - 8 });
  };
  const closeTip = () => setTip(null);

  // Clamp the tooltip inside the viewport using its REAL rendered rect, after
  // paint has been computed but before it is shown. `openTip` guesses from the
  // trigger; this corrects for the actual tooltip width and any containing-block
  // drift, so `left` can never put the card off the right edge. Runs synchronously
  // before paint, so there is no one-frame flash at the unclamped position.
  //
  // Clamp against `clientWidth`, not `innerWidth`: the bar's page scrolls
  // vertically, so the scrollbar takes ~15px off `innerWidth` and an unclamped
  // `left` could otherwise sit under it, cut off to the eye. `clientWidth` is
  // the viewport the browser will actually paint into.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const rect = tipRef.current.getBoundingClientRect();
    const maxLeft = document.documentElement.clientWidth - rect.width - 8;
    const left = Math.max(8, Math.min(tip.left, maxLeft));
    if (left !== tip.left) setTip((t) => (t ? { ...t, left } : t));
  }, [tip]);

  // The tooltip's "Data local" line is the browser's own zone (SGT for the
  // owner), which differs from the SSR zone (UTC) — the hydration-mismatch
  // class this file already documents for clock values. Gated on mount: until
  // `mounted`, the local line falls back to the UTC value so server and client
  // agree; after mount it swaps to the viewer's zone.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 sm:px-5 h-14 border-b border-header-border bg-logo-plate">
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
        aria-label="geninnov — home"
        className="flex items-center gap-2.5 text-header-ink shrink-0"
      >
        <BrandMark />
        <span className="hidden sm:flex flex-col justify-center leading-none">
          <span className="font-semibold tracking-[0.08em]">
            geninnov
          </span>
          {/* Tertiary ink, not secondary: this is the descriptor under a name,
              and at secondary it competes with the four nav items beside it.
              --header-tertiary measures 5.48:1 on navy, so the AA floor is
              cleared at 10px as well — goal 8 is a contrast rule, and the size
              here is bounded by the 56px bar rather than by it. */}
          <span className="hidden lg:block mt-[3px] text-[10px] tracking-[0.14em] text-header-tertiary">
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
        ref={navRef}
        onScroll={syncFades}
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
        // The strip became six items at ADR-0170 and stops fitting well before
        // `wide`: at 900px two phases sit outside the track with nothing to say
        // so, which reads as a nav that HAS four items rather than one showing
        // four of six. The fade is that signal.
        //
        // `mask-image`, not an overlay gradient. The header is solid
        // `bg-logo-plate` (ADR-0223), so an overlay gradient would have to paint
        // exactly the navy to look seamless; a mask fades the CONTENT to
        // transparent instead and needs to know nothing about what is behind it.
        //
        // Conditional on ACTUAL overflow and scroll position, never static. A
        // permanent right fade dims `06 Attribution` at every width where all six
        // already fit, which reads as disabled rather than as continued -- worse
        // than the problem. Both edges, because once scrolled right the items
        // hidden are on the LEFT.
        style={{ maskImage: fadeMask ?? undefined, WebkitMaskImage: fadeMask ?? undefined }}
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
                  ? "text-header-ink bg-header-raised"
                  : "text-header-muted hover:text-header-ink hover:bg-header-raised"
              }`}
            >
              {/* The number is the point — it is what makes the strip read as a
                  sequence rather than as six unrelated places. Muted so it
                  locates without competing with the label, and aria-hidden
                  because "01 Mandate" read aloud is worse than "Mandate". */}
              <span aria-hidden="true" className="num text-header-tertiary mr-1.5 text-[11px]">
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
        {/* The data map. Cross-cutting like /method and /facts, so it is not in
            `lib/method/phases.ts` and the four-destination rule holds; but the
            only place it is reachable today is the bottom Note on /method, which
            is two clicks from a reader on a different page. A TopBar tool
            surfaces it without burning a nav slot. Order: `Ask` then `Data map`
            then `Live news` — Ask first because it is the read-side of the book,
            Data map second because it explains the system that produced it, Live
            news third because it is the most ephemeral of the three. Same
            `RibbonControl` look as the other two; the only difference is the
            click is a Link, not a panel. */}
        <DataMapDock />
        {/* /facts is reachable from /alpha (the theme heatmap) and from /ask's
            "What it reads" sidebar — see ThemeHeatmap's per-row fact link and
            AskPage's layer-count block. A top-bar entry is redundant: the badge
            was a presence signal for a data layer, not a navigation destination
            (ADR-0222 was about /facts the route; the surfacing of it is decided
            per-page, not globally).
            Beside `Ask` for the same reason `Ask` is here rather than in the nav:
            both are ways of READING the site, not things it publishes, so they form
            one cluster of tools and the nav stays four destinations. It sits left of
            the run-state group, which is the order it had on `/` — tool, then state. */}
        <LiveNewsDock runDate={runDate} />
        {/* The visible run-state group. ET stays the face — the market trades
            on ET, so the market's clock is the one the product is ABOUT. The
            UTC and SGT equivalents live in the tooltip (below), reached on
            hover and on focus, because the product's schedule is UTC while its
            owner works in SGT — the reader who needs them gets them, and the
            row does not spend itself on a third and fourth time. `group`
            scopes the tooltip to this cluster so it opens exactly here. */}
        <div
          ref={tipRef}
          aria-describedby="run-state-tip"
          onMouseEnter={(e) => openTip(e.currentTarget)}
          onMouseLeave={closeTip}
          onFocus={(e) => openTip(e.currentTarget)}
          onBlur={closeTip}
          className="group relative flex items-stretch text-header-muted text-[12px] border border-header-border rounded-md overflow-hidden bg-header-raised divide-x divide-header-border"
        >
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap">
          {/* Was bg-long — direction green spent on a freshness state, which is
              goal 3's failure mode (ADR-0085). The words "live"/"stale" already
              carry the meaning, so the dot only has to separate the three cases:
              ink for fresh, --header-warning for stale, tertiary for unknown.
              On navy the page's --warning is 2.5:1, so the STALE dot uses
              --header-warning (5.65:1) — see ADR-0223. */}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              live === null
                ? "bg-header-tertiary"
                : live
                  ? "bg-header-ink"
                  : "bg-header-warning"
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
            <span className="num">{formatTime(lastUpdated)} ET</span>
          </span>
        </span>
        {/* Replaces a stamp of TODAY'S date, which told a reader nothing about a
            product that publishes once a day. The cadence does. This is static
            copy on purpose — no ticking element, because the pipeline is a
            21:30 UTC weekday job and live-updating chrome would misrepresent it. */}
        <span className="hidden md:inline-flex items-center px-2.5 py-1 text-[11px] text-header-tertiary whitespace-nowrap">
          Next run <span className="num ml-1">21:30 UTC</span>
        </span>

        {/* The tooltip: the three times, on hover and focus. Follows the app's
            tooltip convention (BookFunnel's funnel tips) — `role="tooltip"`,
            rendered ALWAYS (once mounted) so Ctrl-F and aria-describedby can
            reach the text, `visible`/`invisible` toggled by the group's hover
            and by focus. `aria-describedby` on the group makes the trigger
            keyboard- and screen-reader-reachable, not hover-only. The local
            line uses the browser's own zone (SGT for the owner); both anchors
            are the SAME fixed time, so ET and UTC can never drift.

            Portalled to `document.body` — this is what keeps it on screen.
            A fixed tooltip left inside the header would resolve against the
            nearest positioned ancestor and get clipped by the run-state
            group's `overflow-hidden`; portalling is what makes `fixed`
            genuinely viewport-relative, and `useLayoutEffect` clamps the real
            rendered rect to the viewport. */}
        {mounted &&
          createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              id="run-state-tip"
              className={`${
                tip ? "visible opacity-100" : "invisible opacity-0"
              } transition-opacity fixed z-50 w-48 max-w-[90vw] text-left card p-3 shadow-lg pointer-events-none`}
              style={tip ? { left: tip.left, top: tip.top } : { left: -9999, top: -9999 }}
            >
          <div className="num text-[10px] uppercase tracking-[0.08em] mb-1.5 text-text-tertiary">
            Run state
          </div>
          <dl className="m-0 space-y-1 text-[11px] leading-[1.4] text-text-secondary">
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Data ET</dt>
              <dd className="num m-0">{formatTime(lastUpdated, "America/New_York")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Data UTC</dt>
              <dd className="num m-0">{formatTime(lastUpdated, "UTC")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Data local</dt>
              {/* Browser zone (SGT for the owner). ET/UTC are zone-fixed and safe
                  at SSR; the local line is not, so it falls back to UTC until
                  `mounted` flips it to the viewer's zone. */}
              <dd className="num m-0">
                {mounted ? formatTime(lastUpdated) : formatTime(lastUpdated, "UTC")}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-1 mt-1.5">
              <dt className="text-text-tertiary">Next UTC</dt>
              <dd className="num m-0">{formatTime(nextRunUtc(), "UTC")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Next ET</dt>
              <dd className="num m-0">{formatTime(nextRunUtc(), "America/New_York")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-tertiary">Next local</dt>
              <dd className="num m-0">
                {mounted ? formatTime(nextRunUtc()) : formatTime(nextRunUtc(), "UTC")}
              </dd>
            </div>
          </dl>
            </div>,
            document.body,
          )}
        </div>
      </div>
    </header>
  );
}
