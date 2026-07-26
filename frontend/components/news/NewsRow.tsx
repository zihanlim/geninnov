"use client";
// frontend/components/news/NewsRow.tsx
//
// One headline, in the shape the competitor's /signals?tab=news row uses:
//
//     {CLUSTER} · {age}
//     {headline}
//     {source} · {tone}
//
// WHAT WE TOOK AND WHAT WE DID NOT. Their row reads
// `AI REGULATION 2026 · 20 minutes ago / Meta Struggles to Ban Misuse of AI
// Smart Glasses / Medium Impact · TECH · 1 market · Bearish · Futurism ·
// Conf 85%`. The structure is good: a named cluster above, the headline as the
// object, and the qualifiers demoted below it — you can scan the middle line
// alone and still know what happened.
//
// Three of their fields are refused rather than faked:
//   · `Conf 85%`     — nothing in L0–L5 produces a probability, and a fabricated
//                      one looks auditable and is not (goal 1).
//   · `1 market`     — needs a headline→instrument linkage we do not model.
//   · `Medium Impact`— an undisclosed severity. We have no such score.
//
// One field is ours and better than theirs: `tone` is a VADER compound score the
// pipeline computed and persisted in `theme_news.sentiment`, so it reconciles to
// a column instead of to an opinion. It renders as a WORD, never as colour —
// these rows sit on the same page as long/short ink and a green "positive" chip
// would read as a book direction (ADR-0085).
//
// The cluster label is the THEME. That is genuinely our equivalent of their
// "US-IRAN CONFLICT 2026": the thing the headline scored into.

import { isSynthetic, toneOf, TONE_LABEL, type NewsItem } from "@/lib/news";

/** "4h", "2d" — relative age from the published date, or null when absent. */
function ageLabel(published: string | null, now: Date): string | null {
  if (!published) return null;
  const t = new Date(published).getTime();
  if (Number.isNaN(t)) return null;
  const secs = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

export function NewsRow({
  item,
  now,
}: {
  item: NewsItem;
  /** Passed in rather than read from Date.now() here: a relative age computed
   *  during render differs between server and client and hydrate-mismatches. */
  now: Date;
}) {
  const tone = toneOf(item.sentiment);
  const synthetic = isSynthetic(item.source);
  const age = ageLabel(item.published_date, now);

  const headline = item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-primary hover:text-accent underline decoration-border-strong hover:decoration-accent underline-offset-2"
    >
      {item.headline}
      <span className="sr-only"> (opens source in a new tab)</span>
    </a>
  ) : (
    <span className="text-text-primary">{item.headline}</span>
  );

  return (
    <li className="border-b border-border last:border-b-0 py-2.5">
      {/* Cluster + age, above the headline — their ordering, and it is right:
          the reader wants to know WHICH STORY this belongs to before reading it. */}
      <div className="flex items-baseline gap-2 flex-wrap mb-1 text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <span className="font-semibold">{item.theme_name ?? "Unassigned"}</span>
        {age && (
          <>
            <span aria-hidden="true">·</span>
            <time
              dateTime={new Date(item.published_date as string).toISOString()}
            >
              {age}
            </time>
          </>
        )}
      </div>

      <p className="m-0 text-[13px] leading-[1.5]">{headline}</p>

      <div className="flex items-baseline gap-2 flex-wrap mt-1 text-[11px] text-text-tertiary">
        <span className="num">{item.source}</span>
        {tone && (
          <>
            <span aria-hidden="true">·</span>
            <span>{TONE_LABEL[tone]}</span>
          </>
        )}
        {!item.url && (
          <>
            <span aria-hidden="true">·</span>
            {/* Absence stated, never a dead anchor (goal 2). */}
            <span>{synthetic ? "no source" : "link not stored"}</span>
          </>
        )}
        {synthetic && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-warning font-semibold">synthetic</span>
          </>
        )}
      </div>
    </li>
  );
}
