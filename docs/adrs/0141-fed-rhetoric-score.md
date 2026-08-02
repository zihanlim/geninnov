# ADR-0141: A Fed rhetoric score, side-by-side with posture

**Status:** Live (vote-based; text-sentiment v2 deferred)
**Date:** 2026-08-02
**Related:** [ADR-0140](0140-hawkish-dovish-pivot-indicator.md), [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md), [ADR-0064](0064-one-formula-one-place.md)

## Context

ADR-0140's `fed_posture` is a measurement of the **market-implied** posture, derived from what DFF and the 2s10s curve have done over 13 weeks. It is silent on what the Fed itself is *saying*. On 2026-08-02 the system reads "Neutral" (DFF -1bp, 2s10s -6bp, both in dead band) while every press scan — Yardeni 7/10 Hawkish, Reuters "hawkish hold", RSM "tilt hawkish", Schwab "hawkish tune" — is calling the Fed hawkish. The two readings are about different signals, and a `/book` reader who sees only "Neutral" has to leave the page to recover the consensus call.

The interesting trade is not the label — it is the **gap** between what the Fed is *saying* and what the market is *pricing*. That gap is the tradeable signal: a Fed that talks hawkish while the curve flattens is a Fed the market does not believe. The current regime row has no way to surface that gap, and the L5 thesis guardrail (ADR-0012) has no column for the LLM to cite if it wanted to.

## Decision

Add a second reading, `fed_rhetoric`, alongside `fed_posture`. The two are deliberately *not* the same column with a different threshold: posture is market-implied (DFF + 2s10s), rhetoric is FOMC-self-reported (statement + vote). Same vocabulary ({dovish, neutral, hawkish}) on the card so a reader can compare at a glance, different inputs, different score.

### 1. The source: FOMC voting record (live-fetched from federalreserve.gov)

The simplest, most-auditable signal of Fed rhetoric is the **voting record of the most recent FOMC meeting**, which is published in the official press release on federalreserve.gov. The data is free, structured, and keyless — meeting the project's data posture.

Implemented as a live fetcher (`_fetch_all_fomc_meetings()` in `regime_classifier.py`): the FOMC calendar page is scraped for meeting dates, each recent press release is fetched and parsed with regex, and the result is cached to `backend/services/.fomc_meetings_cache.json` (24-hour TTL). On failure the disk cache is used; if that is also absent, `classify()` writes NULL — "no meeting recordable", never "neutral" (ADR-0091).

`fed_rhetoric_score` is computed from the dissents:

```
score = (hawkish_dissents − dovish_dissents) × 10 / voting_members
```

Range: −10 to +10. Encoded as REAL in the schema; NULL means "no meeting on or before run_date, OR meeting not yet ingested", not zero (ADR-0091).

**Mapping to the {dovish, neutral, hawkish} vocabulary** (Yardeni-style bands, hand-coded for the same reason the posture thresholds are hand-coded — auditable, round numbers, defensible):

| Score | Label |
|---|---|
| `score ≤ −5` | `strongly_dovish` |
| `−5 < score < −2` | `dovish` |
| `−2 ≤ score ≤ +2` | `neutral` |
| `+2 < score < +5` | `hawkish` |
| `score ≥ +5` | `strongly_hawkish` |

For the 2026-07-29 meeting (9-3, all three dissents hawkish, 12 voting members): `(3 − 0) × 10 / 12 = +2.5` → `hawkish`. That matches the consensus press read.

For the 2026-06-17 meeting (12-0 hold): `(0 − 0) × 10 / 12 = 0` → `neutral`. Note this is "neutral by the vote", NOT "neutral by the statement tone" — the June statement was hawkish by text, the dissent count happens to be zero. The discrepancy between vote-based and text-based scoring is a known limitation of v1; the v2 plan addresses it.

### 2. What v1 deliberately does NOT measure

The press consensus ("hawkish hold") is driven by three things: vote, statement text, and press-conference tone. v1 measures **only the vote**. The June 17 statement was scored 7/10 Hawkish by Yardeni despite a 12-0 vote; v1 will read that as `neutral` because there are no dissents. This is a known false-negative for any meeting where the chair's text and the committee's vote disagree, and it is disclosed in the evidence blob and the UI.

