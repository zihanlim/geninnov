// Row-level lens provenance: which ROWS of the risk-limit board are the
// multi-asset published book's, and does the board say so where the reader is
// looking.
//
// The panel-level chip (lens-scope-components.test.tsx) can only get as far as
// "part multi-asset". That sentence is true and it is not actionable: the board
// has eleven rows under one heading with one OK/BREACH column, and a reader told
// that five of them are another book's still cannot tell WHICH five. They could
// work it out from the `table.column` line already printed under each row — but
// only by knowing that `portfolio_risk` has no lens column and `book_metrics` is
// a JSONB field of one that does, which is a schema fact (migration 062,
// ADR-0194) that appears nowhere on screen.
//
// So the assertions that matter here are:
//   * `sourceProvenance` agrees with the schema for every source the LIVE board
//     builds — checked against `buildLimitBoard`'s own output, not a hand-copied
//     list, because a hand-copied list is the thing that goes stale;
//   * no live row is `unclassified` — the fail-loud default is a backstop and
//     must not be the state anything actually ships in;
//   * the default lens renders BYTE-FOR-BYTE as it did before row tagging, which
//     is the invariant the whole lens-disclosure surface is built on: /mandate
//     with no `?lens=` is the page a live submission is shown from.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskLimitBoard } from "@/components/risk/RiskLimitBoard";
import { buildLimitBoard, type LimitBoardInputs } from "@/lib/risk/riskBoard";
import {
  LENS_FOLLOWING_FIELDS,
  LENS_LESS_TABLES,
  showSourceScopeNote,
  sourceProvenance,
} from "@/lib/risk/lensScope";

/**
 * A run with every input present, so all eleven rows carry a value and none is
 * dropped to "unknown" for a reason unrelated to what this file is testing.
 * `returnSessions` is above every MIN_SESSIONS floor for the same reason.
 */
const INPUTS: LimitBoardInputs = {
  config: new Map<string, string>(),
  totalCapital: 100_000_000,
  var95Usd: -1_700_000,
  cvar95Usd: -2_400_000,
  beta: -0.18,
  hhi: 1_420,
  grossExposure: 0.98,
  netExposure: -0.12,
  maxDrawdown: -0.031,
  singleNameWeight: 0.159,
  sectorWeight: 0.221,
  geoWeight: 0.183,
  returnSessions: 120,
  realisedTurnover: 0.09,
};

/** The lens-less half, by the source string each row prints under itself. */
const PUBLISHED_SOURCES = [
  "portfolio_risk.var_95 / total_capital",
  "portfolio_risk.cvar_95 / total_capital",
  "portfolio_returns.cumulative_return",
  "portfolio_risk.beta",
];

/** The lens-following half — JSONB fields of `research_recommendations`. */
const BOOK_SOURCES = [
  "book_metrics.net_exposure",
  "book_metrics.gross_exposure",
  "cap_utilisation.single_name",
  "cap_utilisation.sector",
  "cap_utilisation.geo",
  "optimizer_result.realised_turnover",
];

const rowsFor = (extra: Partial<LimitBoardInputs> = {}) =>
  buildLimitBoard({ ...INPUTS, ...extra });

/** Every source string, in whatever order the board sorted the rows into. */
const sourcesOf = (extra: Partial<LimitBoardInputs> = {}) =>
  rowsFor(extra).map((r) => r.source);

/**
 * The sources that actually got a tag in the rendered markup, read back out of
 * the DOM rather than predicted. `<span class="num">SOURCE</span>` immediately
 * followed by the tag is the only place the two are adjacent — the row's
 * `value` span is also `.num` and is never followed by one — so this captures
 * exactly the rows a reader sees marked.
 */
function taggedSources(html: string): string[] {
  // `exec` in a loop rather than `[...matchAll()]`: the repo's tsconfig targets
  // below ES2015, so spreading a RegExpStringIterator is a compile error that
  // vitest does not see (esbuild strips types, it does not check them).
  const re =
    /<span class="num">([^<]*)<\/span><span role="note" data-testid="limit-row-scope-tag"/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) found.push(m[1]);
  return found;
}

