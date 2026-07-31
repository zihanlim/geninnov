// The five risks from the live 2026-07-30 book, verbatim. They are the fixture
// because every trap this module has to avoid is present in them: a ticker the
// book does NOT hold (NVDA), a screened-but-not-held one (HYG), scenario ids
// that look like tickers (S1, S3, S6), and prose acronyms that look like
// tickers and are not (AI, FY, YoY, PBOC, EM, AND).

import { describe, expect, it } from "vitest";
import {
  parseRisk,
  parseRisks,
  riskKind,
  riskScenario,
  RISK_KIND_LABEL,
} from "@/lib/book/bookRisks";

const RISKS = [
  "AI capex concentration: SMH and GEV both express the AI Capex theme (hype 68.8). If NVDA's next earnings call guides FY forward revenue growth below 25% YoY, both legs hit simultaneously — measurable trigger on the next guide.",
  "Scenario S1 (VIX Spike >30) at -2.95% on the equal-weighted pool; book has higher long-side beta exposure via SMH (mkt 1.80) and GEV (mkt 1.61), likely worse than pool baseline; shorts provide only modest offset.",
  "Scenario S3 (Credit Widening +150bps) at -1.67% on pool; EMB long suffers as EM credit spreads widen — HYG asset-level stress response shows -10% under this scenario.",
  "China short concentration (BABA + PDD) and NOC defense short are correlated with geopolitical-resolution risk — if Hormuz de-escalates AND China announces PBOC stimulus simultaneously, three shorts rally together; geo cap at 35% will likely bind on China.",
  "Scenario S6 (Rate Shock +50bps) at -0.54% on pool; SMH and GEV high-multiple compression plus EMB duration risk; partial offset from GLD short (gold drops under rate shock per asset stress response).",
];

/** The published book. EMB is deliberately absent — the sizer zeroed it. */
const HELD = new Set(["BABA", "UNH", "GLD", "NOC", "SMH", "GEV", "PDD", "UNG", "F"]);
/** Held plus the rest of the L1 pool that reached the reasoning step. */
const KNOWN = new Set(
  Array.from(HELD).concat(["HYG", "EMB", "TSM", "VRT", "JNK", "ANGL", "BKLN"]),
);

const text = (r: ReturnType<typeof parseRisk>) => r.tokens.map((t) => t.text).join("");

describe("riskKind", () => {
  it("reads the kind off the model's own wording", () => {
    expect(RISKS.map(riskKind)).toEqual([
      "concentration",
      "scenario",
      "scenario",
      "concentration",
      "scenario",
    ]);
  });

  it("prefers concentration over correlation when a sentence is both", () => {
    // Risk 4 opens "China short concentration ..." and later says "are
    // correlated with". It is a concentration risk that explains itself through
    // correlation, and the opening clause is the subject.
    expect(riskKind(RISKS[3])).toBe("concentration");
    expect(/correlated/.test(RISKS[3])).toBe(true);
  });

  it("labels every kind", () => {
    for (const k of ["concentration", "scenario", "correlation", "other"] as const) {
      expect(RISK_KIND_LABEL[k]).toBeTruthy();
    }
  });
});

describe("riskScenario", () => {
  it("finds the cited scenario id, or null", () => {
    // Risk 1 is the AI-capex CONCENTRATION risk and cites no scenario.
    expect(RISKS.map(riskScenario)).toEqual([null, "S1", "S3", null, "S6"]);
  });
});

describe("parseRisk — what counts as a ticker", () => {
  it("marks held names as held", () => {
    const r = parseRisk(RISKS[0], HELD, KNOWN);
    expect(r.heldNamed).toEqual(["SMH", "GEV"]);
    expect(r.tokens.filter((t) => t.held).map((t) => t.ticker)).toEqual(["SMH", "GEV"]);
  });

  it("leaves a ticker the page knows nothing about as plain text", () => {
    // NVDA is real, named in risk 1, and in neither the book nor the pool.
    // Highlighting it would imply this page can say something about it.
    const r = parseRisk(RISKS[0], HELD, KNOWN);
    expect(r.tokens.some((t) => t.ticker === "NVDA")).toBe(false);
    expect(text(r)).toContain("NVDA");
  });

  it("marks a screened-but-not-held name as known and NOT held", () => {
    const r = parseRisk(RISKS[2], HELD, KNOWN);
    const hyg = r.tokens.find((t) => t.ticker === "HYG");
    const emb = r.tokens.find((t) => t.ticker === "EMB");
    expect(hyg).toMatchObject({ ticker: "HYG", held: false });
    // EMB is the position the sizer zeroed: in the pool, not in the book.
    expect(emb).toMatchObject({ ticker: "EMB", held: false });
    expect(r.heldNamed).toEqual([]);
  });

  it("does not mistake prose acronyms for tickers", () => {
    // AI, FY, YoY, EM, AND, PBOC all appear and none is a ticker here.
    const all = parseRisks(RISKS, HELD, KNOWN).flatMap((r) =>
      r.tokens.map((t) => t.ticker).filter(Boolean),
    );
    for (const notATicker of ["AI", "FY", "EM", "AND", "PBOC", "VIX"]) {
      expect(all, `${notATicker} was highlighted`).not.toContain(notATicker);
    }
  });

  it("does not mistake a scenario id for a ticker", () => {
    const all = parseRisks(RISKS, HELD, KNOWN).flatMap((r) =>
      r.tokens.map((t) => t.ticker).filter(Boolean),
    );
    expect(all).not.toContain("S");
    expect(all.every((t) => !/^S\d?$/.test(t as string))).toBe(true);
  });
});

describe("parseRisk — the text survives", () => {
  it("reassembles to the original sentence, exactly, for every risk", () => {
    // The whole module is a rendering aid. If it can drop or reorder a
    // character it is editing the model's own account of how the book breaks.
    for (const r of RISKS) {
      expect(text(parseRisk(r, HELD, KNOWN))).toBe(r);
    }
  });

  it("survives a risk with no tickers at all", () => {
    const r = parseRisk("Nothing here names a position.", HELD, KNOWN);
    expect(text(r)).toBe("Nothing here names a position.");
    expect(r.heldNamed).toEqual([]);
  });
});

describe("parseRisks", () => {
  it("keeps the model's order and drops nothing", () => {
    expect(parseRisks(RISKS, HELD, KNOWN)).toHaveLength(5);
  });

  it("returns an empty list rather than throwing on a null column", () => {
    expect(parseRisks(null, HELD, KNOWN)).toEqual([]);
    expect(parseRisks(undefined, HELD, KNOWN)).toEqual([]);
  });

  it("authors no figure — no parsed number appears outside the text", () => {
    // -2.95% is the EQUAL-WEIGHTED POOL's return; the book's own figure for the
    // same scenario is -1.86%. Lifting it into a field would put one label on
    // two numbers, so nothing here extracts it.
    const parsed = parseRisks(RISKS, HELD, KNOWN);
    for (const r of parsed) {
      expect(Object.keys(r).sort()).toEqual(
        ["heldNamed", "kind", "scenario", "tokens"].sort(),
      );
    }
  });
});
