// frontend/tests/unit/brave-freshness.test.ts
//
// The date window on the Brave news fetch, tested against the helper the
// pipeline actually runs (scripts/call_brave_mcp.js) rather than a copy of it.
//
// WHY THIS EXISTS. Until 2026-07-28 the helper sent the lookback as
// `from=<date>`. The Brave News API has no `from` parameter and silently
// ignores unknown ones, so every fetch since the script was written was an
// UNFILTERED relevance-ranked search - and relevance ranking loves evergreen
// explainer pages. The 2026-07-28 run persisted 386 headlines of which 43
// predated 2026, the oldest from 2001-11-16 ("Rising Junk Bond Yields", San
// Francisco Fed). The documented filter is `freshness`, whose range form is
// YYYY-MM-DDtoYYYY-MM-DD.
//
// The second contract here is about fabricated dates: the old mapper stamped
// any item whose page_age did not parse with TODAY. The frontend sorts the
// ribbon by published_date desc, so a page of UNKNOWN age was shown FIRST, as
// today's news. Unknown must stay null (the ADR-0066 rule: "we did not measure
// this" must not render as a measurement).
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildParams, mapResults } = require("../../../scripts/call_brave_mcp.js");

describe("buildParams", () => {
  it("sends the lookback as a freshness range, which Brave actually honours", () => {
    const params = buildParams("\"FOMC\"", "2026-06-28", "2026-07-28");
    expect(params.get("freshness")).toBe("2026-06-28to2026-07-28");
  });

  it("never sends `from` - the parameter Brave silently ignored for a year", () => {
    const params = buildParams("\"FOMC\"", "2026-06-28", "2026-07-28");
    expect(params.get("from")).toBeNull();
  });

  it("keeps the query and the 50-result page (ADR-0028)", () => {
    const params = buildParams("\"FOMC\"", "2026-06-28", "2026-07-28");
    expect(params.get("q")).toBe("\"FOMC\"");
    expect(params.get("count")).toBe("50");
  });

  it("omits freshness when no lookback is given", () => {
    const params = buildParams("\"FOMC\"", "", "2026-07-28");
    expect(params.get("freshness")).toBeNull();
  });
});

describe("mapResults", () => {
  it("uses page_age's ISO date so mentions can be bucketed by day", () => {
    const out = mapResults([
      { title: "CPI comes in hot", page_age: "2026-07-08T00:00:00", url: "https://x" },
    ]);
    expect(out).toEqual([
      { headline: "CPI comes in hot", date: "2026-07-08", url: "https://x" },
    ]);
  });

  it("returns null for an unparseable age - never a fabricated 'today'", () => {
    const out = mapResults([
      { title: "Undated evergreen", url: "https://x" },
      { title: "Relative age only", page_age: "2 weeks ago", url: "https://y" },
    ]);
    expect(out.map((r: { date: string | null }) => r.date)).toEqual([null, null]);
  });

  it("is a no-op on an empty or missing result set", () => {
    expect(mapResults([])).toEqual([]);
    expect(mapResults(undefined)).toEqual([]);
  });
});
