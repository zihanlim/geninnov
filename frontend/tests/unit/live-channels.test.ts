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
  it("carries the nine verified channels", () => {
    expect(CHANNELS).toHaveLength(9);
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
    // fine everywhere except on screen.
    expect(CHANNELS.map((c) => c.channelId)).not.toContain("UCrIsKS1WCsPGTOd4NlnXwXQ");
    expect(CHANNELS.find((c) => c.key === "alarabiya")!.channelId).toBe(
      "UCIZJ9a6P_nxCFJTmL0gh_IQ",
    );
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