The v2 plan is a lightweight lexicon-based sentiment score over the FOMC statement + minutes, on the same -10 to +10 scale, with a clear hand-coded keyword list. The two scores (vote-based, text-based) become a second gap metric. That is a future ADR.

### 3. The schema change

```sql
-- 054_fed_rhetoric_score.sql
ALTER TABLE regime_classifications
    ADD COLUMN fed_rhetoric_score REAL
        CHECK (fed_rhetoric_score IS NULL
            OR (fed_rhetoric_score >= -10 AND fed_rhetoric_score <= 10)),
    ADD COLUMN fed_rhetoric_label TEXT
        CHECK (fed_rhetoric_label IS NULL
            OR fed_rhetoric_label IN
                ('strongly_dovish','dovish','neutral','hawkish','strongly_hawkish')),
    ADD COLUMN fed_rhetoric_evidence JSONB;
```

Three columns: the numeric score, the band label, and the evidence JSONB. The label is a derived field of the score; persisting both is a deliberate redundancy (a reader rendering the card reads the label, a reader interrogating the threshold reads the score, neither needs to derive the other at query time).

### 4. The evidence blob

```json
{
  "source": "FOMC press release",
  "meeting_date": "2026-07-29",
  "as_of": "2026-08-02",
  "vote": { "for": 9, "against": 3, "voting_members": 12 },
  "dissents": [
    { "voter": "Daly (San Francisco)", "direction": "hawkish", "preferred_action": "hike 25bp" },
    { "voter": "Logan (Dallas)", "direction": "hawkish", "preferred_action": "hike 25bp" },
    { "voter": "Kashkari (Minneapolis)", "direction": "hawkish", "preferred_action": "hike 25bp" }
  ],
  "scoring": {
    "formula": "(hawkish_dissents - dovish_dissents) * 10 / voting_members",
    "raw_score": 2.5,
    "thresholds": {
      "strongly_dovish_max": -5,
      "dovish_max": -2,
      "neutral_max": 2,
      "hawkish_min": 5
    }
  }
}
```

The full dissent list is included so a reader can answer "who dissented, and in which direction" without a second round-trip to federalreserve.gov. The thresholds are in the blob so the published number justifies the published label (the ADR-0140 discipline, applied to a payload).

### 5. The UI change

A new line in the existing posture card, between the "DFF/2s10s inputs" line and the raw-inputs footnote:

```
Fed posture
HAWKISH  ↓ flattening
Pivot +1: Hawkish → Neutral
DFF -1 bp / 13w · 2s10s -6 bp / 13w · now +45 bp
Rhetoric: HAWKISH (+2.5) · 3 dissents ← NEW
Inputs: DFF 3.63% · 2y 4.23% · 10y 4.68%
```

The gap surfaces naturally: when `posture=neutral` and `rhetoric=hawkish`, the reader sees the Fed talking hawkish while the curve is range-bound. When both agree (e.g. `posture=hawkish`, `rhetoric=strongly_hawkish`), the reader sees conviction. When they disagree (`posture=dovish`, `rhetoric=hawkish`), the reader sees the Fed and the market in open conflict.

NULL semantics: a missing rhetoric score renders as "—" with the meeting absence named (ADR-0091), same as posture.

### 6. Shadow mode

14 days, same structure as ADR-0140 §5 and ADR-0139 §5. The shadow tests assert: (a) score is one of the five labels when the meeting is ingestible, (b) NULL when no meeting exists on or before run_date, (c) score formula matches the evidence blob to the basis point, (d) the label band matches the score against the documented thresholds. The columns join ADR-0139/0140 on the L5 snapshot exclusion list during the shadow — `q1_agent` reads the regime row with `select("*")`, so without an exclusion a published thesis could cite a rhetoric the harness has not yet passed (ADR-0100).

