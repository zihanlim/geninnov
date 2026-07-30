"use client";

// frontend/components/AttentionFunnel.tsx
//
// The strip between the two attention boards (ADR-0146), drawn rather than
// written — and drawn in TWO halves, because the arrow chain it replaces
// asserted something untrue.
//
// The old strip read:
//
//   193 phrases tracked → 170 watched by nothing → — emerging → 9 anchor themes
//
// Four stages, one arrow chain, one implied claim: that the 9 came out of the
// 193. They did not. Migration 051 records `promotion_basis` per theme, and the
// live values are **8 practitioner_prior** (the opening list in migration 001)
// and **1 operator_directed** (AI Capex). Zero `measured_discovery`. Eight of
// the nine anchor themes predate the tracker entirely and were never phrases in
// its corpus.
//
// This is why the obvious "make it graphical" move — one proportional funnel,
// each bar's width ∝ its count — is the WRONG one. A funnel's whole visual
// grammar is subset-of. Drawing 9 as 4.7% of 193 would state the nesting far
// more forcefully than the arrows did, and it would be false. Proportion is
// therefore used only INSIDE the observed half, where the nesting is real
// (unwatched ⊂ tracked), and the committed half is drawn as a COUNT — nine pips
// — on no shared scale at all.
//
// The two halves are separated by a rule, not an arrow, and the caption states
// the break instead of papering over it. The one genuine link is AI Capex, and
// even that is `operator_directed` rather than `measured_discovery`: per
// migration 051, the tracker measured AI in 2 of 455 documents, the operator
// then named the theme, and the LDA confirmation ran AFTER. The signal prompted
// the question; it did not justify the promotion. Calling it "promoted from a
// signal" — as this component did — overstated it in the direction that
// flatters the pipeline.
//
// Honesty rules inherited from the boards, both still binding:
//   • While no phrase has a measurable velocity the emerging stage reads "—"
//     with its cause and is drawn as a DASHED track with no width, never a
//     zero-length bar (ADR-0066: absence is not zero).
//   • Every number is text (ADR-0126). The bars reinforce the figures; they are
//     `aria-hidden` and are never the only copy of anything.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { attentionFunnel } from "@/lib/narratives";
import { useNarrativeSeries, type NarrativeSeriesState } from "@/lib/useNarrativeSeries";

/** Live values of `themes.promotion_basis` (migration 051), counted rather than
 *  assumed. `measured_discovery` is the only value that claims the system found
 *  a theme before anyone named it, and nothing currently carries it — which is
 *  the fact this strip exists to keep visible. */
interface ThemeBasis {
  total: number;
  /** promotion_basis = 'measured_discovery' — evidence preceded the decision. */
  measured: number;
  /** promotion_basis = 'operator_directed' — a human named it; evidence, where
   *  it exists, did not come first. */
  operator: number;
  /** promotion_basis = 'practitioner_prior' — the opening list. No measurement
   *  claimed, and per migration 051 none needed: a prior is a legitimate way to
   *  start a universe, not a gap in the record. */
  prior: number;
}

/** One proportional bar in the observed half. `share` is against the widest
 *  stage, so the track is a real value axis and not a decoration. */
function ObservedBar({
  value,
  label,
  share,
}: {
  value: number;
  label: string;
  share: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="num text-[13px] text-text-primary w-9 text-right shrink-0">
        {value}
      </span>
      <span className="text-[11px] text-text-secondary w-[104px] shrink-0 leading-[1.3]">
        {label}
      </span>
      {/* The bar is a percentage of THIS track, not of the row. Sizing it
          directly in the flex row makes 100% mean "the row's full width" on top
          of the two fixed-width siblings, so the longest bar overshoots the
          column and paints over the committed half beside it. */}
      <span aria-hidden="true" className="flex-1 min-w-0">
        <span
          className="block h-2 rounded-sm"
          style={{
            // The 1.5% floor keeps a small NON-ZERO stage visible; it must not
            // apply at zero, or a measured 0 renders as a stub bar that reads as
            // "a few". Zero and nearly-zero are different readings, and the
            // figure beside the bar is already the record either way.
            width: share > 0 ? `${Math.max(share * 100, 1.5)}%` : "0%",
            background: "var(--series-1)",
            opacity: 0.85,
          }}
        />
      </span>
    </div>
  );
}

