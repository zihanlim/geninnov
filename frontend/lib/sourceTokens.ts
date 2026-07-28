// frontend/lib/sourceTokens.ts
//
// The inline source/character pill vocabulary, kept out of the component so it
// is plain data the tests can import. The shape mirrors lib/statusChips.ts and
// lib/risk/riskChips.ts for the same reason: classes written only inside a
// component JSX ship via Tailwind content globs (and components/ IS in them)
// but cannot be ASSERTED on by a test that reads the real chip definition
// instead of a copy of its markup. A copied class string passes while the
// shipped pill regresses.
//
// Two ramps, mapped to the prototype HTML exactly:
//   - accent /10 fill + 0.5px /30 border + accent ink = measured / live / exact
//     (the prototypes `secondary` for XACT).
//   - warning /10 fill + 0.5px /30 border + warning ink = modeled / estimated /
//     hypothetical (the prototypes `tertiary` for EST).
//   neutral   = elevated fill + secondary ink + 0.5px strong border
//             = provenance metadata that is neither measured nor estimated
//             (sample window, preflight, house default).
//
// ADR-0085 forbids reusing --long / --short for status. The two ramps above
// come from --accent (interactive) and --warning (attention) rather than
// from direction ink, so a pill saying "this value was estimated" never reads
// as a short position.
//
// Each entry carries the prose a pill puts in its hover title: the moment a
// reader has to hover for the meaning, the vocabulary has failed. SourceTag
// falls back to this string when the caller does not pass an explicit title.

export type SourceToken =
  // measured / live / exact (accent ramp)
  | "XACT"   // live, exact figure pulled from the persisted source
  | "RAW"    // raw signal reading, pre-normalisation
  | "NORM"   // normalised across the book
  | "LIVE"   // live snapshot, not cached or EOD
  | "OPT"    // optimizer-sized weight
  | "HIST"   // historical / backtested figure
  // modeled / estimated (warning ramp)
  | "EST"    // estimated or rounded figure
  | "MOD"    // derived from a composite model
  | "HRS"    // heuristic-sized (hype-fallback path)
  | "HYPO"   // hypothetical / counterfactual scenario
  // neutral provenance metadata
  | "DEF"    // house default, no scoring_config row behind the limit
  | "PRE";   // preflight / pre-publish

export interface SourceChip {
  /** Tailwind class string (kept literal so Tailwind JIT picks it up). */
  cls: string;
  /** Default hover title for the pill. Callers may override via prop. */
  detail: string;
}

export const SOURCE_CHIPS: Record<SourceToken, SourceChip> = {
  XACT: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "live, exact figure",
  },
  RAW: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "raw signal reading, pre-normalisation",
  },
  NORM: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "normalised across the book",
  },
  LIVE: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "live snapshot, not cached",
  },
  OPT: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "optimizer-sized weight",
  },
  HIST: {
    cls: "bg-accent/10 text-accent border-[0.5px] border-accent/30",
    detail: "historical / backtested figure",
  },
  EST: {
    cls: "bg-warning/10 text-warning border-[0.5px] border-warning/30",
    detail: "estimated or modelled figure",
  },
  MOD: {
    cls: "bg-warning/10 text-warning border-[0.5px] border-warning/30",
    detail: "composite modelled from components",
  },
  HRS: {
    cls: "bg-warning/10 text-warning border-[0.5px] border-warning/30",
    detail: "heuristic-sized (HypeScore fallback)",
  },
  HYPO: {
    cls: "bg-warning/10 text-warning border-[0.5px] border-warning/30",
    detail: "hypothetical / counterfactual",
  },
  DEF: {
    cls: "bg-bg-elevated text-text-secondary border-[0.5px] border-border-strong",
    detail: "house default, no scoring_config row behind this limit",
  },
  PRE: {
    cls: "bg-bg-elevated text-text-secondary border-[0.5px] border-border-strong",
    detail: "preflight / pre-publish state",
  },
};