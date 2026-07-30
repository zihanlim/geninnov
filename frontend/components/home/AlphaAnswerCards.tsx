// frontend/components/home/AlphaAnswerCards.tsx
//
// The four questions a PM arrives at `/` with, answered above the fold.
//
// Phase 2 asks "what is moving, and what does consensus not see yet?" — and this is
// the densest page in the app by figure count: 420 numerals over 4 screens on
// 2026-07-30, against 232 on /mandate and 298 on /risk. Every one of those numerals
// is sourced and none is wrong; there were simply no four the page led with.
//
// THE SECOND HALF OF THE QUESTION IS THE HARD HALF, and card 3 is the only one that
// answers it. "What is moving" is a ranking — the heatmap and the conviction cards
// have always shown it. "What does consensus not see yet" is a claim about ABSENCE:
// a narrative rising in the un-themed corpus that no anchor theme is watching. That
// is what `covered_by IS NULL` means and what ADR-0146's detection plane calls the
// payload; it has been on the page since, as a filled mark among hollow ones, three
// screens down.
//
// WHAT THESE CARDS MAY NOT CLAIM. A HypeScore is attention x sentiment x correlation
// x momentum — it is not a return forecast and not a probability, so no card here may
// phrase a score as an expectation. The one honest reading of a high score is that a
// theme is LOUD, which is as likely to mean crowded as it is to mean early; card 1
// says exactly that and no more. ADR-0094 is why: HypeScore currently rests on a
// single provider, so "loud" is a statement about one corpus, not about the market.

import type { AnswerCard } from "@/components/AnswerRow";
import type { ConvictionTheme } from "@/components/ConvictionCard";
import type { NarrativeSeries } from "@/lib/narratives";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Highest measurable velocity — a phrase accelerating against its OWN history. */
function fastest(series: NarrativeSeries[]): NarrativeSeries | null {
  const measurable = series.filter((s) => isNum(s.latest.velocity));
  if (!measurable.length) return null;
  return measurable.reduce((hi, s) =>
    (s.latest.velocity as number) > (hi.latest.velocity as number) ? s : hi,
  );
}

/** Loudest phrase nothing is watching — ADR-0146's payload, by share. */
function uncovered(series: NarrativeSeries[]): NarrativeSeries | null {
  const orphans = series.filter((s) => s.latest.covered_by === null);
  if (!orphans.length) return null;
  return orphans.reduce((hi, s) => (s.latest.share > hi.latest.share ? s : hi));
}

export function alphaAnswerCards({
  themes,
  series,
  aboveThreshold,
  totalThemes,
  hypeGate,
  seriesError,
}: {
  themes: ConvictionTheme[];
  /** null while loading or when the read failed — `seriesError` tells them apart. */
  series: NarrativeSeries[] | null;
  aboveThreshold: number | null;
  totalThemes: number | null;
  hypeGate: number | null;
  seriesError: string | null;
}): AnswerCard[] {
  const scored = themes.filter((t) => isNum(t.hype_score));
  const loudest = scored.length
    ? scored.reduce((hi, t) => (t.hype_score > hi.hype_score ? t : hi))
    : null;

  // ── 1. What is loudest ────────────────────────────────────────────────────
  const loud: AnswerCard = {
    label: "Loudest theme",
    href: "#themes",
    source: "themes.hype_score",
    figure: loudest ? (
      <>
        {loudest.name}{" "}
        <span className="text-[13px] font-normal text-text-secondary">
          {loudest.hype_score.toFixed(1)}
        </span>
      </>
    ) : null,
    consequence: !loudest ? (
      <>
        No theme has a scored HypeScore for this run. A theme created between runs is
        null across every sub-score, and null is the absence of a score rather than a
        low one (ADR-0066).
      </>
    ) : (
      <>
        Attention x sentiment x correlation x momentum, not a return forecast. A high
        score means the theme is <em>loud</em>, which is as likely to be crowded as
        early — and it rests on one news provider (ADR-0094), so it describes a corpus
        rather than the market.
      </>
    ),
  };

  // ── 2. What is accelerating ───────────────────────────────────────────────
  const f = series ? fastest(series) : null;
  const rising: AnswerCard = {
    label: "Fastest riser",
    href: "#narratives",
    source: "narrative_signals.velocity",
    figure: f ? (
      <>
        {f.phrase}{" "}
        <span className="text-[13px] font-normal text-text-secondary">
          +{(f.latest.velocity as number).toFixed(2)}
        </span>
      </>
    ) : null,
    consequence: !series ? (
      seriesError ? (
        <>
          <code className="num">narrative_signals</code> could not be read
          ({seriesError}), so nothing can be said about what is accelerating.
        </>
      ) : (
        <>Still loading the narrative series.</>
      )
    ) : !f ? (
      <>
        {series.length} phrases are tracked and none has enough history for a velocity
        yet. Velocity is a robust z against a phrase&apos;s OWN past, so it is null
        rather than 0 until that past exists.
      </>
    ) : (
      <>
        Measured against its own history, not against the board — so this is a phrase
        breaking its own pattern rather than simply a loud one. {f.latest.days_observed}{" "}
        days observed, {(f.latest.share * 100).toFixed(1)}% share of the archive corpus.
      </>
    ),
  };

  // ── 3. What nothing is watching ───────────────────────────────────────────
  const u = series ? uncovered(series) : null;
  const orphan: AnswerCard = {
    label: "Watched by nothing",
    href: "#narratives",
    source: "narrative_signals.covered_by",
    tone: u ? "warning" : "default",
    figure: u ? (
      <>
        {u.phrase}{" "}
        <span className="text-[13px] font-normal text-text-secondary">
          {(u.latest.share * 100).toFixed(1)}%
        </span>
      </>
    ) : null,
    consequence: !series ? (
      <>Unknown until the narrative series loads.</>
    ) : !u ? (
      <>
        Every tracked phrase maps to an anchor theme, so on this corpus the nine themes
        cover what the news is about. That is a statement about today&apos;s archive,
        not a claim that nothing is missed.
      </>
    ) : (
      <>
        No anchor theme is asking about this, so nothing in the book can express it —
        the gap between what the corpus is about and what the pipeline watches. This is
        the detection plane&apos;s payload, and it is a candidate, not a position.
      </>
    ),
  };

  // ── 4. What the book had to choose from ───────────────────────────────────
  const gate: AnswerCard = {
    label: "Cleared the gate",
    href: "#themes",
    source: "themes.hype_score vs scoring_config.hype_score_threshold",
    tone: aboveThreshold === 0 ? "warning" : "default",
    figure:
      aboveThreshold === null || totalThemes === null ? null : (
        <>
          {aboveThreshold}/{totalThemes} themes
        </>
      ),
    consequence:
      aboveThreshold === null || totalThemes === null ? (
        <>The theme counts have not loaded, so the size of the pool is unknown.</>
      ) : aboveThreshold === 0 ? (
        <>
          Nothing cleared the {hypeGate ?? 50} HypeScore gate, so the book is built
          entirely from the ADR-0029 backfill and the ADR-0046 conviction override.
          Attention chose nothing today; conviction chose everything.
        </>
      ) : (
        <>
          Above the {hypeGate ?? 50} gate read from{" "}
          <code className="num">scoring_config</code>. Themes below it can still reach
          the book when a name&apos;s own EdgeScore is decisive — attention picks what
          we look at, it does not decide what is tradable (ADR-0046).
        </>
      ),
  };

  return [loud, rising, orphan, gate];
}
