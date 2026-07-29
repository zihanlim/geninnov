// The remaining-questions figure the composer shows, and the three ways it can be wrong.
//
// It was unrendered for the whole life of /ask: the route computed it, the Turn type
// carried it, nothing read it (ADR-0160). The failure modes worth pinning are not about
// arithmetic — they are about what the sentence CLAIMS when there is no reading.

import { describe, expect, it } from "vitest";
import { describeRemaining } from "@/lib/chat/quota";

describe("nothing is claimed before a question has been answered", () => {
  it("says nothing at all when no answer has arrived", () => {
    // The default cap is a deployment setting, not this visitor's balance. Announcing
    // "15 questions left" to someone who has already asked ten would be a fabrication.
    expect(describeRemaining(undefined, false)).toBeNull();
    expect(describeRemaining(15, false)).toBeNull();
  });
});

describe("an unreadable cap is an absence, not a zero", () => {
  it("renders an em-dash and its cause rather than an empty allowance", () => {
    // `checkRateLimit` returns {allowed:true} with no used/cap when the guard is
    // unconfigured. Rendering that as 0 would tell a deployment with NO limit that it
    // had run out — design goal 2.
    const s = describeRemaining(null, true)!;
    expect(s).toContain("—");
    expect(s).toContain("did not report a count");
    expect(s).not.toMatch(/\b0 questions\b/);
  });

  it("treats a missing field the same as an explicit null", () => {
    expect(describeRemaining(undefined, true)).toBe(describeRemaining(null, true));
  });
});

describe("a real count is stated as questions", () => {
  it("counts down in whole questions", () => {
    expect(describeRemaining(14, true)).toContain("14 questions left today");
  });

  it("does not say '1 questions'", () => {
    expect(describeRemaining(1, true)).toContain("1 question left today");
    expect(describeRemaining(1, true)).not.toContain("1 questions");
  });

  it("warns on the last question BEFORE the refusal rather than after", () => {
    const s = describeRemaining(0, true)!;
    expect(s).toContain("last question");
    // The reader is pointed at what still works without a quota.
    expect(s).toContain("/book");
  });

  it("never renders a negative allowance", () => {
    // The route already clamps with Math.max(0, …); this pins the copy if that changes.
    expect(describeRemaining(-3, true)).toContain("last question");
  });
});

describe("it is a count, never a spend meter", () => {
  it("quotes no percentage, currency or token figure in any branch", () => {
    // The comp that prompted this drew "Spend: 14%" on a bar. What `chat_usage` stores is
    // a question counter — a percentage would imply a cost gauge that does not exist.
    for (const r of [null, 0, 1, 14, 200]) {
      const s = describeRemaining(r as number | null, true) ?? "";
      expect(s, `remaining=${r}`).not.toMatch(/\d%|\$|token/i);
    }
  });
});