export default function AttentionFunnel({ shared }: { shared?: NarrativeSeriesState }) {
  const [basis, setBasis] = useState<ThemeBasis | null>(null);

  // The corpus and the day rule are the hook's, not this component's. They were
  // inlined here — with `fetchNarratives()`'s `combined` default against the
  // board's `archive` — which is how this strip came to report 193 tracked and
  // "velocity not measurable yet" beneath a chart reading 76 with velocities to
  // +2.27. Aligning the two call sites by hand fixed that instance and left the
  // next one available; the choice lives in one place now.
  // See NarrativeTrends: the page may own the read so `/` queries
  // narrative_signals once instead of twice.
  const own = useNarrativeSeries(30, { skip: shared !== undefined });
  const { series, asOfFallback } = shared ?? own;
  const funnel = series ? attentionFunnel(series) : null;
  // Corpus size and velocity count — available from the same series read,
  // surfaced here so the observed bars have their denominators stated.
  const corpusSize = series?.[0]?.latest.corpus_size ?? null;
  const velocityCount = series?.filter((s) => s.latest.velocity !== null).length ?? 0;
  // Attribution breakdown: which themes cover which attributed phrases.
  // Shown as mini bars below the "Not a funnel" paragraph.
  const attributedPhrases = series
    ? series
        .filter((s) => s.latest.covered_by !== null)
        .reduce<Record<string, number>>((acc, s) => {
          const t = s.latest.covered_by!;
          acc[t] = (acc[t] ?? 0) + 1;
          return acc;
        }, {})
    : {};

  useEffect(() => {
    supabase
      .from("themes")
      .select("id, promotion_basis")
      .then(({ data, error }) => {
        if (error || !data) return;
        const by = (v: string) =>
          data.filter(
            (t) => (t as { promotion_basis?: string }).promotion_basis === v,
          ).length;
        setBasis({
          total: data.length,
          measured: by("measured_discovery"),
          operator: by("operator_directed"),
          prior: by("practitioner_prior"),
        });
      });
  }, []);

  if (funnel === null && basis === null) return null;

  // Proportion only within the observed half, where the nesting is real.
  const denom = funnel ? Math.max(funnel.tracked, 1) : 1;
  // A theme is drawn filled when a measurement had ANY part in its existence —
  // `measured_discovery` (evidence first) or `operator_directed` (evidence
  // attached, but after the decision). The distinction between those two is the
  // point of migration 051, so the caption keeps them apart in words even though
  // the pip treats them alike.
  const linked = basis ? basis.measured + basis.operator : 0;

  return (
    <div className="card px-4 py-3 flex flex-col flex-1">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-text-secondary">
          Attention funnel
        </span>
        <span className="text-[10.5px] text-text-tertiary">
          what is observed, and what is committed
        </span>
      </div>

      {/* One column, always. This card lives in the 1fr slot beside the
          narrative board, so its widest possible rendering is
          (1400 − 64 − 16) / 3 ≈ 440px — 408px inside the card padding. The
          committed half alone was budgeted 340px, so the two halves have no
          viewport at which they fit side by side. Same bound as the note in
          `NarrativeTrends`: with `main` capped at 1400px this is provable, not
          a guess about typical screens. */}
      <div className="grid gap-x-5 gap-y-3 items-start">
        {/* ── Observed: narrative_signals. Genuinely nested, so proportional. ── */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            Observed &middot; <code className="num">narrative_signals</code>
            {/* The day these counts are FROM, whenever it is not the newest run.
                Stated for the same reason the board states it (ADR-0159): a
                count keyed to one day under a heading implying another is the
                mislabel, not the fallback. */}
            {asOfFallback && (
              <>
                {" "}
                &middot; <span className="num">{asOfFallback}</span>, last
                measured day
              </>
            )}
          </span>
          {funnel && (
            <>
              <ObservedBar
                value={funnel.tracked}
                label="phrases tracked"
                share={1}
              />
              <ObservedBar
                value={funnel.unwatched}
                label="watched by nothing"
                share={funnel.unwatched / denom}
              />
              {funnel.velocityMeasurable ? (
                <ObservedBar
                  value={funnel.emerging}
                  label="emerging"
                  share={funnel.emerging / denom}
                />
              ) : (
                /* NOT a zero-width bar (ADR-0066). A dashed track claims no
                   length, which is the honest drawing of a quantity that has
                   not been measured — the same rule the detection plane's rug
                   applies to a phrase with no velocity. */
                <div className="flex items-center gap-2.5">
                  <span className="num text-[13px] text-text-tertiary w-9 text-right shrink-0">
                    &mdash;
                  </span>
                  <span className="text-[11px] text-text-secondary w-[104px] shrink-0 leading-[1.3]">
                    emerging
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2 rounded-sm shrink-0 flex-1 border border-dashed border-border"
                  />
                </div>
              )}
              {!funnel.velocityMeasurable && (
                <p className="m-0 mt-0.5 text-[10.5px] text-text-tertiary leading-[1.45]">
                  Velocity compares a phrase against its own history and no
                  tracked phrase has enough observed days yet, so this stage is
                  unmeasured rather than empty.
                </p>
              )}
              {/* Velocity fraction and corpus size — the denominators behind the bars. */}
              <p className="m-0 mt-0.5 text-[10.5px] text-text-tertiary leading-[1.45]">
                {velocityCount > 0 ? (
                  <>
                    <span className="num">{velocityCount}</span> of{" "}
                    <span className="num">{series?.length}</span> phrases have velocity
                  </>
                ) : (
                  <>No tracked phrase has velocity yet</>
                )}
                {corpusSize ? (
                  <> · ~<span className="num">{corpusSize}</span> archive headlines/day</>
                ) : null}
              </p>
            </>
          )}
        </div>

        {/* A rule, NOT an arrow. An arrow here would restate the subset claim
            the whole component was rewritten to stop making. Horizontal now the
            halves stack — it separates the same two things in the same way; only
            the axis changed. */}
        <div aria-hidden="true" className="border-t border-border" />

        {/* ── Committed: themes. A COUNT, on no shared scale with the left. ── */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            Committed &middot; <code className="num">themes</code>
          </span>
          {basis && (
            <>
              <div className="flex items-center gap-2.5">
                <span className="num text-[13px] text-text-primary w-9 text-right shrink-0">
                  {basis.total}
                </span>
                <span className="text-[11px] text-text-secondary w-[104px] shrink-0 leading-[1.3]">
                  anchor themes
                </span>
                <span aria-hidden="true" className="flex items-center gap-1">
                  {Array.from({ length: basis.total }, (_, i) => (
                    <span
                      key={i}
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={
                        i < linked
                          ? { background: "var(--accent)" }
                          : { border: "1px solid var(--border)" }
                      }
                    />
                  ))}
                </span>
              </div>
              <p className="m-0 text-[10.5px] text-text-tertiary leading-[1.45]">
                <span className="num">{basis.prior}</span> of them are{" "}
                <code className="num">practitioner_prior</code> — the opening
                list, no measurement claimed and none needed.{" "}
                <span className="num">{basis.operator}</span> is{" "}
                <code className="num">operator_directed</code>, and{" "}
                <span className="num">{basis.measured}</span> is{" "}
                <code className="num">measured_discovery</code>, the only basis
                that records evidence arriving <em>before</em> the decision.
              </p>
            </>
          )}
        </div>
      </div>

      {/* The break, stated. This is the sentence the old arrow chain was
          implicitly denying.

          Two claims were removed here on review, both wrong in ways the board
          beside this one disproves:

          1. "were never in its corpus" — false. `covered_by` exists precisely to
             attribute a phrase to an anchor, and it does: `ai` → AI Capex, `oil`
             → Energy Prices, `fed` → Fed Policy, in the table one column left.
             The themes were not DERIVED from the corpus; their subject matter is
             thoroughly in it. Provenance, not presence.
          2. "not a surviving subset of the tracked phrases" — a category error.
             A theme is a row in `themes`; a phrase is a row in
             `narrative_signals`. `AI Capex` is not a member of the phrase set
             under any provenance, so containment cannot be true OR false in
             those terms, and defending the right claim with the wrong noun
             weakens it.

          And the zero needed a sentence of its own: read cold, `0
          measured_discovery` says "the pipeline found nothing", which is not
          what it counts and not what happened — the two-method job HAS produced
          candidates, they are in `DiscoveredThemes` above, and they are in
          shadow because promotion is an operator's act. The zero measures the
          human gate. */}
      {/* `mt-auto` on BOTH this paragraph and the attribution block below it,
          not on one of them. This card is stretched to the narrative board's
          height by the paired-pane rule in `page.tsx` (`self-stretch` +
          `lg:h-full`, deliberate: the two must share an edge), and the board is
          ~260px taller than anything this card has to say. Flexbox splits free
          space EQUALLY across every auto margin on the main axis, so two
          absorbers turn one conspicuous 260px hole into two ~130px section
          gaps, each sitting on a rule that already separated something. One
          absorber — or none, which left the void trailing under the last bar —
          reads as a card that ran out; two read as a card with air in it.
          Below `lg` there is no free space, the autos collapse to zero, and the
          `pt-3` is the whole separation, which is why it is not `pt-2.5`. */}
      {funnel && basis && (
        <p className="m-0 mt-auto pt-3 border-t border-border text-[11px] text-text-secondary leading-[1.55]">
          <strong>Not a funnel.</strong> These themes were not derived from the
          phrases beside them &mdash;{" "}
          <span className="num">{basis.prior}</span> predate the tracker. Their
          subject matter is in its corpus:{" "}
          <span className="num">{funnel.tracked - funnel.unwatched}</span> of{" "}
          <span className="num">{funnel.tracked}</span> phrases are attributed to
          an anchor. This counts <strong>provenance, not coverage</strong>. And{" "}
          <span className="num">{basis.measured}</span>{" "}
          <code className="num">measured_discovery</code> is a fact about
          promotion, not discovery &mdash; candidates sit in shadow under{" "}
          <em>What the engine is discovering</em> until an operator promotes one.
        </p>
      )}
      {/* Attribution graphic: proportional bar (unwatched | attributed) and
          mini bars by theme — the visual answer to "not a funnel". */}
      {funnel && Object.keys(attributedPhrases).length > 0 && (
        /* `mt-auto`: this card sits in a `lg:h-full` grid row beside the
           narrative board, which is roughly 260px taller, so the card is
           stretched whatever its content does. Top-aligning every section left
           that stretch as one trailing void below the last bar — the card read
           as cut short rather than as full. Anchoring the attribution summary
           to the bottom spends the same pixels as one gap ABOVE a footer, which
           is a layout, and the rule already drawn here reads as its top edge. */
        <div className="mt-auto pt-3 flex flex-col gap-2">
          {/* Label column is `w-24` — the SAME width as the per-theme labels
              below — so the total bar and the theme bars it decomposes share
              one left edge and are read against each other. At `w-9` (36px)
              the word "attribution" was 16px wider than its own box, and
              `text-right` spilled the overflow leftward past the card's
              padding. */}
          <div className="flex items-center gap-2 pt-2.5 border-t border-border">
            <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary w-24 text-right shrink-0">
              attribution
            </span>
            {/* Proportional bar: unwatched | attributed, one shared axis. */}
            <div className="flex-1 h-3 rounded-sm overflow-hidden flex">
              {funnel.unwatched > 0 && (
                <div
                  title={`${funnel.unwatched} unwatched`}
                  className="h-full rounded-l-sm"
                  style={{
                    width: `${(funnel.unwatched / funnel.tracked) * 100}%`,
                    background: "var(--border)",
                  }}
                />
              )}
              {Object.keys(attributedPhrases).length > 0 && (
                <div
                  title={`${funnel.tracked - funnel.unwatched} attributed`}
                  className={`h-full${funnel.unwatched === 0 ? " rounded-sm" : " rounded-r-sm"}`}
                  style={{
                    width: `${((funnel.tracked - funnel.unwatched) / funnel.tracked) * 100}%`,
                    background: "var(--series-1)",
                    opacity: 0.75,
                  }}
                />
              )}
            </div>
            {/* Spacer, matching the count column of the theme rows below, so
                every bar in this block ends on the same right edge too. */}
            <span aria-hidden="true" className="w-4 shrink-0" />
          </div>
          {/* The key on its own line rather than crowded into the row above.
              Inline, it was ~150px of `shrink-0` beside a `flex-1` track, so
              the bar the key describes got barely half the column it had to
              divide. */}
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="w-24 shrink-0" />
            <div className="flex-1 flex gap-3 text-[10px] text-text-tertiary">
              <span>
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "var(--border)" }} />
                <span className="num">{funnel.unwatched}</span> unwatched
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "var(--series-1)", opacity: 0.75 }} />
                <span className="num">{funnel.tracked - funnel.unwatched}</span> attributed
              </span>
            </div>
          </div>
          {/* Mini bars: attributed phrases broken down by which theme covers them. */}
          {Object.entries(attributedPhrases)
            .sort((a, b) => b[1] - a[1])
            .map(([theme, count]) => (
              <div key={theme} className="flex items-center gap-2">
                <span className="text-[10px] text-text-tertiary w-24 text-right shrink-0 truncate" title={theme}>
                  {theme}
                </span>
                <div className="flex-1 h-2 rounded-sm overflow-hidden bg-border/30">
                  <div
                    className={`h-full${count === funnel.tracked - funnel.unwatched ? " rounded-sm" : " rounded-r-sm"}`}
                    style={{
                      width: `${(count / (funnel.tracked - funnel.unwatched)) * 100}%`,
                      background: "var(--series-1)",
                      opacity: 0.6,
                    }}
                  />
                </div>
                <span className="num text-[10px] text-text-tertiary w-4 text-right shrink-0">
                  {count}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
