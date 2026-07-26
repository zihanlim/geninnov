// frontend/components/status/ProvenanceStrip.tsx
import { Ident } from "@/components/risk/SectionGap";

/**
 * A one-line caption stating where a section's figures came from and how often
 * they change.
 *
 * The gap this closes: the app asserted its own cadence in exactly one place — a
 * "Next run 21:30 UTC" string in TopBar — so a reader arriving on a deep link to
 * /book or /risk had no way to learn the publication is daily rather than live.
 * Every figure under it silently read as "now". Goal 1 asks whether a number's
 * origin can be found without asking; the cadence is part of that origin, because
 * a stale-by-design number and a stale-by-accident one are different claims.
 *
 * Deliberately not a card, a callout or a banner. It sits under the data it
 * describes at caption weight, because a reader who does not need it should be
 * able to skip it in one saccade — Goal 7, density serves comparison. A banner
 * above the table would push the rows the reader came for below the fold.
 *
 * Contrast: text-text-tertiary is the same token the /book legend and the table
 * headers already use, measured at 5.52:1 on the page, 5.78:1 on a card and
 * 5.23:1 on --bg-elevated. It clears the Goal 8 floor on every surface this can
 * land on, which is why it is a token and not a new dimmer grey.
 */
export function ProvenanceStrip({
  cadence,
  source,
  note,
  className = "",
}: {
  /** When this data changes, in the reader's words. */
  cadence: string;
  /** The `table.column` the figures above were read from. */
  source: string;
  /** Optional extra qualifier — a lens, a determinism claim, a window. */
  note?: string;
  className?: string;
}) {
  return (
    <p
      className={`m-0 px-[18px] py-2 text-[11px] leading-[1.6] text-text-tertiary flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}
    >
      <span>{cadence}</span>
      <span aria-hidden="true">·</span>
      <Ident>{source}</Ident>
      {note ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{note}</span>
        </>
      ) : null}
    </p>
  );
}
