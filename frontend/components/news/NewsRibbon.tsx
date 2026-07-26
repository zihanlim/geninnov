"use client";
// frontend/components/news/NewsRibbon.tsx
//
// The top-10 headlines, rolling right-to-left.
//
// Adapted from the margin-stress-engine ribbon (triplicate the list, advance
// scrollLeft, wrap at the second copy). Four things are done differently, and
// each is a rule this repo enforces rather than a preference:
//
//  1. NO HEX. The reference hardcodes #0d1220/#f59e0b/#e5e7eb. Our
//     chip-contrast test FAILS the build on hex literals in app/, components/
//     and lib/, because a hex is invisible to a token sweep and drifts silently.
//     Everything here is a token.
//
//  2. prefers-reduced-motion STOPS IT. The reference animates unconditionally.
//     A permanently moving strip is the single most common accessibility defect
//     on the site we took this from — and goal 8 is a floor, not a polish pass.
//     Reduced motion gets a static, scrollable list with every item reachable.
//
//  3. PAUSES ON FOCUS, not just hover. Theirs pauses on mouseenter only, so a
//     keyboard user tabbing into a moving strip is chasing a link that is
//     sliding away. Focus pauses it here, which is what makes the links usable
//     at all without a mouse.
//
//  4. THE DUPLICATES ARE HIDDEN FROM ASSISTIVE TECH. The seamless-loop trick
//     needs three copies in the DOM; a screen reader would otherwise announce
//     thirty items when there are ten. Copies 2 and 3 are aria-hidden and the
//     live region is the first copy alone.
//
// It is also NOT a live ticker, and does not pretend to be. The pipeline runs
// once a weekday; the motion is a way to fit ten headlines in one strip, not a
// claim that anything is streaming. The run date is stamped on the left so the
// movement cannot be mistaken for freshness (the "Daily Alpha that was two days
// old" failure we catalogued).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchLatestNews, topForRibbon, type NewsItem } from "@/lib/news";

/** px per tick. 1px/40ms ≈ 25px/s — readable at a glance, not a slot machine. */
const STEP_PX = 1;
const TICK_MS = 40;

export function NewsRibbon() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchLatestNews(60);
      if (cancelled) return;
      setItems(topForRibbon(res.items, 10));
      setRunDate(res.runDate);
      setError(res.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Honour the OS setting, and keep honouring it if the reader changes it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || paused || reduceMotion || items.length === 0) return;

    const id = window.setInterval(() => {
      const oneSet = el.scrollWidth / 3;
      if (oneSet <= 0) return;
      let next = el.scrollLeft + STEP_PX;
      // Wrap from the end of copy 2 back to the end of copy 1. Both show the
      // same pixels, so the jump is invisible and the loop never ends.
      if (next >= oneSet * 2) next -= oneSet;
      el.scrollLeft = next;
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [paused, reduceMotion, items.length]);

  // Start inside copy 1 so the strip can also be scrolled backwards by hand.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0 || reduceMotion) return;
    el.scrollLeft = el.scrollWidth / 3;
  }, [items.length, reduceMotion]);

  const copies = useMemo(
    () => (reduceMotion ? [items] : [items, items, items]),
    [items, reduceMotion],
  );

  if (loading) {
    return <div className="skeleton h-[34px] rounded-[6px] mb-4" aria-hidden="true" />;
  }
  if (error || items.length === 0) {
    // Absence with a cause, not an empty strip (goal 2).
    return (
      <p className="m-0 mb-4 px-3 py-2 text-[11px] text-text-tertiary bg-bg-elevated border border-border rounded-[6px]">
        {error
          ? `Headlines unavailable (${error}).`
          : "No headlines persisted for the latest run — theme_news is empty."}
      </p>
    );
  }

  return (
    <section
      aria-label="Latest headlines behind today's theme scores"
      className="mb-4 rounded-[6px] border border-border bg-bg-surface overflow-hidden"
    >
      <div className="flex items-stretch">
        <div className="flex items-center gap-2 px-3 py-2 border-r border-border bg-bg-elevated shrink-0">
          <span className="text-[10px] uppercase tracking-[0.12em] text-text-tertiary font-semibold whitespace-nowrap">
            Top headlines
          </span>
          {runDate && (
            // Stamped, so motion is never mistaken for live data.
            <time
              dateTime={runDate}
              className="num text-[10px] text-text-tertiary whitespace-nowrap"
            >
              {runDate}
            </time>
          )}
        </div>

        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-none flex-1"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="flex items-center gap-6 whitespace-nowrap px-3 py-2">
            {copies.map((copy, ci) =>
              copy.map((it, i) => (
                <NewsRibbonItem
                  key={`${ci}-${i}-${it.headline.slice(0, 24)}`}
                  item={it}
                  /* Only the first copy is real to assistive tech; the other two
                     exist solely to make the loop seamless. */
                  ariaHidden={ci > 0}
                />
              )),
            )}
          </div>
        </div>

        <Link
          href="/#news"
          className="flex items-center px-3 py-2 border-l border-border bg-bg-elevated text-[10px] uppercase tracking-[0.1em] text-text-tertiary hover:text-accent whitespace-nowrap shrink-0"
        >
          All news →
        </Link>
      </div>
    </section>
  );
}

function NewsRibbonItem({
  item,
  ariaHidden,
}: {
  item: NewsItem;
  ariaHidden: boolean;
}) {
  const body = (
    <>
      <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        {item.theme_name ?? "Unassigned"}
      </span>
      <span className="text-[12.5px] text-text-secondary group-hover:text-accent max-w-[46ch] truncate">
        {item.headline}
      </span>
    </>
  );

  const cls = "group inline-flex items-center gap-2 shrink-0";

  // A duplicate must not be focusable — tabbing would otherwise cycle the same
  // ten links three times.
  if (ariaHidden) {
    return (
      <span className={cls} aria-hidden="true">
        {body}
      </span>
    );
  }

  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}
