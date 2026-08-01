// Versus what — measured, not drawn.
//
// ADR-0094 built `benchmark_returns` so /risk could answer "versus what?", and the answer
// it could give was a second line on the drawdown chart. Two curves is the PICTURE of
// relative performance; it is not the measurement. A reader who can see the book beat the
// index by 2% still cannot tell whether that came from taking more risk, a different risk,
// or skill.
//
// DOWN-CAPTURE IS THE ONE THAT MATTERS HERE, and it is why this panel exists rather than
// three more tiles. This book's central claim is that it is market-neutral-to-short. A book
// that rises when the benchmark falls captures LESS THAN NONE of a fall — a negative
// down-capture. That is a falsifiable version of the claim, and until now nothing on the
// site tested it.
//
// Tracking error and the information ratio are annualised ratios of the same family as
// Sharpe and share its 60-session floor (ADR-0100).
//
// THE DENOMINATOR IS THE OVERLAP, NOT THE BOOK'S OWN HISTORY (ADR-0213). This header
// used to claim "everything is gated by MIN_SESSIONS_BY_FIELD like every other
// estimate", and three things on the panel were not gated at all — beta, up-capture and
// down-capture. The gates that did exist read the book's `sessions`, so the card printed
// "Measured over the 5 sessions the two series share" above "7 sessions of return
// history, needs 60": two denominators, both called sessions, nothing distinguishing
// them. A benchmark statistic is bounded by the OVERLAP, which is what the backend's own
// `sufficient` flag has always used (`n >= MIN_OBS_FOR_STATISTICS` in
// benchmark_compare.py) and what this panel now reads.
//
// The capture ratios are gated on their OWN denominator — up_days / down_days — because
// neither is a function of the overlap. A down-capture over one down day is one session
// described, however many sessions the two series share.

"use client";

import type { BenchmarkComparisonRow, ConditionalVolRow } from "@/lib/risk/analytics";
import { sampleAdequacy } from "@/lib/risk/sampleAdequacy";
import { describeDownCapture, MIN_CAPTURE_DAYS } from "@/lib/risk/benchmarkReading";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;

/**
 * A label/value line, or — when the value is withheld — a label with the reason
 * beneath it.
 *
 * THE TWO LAYOUTS ARE NOT COSMETIC. The value slot is `whitespace-nowrap`, which is
 * right for `−0.83%` and catastrophic for a sentence: a withheld reason put there
 * refuses to wrap, takes the width it wants, and squeezes the `min-w-0` label column
 * to nothing — which rendered "Tracking error" and "Information ratio" one word per
 * line with the reason overlapping them. It had been doing that to those two rows
 * since the gates were added; gating beta (ADR-0213) made it three and made it
 * obvious. A withheld reason is prose about the row, so it goes under the row.
 */
