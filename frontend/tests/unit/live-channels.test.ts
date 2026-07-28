// The channel catalogue, and the two ways it can be silently wrong.
//
// A mistyped channel ID does NOT error. It renders an empty player, which is
// indistinguishable from a channel that is off air, so it survives review and every manual
// pass until someone clicks that specific station. The first draft of this list had Al
// Arabiya as `UCrIsKS1WCsPGTOd4NlnXwXQ` — a 200 with a blank title, i.e. no such channel.
// Every ID here was resolved against youtube.com and matched to its real channel title
// before being committed.
//
// The second failure is the embed FORM. A channel's live video ID changes every broadcast,
// so an embed built from a video ID works when written and breaks within a day. The
// `live_stream?channel=` form is what makes the panel durable, and it is easy to "simplify"
// away.

import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  DEFAULT_CHANNEL,
  channelFor,
  embedUrl,
} from "@/lib/live/channels";

describe("the catalogue", () => {
  it("carries the fifteen verified channels", () => {
    // Nine -> eight -> fifteen on 2026-07-27: `skynews` and `alarabiya` removed for
    // being off air, then `cna` and seven more added, each probed LIVE first. See the
    // note above CHANNELS for what that evidence does and does not prove.
    expect(CHANNELS).toHaveLength(15);
  });

  it("uses well-formed YouTube channel IDs", () => {
    // UC + 22 base64url chars. A typo that changes the length is caught here; one that
    // preserves it is caught only by the verification done before committing.
    for (const c of CHANNELS) {
      expect(c.channelId, `${c.key} has a malformed id`).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
    }
  });

  it("has no duplicate ids or keys", () => {
    // A copy-paste that leaves two stations pointing at one stream renders plausibly.
    expect(new Set(CHANNELS.map((c) => c.channelId)).size).toBe(CHANNELS.length);
    expect(new Set(CHANNELS.map((c) => c.key)).size).toBe(CHANNELS.length);
  });

  it("does not contain the wrong Al Arabiya id that the first draft had", () => {
    // Pinned by value: this exact string returns a 200 with a blank title, so it looks
    // fine everywhere except on screen. Al Arabiya itself is gone (off air), but the
    // known-bad id stays pinned — a dead id is exactly the sort of thing that gets
    // pasted back in from an old diff.
    expect(CHANNELS.map((c) => c.channelId)).not.toContain("UCrIsKS1WCsPGTOd4NlnXwXQ");
  });

  it("pins every id added on 2026-07-27, by value", () => {
    // Each was resolved from its @handle, then reverse-checked by fetching
    // youtube.com/channel/<id> and confirming the title, then probed LIVE. A
    // mistyped id does not error - it renders a blank player - so the only defence
    // is pinning the exact string that was verified.
    const byKey = Object.fromEntries(CHANNELS.map((c) => [c.key, c.channelId]));
    expect(byKey.cna).toBe("UC83jt4dlz1Gjl58fzQrrKZg");
    expect(byKey.yahoofinance).toBe("UCEAZeUIeJs0IjQiqTCdVSIg");
    expect(byKey.nhk).toBe("UCSPEjw8F2nQDtmUKPFNF7_A");
    expect(byKey.abcau).toBe("UCVgO39Bk5sMo66-6o6Spn6Q");
    expect(byKey.abcnews).toBe("UCBi2mrWuNuyYy4gbM6fU18Q");
    expect(byKey.nbcnews).toBe("UCeY0bbntWzzVIaj2z3QigXg");
    expect(byKey.trtworld).toBe("UC7fWeaHhqgM4Ry-RMpM2YYw");
    expect(byKey.africanews).toBe("UC1_E8NeF5QHY2dtdLRBCCLA");
  });

  it("does not carry the candidates that failed their probe", () => {
    // Rejected on 2026-07-27 for not playing when asked: Schwab Network, CBS News,
    // LiveNOW from FOX, WION, CGTN, Global News, Firstpost, Associated Press. Pinned
    // so none is added later from a list of "obvious" outlets without a fresh probe.
    const ids = CHANNELS.map((c) => c.channelId);
    for (const rejected of [
      "UCqoSrYgusd8ZddtMoWhjHYA", // Schwab Network
      "UC8p1vwvWtl6T73JiExfWs1g", // CBS News
      "UCJg9wBPyKMNA5sRDnvzmkdg", // LiveNOW from FOX
      "UC_gUM8rL-Lrg6O3adPW9K1g", // WION
      "UCgrNz-aDmcr2uuto8_DL2jg", // CGTN
      "UChLtXXpo4Ge1ReTEboVvTDg", // Global News
      "UCz8QaiQxApLq8sLNcszYyJw", // Firstpost
      "UC52X5wxOL_s5yw0dQk7NtgA", // Associated Press
    ]) {
      expect(ids).not.toContain(rejected);
    }
  });

  it("does not carry the stations that were removed for being off air", () => {
    // `live_stream` renders "This video is unavailable" for a channel with no active
    // broadcast, which a reader cannot tell apart from a broken site. Both of these
    // had CORRECT ids and still failed, so the failure is off-air, not a typo — and
    // re-adding either needs a fresh probe, not an argument about reputation.
    const keys = CHANNELS.map((c) => c.key);
    expect(keys).not.toContain("skynews");
    expect(keys).not.toContain("alarabiya");
  });

  it("does not carry Reuters, which is not a 24/7 stream", () => {
    // Asked for on 2026-07-27 and rejected on evidence: both @Reuters and @ReutersNow
    // return "This video is unavailable". Pinned so the request does not get actioned
    // later without re-probing.
    const ids = CHANNELS.map((c) => c.channelId);
    expect(ids).not.toContain("UChqUTb7kYRX8-EiaN3XFrSQ");
    expect(ids).not.toContain("UC9M3cEqYCKDZ7BABf-LC6sw");
  });

  it("says what each channel is for, so the picker is not nine anonymous names", () => {
    for (const c of CHANNELS) {
      expect(c.angle.trim().length, `${c.key} has no stated angle`).toBeGreaterThan(15);
    }
  });

  it("defaults to the outlet closest to the book's subject", () => {
    expect(DEFAULT_CHANNEL).toBe("bloomberg");
    expect(channelFor(DEFAULT_CHANNEL).angle).toMatch(/[Mm]arkets/);
  });
});

