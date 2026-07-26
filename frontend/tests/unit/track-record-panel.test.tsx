// The /book track-record panel (ADR-0090, surfaced at the claim rather than on /method).
//
// This repo's vitest runs in `node` with `renderToString`, so a useEffect-loaded panel
// cannot be driven to its loaded state here. What is pinned instead is the thing that
// could actually be wrong — what the panel is ALLOWED TO CLAIM in each state — plus a
// smoke test that it mounts.
//
// Every case builds its TrackRecord with the real `buildTrackRecord`, not a hand-written
// object, so a change to the read model that would alter the claim fails here too.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import TrackRecordPanel, { panelClaim } from "@/components/book/TrackRecordPanel";
import {
  THIN_RECORD_THRESHOLD,
  buildTrackRecord,
  type PickOutcomeRow,
} from "@/lib/method/trackRecord";

const HORIZON = 21;

function row(over: Partial<PickOutcomeRow> = {}): PickOutcomeRow {
  return {
    run_date: "2026-07-25",
    asset: "XLE",
    direction: "long",
    horizon_days: HORIZON,
    verdict: "pending",
    expected_exit_date: "2026-08-20",
    ...over,
  };
}

const claimFor = (rows: PickOutcomeRow[]) =>
  panelClaim(buildTrackRecord(rows, HORIZON));

describe("panelClaim — nothing resolved yet", () => {
  // The live state on 2026-07-27: 23 claims across 4 books, every one pending, first
  // maturing 2026-08-20. This is the state the panel shipped in, so it is the state most
  // worth pinning.
  const pending = Array.from({ length: 23 }, (_, i) =>
    row({ run_date: `2026-07-2${2 + (i % 4)}` })
  );

  it("never renders a rate as the headline when nothing has matured", () => {
    // The whole failure this guards: a reader scanning the positions sees a big number.
    // If that number can be a percentage while the denominator is zero, the panel is
    // asserting a performance claim it has no evidence for.
    const claim = claimFor(pending);
    expect(claim.headline).not.toContain("%");
    expect(claim.headline).toBe("23");
  });

  it("never renders zero as a stand-in for an unanswerable rate", () => {
    const claim = claimFor(pending);
    expect(claim.headline).not.toBe("0%");
    expect(claim.headline).not.toBe("0");
    // And it says so in words, because a reader who sees no rate should learn why.
    expect(claim.note).toContain("not the same as a hit rate of zero");
  });

  it("names the date the first verdict lands, so the claim is falsifiable on a date", () => {
    expect(claimFor(pending).note).toContain("2026-08-20");
  });

  it("counts distinct books, not picks, when it says how many books are live", () => {
    // 23 picks spread across 4 run_dates.
    expect(claimFor(pending).label).toContain("4 books");
  });

  it("does not invent a maturity date when no pending row carries one", () => {
    const undated = [row({ expected_exit_date: null })];
    const claim = claimFor(undated);
    expect(claim.note).toContain("No pending pick carries an expected resolution date");
    expect(claim.note).not.toContain("null");
    expect(claim.note).not.toContain("undefined");
  });
});

describe("panelClaim — resolved but too thin to read", () => {
  const thin = [
    row({ verdict: "hit", signed_return: 0.04 }),
    row({ verdict: "hit", signed_return: 0.02 }),
    row({ verdict: "miss", signed_return: -0.01 }),
    row({ verdict: "pending" }),
  ];

  it("keeps the headline a count, so a thin rate is never the scanned number", () => {
    // Stricter than /method deliberately — see the panelClaim docstring. Three resolved
    // picks reading "67%" beside the positions is ADR-0059's failure mode.
    const claim = claimFor(thin);
    expect(claim.headline).toBe("2/3");
    expect(claim.headline).not.toContain("%");
  });

  it("still discloses the rate, with its denominator and a refusal to be read as one", () => {
    const claim = claimFor(thin);
    expect(claim.note).toContain("67%");
    expect(claim.note).toContain("3 resolved");
    expect(claim.note).toContain(String(THIN_RECORD_THRESHOLD));
    expect(claim.note).toContain("not a track record");
  });

  it("reports live picks alongside, so the record is not read as complete", () => {
    expect(claimFor(thin).label).toContain("1 still live");
  });
});

describe("panelClaim — a record thick enough to carry a rate", () => {
  const thick = [
    ...Array.from({ length: 15 }, () => row({ verdict: "hit", signed_return: 0.03 })),
    ...Array.from({ length: 10 }, () => row({ verdict: "miss", signed_return: -0.02 })),
  ];

  it("promotes the rate to the headline only at the threshold", () => {
    const claim = claimFor(thick);
    expect(claim.headline).toBe("60%");
    expect(claim.label).toContain("25 resolved");
  });

  it("reports mean signed return direction-adjusted, not raw", () => {
    expect(claimFor(thick).note).toContain("direction-adjusted");
  });

  it("crosses from count to rate exactly at THIN_RECORD_THRESHOLD, not near it", () => {
    // An off-by-one here silently changes which claim the panel makes.
    const at = Array.from({ length: THIN_RECORD_THRESHOLD }, () =>
      row({ verdict: "hit", signed_return: 0.01 })
    );
    const below = at.slice(0, THIN_RECORD_THRESHOLD - 1);
    expect(claimFor(at).headline).toBe("100%");
    expect(claimFor(below).headline).toBe(`${THIN_RECORD_THRESHOLD - 1}/${THIN_RECORD_THRESHOLD - 1}`);
  });
});

describe("TrackRecordPanel", () => {
  it("mounts without throwing, and renders nothing before its rows arrive", () => {
    // renderToString does not run effects, so this is the rows === null path. It must be
    // empty rather than a card promising a record it has not fetched.
    expect(renderToString(<TrackRecordPanel />)).toBe("");
  });
});
