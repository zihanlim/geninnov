"use client";
import { useState } from "react";
import {
  CHANNELS,
  DEFAULT_CHANNEL,
  channelFor,
  embedUrl,
  type Channel,
} from "@/lib/live/channels";

// Live news TV (ADR-0104).
//
// This is the one panel on the site whose content CANNOT be traced. Everything else answers
// "where did this number come from"; a broadcast cannot be cited, verified, or reconciled
// against the book. That is stated in the panel rather than left for a reader to work out,
// because the alternative is a page where the traceability standard silently has an
// exception.
//
// Two consequences follow, and both are load-bearing rather than polish:
//
//   1. COLLAPSED BY DEFAULT, and the iframe is mounted only once opened. A reader who never
//      opens it makes no request to Google at all — no third-party frame, no cookie, no
//      referrer. The site has no other external embeds, so opting in is the whole privacy
//      story here.
//   2. The book's cadence is stated NEXT TO the stream. A live picture beside a once-daily
//      book is exactly the mismatch the "no real-time" non-goal was written about; saying so
//      in place is what makes it honest rather than merely permitted.

export default function LiveNews({ runDate }: { runDate?: string | null }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string>(DEFAULT_CHANNEL);
  const channel: Channel = channelFor(key);

  return (
    <section className="card mb-6" aria-labelledby="live-news-heading">
      <div className="card-header flex-wrap gap-2">
        <h2 id="live-news-heading" className="card-title m-0">
          Live news
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="live-news-body"
          className="text-[11px] uppercase tracking-[0.09em] text-text-secondary border border-border rounded px-2 py-1 hover:bg-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {open ? "Close" : "Open stream"}
        </button>
      </div>

      <div id="live-news-body">
        {!open ? (
          <p className="m-0 px-[18px] py-3 text-[12px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            {CHANNELS.length} broadcast channels. Nothing loads until you open it — the player
            is a third-party frame, so leaving it closed means no request to YouTube at all.
          </p>
        ) : (
          <>
            {/* The picker. Labelled buttons rather than logos: an unlabelled glyph rail is a
                standing non-goal, and the same objection applies to a row of station marks. */}
            <div
              role="tablist"
              aria-label="Broadcast channel"
              className="flex flex-wrap gap-1.5 px-[18px] py-2.5 border-b border-border"
            >
              {CHANNELS.map((c) => {
                const active = c.key === channel.key;
                return (
                  <button
                    key={c.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setKey(c.key)}
                    title={c.angle}
                    className={`text-[11.5px] px-2 py-1 rounded border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      active
                        ? "border-border-strong bg-bg-elevated text-text-primary font-semibold"
                        : "border-border text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* 16:9 without a fixed height, so the panel never becomes a viewport-locked
                shell (goal 7) and scales down to a phone. */}
            <div className="px-[18px] py-3">
              <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                <iframe
                  // `key` forces a fresh frame per channel: without it, switching channels
                  // only changes the src of a player that has already negotiated a stream,
                  // and it keeps showing the previous broadcast.
                  key={channel.key}
                  src={embedUrl(channel)}
                  title={`${channel.label} live stream`}
                  className="absolute inset-0 w-full h-full border border-border rounded"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                />
              </div>
              <p className="m-0 mt-2 text-[11.5px] text-text-secondary leading-[1.55]">
                <span className="num text-text-primary">{channel.label}</span> — {channel.angle}
              </p>
            </div>
          </>
        )}

        {/* Stated whether open or closed: the caveat is not a thing you should have to open
            the panel to discover. */}
        <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch] border-t border-border">
          These are third-party broadcasts, not a source this book is built on. Nothing here
          is fetched, scored, or citable: no figure on this site traces to a stream, and{" "}
          <span className="num">/ask</span> cannot quote one. If a channel is off air its
          player will say so — that is YouTube reporting, not us.{" "}
          {runDate ? (
            <>
              The book itself is published once daily after the US close and currently reflects{" "}
              <span className="num">{runDate}</span>, so a moving picture beside it does not
              mean a moving book.
            </>
          ) : (
            <>
              The book is published once daily after the US close, so a moving picture beside
              it does not mean a moving book.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
