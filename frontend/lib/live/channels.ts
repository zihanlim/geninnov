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

/** In the order a markets reader would reach for them: finance first, then general, then regional. */
export const CHANNELS: Channel[] = [
  { key: "bloomberg", label: "Bloomberg TV", channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    angle: "Markets and macro, closest to the book's own subject" },
  { key: "cnbc", label: "CNBC", channelId: "UCvJJ_dzjViJCoLf5uKUTwoA",
    angle: "US equities and the session tape" },
  { key: "skynews", label: "Sky News", channelId: "UCoMdktPbSTixAyNGwb-UYkQ",
    angle: "UK and breaking international" },
  { key: "dw", label: "DW News", channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    angle: "Europe, from a German desk" },
  { key: "euronews", label: "Euronews", channelId: "UCSrZ3UV4jOidv8ppoVuvW9Q",
    angle: "EU policy and the continent" },
  { key: "france24", label: "France 24", channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg",
    angle: "Africa and the Francophone world" },
  { key: "cnn", label: "CNN", channelId: "UCupvZG-5ko_eiXAupbDfxWw",
    angle: "US politics and breaking domestic" },
  { key: "aljazeera", label: "Al Jazeera", channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    angle: "Middle East — the sleeve S6's chokepoint scenario turns on" },
  { key: "alarabiya", label: "Al Arabiya", channelId: "UCIZJ9a6P_nxCFJTmL0gh_IQ",
    angle: "Gulf states and regional energy politics" },
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
 * one would ambush a reader. `playsinline=1` stops iOS taking over the whole screen.
 */
export function embedUrl(channel: Channel): string {
  const p = new URLSearchParams({
    channel: channel.channelId,
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
  });
  return `https://www.youtube-nocookie.com/embed/live_stream?${p.toString()}`;
}
