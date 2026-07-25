// frontend/components/risk/AttentionCrowding.tsx
//
// The risk-monitoring half of the theme engine: an attention score only means
// something against how much attention that theme normally gets, so we rank
// themes by their percentile within their own history (fetchThemeHistories
// .percentile) and FLAG the ones the book is positioned in. A long the crowd is
// already loud about is a crowded long — mean-reversion risk the book is walking
// into. Percentile is null under 5 observations; those themes render "—", never
// a fabricated 50th percentile.

"use client";
import {
  type CrowdingRow,
  CROWDING_PERCENTILE,
} from "@/lib/risk/riskBoard";
import { isNum } from "@/lib/risk/analytics";
import { Ident, SectionSkeleton } from "./SectionGap";

function pctBadge(p: number | null): { label: string; cls: string } {
  if (!isNum(p)) return { label: "—", cls: "text-text-tertiary" };
  if (p >= CROWDING_PERCENTILE) return { label: `${Math.round(p)}th`, cls: "text-short" };
  if (p >= 50) return { label: `${Math.round(p)}th`, cls: "text-warning" };
  return { label: `${Math.round(p)}th`, cls: "text-text-secondary" };
}

function dirLabel(d: CrowdingRow["bookDirection"]): { text: string; cls: string } {
  switch (d) {
    case "long":
      return { text: "LONG", cls: "dir-pill-long" };
    case "short":
      return { text: "SHORT", cls: "dir-pill-short" };
    case "mixed":
      return { text: "MIXED", cls: "bg-warning-dim text-warning" };
    default:
      return { text: "—", cls: "bg-bg-elevated text-text-tertiary border border-border" };
  }
}