describe("sourceProvenance", () => {
  it("reads a lens-less table through a compound source string", () => {
    // The VaR row is a RATIO over two columns of one table. Matching on the text
    // before the first "." happens to work here and would break the first time a
    // row cites a denominator from somewhere else, so the classifier tokenises.
    expect(sourceProvenance("portfolio_risk.var_95 / total_capital")).toBe("published");
  });

  it("classifies a research_recommendations payload field as the active book's", () => {
    // `book_metrics` LOOKS like a table and is a JSONB column. That resemblance
    // is the entire reason a reader cannot do this classification themselves.
    expect(sourceProvenance("book_metrics.gross_exposure")).toBe("book");
    expect(sourceProvenance("cap_utilisation.single_name")).toBe("book");
  });

  it("marks a source naming BOTH — published wins the tie", () => {
    // A row that is itself part multi-asset gets marked. The alternative asks a
    // reader to hold "some of this one row is the other book" unmarked, which is
    // the thing the tag exists to stop.
    expect(sourceProvenance("book_metrics.x / portfolio_risk.total_capital")).toBe(
      "published",
    );
  });

  it("returns 'unclassified' for a source nobody has classified, not 'book'", () => {
    // Fail loud, the same asymmetry `scopeOf` runs on: default to "book" and a
    // new lens-less row ships unmarked under a credit heading.
    expect(sourceProvenance("some_new_table.some_column")).toBe("unclassified");
  });

  it("does not confuse a lens-neutral table with a lens-less one", () => {
    // factor_exposures has no lens column and needs none — one FF5 beta per
    // asset per run, the same under every lens. Tagging it would tell a reader
    // to discount a figure that is genuinely theirs.
    expect(sourceProvenance("factor_exposures.beta_mkt")).toBe("book");
  });

  it("keeps the two vocabularies disjoint", () => {
    // A name in both lists would make the tie-break above decide provenance by
    // list order, which is not a decision anybody made.
    const overlap = LENS_FOLLOWING_FIELDS.filter((f) => LENS_LESS_TABLES.includes(f));
    expect(overlap, `named in both vocabularies: ${overlap.join(", ")}`).toEqual([]);
  });
});