describe("channelFor", () => {
  it("falls back to the default rather than rendering nothing", () => {
    expect(channelFor("no-such-channel").key).toBe(DEFAULT_CHANNEL);
    expect(channelFor(null).key).toBe(DEFAULT_CHANNEL);
    expect(channelFor(undefined).key).toBe(DEFAULT_CHANNEL);
  });
});

describe("embedUrl", () => {
  const url = embedUrl(channelFor("bloomberg"));

  it("uses the live_stream form, NOT a video id", () => {
    // The durability property. A video id works today and is dead tomorrow.
    expect(url).toContain("/embed/live_stream?");
    expect(url).toContain("channel=UCIALMKvObZNtJ6AmdCLP7Lg");
  });

  it("uses the privacy-enhanced host", () => {
    expect(url.startsWith("https://www.youtube-nocookie.com/")).toBe(true);
    expect(url).not.toContain("//www.youtube.com/");
  });

  it("autoplays muted, never with sound", () => {
    expect(url).toContain("autoplay=1");
    expect(url).toContain("mute=1");
  });

  it("enables the JS API, so sound can be asked for from OUR chrome", () => {
    // Without this the only way to unmute is a click inside a third-party
    // cross-origin iframe — a gesture we can neither observe nor guarantee, and the
    // one a reader reported making with no effect. Dropping the param does not break
    // the picture, it silently breaks the Unmute button, which is exactly the kind of
    // regression that survives a screenshot.
    expect(url).toContain("enablejsapi=1");
  });

  it("plays inline so iOS does not seize the whole screen", () => {
    expect(url).toContain("playsinline=1");
  });

  it("builds a distinct url per channel", () => {
    const urls = CHANNELS.map((c) => embedUrl(c));
    expect(new Set(urls).size).toBe(CHANNELS.length);
  });
});

describe("the traceability caveat is not optional", () => {
  it("the component states the stream is uncitable, whether open or closed", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.resolve(__dirname, "../../components/live/LiveNews.tsx"),
      "utf8",
    );
    // This is the one panel whose content cannot be traced. If that sentence is ever
    // removed, the site has a silent exception to the standard everything else meets.
    expect(src).toContain("not a source this book is built on");
    expect(src).toContain("cannot quote one");
    // And the caveat sits outside the `open` branch, so closing the panel does not hide it.
    const openBranch = src.indexOf("{!open ?");
    const caveat = src.indexOf("not a source this book is built on");
    const closeBranch = src.lastIndexOf("</div>");
    expect(caveat).toBeGreaterThan(openBranch);
    expect(caveat).toBeLessThan(closeBranch);
  });
});
