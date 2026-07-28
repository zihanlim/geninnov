// Live news channels for the /live panel.
//
// EVERY CHANNEL ID BELOW WAS VERIFIED against https://www.youtube.com/channel/<id> and
// matched to its real channel title before being written here. That is not ceremony: a
// mistyped ID does not error, it renders an empty player, and the first draft of this list
// had Al Arabiya as `UCrIsKS1WCsPGTOd4NlnXwXQ`, which returns a 200 with a blank title —
// a channel that does not exist. The correct one was resolved via the @AlArabiyaEnglish
// handle. A dead embed looks identical to an off-air channel, so it would have been
// invisible until someone clicked it.
//
// The embed uses the `live_stream?channel=<id>` form rather than a video ID, because a
// channel's current live video ID changes every broadcast; hardcoding one guarantees the
// panel breaks within a day.
//
// `youtube-nocookie.com` is deliberate — YouTube's privacy-enhanced host sets no tracking
// cookie until playback begins. Combined with mounting the iframe only after the reader
// opens the panel, a visitor who never opens it makes no request to Google at all.
//
// See ADR-0104 for why this exists at all, given it reverses a standing non-goal.

export interface Channel {
  key: string;
  label: string;
  /** Verified YouTube channel ID — see the note above before changing one. */
  channelId: string;
  /** What this outlet is useful for, so the picker is not nine anonymous logos. */
  angle: string;
}

/**
 * In the order a markets reader would reach for them: finance first, then general,
 * then regional.
 *
 * A CHANNEL EARNS ITS PLACE BY BEING ON AIR, not by being a good outlet. `live_stream`
 * renders "This video is unavailable" for a channel with no active broadcast, and that
 * is indistinguishable from a broken site — so a station that is not reliably 24/7 costs
 * a reader more than it gives them.
 *
 * 2026-07-27, at the owner's direction and confirmed by probing each embed inside an
 * iframe on our own origin:
 *   • REMOVED `skynews` and `alarabiya` — both returned "This video is unavailable" on
 *     repeated probes. Their IDs were correct (they resolve to "Sky News" and
 *     "Al Arabiya English"), so this is off-air, not the mistyped-ID trap below.
 *   • ADDED `cna` — probed LIVE (readyState 4, playing).
 *   • REJECTED Reuters. Asked for, and it fails the "always on air" bar: both
 *     `@Reuters` (UChqUTb7kYRX8-EiaN3XFrSQ) and `@ReutersNow`
 *     (UC9M3cEqYCKDZ7BABf-LC6sw) return "This video is unavailable". Reuters publishes
 *     clips rather than running a continuous stream. Recorded here so the next person
 *     to think of it does not have to re-derive it.
 *
 * 2026-07-27, second pass: SEVEN more added at the owner's direction after probing
 * fifteen major outlets and keeping only the ones that played — Yahoo Finance, NHK
 * WORLD-JAPAN, ABC News (Australia), ABC News (US), NBC News, TRT World and
 * africanews. Eight candidates were rejected the same way: Schwab Network, CBS News,
 * LiveNOW from FOX, WION, CGTN, Global News and Firstpost all returned "This video is
 * unavailable", and Associated Press loaded a frame that never started.
 *
 * THE HONEST LIMIT OF THAT EVIDENCE: every probe above ran at ~07:22 UTC on a Monday
 * — US pre-market, Asia evening. A station that runs SCHEDULED live blocks rather
 * than a continuous stream will read as off air at one hour and fine at another, so
 * the rejections are "not live when asked", not "never live", and the additions are
 * "live when asked", not proven 24/7. The list is a snapshot of what worked, and the
 * only way to keep it true is to re-probe.
 *
 * Liveness is a measurement at a moment, not a property. Re-probe before re-adding
 * anything, and do not add a station on reputation alone.
 *
 * Grouped by desk so fifteen buttons stay scannable: finance, then Asia-Pacific,
 * then US, then Europe, then Middle East and Africa.
 */