export function AttentionCrowding({
  loading,
  rows,
  historyFailure,
  observationNote,
}: {
  loading: boolean;
  rows: CrowdingRow[];
  historyFailure: string | null;
  /** Set when too few scored observations exist to compute percentiles. */
  observationNote?: string | null;
}) {
  const flagged = rows.filter((r) => r.flag !== null);
  const positioned = rows.filter((r) => r.bookDirection !== null);
  const anyPercentile = rows.some((r) => isNum(r.percentile));

  return (
    <section className="card mb-6" aria-labelledby="risk-crowding-heading">
      <div className="card-header">
        <h2 id="risk-crowding-heading" className="card-title m-0">
          Theme attention crowding
        </h2>
        <span className="text-[11px] text-text-tertiary num">
          {loading
            ? "…"
            : `${flagged.length} crowded & positioned · ${positioned.length} in book`}
        </span>
      </div>

      {loading ? (
        <SectionSkeleton height={220} />
      ) : historyFailure ? (
        <div className="px-[18px] py-6 text-[13px]" role="alert">
          <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--short)" }}>
            <p className="m-0 mb-1.5 font-medium text-text-primary">
              theme_signals_history could not be read
            </p>
            <p className="m-0 text-text-secondary leading-[1.6]">{historyFailure}</p>
          </div>
        </div>
      ) : (
        <>
          {flagged.length > 0 && (
            <div className="px-[18px] pt-3.5">
              <div
                className="pl-4 border-l-2 py-1.5"
                style={{ borderColor: "var(--short)" }}
                role="alert"
              >
                <p className="m-0 mb-1 text-[11px] font-medium text-short uppercase tracking-[0.1em]">
                  {flagged.length} crowding flag{flagged.length === 1 ? "" : "s"}
                </p>
                <ul className="m-0 pl-4 text-[12px] text-text-secondary leading-[1.7]">
                  {flagged.map((r) => (
                    <li key={r.themeId}>{r.flag}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <p className="m-0 px-[18px] pt-3.5 text-[12px] text-text-secondary leading-[1.6] max-w-[92ch]">
            Themes ranked by where today&apos;s attention sits within their own history —
            a theme at its {CROWDING_PERCENTILE}th percentile or higher is unusually loud
            for itself. When the book is positioned in one of those, it is leaning into a
            consensus the crowd already owns, which is where mean-reversion risk lives.
            Percentile needs at least five scored observations; below that it is{" "}
            <span className="num">—</span>, not a guess.
          </p>

          {!anyPercentile ? (
            <div className="px-[18px] py-5 text-[13px]">
              <div className="pl-4 border-l-2 max-w-[80ch]" style={{ borderColor: "var(--border-strong)" }}>
                <p className="m-0 mb-1.5 font-medium text-text-primary">
                  No attention percentiles yet
                </p>
                <p className="m-0 text-text-secondary leading-[1.6]">
                  {observationNote ??
                    "Every theme has fewer than five scored rows in theme_signals_history.hype_score, so no percentile can be computed. This is expected until the history backfills."}{" "}
                  Source: <Ident>theme_signals_history.hype_score</Ident>.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px] min-w-[640px]">
                <caption className="sr-only">
                  Themes ranked by attention percentile within their own history, with
                  the book&apos;s position in each theme flagged.
                </caption>
                <thead>
                  <tr>
                    {["Theme", "Attn pct", "1d Δ", "Book position", "Weight", "Read"].map(
                      (h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={`px-[16px] py-[7px] text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-y border-border bg-bg-elevated ${
                            i === 0 || i === 5 ? "text-left" : i === 3 ? "text-center" : "text-right"
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pb = pctBadge(r.percentile);
                    const dl = dirLabel(r.bookDirection);
                    const crowded =
                      r.bookDirection !== null &&
                      isNum(r.percentile) &&
                      r.percentile >= CROWDING_PERCENTILE;
                    return (
                      <tr
                        key={r.themeId}
                        className={`hover:bg-bg-elevated ${crowded ? "bg-short-dim/20" : ""}`}
                      >
                        <td className="px-[16px] py-[7px] border-b border-border text-text-primary">
                          {r.themeName}
                        </td>
                        <td className={`px-[14px] py-[7px] border-b border-border text-right num ${pb.cls}`}>
                          {pb.label}
                        </td>
                        <td
                          className={`px-[14px] py-[7px] border-b border-border text-right num ${
                            !isNum(r.delta1d)
                              ? "text-text-tertiary"
                              : r.delta1d > 0
                                ? "text-long"
                                : r.delta1d < 0
                                  ? "text-short"
                                  : "text-text-secondary"
                          }`}
                        >
                          {isNum(r.delta1d)
                            ? `${r.delta1d >= 0 ? "+" : "−"}${Math.abs(r.delta1d).toFixed(1)}`
                            : "—"}
                        </td>
                        <td className="px-[14px] py-[7px] border-b border-border text-center">
                          <span className={`badge ${dl.cls}`}>{dl.text}</span>
                        </td>
                        <td className="px-[14px] py-[7px] border-b border-border text-right num text-text-secondary">
                          {isNum(r.bookWeight) ? `${(r.bookWeight * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-[16px] py-[7px] border-b border-border text-[12px] text-text-secondary leading-[1.5] max-w-[30ch]">
                          {crowded ? (
                            <span className="text-short">crowded {r.bookDirection}</span>
                          ) : r.bookDirection !== null ? (
                            "positioned, not crowded"
                          ) : (
                            <span className="text-text-tertiary">not in book</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="m-0 px-[18px] py-3 text-[11px] text-text-tertiary leading-[1.6] max-w-[92ch]">
            Percentile is the latest hype score&apos;s rank within the theme&apos;s own{" "}
            <Ident>theme_signals_history.hype_score</Ident> series; book position joins{" "}
            <Ident>portfolio_positions.theme_id</Ident>. A highlighted row is a theme the
            book is positioned in at or above the {CROWDING_PERCENTILE}th attention
            percentile — the crowding warning.
          </p>
        </>
      )}
    </section>
  );
}
