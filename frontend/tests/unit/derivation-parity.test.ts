// `lib/derivations/numeric.ts` says it "mirrors backend/derivations/numeric.py
// field-for-field". This makes that true.
//
// A comment claiming parity between two hand-maintained copies is worth exactly nothing the
// first time someone edits one of them. The failure is silent in the worst way: the backend
// starts emitting a field, the TS interface does not declare it, and every read of it is
// `undefined` — which on a page whose whole job is provenance renders as "no data" rather
// than as an error.
//
// This is the same shape as `risk-analytics-columns.test.ts`: derive the expectation from
// one artefact and check the other against it, rather than pinning a hand-written list that
// itself needs maintaining.
//
// It compares the SHARED shapes only. The TS side may add view helpers (`absenceCopy`) and
// the Python side may add validation the browser never runs; what must not differ is the
// set of fields and the members of each closed union.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PY = readFileSync(
  path.resolve(__dirname, "../../../backend/derivations/numeric.py"),
  "utf8",
);
const TS = readFileSync(
  path.resolve(__dirname, "../../lib/derivations/numeric.ts"),
  "utf8",
);

/** Field names of a Python `@dataclass`, ignoring comments, docstrings and methods. */
function pyFields(name: string): string[] {
  const re = new RegExp(`class ${name}[^\\n]*:\\n([\\s\\S]*?)(?=\\n@dataclass|\\nclass |\\n# ─|\\n_VALID|\\ndef )`);
  const m = re.exec(PY);
  expect(m, `python class ${name} should be found`).not.toBeNull();
  const fields: string[] = [];
  let inDoc = false;
  for (const line of m![1].split("\n")) {
    const t = line.trim();
    // Toggle on docstring delimiters; a one-line docstring opens and closes on the same line.
    const ticks = (t.match(/"""/g) ?? []).length;
    if (ticks === 1) { inDoc = !inDoc; continue; }
    if (ticks >= 2) continue;
    if (inDoc || !t || t.startsWith("#") || t.startsWith("@") || t.startsWith("def ")) continue;
    const f = /^(\w+)\s*:/.exec(t);
    if (f) fields.push(f[1]);
  }
  return fields.sort();
}

/** Property names of a TS `interface`. */
function tsFields(name: string): string[] {
  const m = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(TS);
  expect(m, `ts interface ${name} should be found`).not.toBeNull();
  const fields: string[] = [];
  let inDoc = false;
  for (const line of m![1].split("\n")) {
    const t = line.trim();
    if (t.startsWith("/**")) inDoc = true;
    if (inDoc) { if (t.includes("*/")) inDoc = false; continue; }
    if (!t || t.startsWith("//") || t.startsWith("*")) continue;
    const f = /^(\w+)\??\s*:/.exec(t);
    if (f) fields.push(f[1]);
  }
  return fields.sort();
}

/** Members of a Python `Literal[...]` alias. */
function pyUnion(name: string): string[] {
  const m = new RegExp(`${name} = Literal\\[([\\s\\S]*?)\\]`).exec(PY);
  expect(m, `python union ${name} should be found`).not.toBeNull();
  // `.match(/g)` returns a plain array; spreading `matchAll` would need --downlevelIteration
  // on this tsconfig, the same trap documented in lib/themeProvenance.ts.
  return (m![1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1)).sort();
}

/** Members of a TS string-literal union alias. */
function tsUnion(name: string): string[] {
  const m = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(TS);
  expect(m, `ts union ${name} should be found`).not.toBeNull();
  // `.match(/g)` returns a plain array; spreading `matchAll` would need --downlevelIteration
  // on this tsconfig, the same trap documented in lib/themeProvenance.ts.
  return (m![1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1)).sort();
}

describe("NumericDerivation mirrors its Python definition", () => {
  const SHAPES = ["NumericDerivation", "SourceRecord", "Freshness", "Uncertainty", "Timestamps"];

  it.each(SHAPES)("%s declares the same fields on both sides", (shape) => {
    expect(tsFields(shape)).toEqual(pyFields(shape));
  });

  const UNIONS = ["NumericStatus", "NumericUnit", "UncertaintyMethod", "Epistemic"];

  it.each(UNIONS)("%s has the same members on both sides", (union) => {
    expect(tsUnion(union)).toEqual(pyUnion(union));
  });

  it("actually parsed something, so the checks above are not vacuous", () => {
    // Every guard above compares two lists; two empty lists are equal. A regex that stops
    // matching after a refactor would turn this whole file green while checking nothing.
    expect(pyFields("NumericDerivation").length).toBeGreaterThanOrEqual(11);
    expect(pyUnion("Epistemic")).toEqual(["known", "not_applicable", "unknown"]);
    expect(pyFields("Timestamps")).toEqual(["effective", "observed", "published", "retrieved"]);
  });
});

describe("absenceCopy distinguishes the two absences", () => {
  const base = {
    field_id: "f", display_status: "unavailable" as const, unit: "pct" as const,
    method_id: "m", source_records: [], computed_at: "", as_of: "",
    freshness: { max_age_seconds: 1, observed_age_seconds: 0 },
  };

  it("says a not-applicable figure does not apply, never that it is pending", async () => {
    const { absenceCopy } = await import("@/lib/derivations/numeric");
    const copy = absenceCopy({
      ...base, value: null, epistemic: "not_applicable",
      unavailable_reason: "the book has no gross, so a share of it is undefined",
    })!;
    expect(copy).toContain("Does not apply");
    expect(copy).not.toContain("Not measured");
  });

  it("says an unknown figure was not measured, so a reader knows to retry", async () => {
    const { absenceCopy } = await import("@/lib/derivations/numeric");
    const copy = absenceCopy({
      ...base, value: null, epistemic: "unknown",
      unavailable_reason: "the CFTC portal did not answer",
    })!;
    expect(copy).toContain("Not measured");
    expect(copy).not.toContain("Does not apply");
  });

  it("returns null for a present value", async () => {
    const { absenceCopy } = await import("@/lib/derivations/numeric");
    expect(absenceCopy({ ...base, display_status: "exact", value: 1.5 })).toBeNull();
  });
});