export const CHANNELS: Channel[] = [
  // ── Finance ───────────────────────────────────────────────────────────────
  { key: "bloomberg", label: "Bloomberg TV", channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    angle: "Markets and macro, closest to the book's own subject" },
  { key: "cnbc", label: "CNBC", channelId: "UCvJJ_dzjViJCoLf5uKUTwoA",
    angle: "US equities and the session tape" },
  { key: "yahoofinance", label: "Yahoo Finance", channelId: "UCEAZeUIeJs0IjQiqTCdVSIg",
    angle: "The US session end to end, tape and earnings" },
  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  { key: "cna", label: "CNA", channelId: "UC83jt4dlz1Gjl58fzQrrKZg",
    angle: "The Asia session and China policy, where the book's short sleeve sits" },
  { key: "nhk", label: "NHK World", channelId: "UCSPEjw8F2nQDtmUKPFNF7_A",
    angle: "Japan and the BoJ, where the yen and global duration are set" },
  { key: "abcau", label: "ABC Australia", channelId: "UCVgO39Bk5sMo66-6o6Spn6Q",
    angle: "The APAC open, commodities and the Australian dollar" },
  // ── United States ─────────────────────────────────────────────────────────
  { key: "cnn", label: "CNN", channelId: "UCupvZG-5ko_eiXAupbDfxWw",
    angle: "US politics and breaking domestic" },
  { key: "abcnews", label: "ABC News", channelId: "UCBi2mrWuNuyYy4gbM6fU18Q",
    angle: "A second US network read when one story is dominating" },
  { key: "nbcnews", label: "NBC News", channelId: "UCeY0bbntWzzVIaj2z3QigXg",
    angle: "US network rolling coverage, politics and macro headlines" },
  // ── Europe ────────────────────────────────────────────────────────────────
  { key: "dw", label: "DW News", channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    angle: "Europe, from a German desk" },
  { key: "euronews", label: "Euronews", channelId: "UCSrZ3UV4jOidv8ppoVuvW9Q",
    angle: "EU policy and the continent" },
  { key: "france24", label: "France 24", channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg",
    angle: "Africa and the Francophone world" },
  // ── Middle East and Africa ────────────────────────────────────────────────
  { key: "aljazeera", label: "Al Jazeera", channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    angle: "Middle East — the sleeve S6's chokepoint scenario turns on" },
  { key: "trtworld", label: "TRT World", channelId: "UC7fWeaHhqgM4Ry-RMpM2YYw",
    angle: "The Middle East from a non-Gulf desk, and Turkish policy" },
  { key: "africanews", label: "africanews", channelId: "UC1_E8NeF5QHY2dtdLRBCCLA",
    angle: "Africa, and the commodity supply that begins there" },
];

export const DEFAULT_CHANNEL = CHANNELS[0].key;

/** Look up a channel by key, falling back to the default rather than rendering nothing. */
export function channelFor(key: string | null | undefined): Channel {
  return CHANNELS.find((c) => c.key === key) ?? CHANNELS[0];
}

/**
 * The privacy-enhanced embed URL for a channel's CURRENT live stream.
 *
 * `autoplay=1&mute=1` because a muted autostart is what a TV panel is for, and an unmuted
 * one would ambush a reader. Every browser blocks UNMUTED autoplay outright, so this pair
 * is not a preference — it is the only combination that starts at all without a gesture.
 * `playsinline=1` stops iOS taking over the whole screen.
 *
 * `enablejsapi=1` exists so the panel's OWN chrome can drive the player. Sound needs a user
 * gesture, and the only gesture that would otherwise do it is a click INSIDE a third-party
 * cross-origin iframe — which is exactly the click a reader reported doing with no effect,
 * and which we can neither observe nor guarantee. With the JS API, an Unmute button in our
 * chrome posts `unMute`/`playVideo` to the frame, so the gesture happens somewhere we
 * control. It does not weaken the rule above: playback still STARTS muted, and sound is
 * still something the reader has to ask for.
 */
export function embedUrl(channel: Channel): string {
  const p = new URLSearchParams({
    channel: channel.channelId,
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    enablejsapi: "1",
  });
  return `https://www.youtube-nocookie.com/embed/live_stream?${p.toString()}`;
}

/** Origin to post JS-API commands to. Exported so the caller cannot guess it wrong. */
export const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
