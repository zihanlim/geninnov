// frontend/lib/book/format.ts
//
// Display formatters and label maps for the book surfaces, lifted out of
// app/book/page.tsx so components/book/PositionRow.tsx can share them.
//
// The move was forced by a Next.js constraint worth remembering: a route file may
// only export `default` plus the framework's own names (`metadata`, `viewport`, …).
// Adding any other export makes Next's generated route types fail with
// "Property 'X' is incompatible with index signature ... not assignable to type
// 'never'". So a component defined inside page.tsx can never be imported by a
// test. Anything that needs testing needs to live outside the route.

/** Signed dollars in millions. `undefined`/`NaN` render as an em-dash, never 0. */
export const fmtUSD = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `$${(n / 1_000_000).toFixed(1)}M`;

/** A [0,1] share as a percentage. */
export const fmtPct = (n?: number | null, dp = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `${(n * 100).toFixed(dp)}%`;

/** Always carries an explicit sign, so a positive number cannot be misread. */
export const fmtSigned = (n?: number | null, dp = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}`;

// beta_mkt -> Mkt. The raw column names leaked to the page as chip labels.
export const FACTOR_LABELS: Record<string, string> = {
  beta_mkt: "Mkt",
  beta_smb: "SMB",
  beta_hml: "HML",
  beta_rmw: "RMW",
  beta_cma: "CMA",
  beta_umd: "UMD",
};

// `high` held #e8833a — a pale orange measuring 2.71:1 on the card, i.e. the band
// meant to shout was the one a reader could not read. The Ledger palette has three
// AA-safe inks for a four-step ramp, so `high` joins `severe` on crimson (the
// grouping a reader wants: "this hurts") and the two are separated by weight
// instead, which is a non-colour channel and so survives colourblindness too.
export const SEVERITY_COLOR: Record<string, string> = {
  low: "var(--text-secondary)",
  moderate: "var(--warning)",
  high: "var(--short)",
  severe: "var(--short)",
};
