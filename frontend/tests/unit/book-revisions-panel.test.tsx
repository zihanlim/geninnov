// The corrections panel (ADR-0093).
//
// This repo's vitest runs in `node` with `renderToString`, so a useEffect-loaded table
// cannot be driven to its loaded state here. Rather than pretend otherwise, this pins the
// two things that could actually be wrong — the null-vs-zero rule and the trigger
// vocabulary — and smoke-tests that the component mounts.

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import BookRevisions, { TRIGGER_LABEL, revisionCell } from "@/components/method/BookRevisions";

describe("revisionCell", () => {
  it("renders an absent previous value as an em dash, never as zero", () => {
    // A null previous_value means the field did not exist before. Showing 0 would assert
    // the book held a value it never had, on the one surface whose job is to be trusted
    // about what changed (ADR-0066).
    expect(revisionCell(null)).toBe("—");
    expect(revisionCell(undefined)).toBe("—");
  });

  it("passes a real value through untouched, including a literal zero", () => {
    expect(revisionCell("0")).toBe("0");
    expect(revisionCell("5 scenarios")).toBe("5 scenarios");
    expect(revisionCell("0.593324")).toBe("0.593324");
  });
});

describe("TRIGGER_LABEL", () => {
  it("labels exactly the triggers migration 044's CHECK constraint permits", () => {
    // Hardcoded, not derived: a trigger the DB accepts but the UI cannot label would
    // render as a raw enum to a reader.
    expect(Object.keys(TRIGGER_LABEL).sort()).toEqual([
      "backfill",
      "manual_correction",
      "pipeline_rerun",
    ]);
  });

  it("reads as prose, not as an identifier", () => {
    for (const label of Object.values(TRIGGER_LABEL)) {
      expect(label).not.toMatch(/_/);
    }
  });
});

describe("BookRevisions", () => {
  it("mounts and states its purpose before any data arrives", () => {
    const html = renderToString(<BookRevisions />);
    expect(html).toContain("Has a published book been changed?");
    // The upsert-on-run_date mechanism is the whole reason the panel exists, so the copy
    // has to name it rather than leaving the reader to infer it.
    expect(html).toContain("run_date");
    expect(html).toContain("without a stated reason");
  });
});