function Row({
  label,
  children,
  hint,
  withheld,
}: {
  label: string;
  children?: React.ReactNode;
  hint?: string;
  /** When present, the row renders as a withheld statement and `children` is ignored. */
  withheld?: string;
}) {
  if (withheld) {
    return (
      <div className="py-1.5 border-b border-border last:border-b-0">
        <span className="text-text-secondary text-[12px]">{label}</span>
        {hint && (
          <div className="text-[10.5px] text-text-tertiary leading-[1.45] mt-0.5">{hint}</div>
        )}
        <div className="text-[10.5px] text-text-tertiary leading-[1.45] mt-1 [text-wrap:pretty]">
          {withheld}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-4 items-baseline py-1.5 border-b border-border last:border-b-0">
      <div className="min-w-0">
        <span className="text-text-secondary text-[12px]">{label}</span>
        {hint && (
          <div className="text-[10.5px] text-text-tertiary leading-[1.45] mt-0.5">{hint}</div>
        )}
      </div>
      <span className="num text-[12px] text-right whitespace-nowrap">{children}</span>
    </div>
  );
}

/**
 * The withheld reason, reworded for THIS panel's denominator.
 *
 * `sampleAdequacy` stays the single source of the THRESHOLD (ADR-0100 — the whole
 * point is that /ask, MCP and the pages cannot disagree about 60). Its stock wording
 * says "sessions of return history", which is the book's own series; here the bound
 * is the OVERLAP, and printing "5 sessions of return history" under a heading that
 * just said "the 5 sessions the two series share" invites a reader to think they are
 * two different fives. Local noun, central number.
 */
function overlapReason(sessions: number, needs: number): string {
  return (
    `${sessions} overlapping session${sessions === 1 ? "" : "s"} with the benchmark, ` +
    `needs ${needs}. A figure from this sample is noise, so it is not published.`
  );
}

/**
 * The capture pair, as two bars diverging from a shared zero.
 *
 * WHY A CHART AND NOT TWO MORE ROWS. Capture's job is POLARITY — which side of zero,
 * and how far — and "−28.9%" in a list of stats reads as a magnitude with a stray
 * minus. The claim this panel exists to test ("the book rose while the benchmark
 * fell") IS a sign, so the sign should be the geometry: a bar left of the zero rule
 * means the book moved against the benchmark, and you read it before you read the
 * number.
 *
 * WHY NO --long / --short. Design goal 3 fences those to book direction, and is
 * explicit that a colour keyed to a VERDICT rather than to a sign is not covered by
 * the signed-value exemption. Capture is a verdict. The previous version tinted
 * down-capture `--long` when it was negative, which is that fence crossed — a
 * "good news" green wearing the ink that means LONG. The sign is carried by which
 * side of zero the bar sits on, so no colour has to mean anything, and one
 * `--series-1` mark (the validated first categorical slot, the highest-contrast of
 * the five) serves both bars. Same argument the palette's own comment makes about
 * why narratives may not borrow direction hues.
 *
 * The 100% tick is the reference that makes the axis readable: it is where the book
 * matched the benchmark's move exactly. Without it a reader has no anchor for
 * whether −28.9% is far from normal.
 */
function CaptureChart({
  up,
  upDays,
  down,
  downDays,
}: {
  up: number | null;
  upDays: number;
  down: number | null;
  downDays: number;
}) {
  const bars = [
    {
      key: "up",
      label: "Up-capture",
      value: up,
      days: upDays,
      /** What the sign MEANS, spelled out per bar — symmetric between the two.
       *  Only down-capture's negative case was ever explained, so the panel
       *  narrated its good news and left −28.9% up-capture to be inferred. */
      reading:
        up === null
          ? null
          : up < 0
            ? "the book FELL while the benchmark rose"
            : up < 1
              ? "the book rose less than the benchmark"
              : "the book rose at least as much",
    },
    {
      key: "down",
      label: "Down-capture",
      value: down,
      days: downDays,
      reading:
        down === null
          ? null
          : down < 0
            ? "the book ROSE while the benchmark fell"
            : down < 1
              ? "the book fell less than the benchmark"
              : "the book fell at least as hard",
    },
  ];

  const measured = bars.filter((b) => b.value !== null);
  if (measured.length === 0) return null;

  // Symmetric domain around zero, so the zero rule sits where the eye expects and the
  // two bars stay comparable at a glance.
  //
  // The ×1.15 is what makes the 100% tick VISIBLE. At a bare `Math.max(1, …)` the
  // domain ends exactly at ±100%, so the reference rule is drawn at `left: 100%` —
  // on the track's own border, indistinguishable from it. The caption names that
  // rule, and a caption naming a mark the reader cannot find is worse than no
  // caption. Padding the domain puts it inside the canvas at ~93%.
  const extent =
    Math.max(1, ...measured.map((b) => Math.abs(b.value as number))) * 1.15;
  const pos = (v: number) => 50 + (v / extent) * 50;   // → % of track width

  return (
    <figure
      className="m-0 mb-3 border-t border-border pt-2.5"
      data-testid="capture-chart"
    >
      <figcaption className="text-[11.5px] text-text-secondary mb-2">
        Capture, against the benchmark&rsquo;s own move
      </figcaption>

      <div className="flex flex-col gap-2.5">
        {bars.map((b) => {
          const v = b.value;
          const thin = b.days > 0 && b.days < MIN_CAPTURE_DAYS;
          return (
            <div key={b.key}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[11.5px] text-text-secondary">
                  {b.label}{" "}
                  <span className="text-text-tertiary">
                    · {b.days} {b.days === 1 ? "day" : "days"}
                  </span>
                </span>
                <span className="num text-[12px] text-text-primary">
                  {v === null ? "—" : `${(v * 100).toFixed(1)}%`}
                </span>
              </div>

              {v === null ? (
                <p className="m-0 text-[10.5px] text-text-tertiary leading-[1.45]">
                  No {b.key} days in the shared sample.
                </p>
              ) : (
                <>
                  <div
                    className="relative h-3.5 w-full rounded-sm bg-bg-elevated border border-border overflow-hidden"
                    role="img"
                    aria-label={`${b.label} ${(v * 100).toFixed(1)} percent over ${b.days} ${b.days === 1 ? "day" : "days"} — ${b.reading}${thin ? ", too few days for a verdict" : ""}`}
                    title={`${b.reading}. Measured over ${b.days} ${b.days === 1 ? "day" : "days"}.`}
                  >
                    {/* The 100% reference — where the book matched the benchmark. */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-border-strong"
                      style={{ left: `${pos(1)}%` }}
                      aria-hidden="true"
                    />
                    {/* The bar, anchored to zero and growing to whichever side the
                        sign puts it. 4px rounded on the DATA end only; the zero end
                        stays square against the rule it grows from. */}
                    <div
                      className="absolute top-[3px] bottom-[3px] bg-[var(--series-1)]"
                      style={{
                        left: `${Math.min(pos(0), pos(v))}%`,
                        width: `${Math.abs(pos(v) - pos(0))}%`,
                        borderTopLeftRadius: v < 0 ? 4 : 0,
                        borderBottomLeftRadius: v < 0 ? 4 : 0,
                        borderTopRightRadius: v > 0 ? 4 : 0,
                        borderBottomRightRadius: v > 0 ? 4 : 0,
                        // Thin samples are drawn hollow rather than recoloured: the
                        // mark still shows where the value sits, and the fill — the
                        // thing that reads as "measured" — is what it loses.
                        opacity: thin ? 0.45 : 1,
                      }}
                    />
                    {/* Zero, drawn OVER the bar so the anchor is never hidden. */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-text-tertiary"
                      style={{ left: `${pos(0)}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="m-0 mt-1 text-[10.5px] text-text-tertiary leading-[1.45]">
                    {b.reading}
                    {thin && ` — ${b.days} ${b.days === 1 ? "day" : "days"}, below the ${MIN_CAPTURE_DAYS} a verdict needs`}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="m-0 mt-2 text-[10px] text-text-tertiary leading-[1.45]">
        Zero is the darker rule; the lighter one is 100% — where the book matched the
        benchmark&rsquo;s move exactly. Left of zero, the book moved the other way.
      </p>
    </figure>
  );
}

export default function BenchmarkComparison({
  comparison,
  conditionalVol,
  sessions,
}: {
  comparison?: BenchmarkComparisonRow | null;
  conditionalVol?: ConditionalVolRow | null;
  sessions: number | null;
}) {
  // The OVERLAP, not the book's own history. A benchmark statistic cannot be better
  // sampled than the sessions the two series actually share, and `sessions` (7 live)
  // exceeding `n` (5 live) made the card print two different denominators. Falls back
  // to `sessions` only when the payload predates `n`, so an old row is judged as
  // before rather than going unjudged.
  const shared = isNum(comparison?.n) ? comparison!.n! : sessions;
  const teGate = sampleAdequacy("tracking_error", shared);
  const irGate = sampleAdequacy("information_ratio", shared);
  // ADR-0063 ruled that ONE sample bar governs beta on every surface, and its
  // consequences named the risk: "Any fourth surface that renders a beta must read
  // MIN_SESSIONS too." This panel was that fourth surface, and it published a beta
  // beside two figures withheld on the same sample.
  const betaGate = sampleAdequacy("beta", shared);

  // Three distinct absences, and the page must not collapse them (ADR-0098):
  //   null column            — the run predates the feature
  //   computed: false        — it RAN and said why it could not compare
  //   computed, no overlap   — handled inside the payload
  // The middle one is the live case: on 2026-07-27 the benchmark series had one usable
  // daily return against the book's four, because inception carries a null return.
  const uncomputed = comparison && comparison.computed === false;
  if ((!comparison || uncomputed) && !conditionalVol) {
    return (
      <section className="card p-4" aria-label="Versus the benchmark" data-testid="benchmark-comparison">
        <h3 className="text-[13px] font-semibold mb-1">Versus the benchmark</h3>
        <p className="text-[11.5px] text-text-tertiary leading-[1.55]">
          {uncomputed && comparison?.reason
            ? `No comparison yet — ${comparison.reason}`
            : "Not recorded for this run: it predates the column that stores it. That is not a statement that the book tracked its benchmark."}
        </p>
      </section>
    );
  }

  const down = comparison?.down_capture;
  const downReading = describeDownCapture(down, comparison?.down_days);
  const up = comparison?.up_capture;

  return (
    <section className="card p-4" aria-label="Versus the benchmark" data-testid="benchmark-comparison">
      <h3 className="text-[13px] font-semibold mb-1">Versus the benchmark</h3>
      {/* Only claim a measurement when one happened. With no comparison but a conditional
          vol block, this panel still renders — and the intro used to read "Measured over
          the — sessions the two series share", asserting a measurement with an em-dash
          where its own denominator should be. Caught by looking at the page; no test
          asserted the prose. */}
      <p className="text-[11.5px] text-text-tertiary leading-[1.55] mb-3">
        {isNum(comparison?.n) && !uncomputed ? (
          <>
            The drawdown chart draws the comparison; these are the numbers behind it.
            Measured over the {comparison!.n} sessions the two series share
            {comparison?.as_of ? `, to ${comparison.as_of}` : ""}.
          </>
        ) : uncomputed && comparison?.reason ? (
          <>No comparison yet — {comparison.reason}</>
        ) : (
          <>
            No benchmark comparison for this run. The volatility figures below are computed
            from the book&rsquo;s own series and do not depend on it.
          </>
        )}
      </p>

      {comparison && !uncomputed && (
        <div className="mb-3">
          <Row label="Active return" hint="Book minus benchmark, compounded from a shared origin.">
            {isNum(comparison.active_return) ? signedPct(comparison.active_return) : "—"}
          </Row>
          <Row
            label="Tracking error"
            hint="Annualised volatility of the active return. How far the book roams from the index."
            withheld={teGate.ok ? undefined : overlapReason(teGate.sessions, teGate.needs)}
          >
            {isNum(comparison.tracking_error) ? pct(comparison.tracking_error) : "—"}
          </Row>
          <Row
            label="Information ratio"
            hint="Active return per unit of tracking error."
            withheld={irGate.ok ? undefined : overlapReason(irGate.sessions, irGate.needs)}
          >
            {isNum(comparison.information_ratio) ? (
              comparison.information_ratio.toFixed(2)
            ) : (
              <span className="text-text-tertiary">undefined at zero tracking error</span>
            )}
          </Row>
          <Row
            label="Beta to benchmark"
            hint="Not the FF5 market beta — this is against the reference series."
            withheld={betaGate.ok ? undefined : overlapReason(betaGate.sessions, betaGate.needs)}
          >
            {isNum(comparison.beta) ? comparison.beta.toFixed(2) : "—"}
          </Row>
        </div>
      )}

      {/* The capture pair moved out of the stat list and into its own figure: its job
          is polarity, which a right-aligned number in a row cannot show. */}
      {comparison && !uncomputed && (
        <CaptureChart
          up={isNum(up) ? up : null}
          upDays={comparison.up_days ?? 0}
          down={isNum(down) ? down : null}
          downDays={comparison.down_days ?? 0}
        />
      )}

      {downReading && (
        <p
          className="text-[11px] leading-[1.55] mb-3 text-text-secondary"
          data-testid="down-capture-reading"
          data-verdict={downReading.verdict}
        >
          {downReading.text}
        </p>
      )}

      {conditionalVol && (
        <div className="border-t border-border pt-2.5">
          <div className="text-[11.5px] text-text-secondary mb-1">Volatility, three ways</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-text-tertiary">
            {isNum(conditionalVol.sample_annualised_vol) && (
              <span>trailing sample <span className="num">{pct(conditionalVol.sample_annualised_vol)}</span></span>
            )}
            {isNum(conditionalVol.ewma?.annualised_vol) && (
              <span>EWMA <span className="num">{pct(conditionalVol.ewma!.annualised_vol!)}</span></span>
            )}
            {/* NO NUMBER FROM A FIT THAT DID NOT HAPPEN (design goal 2).
                `garch11` degrades to `ewma_volatility` below MIN_OBS_FOR_GARCH and
                returns it with `converged=False` and a warning that says, in as many
                words, "returned the EWMA vol, not a GARCH fit". This panel printed
                that number under a GARCH(1,1) label and footnoted the failure at the
                end of a paragraph — which is why the live card read EWMA 9.64% and
                GARCH(1,1) 9.64%, the same figure twice, one of them mislabelled.
                An em-dash plus the backend's own stated reason is the honest render. */}
            {conditionalVol.garch?.converged === false ? (
              <span>
                GARCH(1,1) <span className="num text-text-tertiary">—</span>
              </span>
            ) : (
              isNum(conditionalVol.garch?.annualised_vol) && (
                <span>GARCH(1,1) <span className="num">{pct(conditionalVol.garch!.annualised_vol!)}</span></span>
              )
            )}
          </div>
          <p className="text-[10.5px] text-text-tertiary leading-[1.5] mt-1.5">
            The trailing sample weights a shock 200 sessions ago as heavily as yesterday;
            EWMA and GARCH say what volatility is <em>now</em>. Shown for comparison only —
            position sizing still uses the trailing sample vol, because changing the
            conviction denominator would move every published weight and is a separate
            decision.
            {conditionalVol.garch?.converged === false && (
              <>
                {" "}
                <span data-testid="garch-not-converged">
                  No GARCH figure is shown:{" "}
                  {conditionalVol.garch?.warnings?.[0] ??
                    "the fit did not converge on this sample"}
                  .
                </span>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
