// A read of research_recommendations or book_holdings that does not filter on
// lens is a latent wrong-book bug, and it is invisible in review: the query
// looks identical to the single-book code that ran for years, and it worked
// for years — right up until migration 062 let a second row exist for the
// same run_date. Once that landed, `.order("run_date", desc).limit(1)` reads
// whichever of TODAY's two books Postgres happens to return first, and
// `.limit(2)` — the pattern /book used for "today vs. yesterday" — can return
// today's two LENSES instead of two DATES.
//
// Same approach as risk-thresholds.test.ts: parse the source rather than trust
// a comment, because a comment cannot fail a build when the code drifts from
// it. Every `.from("research_recommendations")` / `.from("book_holdings")` in
// the tree (production code, not fixtures) must carry an explicit lens filter
// somewhere in the same query — either the Supabase chain's own `.eq("lens",
// ...)`, or the `DbReader.select(...)` object form's `eq: { lens: ... }`
// (lib/chat/tools.ts, which shares this contract with /ask and the MCP
// server).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const TABLES = ["research_recommendations", "book_holdings"] as const;

interface Hit {
  file: string;
  table: string;
  line: number;
  qualified: boolean;
  snippet: string;
}

/** Every .ts/.tsx file under app/, components/, lib/ — production code only. */
function sourceFiles(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        out.push({ file: path.relative(ROOT, p), src: readFileSync(p, "utf8") });
      }
    }
  };
  for (const d of ["app", "components", "lib"]) walk(path.join(ROOT, d));
  return out;
}

/** A bounded forward window from a match's start — enough to span a chained
 *  Supabase call or a `DbReader.select(...)` call, not the whole file. */
function windowAfter(src: string, idx: number): string {
  return src.slice(idx, idx + 1200);
}

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

/** Direct `supabase.from("research_recommendations")` / `.from("book_holdings")`
 *  chains — the common case (app/ask, /book, /risk, LiveFeed, SourceBoard, …). */
function fromChainHits(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  for (const table of TABLES) {
    const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      const win = windowAfter(src, m.index);
      hits.push({
        file,
        table,
        line: lineOf(src, m.index),
        qualified: /\.eq\(\s*["'`]lens["'`]/.test(win),
        snippet: win.split("\n").slice(0, 6).join("\n"),
      });
    }
  }
  return hits;
}

/** `DbReader.select("research_recommendations", columns, { eq: { lens: ... } })`
 *  — the object-options form lib/chat/tools.ts uses so /ask and the MCP server
 *  share one read contract. */
function dbSelectHits(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  for (const table of TABLES) {
    const re = new RegExp(`\\.select\\(\\s*\\n?\\s*["'\`]${table}["'\`]`, "g");
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      const win = windowAfter(src, m.index);
      hits.push({
        file,
        table,
        line: lineOf(src, m.index),
        qualified: /eq:\s*\{[^}]*lens/.test(win),
        snippet: win.split("\n").slice(0, 8).join("\n"),
      });
    }
  }
  return hits;
}

function allHits(): Hit[] {
  const hits: Hit[] = [];
  for (const { file, src } of sourceFiles()) {
    hits.push(...fromChainHits(file, src));
    hits.push(...dbSelectHits(file, src));
  }
  return hits;
}

describe("every research_recommendations / book_holdings read is lens-qualified", () => {
  it("found reads to check — a silently-empty scan would make the next test vacuous", () => {
    // Known live readers as of migration 062: /ask, /book, /risk, /workbench,
    // LiveFeed, /method's SourceBoard, and lib/chat/tools.ts (which feeds /ask
    // AND the MCP server through the DbReader form). If this count drops, the
    // scan's own regex broke, not the codebase.
    expect(allHits().length).toBeGreaterThanOrEqual(8);
  });

  it("every match carries an explicit lens filter", () => {
    const unqualified = allHits().filter((h) => !h.qualified);
    expect(
      unqualified.map((h) => `${h.file}:${h.line} (${h.table})\n${h.snippet}`),
      "these reads have no lens filter — migration 062 lets a run_date carry both " +
        "the multi-asset and the credit-lens book, so an unfiltered read returns " +
        "whichever one Postgres orders first",
    ).toEqual([]);
  });

  it("book_holdings has no direct frontend reader today", () => {
    // Not a requirement — a stated fact worth pinning. If this starts failing, a
    // NEW read of book_holdings was added and must be lens-qualified like every
    // research_recommendations read above; book_holdings_performance (a
    // DIFFERENT, deliberately lens-less table per ADR-0194) is unaffected.
    const hits = allHits().filter((h) => h.table === "book_holdings");
    expect(hits).toEqual([]);
  });
});
