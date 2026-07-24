import { describe, it, expect } from "vitest";
import {
  positionStability,
  stabilityLabel,
  signedName,
  type ReplicationNames,
} from "@/lib/book/positionStability";

const repl: ReplicationNames = {
  stable: ["L:JPM", "L:NUE", "L:SVXY", "S:BABA", "S:NOC", "S:PDD", "S:SLV"],
  unstable: ["L:OIH", "L:UNH", "L:XLE", "S:ARKK"],
  endDate: "2026-07-25",
  samples: 3,
};

describe("per-position stability", () => {
  it("labels the live 2026-07-25 book exactly as the harness measured it", () => {
    // Seven held names were unanimous; XLE and UNH were not.
    expect(positionStability("long", "JPM", repl, "2026-07-25")).toBe("stable");
    expect(positionStability("short", "SLV", repl, "2026-07-25")).toBe("stable");
    expect(positionStability("long", "XLE", repl, "2026-07-25")).toBe("coinflip");
    expect(positionStability("long", "UNH", repl, "2026-07-25")).toBe("coinflip");
  });

  it("refuses to carry a replication forward to a different run", () => {
    // A replication is a statement about one pool on one day. Reusing it would
    // attach yesterday's variance to today's names.
    expect(positionStability("long", "JPM", repl, "2026-07-26")).toBe("unmeasured");
    expect(positionStability("long", "JPM", repl, null)).toBe("unmeasured");
  });

  it("says nothing when there is no replication at all", () => {
    expect(positionStability("long", "JPM", null, "2026-07-25")).toBe("unmeasured");
    expect(
      positionStability("long", "JPM", { ...repl, endDate: null }, "2026-07-25"),
    ).toBe("unmeasured");
  });

  it("cannot establish stability from a single sample", () => {
    // One sample agrees with itself trivially — that is not evidence.
    expect(
      positionStability("long", "JPM", { ...repl, samples: 1 }, "2026-07-25"),
    ).toBe("unmeasured");
  });

  it("treats a name the harness never saw as unmeasured, not stable", () => {
    // Absent from both lists means no information, and the safe reading is silence.
    expect(positionStability("long", "TLT", repl, "2026-07-25")).toBe("unmeasured");
  });

  it("keys on direction as well as ticker", () => {
    // L:XLE was a coin flip; a hypothetical S:XLE is a different bet entirely.
    expect(positionStability("short", "XLE", repl, "2026-07-25")).toBe("unmeasured");
    expect(signedName("short", "XLE")).toBe("S:XLE");
  });

  it("labels without attaching a verdict", () => {
    // A coin flip is not a bad trade — it is one of several the agent rates equally.
    expect(stabilityLabel("stable", 3)).toBe("in all 3 reruns");
    expect(stabilityLabel("coinflip", 3)).toBe("in some of 3 reruns");
    expect(stabilityLabel("unmeasured", 3)).toBeNull();
  });
});
