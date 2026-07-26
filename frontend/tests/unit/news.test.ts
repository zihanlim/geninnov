// frontend/tests/unit/news.test.ts
import { describe, expect, it } from "vitest";
import { toneOf, isSynthetic, topForRibbon, type NewsItem } from "@/lib/news";

function item(over: Partial<NewsItem> = {}): NewsItem {
  return {
    theme_id: "t1",
    theme_name: "Inflation",
    headline: "CPI comes in hot",
    url: "https://example.org/a",
    source: "brave",
    published_date: "2026-07-27",
    run_date: "2026-07-27",
    sentiment: 0.2,
    ...over,
  };
}

describe("toneOf", () => {
  it("uses VADER's own ±0.05 neutral band", () => {
    expect(toneOf(0.05)).toBe("positive");
    expect(toneOf(-0.05)).toBe("negative");
    expect(toneOf(0.049)).toBe("neutral");
    expect(toneOf(-0.049)).toBe("neutral");
    expect(toneOf(0)).toBe("neutral");
  });

  it("returns null for an unmeasured headline — NOT neutral", () => {
    // Rows collected before 2026-07-27 carry no score. "We did not measure
    // this" and "this was measured and came out balanced" are different
    // claims, and collapsing them is exactly what ADR-0066 forbids.
    expect(toneOf(null)).toBeNull();
    expect(toneOf(undefined)).toBeNull();
  });

  it("refuses non-finite scores rather than rendering them", () => {
    expect(toneOf(Number.NaN)).toBeNull();
    expect(toneOf(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("handles the real range the pipeline produced on 2026-07-27", () => {
    expect(toneOf(0.686)).toBe("positive");
    expect(toneOf(-0.599)).toBe("negative");
    expect(toneOf(0.0258)).toBe("neutral");
  });
});

describe("isSynthetic", () => {
  it("flags the mock fallback so it can never pass as sourced", () => {
    expect(isSynthetic("mock_brave")).toBe(true);
    expect(isSynthetic("mock_reddit")).toBe(true);
    expect(isSynthetic("brave")).toBe(false);
    expect(isSynthetic("reddit")).toBe(false);
    expect(isSynthetic(null)).toBe(false);
  });
});

describe("topForRibbon", () => {
  it("caps at n", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      item({ headline: `story ${i}` }),
    );
    expect(topForRibbon(many, 10)).toHaveLength(10);
  });

  it("de-duplicates the same wire story scored into several themes", () => {
    // "Fed holds rates" legitimately scores into both Fed Policy and
    // Inflation. A ribbon that shows it twice looks broken, not thorough.
    const dupes = [
      item({ headline: "Fed holds rates", theme_name: "Fed Policy" }),
      item({ headline: "Fed holds rates", theme_name: "Inflation" }),
      item({ headline: "Oil rallies", theme_name: "Energy Prices" }),
    ];
    const out = topForRibbon(dupes, 10);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.headline)).toEqual(["Fed holds rates", "Oil rallies"]);
  });

  it("dedupes case- and whitespace-insensitively", () => {
    const dupes = [
      item({ headline: "Fed holds rates" }),
      item({ headline: "  FED HOLDS RATES  " }),
    ];
    expect(topForRibbon(dupes, 10)).toHaveLength(1);
  });

  it("keeps the first occurrence, so newest-first ordering survives", () => {
    const rows = [
      item({ headline: "A", theme_name: "First" }),
      item({ headline: "A", theme_name: "Second" }),
    ];
    expect(topForRibbon(rows, 10)[0].theme_name).toBe("First");
  });

  it("is a no-op on an empty feed", () => {
    expect(topForRibbon([], 10)).toEqual([]);
  });
});
