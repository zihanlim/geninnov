"use client";
// frontend/components/news/NewsFeed.tsx
//
// The headlines behind today's scores, as a readable list on the home page.
//
// This is the fix for a real complaint: the pipeline collects ~330 headlines a
// day, each now carrying a publisher URL, and until today every one of them was
// behind a 10px `ⓘ derive` hint that does not render below the `md` breakpoint,
// three scroll-sections deep inside a drawer. The evidence for every HypeScore
// on the page was, in practice, invisible.
//
// It is a SECTION on `/`, not a new route. The nav stays four destinations
// (ADR-0084 / the standing non-goal); this is the same data the theme cards
// above are scored from, shown where the reader already is rather than behind a
// fifth tab.

import { useEffect, useState } from "react";
import { fetchLatestNews, type NewsItem } from "@/lib/news";
import { NewsRow } from "./NewsRow";
import { EmptyState } from "@/components/status/EmptyState";

const PAGE = 12;

export function NewsFeed({ embedded = false }: { embedded?: boolean } = {}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(PAGE);
  // Fixed at mount so every row's relative age is computed against one instant
  // and cannot drift between rows mid-render.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchLatestNews(60);
      if (cancelled) return;
      setItems(res.items);
      setRunDate(res.runDate);
      setError(res.error);
      setNow(new Date());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // EMBEDDED drops the section chrome. Inside a TerminalPane the pane already
  // supplies the heading, the card and the scroll box, so the standalone
  // version rendered a second <h2> with the same words, a card inside a card,
  // and an mb-8 that pushed 1,260px of rows through a 418px pane. A component
  // written as a page section does not become a pane by being placed in one.
  const Wrapper = embedded ? "div" : "section";
  return (
    <Wrapper
      id="news"
      aria-label={embedded ? undefined : "Headlines behind today's scores"}
      className={embedded ? "" : "mb-8"}
    >
      {!embedded && (
        <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
          <h2 className="text-[15px] font-semibold m-0">
            Headlines behind today&apos;s scores
          </h2>
          <p className="m-0 text-[11px] text-text-tertiary">
            The items the HypeScores above are computed from
            {runDate ? (
              <>
                {" · "}
                <time dateTime={runDate} className="num">
                  {runDate}
                </time>
              </>
            ) : null}
          </p>
        </div>
      )}

      {loading ? (
        <div className={`skeleton rounded-[10px] ${embedded ? "h-full min-h-[160px]" : "h-[220px]"}`} aria-hidden="true" />
      ) : error ? (
        <EmptyState
          title="Headlines unavailable"
          cause={error}
          source="theme_news"
          severity="warning"
          compact
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No headlines for the latest run"
          cause="theme_news has no rows for the most recent run_date. The news fetch returns nothing when BRAVE_SEARCH_API_KEY is absent or the feed failed."
          source="theme_news"
          severity="warning"
          compact
        />
      ) : (
        <div className={embedded ? "px-[18px]" : "card px-[18px] py-1"}>
          <ul className="list-none m-0 p-0">
            {items.slice(0, shown).map((it, i) => (
              <NewsRow key={`${it.headline.slice(0, 32)}-${i}`} item={it} now={now ?? new Date()} />
            ))}
          </ul>
          {/* Explicit terminator, and a count that names the whole — "that is
              all of them" and "the list was cut" must not look identical. */}
          <p className="m-0 py-2.5 text-[11px] text-text-tertiary">
            {shown < items.length ? (
              <button
                type="button"
                onClick={() => setShown((s) => s + PAGE)}
                className="text-accent hover:underline"
              >
                Show {Math.min(PAGE, items.length - shown)} more
              </button>
            ) : (
              `End of list — ${items.length} headline${items.length === 1 ? "" : "s"} collected this run.`
            )}
          </p>
        </div>
      )}
    </Wrapper>
  );
}
