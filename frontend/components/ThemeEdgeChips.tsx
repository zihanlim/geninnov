import Link from "next/link";
import type { ThemeEdge } from "@/lib/themeSignals";
import {
  provenanceColor,
  provenanceLabel,
  isSynthetic,
  type DataSource,
} from "@/lib/themeProvenance";

/**
 * Shared theme-card / heatmap affordances so the two Themes-home surfaces stay
 * consistent:
 *
 *  - <EdgeDirectionChip> — the resolved long / short / abstain side from
 *    EdgeScore (NOT sign(HypeScore)); this is the trade the theme implies.
 *  - <ProvenanceDot> — real / mock / mixed honesty carried from
 *    theme_signals_history.data_source.
 *  - <PositionsLink> — the theme → trade linkage into /book?theme=<id>.
 */

/** True when a theme's |EdgeScore| is below the abstain threshold — it was held
 *  out of the book. Exported so callers can label a "positions →" link honestly. */
export function isThemeAbstained(
  edge: ThemeEdge | undefined,
  threshold: number,
): boolean {
  if (!edge || edge.edge_score === null) return false;
  return Math.abs(edge.edge_score) < threshold;
}

/** long / short / abstain chip resolved from EdgeScore. */
export function EdgeDirectionChip({
  edge,
  abstainThreshold,
  title,
}: {
  edge: ThemeEdge | undefined;
  abstainThreshold: number;
  title?: string;
}) {
  if (!edge || edge.edge_score === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] border border-border text-text-tertiary"
        title="EdgeScore not yet computed for this theme"
      >
        no edge
      </span>
    );
  }

  const abstained = isThemeAbstained(edge, abstainThreshold);
  const dir = abstained ? null : edge.direction;

  const cls = abstained
    ? "border-border text-text-tertiary"
    : dir === "long"
      ? "border-[color:var(--long)] text-long"
      : dir === "short"
        ? "border-[color:var(--short)] text-short"
        : "border-border text-text-tertiary";

  const edgeMag = Math.abs(edge.edge_score).toFixed(2);
  const label = abstained ? "abstain" : dir === "long" ? "long" : dir === "short" ? "short" : "flat";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] border ${cls}`}
      title={
        title ??
        (abstained
          ? `Abstained — |EdgeScore| ${edgeMag} < threshold ${abstainThreshold.toFixed(2)}`
          : `EdgeScore ${edge.edge_score >= 0 ? "+" : ""}${edge.edge_score.toFixed(2)}`)
      }
    >
      {label}
      <span className="num opacity-70">{edge.edge_score >= 0 ? "+" : "−"}{edgeMag}</span>
    </span>
  );
}

/** Small provenance dot with the /method colour vocabulary. */
export function ProvenanceDot({
  source,
  size = 8,
}: {
  source: DataSource | null;
  size?: number;
}) {
  const synthetic = isSynthetic(source);
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: provenanceColor(source),
        // Ring the synthetic ones so they draw the eye even at small sizes.
        boxShadow: synthetic ? "0 0 0 2px rgba(210,153,34,0.25)" : undefined,
      }}
      title={provenanceLabel(source)}
      aria-label={provenanceLabel(source)}
    />
  );
}

/** "positions →" deep link into the book, filtered to this theme. Stops row/card
 * click propagation so it doesn't also open the derivation drawer. */
export function PositionsLink({
  themeId,
  className,
  label,
  held = false,
  hasPositions,
}: {
  themeId: string;
  className?: string;
  label?: string;
  /** True when the theme was abstained/held out — it has no sized position, so
   *  the link says so honestly and lands on the book's held-out explanation
   *  (banner → abstention roster) rather than implying positions exist. */
  held?: boolean;
  /**
   * Does the book ACTUALLY hold a position in this theme?
   *
   * `held` answers a question about the THEME'S SCORE — is |EdgeScore| below the
   * abstain bar — and was standing in for a question about the BOOK. They come
   * apart: a theme can clear the conviction bar comfortably and still win no slot,
   * because sizing is a competition and the caps bind. On the 2026-07-30 book,
   * Energy Prices (+0.20) and US Dollar (+0.27) both cleared the 0.15 bar, hold
   * nothing, and offered a reader "positions →" under the tooltip "See this
   * theme's sized positions in the book".
   *
   * `undefined` means the caller could not determine it, and the label falls back
   * to the score-only reading rather than asserting either way — the destination
   * corrects it on arrival (BookBody classifies a themed deep-link with no
   * positions as held out and says so), but a link should not need its target to
   * fix its own label.
   */
  hasPositions?: boolean;
}) {
  // Score below the bar, or scored fine and simply not sized. Both are "nothing to
  // show here"; only the first is the abstention roster's story.
  const notSized = hasPositions === false && !held;
  const text =
    label ?? (held ? "held out →" : notSized ? "not sized →" : "positions →");
  return (
    <Link
      href={`/book?theme=${encodeURIComponent(themeId)}`}
      onClick={(e) => e.stopPropagation()}
      className={
        className ??
        "text-[11px] text-text-tertiary hover:text-accent transition-colors whitespace-nowrap"
      }
      title={
        held
          ? "This theme was held out of the book — see why in the abstention roster"
          : notSized
            ? "This theme cleared the conviction bar but no position was sized in it — sizing is a competition and the caps bind. Opens the book filtered to this theme."
            : "See this theme's sized positions in the book"
      }
    >
      {text}
    </Link>
  );
}
