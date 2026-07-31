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
//
// THE ONE EXEMPTION. `lib/book/lensProbe.ts` asks WHICH lenses published a book
// for the latest run_date. Filtering that read by lens would be circular: it
// could only ever confirm the lens the caller already assumed, and it could
// never report a lens the caller did not think to ask about — which is the
// entire question. So the exemption is not a relaxation of the rule, it is the
// one place the rule cannot be stated, and the read says so in-line:
//
//     // LENS-DISCOVERY-EXEMPT: this read is intentionally not lens-qualified.
//
// A marker is worth exactly as much as the cap on who may write it. So the
// exemption is pinned to that ONE file by name, and the exempt set is asserted
// to have exactly one member — copying the comment onto a second unfiltered
// read fails the suite rather than joining the exemption.
//
// A NOTE ON THE WINDOW, because it used to be the weak joint. The scan looked
// 1200 characters forward from a match and accepted any `.eq("lens", ...)`
// inside it. On a page that fires several reads from one `Promise.all` —
// RiskBody's twelve, BookBody's five — that window runs straight into the NEXT
// query, so an unfiltered read could pass on its NEIGHBOUR's filter. That is a
// false pass of exactly the bug this file exists to catch. The window is now
// truncated where the sibling statement begins: at the next `.from(` for a
// Supabase chain, at the next `.select(` for the DbReader form. Every filter
// counted below is now the matched query's own.

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
  /** Carries the LENS-DISCOVERY-EXEMPT marker on the statement itself. */
  exempt: boolean;
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
        // POSIX separators regardless of host OS: the exempt-file assertion
        // below compares against a literal path, and a test that passes on CI
        // and fails on a Windows checkout is a test nobody trusts.
        out.push({
          file: path.relative(ROOT, p).split(path.sep).join("/"),
          src: readFileSync(p, "utf8"),
        });
      }
    }
  };
  for (const d of ["app", "components", "lib"]) walk(path.join(ROOT, d));
  return out;
}

/** Cap on the forward window: enough for a chained Supabase call with a long
 *  column list and its comments, nowhere near a whole file. */
const WINDOW_CHARS = 1200;

/** The marker `lib/book/lensProbe.ts` carries directly above its discovery read. */
const EXEMPT_MARKER = "LENS-DISCOVERY-EXEMPT";

/** The only file allowed to carry it. POSIX separators; see `sourceFiles`. */
const EXEMPT_FILE = "lib/book/lensProbe.ts";

/**
 * A forward window from a match's start, truncated where the NEXT query begins.
 *
 * `boundary` is the first token of a sibling read — `.from(` for a Supabase
 * chain, `.select(` for the DbReader form. A lens filter that lives past one of
 * those belongs to that sibling, not to this match, and counting it is the
 * false pass this bound exists to close. The search starts one character in so
 * the match's own opening token cannot terminate its own window.
 */
function windowAfter(src: string, idx: number, boundary: RegExp): string {
  const raw = src.slice(idx, idx + WINDOW_CHARS);
  const next = raw.slice(1).search(boundary);
  return next === -1 ? raw : raw.slice(0, next + 1);
}

/**
 * Is this match the discovery read — marked exempt on the statement itself?
 *
 * The lookback is deliberately short — 240 characters, roughly the marker line
 * plus the two lines of chain that follow it. A file-header paragraph that
 * merely quotes the marker while explaining the rule must not thereby exempt
 * some read two hundred lines below it. Only a marker sitting immediately above
 * a statement exempts that statement.
 */
function markedExempt(src: string, idx: number): boolean {
  return src.slice(Math.max(0, idx - 240), idx).includes(EXEMPT_MARKER);
}

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

/** Direct `supabase.from("research_recommendations")` / `.from("book_holdings")`
 *  chains — the common case (app/ask, /book, /risk, LiveFeed, SourceBoard, …). */
function fromChainHits(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  for (const table of TABLES) {
    const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      const win = windowAfter(src, m.index, /\.from\(/);
      hits.push({
        file,
        table,
        line: lineOf(src, m.index),
        qualified: /\.eq\(\s*["'`]lens["'`]/.test(win),
        exempt: markedExempt(src, m.index),
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
      const win = windowAfter(src, m.index, /\.select\(/);
      hits.push({
        file,
        table,
        line: lineOf(src, m.index),
        qualified: /eq:\s*\{[^}]*lens/.test(win),
        exempt: markedExempt(src, m.index),
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
    // Known live readers as of migration 062: /ask, /book, /risk (two reads),
    // /workbench, LiveFeed, /method's SourceBoard, lib/book/lensProbe.ts (the
    // discovery read) and lib/chat/tools.ts (which feeds /ask AND the MCP
    // server through the DbReader form). If this count drops, the scan's own
    // regex broke, not the codebase.
    expect(allHits().length).toBeGreaterThanOrEqual(8);
  });

  it("every match carries an explicit lens filter", () => {
    const unqualified = allHits().filter((h) => !h.qualified && !h.exempt);
    expect(
      unqualified.map((h) => `${h.file}:${h.line} (${h.table})\n${h.snippet}`),
      "these reads have no lens filter — migration 062 lets a run_date carry both " +
        "the multi-asset and the credit-lens book, so an unfiltered read returns " +
        "whichever one Postgres orders first",
    ).toEqual([]);
  });

  it("lib/book/lensProbe.ts is the ONLY read allowed the discovery exemption", () => {
    // (b) of the contract. The marker is a comment, and a comment can be typed
    // anywhere; what makes it an exemption rather than an opt-out is that this
    // assertion names the one file entitled to it. Paste
    // `LENS-DISCOVERY-EXEMPT` above a second unfiltered read and this fails
    // with that file's path — which is the conversation that ought to happen,
    // rather than a second silent wrong-book read shipping behind a comment.
    // One entry, not "at most one per file": the array form asserts the COUNT
    // and the identity in a single comparison, so a second marked read inside
    // lensProbe.ts fails here too.
    const exempt = allHits().filter((h) => h.exempt);
    expect(
      exempt.map((h) => h.file),
      "only the lens DISCOVERY read may skip the lens filter; every other read " +
        "fetches a book and must say which one",
    ).toEqual([EXEMPT_FILE]);
  });

  it("the exemption is load-bearing — the discovery read really is unfiltered", () => {
    // The mirror of the test above, and the reason it is worth writing: an
    // exemption nobody needs is worse than no exemption, because it is a
    // standing licence with no live justification. If lensProbe's read ever
    // does acquire a lens filter, the marker has become a lie about the code
    // beneath it and should be deleted along with the entitlement above.
    const probe = allHits().filter((h) => h.file === EXEMPT_FILE);
    expect(probe.length, "lensProbe.ts should hold exactly one book read").toBe(1);
    expect(
      probe[0].qualified,
      "lensProbe.ts's read is now lens-qualified — delete the LENS-DISCOVERY-EXEMPT " +
        "marker and this entitlement, the general rule covers it",
    ).toBe(false);
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