describe("the live board's rows are all classified", () => {
  it("has no unclassified source", () => {
    // The backstop must not be the shipping state. If this fails, a row was
    // added citing a table neither vocabulary knows — add it to the right list
    // in lib/risk/lensScope.ts rather than relaxing this test.
    const unclassified = sourcesOf().filter(
      (s) => sourceProvenance(s) === "unclassified",
    );
    expect(unclassified, `unclassified sources: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("splits exactly as lensScope's PANEL_SCOPE claims: five published, six book", () => {
    // PANEL_SCOPE calls RiskLimitBoard "mixed" and the comment beside it says
    // "five of its eleven rows". That arithmetic is load-bearing — it is quoted
    // in the chip's rationale and in ADR-0194's disclosure — so it is measured
    // here rather than trusted. The fifth published row is HHI on a run that
    // predates ADR-0208's lens-following field.
    const legacy = sourcesOf({ hhiSource: "portfolio_risk" });
    expect(legacy).toHaveLength(11);
    expect(legacy.filter((s) => sourceProvenance(s) === "published")).toHaveLength(5);
    expect(legacy.filter((s) => sourceProvenance(s) === "book")).toHaveLength(6);
  });

  it("moves HHI to the book side when the run wrote the ADR-0208 field", () => {
    const modern = sourcesOf({ hhiSource: "book_metrics" });
    expect(modern.filter((s) => sourceProvenance(s) === "published")).toHaveLength(4);
    expect(sourceProvenance("book_metrics.concentration_hhi")).toBe("book");
    expect(sourceProvenance("portfolio_risk.concentration_hhi")).toBe("published");
  });

  it("agrees with the hand-written split above, both ways", () => {
    const live = sourcesOf({ hhiSource: "book_metrics" });
    for (const s of PUBLISHED_SOURCES) {
      expect(live, `board no longer builds "${s}"`).toContain(s);
      expect(sourceProvenance(s), s).toBe("published");
    }
    for (const s of BOOK_SOURCES) {
      expect(live, `board no longer builds "${s}"`).toContain(s);
      expect(sourceProvenance(s), s).toBe("book");
    }
  });
});

describe("the default lens is untouched", () => {
  it("showSourceScopeNote is false for EVERY source the board builds", () => {
    // The whole set, not a spot check: /mandate with no ?lens= is the page a
    // live submission is shown from.
    for (const s of sourcesOf()) {
      expect(showSourceScopeNote("multi_asset", s), s).toBe(false);
    }
    // Including one nobody classified — the fail-loud default must not leak a
    // tag onto the default page either.
    expect(showSourceScopeNote("multi_asset", "some_new_table.col")).toBe(false);
  });

  it("renders byte-for-byte the same with the lens omitted and set to the default", () => {
    const rows = rowsFor();
    const omitted = renderToStaticMarkup(
      <RiskLimitBoard loading={false} rows={rows} />,
    );
    const explicit = renderToStaticMarkup(
      <RiskLimitBoard loading={false} rows={rows} lens="multi_asset" />,
    );
    expect(omitted).toBe(explicit);
    expect(omitted).not.toContain("limit-row-scope-tag");
    expect(omitted).not.toContain("multi-asset");
  });
});

describe("the board under a non-default lens", () => {
  const rows = rowsFor({ hhiSource: "book_metrics" });
  const html = renderToStaticMarkup(
    <RiskLimitBoard loading={false} rows={rows} lens="credit" />,
  );

  it("tags exactly the lens-less rows and no others", () => {
    expect(taggedSources(html).sort()).toEqual([...PUBLISHED_SOURCES].sort());
  });

  it("leaves every lens-following row unmarked", () => {
    // The failure this catches is over-disclosure, which is not harmless here: a
    // tag on "Gross exposure" invites a reader to discard the one figure on the
    // page that IS the credit book's answer to their question.
    for (const s of BOOK_SOURCES) {
      expect(html, `"${s}" should not carry a tag`).toContain(s);
      expect(taggedSources(html), s).not.toContain(s);
    }
  });

  it("puts the claim in VISIBLE text, not only in a title", () => {
    // A `title` is invisible on touch and to anyone who does not hover — the
    // reason the panel chip carries its own distinction as text (ADR-0162's
    // shape: an encoding may not also mean "you cannot read this").
    const stripped = html.replace(/title="[^"]*"/g, "");
    expect(stripped).toContain("· multi-asset");
  });

  it("still explains itself on hover, naming the source and the ADR", () => {
    expect(html).toContain("ADR-0194");
    expect(html).toContain("Credit Lens");
  });

  it("states the split as a count, before the reader meets the first tag", () => {
    // A per-row tag with no total leaves a reader unable to tell a board they
    // have finished checking from one they have only partly read.
    const intro = html.indexOf("4 of these 11 rows");
    const firstTag = html.indexOf("limit-row-scope-tag");
    expect(intro, "board does not state the split").toBeGreaterThan(-1);
    expect(firstTag).toBeGreaterThan(intro);
    expect(html).toContain("The other 7 are the Credit Lens book");
  });

  it("says the LIMIT still governs — only the measurement is another book's", () => {
    // Without this the tag reads as "this row does not apply to you", and a
    // reader discounts a governing risk limit rather than the book it was
    // measured on.
    expect(html).toContain("Every LIMIT applies to both");
  });

  it("is a note, not an alert, and borrows no direction colour", () => {
    // Nothing here is broken (design goal 3 fences --warning for the day
    // something is, and --long/--short for direction).
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    const tag = html.slice(html.indexOf("limit-row-scope-tag"));
    const firstTagEnd = tag.slice(0, tag.indexOf(">"));
    expect(firstTagEnd).not.toMatch(/text-(warning|long|short|accent)/);
  });

  it("tags under every non-default lens, not just credit", () => {
    for (const lens of ["rates", "equity", "fx", "commodity"]) {
      const out = renderToStaticMarkup(
        <RiskLimitBoard loading={false} rows={rows} lens={lens} />,
      );
      expect(taggedSources(out).sort(), lens).toEqual([...PUBLISHED_SOURCES].sort());
    }
  });

  it("marks an unclassified row too, and says it is unclassified", () => {
    const withUnknown = rows.map((r) =>
      r.key === "turnover" ? { ...r, source: "some_new_table.some_column" } : r,
    );
    const out = renderToStaticMarkup(
      <RiskLimitBoard loading={false} rows={withUnknown} lens="credit" />,
    );
    expect(taggedSources(out)).toContain("some_new_table.some_column");
    expect(out).toContain("not classified");
  });
});