After 14 days: lift is one coordinated change, same as ADR-0140 — snapshot exclusion removed, one line added to the L5 prompt ("if you claim the Fed is hawkish, cite `regime:fed_rhetoric_label`; if N/A, you may not make that claim"), `verify_citations` extended to the new key.

## Consequences

- **One new column set on the regime row.** Same footprint as ADR-0140 (six columns, then three). The two readings live side-by-side on the card; the page reader can compare them.
- **v1 is vote-based, not text-based.** It will understate rhetoric at meetings where the chair is hawkish but the committee votes unanimously (e.g. June 17). The under-statement is disclosed in the evidence blob and the UI footnote. v2 fixes it.
- **The dissent direction (hawkish vs dovish) is hand-classified from the press release.** Each dissent is read as "would have preferred [hike | cut]" and bucketed. The classification is auditable (the press release is the source) but it is human judgement, not a numeric signal. A future ADR can introduce a structured source (e.g. a hand-coded dissent table maintained alongside the fetcher) if this proves a bottleneck.
- **The thresholds are round numbers, hand-coded, and live in the evidence blob.** Same precedent as ADR-0140 — the round numbers survive a meeting and a fitted threshold is not auditable.
- **The gap between posture and rhetoric is the tradeable signal, not the labels themselves.** The card surfaces the gap visually; an LLM reading the regime row can compute it numerically (`fed_rhetoric_score − fed_posture_signed × 10`). A reader who wants the gap framed for them is pointed at `fed_rhetoric_evidence`; the headline is the two labels.
- **The shadow runs even though the source is fully auditable.** Same reasoning as ADR-0140's postscript: shape, NULL semantics, formula consistency, and threshold consistency need a 14-day window to surface bugs the design didn't anticipate. Lift is one coordinated change at the end.
- **The score is computed on the most recent meeting on or before run_date, not "today's FOMC."** Same as-of discipline as every other L0 read: a row stamped run_date=2026-08-02 reads the 2026-07-29 meeting, not whatever meeting is later in the calendar.
- **The card does NOT collapse posture and rhetoric into a single "is the Fed hawkish?" answer.** The two readings are presented side by side, with the gap visible. The premise of this ADR is that the gap is the information, and collapsing it would lose that.

## Alternatives considered

- **Pull from Yardeni / CentralBank.Watch Hawkometer as a third-party data source.** Rejected for the same reason ADR-0140 rejected FedWatch: scraping is a ToS-fragile dependency under a nightly publication, and the project's data posture is "free, keyless, or free-with-a-key." federalreserve.gov press releases are none of those, and they are the *source* the third-party services derive from — going direct is the more honest dependency.
- **Score the FOMC statement + minutes with a lexicon-based sentiment.** Considered, deferred to v2. The lexicon itself is non-trivial work (which words are hawkish? "resolute" or "patient"? "elevated" or "moderating"?) and a v1 with the right shape is more useful than a v2 that ships a year later. v1 ships; v2 extends the same column with a second score field (`fed_rhetoric_text_score`) and reports both.
- **Replace `fed_posture` with rhetoric.** Rejected — posture is market-implied, rhetoric is FOMC-self-reported; they are different sensors. The whole point of this ADR is to surface the gap, not collapse it.
- **Reuse `cycle` to encode rhetoric.** Rejected — `cycle` is the business-cycle reading (early/mid/late/recession), with a four-value vocabulary chosen for cycle. Conflating cycle with rhetoric is the same class of error ADR-0140 rejected for posture.
- **Add the gap as a single derived column.** Rejected — the gap is reader-derivable from `fed_posture` and `fed_rhetoric_score`, and a derived column would be the second-implementation-of-the-formula trap (ADR-0064). The card shows the two columns side by side; the reader computes the gap.
- **Use the dot plot as the rhetoric signal.** Considered, deferred. The dot plot is a SEP release (four per year), too sparse to be a daily-reading signal. v1 reads the meeting vote; v2 might add a quarterly dot-plot cross-check.
- **Hardcode recent FOMC meetings in Python.** An earlier cut kept the `FOMC_MEETINGS` dict as a hand-maintained table, updated per PR after each meeting. That was the accepted interim state; the live fetcher (above) supersedes it.
