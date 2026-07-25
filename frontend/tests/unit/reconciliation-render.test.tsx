// The Δ still reaches the page.
//
// /method's whole purpose is proving the arithmetic reproduces the published
// number, and that proof is three values: Recomputed, Persisted, Δ. Sharing the
// presentation with /book was worth doing, but a shared component is exactly how
// such a proof gets quietly dropped — the page still renders, the section still
// looks complete, and the one claim that mattered is gone.
//
// So: the component is asserted to surface all three in both modes, the lineage
// step is asserted to carry it when given one, and the page is asserted to still
// render it twice (HypeScore and EdgeScore) with no hand-rolled Δ tile left behind.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { Reconciliation } from "@/components/Reconciliation";
import { StepNumbered } from "@/components/book/StepNumbered";
import {
  EDGE_TOLERANCE,
  HYPE_TOLERANCE,
  reconcile,
} from "@/lib/method/reconciliation";
import type { WorkedExampleStep } from "@/lib/book/workedExample";

const strip = (html: string) => html.replace(/<!-- -->/g, "");

const HYPE_LABELS = {
  recomputed: "Recomputed from sub-scores",
  recomputedSub: "100 × Σ of the four weighted terms above",
  persisted: "Persisted themes.hype_score",
  persistedSub: "what the rest of the product reads",
};

describe("Reconciliation — tile mode (/method)", () => {
  const render = (r: number | null, p: number | null) =>
    strip(
      renderToString(
        <Reconciliation
          verdict={reconcile(r, p, HYPE_TOLERANCE)}
          labels={HYPE_LABELS}
          format={{ decimals: 2, signed: false }}
        />,
      ),
    );

  it("surfaces all three values and both captions", () => {
    const html = render(60.14, 60.1);
    expect(html).toContain("60.14"); // recomputed
    expect(html).toContain("60.10"); // persisted
    expect(html).toContain("0.04"); // delta
    expect(html).toContain("Recomputed from sub-scores");
    expect(html).toContain("Persisted themes.hype_score");
    expect(html).toContain("100 × Σ of the four weighted terms above");
    expect(html).toContain("what the rest of the product reads");
  });

  it("says it reconciles, in the long ink, when it does", () => {
    const html = render(60.12, 60.12);
    expect(html).toContain("reconciles exactly");
    expect(html).toContain("text-long");
  });

  it("says it does NOT reconcile, in the short ink, when it does not", () => {
    const html = render(60.9, 60.1);
    expect(html).toContain("does NOT reconcile");
    expect(html).toContain("text-short");
  });

  it("states absence rather than claiming a failure", () => {
    // A theme with no persisted score has not failed to reconcile — it has not
    // been scored. Reporting that as a failure accuses the pipeline (design goals §2).
    const html = render(60.12, null);
    expect(html).toContain("no persisted value to compare");
    expect(html).toContain("—");
    expect(html).not.toContain("does NOT reconcile");
    expect(html).not.toContain("text-short");
  });

  it("renders EdgeScore signed at four decimals", () => {
    // The sign IS the trade direction, so it must never be dropped.
    const html = strip(
      renderToString(
        <Reconciliation
          verdict={reconcile(-0.2785, -0.2781, EDGE_TOLERANCE)}
          labels={{ recomputed: "EdgeScore recomputed", persisted: "Persisted edge_score" }}
          format={{ decimals: 4, signed: true }}
        />,
      ),
    );
    expect(html).toContain("-0.2785");
    expect(html).toContain("-0.2781");
    expect(html).toContain("reconciles exactly"); // |0.0004| < 0.005
  });
});

describe("Reconciliation — compact mode (/book lineage step)", () => {
  it("surfaces the same three values", () => {
    const html = strip(
      renderToString(
        <Reconciliation
          verdict={reconcile(60.14, 60.1, HYPE_TOLERANCE)}
          labels={HYPE_LABELS}
          format={{ decimals: 2, signed: false }}
          compact
        />,
      ),
    );
    expect(html).toContain("60.14");
    expect(html).toContain("60.10");
    expect(html).toContain("0.04");
    expect(html).toContain("reconciles exactly");
  });
});

describe("StepNumbered carries a reconciliation", () => {
  const base: WorkedExampleStep = {
    number: 3,
    title: "Position sizing",
    prose: "Conviction over volatility, normalised across the book.",
    formula: "conviction = 0.2785 / 0.0145 = 19.21",
    sourceColumn: "portfolio_positions.conviction",
    sourcePersisted: true,
  };

  it("renders one when given one", () => {
    const html = strip(
      renderToString(
        <StepNumbered
          step={{
            ...base,
            reconciliation: {
              verdict: reconcile(19.21, 19.21, EDGE_TOLERANCE),
              labels: { recomputed: "Recomputed", persisted: "Persisted" },
              format: { decimals: 2, signed: false },
            },
          }}
        />,
      ),
    );
    expect(html).toContain('data-testid="reconciliation"');
    expect(html).toContain("19.21");
    expect(html).toContain("reconciles exactly");
  });

  it("omits it when the step has nothing to reconcile", () => {
    // A step that merely reports a stored figure must not display an empty proof.
    const html = strip(renderToString(<StepNumbered step={base} />));
    expect(html).not.toContain('data-testid="reconciliation"');
  });

  it("preserves newlines in a multi-line derivation", () => {
    // A derivation is often a column of aligned terms, a Σ rule, then the result.
    // Rendered in a plain div every newline collapses and the arithmetic arrives
    // as one unreadable run — which is what would have happened to /method's
    // Formula blocks had they been moved into this primitive as-was.
    const html = strip(
      renderToString(
        <StepNumbered step={{ ...base, formula: "a = 1\nb = 2\n───\nΣ = 3" }} />,
      ),
    );
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("Σ = 3");
  });
});

describe("/method still proves its arithmetic", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../app/method/page.tsx"),
    "utf8",
  );

  it("renders a reconciliation for BOTH worked examples", () => {
    // HypeScore and EdgeScore. If a refactor drops one, the page keeps its
    // Formula block and loses the proof that the formula matches the database.
    const uses = src.match(/<Reconciliation\b/g) ?? [];
    expect(uses).toHaveLength(2);
  });

  it("left no hand-rolled delta tile behind", () => {
    // Two renderings of one claim can disagree about it, which is why they were
    // merged. A `<Stat label="Δ"` here means one came back.
    expect(src).not.toMatch(/<Stat\s+label="Δ"/);
    expect(src).not.toMatch(/label="Δ"/);
  });

  it("tests the tolerance through the shared constants, not literals", () => {
    expect(src).toContain("HYPE_TOLERANCE");
    expect(src).toContain("EDGE_TOLERANCE");
    // A bare threshold in a conditional is how the tile and its failure note
    // came to test different numbers.
    expect(src).not.toMatch(/Math\.abs\([a-zA-Z.]+\)\s*[<>]=?\s*0\.0*5\b/);
  });
});
