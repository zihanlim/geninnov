"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHANNELS,
  DEFAULT_CHANNEL,
  PLAYER_ORIGIN,
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

/**
 * `windowed` — rendered inside `LiveNewsWindow`, which supplies the card, the
 * title bar and the collapse control. Two consequences, both structural:
 *
 *   1. NO OWN CARD OR HEADER. Otherwise the floating window shows two title bars
 *      saying "Live news", one inside the other.
 *   2. NO INNER OPEN/CLOSE. That toggle exists to keep the iframe unmounted until
 *      a reader opts in (point 1 above). In the window that job belongs to the
 *      COLLAPSE state — the window renders this component only while expanded —
 *      so keeping a second gate here would mean opening the thing twice. The
 *      privacy property is unchanged; only its owner is.
 */
export default function LiveNews({
  runDate,
  windowed = false,
}: {
  runDate?: string | null;
  windowed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string>(DEFAULT_CHANNEL);
  const channel: Channel = channelFor(key);
  const showPlayer = windowed || open;

  // Sound is driven from OUR chrome rather than from inside the third-party frame.
  // The stream starts muted (browsers permit no other kind of autostart), and the
  // only other way to get sound is a click inside a cross-origin iframe — a click
  // we cannot observe, cannot guarantee, and which a reader reported doing with no
  // effect. `enablejsapi=1` lets a button here post the command instead.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [muted, setMuted] = useState(true);

  const command = useCallback((func: string) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: [] }),
      PLAYER_ORIGIN,
    );
  }, []);

  // Switching channels mounts a fresh frame (see the `key` on the iframe), and a
  // fresh frame is muted again — so the label must reset with it or it will offer
  // to "Mute" something already silent.
  useEffect(() => setMuted(true), [channel.key]);

  function toggleSound() {
    const next = !muted;
    command(next ? "mute" : "unMute");
    // Unmuting is also the natural "make it play" gesture: if the reader's browser
    // refused the muted autostart, this is the user activation that starts it.
    if (!next) command("playVideo");
    setMuted(next);
  }

  const Wrapper = windowed ? "div" : "section";

  return (
    <Wrapper
      className={windowed ? "" : "card mb-6"}
      aria-labelledby={windowed ? undefined : "live-news-heading"}
    >
      {!windowed && (
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
      )}

      <div id={windowed ? undefined : "live-news-body"}>
        {!showPlayer ? (
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
                  ref={frameRef}
                  src={embedUrl(channel)}
                  title={`${channel.label} live stream`}
                  className="absolute inset-0 w-full h-full border border-border rounded"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                />
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <p className="m-0 text-[11.5px] text-text-secondary leading-[1.55]">
                  <span className="num text-text-primary">{channel.label}</span> — {channel.angle}
                </p>
                {/* Stated, not implied. A silent picture reads as a broken player —
                    which is precisely how it was reported — so the panel says it is
                    muted and offers the one gesture that fixes it. */}
                <button
                  type="button"
                  onClick={toggleSound}
                  aria-pressed={!muted}
                  className="shrink-0 text-[11px] px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              </div>
              {muted && (
                <p className="m-0 mt-1.5 text-[11px] text-text-tertiary leading-[1.5]">
                  Playing muted — every browser blocks an unmuted autostart, so sound has
                  to be asked for.
                </p>
              )}
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
    </Wrapper>
  );
}
