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
import {
  attentionFunnel,
  fetchNarratives,
  toSeries,
  type AttentionFunnelCounts,
} from "@/lib/narratives";

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
            width: `${Math.max(share * 100, 1.5)}%`,
            background: "var(--series-1)",
            opacity: 0.85,
          }}
        />
      </span>
    </div>
  );
}

export default function AttentionFunnel() {
  const [funnel, setFunnel] = useState<AttentionFunnelCounts | null>(null);
  const [basis, setBasis] = useState<ThemeBasis | null>(null);

  useEffect(() => {
    fetchNarratives().then(({ rows, error }) => {
      if (!error) setFunnel(attentionFunnel(toSeries(rows)));
    });
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
    <div className="card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-text-secondary">
          Attention funnel
        </span>
        <span className="text-[10.5px] text-text-tertiary">
          what is observed, and what is committed
        </span>
      </div>

      <div className="grid gap-x-5 gap-y-3 figures:grid-cols-[minmax(0,1fr)_auto_minmax(0,340px)] items-start">
        {/* ── Observed: narrative_signals. Genuinely nested, so proportional. ── */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            Observed &middot; <code className="num">narrative_signals</code>
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
            </>
          )}
        </div>

        {/* A rule, NOT an arrow. An arrow here would restate the subset claim
            the whole component was rewritten to stop making. */}
        <div
          aria-hidden="true"
          className="hidden figures:block self-stretch border-l border-border"
        />

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
                <code className="num">measured_discovery</code>, the only value
                that claims the pipeline found a theme before anyone named it.
              </p>
            </>
          )}
        </div>
      </div>

      {/* The break, stated. This is the sentence the old arrow chain was
          implicitly denying. */}
      {funnel && basis && (
        <p className="m-0 mt-3 pt-2.5 border-t border-border text-[11px] text-text-secondary leading-[1.55]">
          <strong>These two halves are not nested.</strong> The{" "}
          <span className="num">{basis.total}</span> anchor themes are not a
          surviving subset of the{" "}
          <span className="num">{funnel.tracked}</span> tracked phrases —{" "}
          <span className="num">{basis.prior}</span> of them predate the tracker
          and were never in its corpus. The one link is{" "}
          <strong>AI Capex</strong>, and even there the measurement followed the
          decision: the tracker saw AI in 2 of 455 documents, the operator named
          the theme, and the LDA confirmation ran afterwards. A signal that
          prompts a question is not evidence that justified an answer.
        </p>
      )}
    </div>
  );
}
