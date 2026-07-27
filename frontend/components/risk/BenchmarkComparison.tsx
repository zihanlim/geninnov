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
// Everything is gated by `MIN_SESSIONS_BY_FIELD` like every other estimate: tracking error
// and the information ratio are annualised ratios of the same family as Sharpe and share
// its 60-session floor (ADR-0100).

"use client";

import type { BenchmarkComparisonRow, ConditionalVolRow } from "@/lib/risk/analytics";
import { sampleAdequacy } from "@/lib/risk/sampleAdequacy";
import { describeDownCapture } from "@/lib/risk/benchmarkReading";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
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

function Withheld({ reason }: { reason: string }) {
  return (
    <span className="text-[10.5px] text-text-tertiary leading-[1.4] font-normal">
      {reason}
    </span>
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
  const teGate = sampleAdequacy("tracking_error", sessions);
  const irGate = sampleAdequacy("information_ratio", sessions);

  // Three distinct absences, and the page must not collapse them (ADR-0098):
  //   null column            — the run predates the feature
  //   computed: false        — it RAN and said why it could not compare
  //   computed, no overlap   — handled inside the payload
  // The middle one is the live case: on 2026-07-27 the benchmark series had one usable
  // daily return against the book's four, because inception carries a null return.
  const uncomputed = comparison && comparison.computed === false;
  if ((!comparison || uncomputed) && !conditionalVol) {
    return (
      <section className="panel p-4" aria-label="Versus the benchmark" data-testid="benchmark-comparison">
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
    <section className="panel p-4" aria-label="Versus the benchmark" data-testid="benchmark-comparison">
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
          >
            {!teGate.ok ? (
              <Withheld reason={teGate.reason} />
            ) : isNum(comparison.tracking_error) ? (
              pct(comparison.tracking_error)
            ) : (
              "—"
            )}
          </Row>
          <Row label="Information ratio" hint="Active return per unit of tracking error.">
            {!irGate.ok ? (
              <Withheld reason={irGate.reason} />
            ) : isNum(comparison.information_ratio) ? (
              comparison.information_ratio.toFixed(2)
            ) : (
              <span className="text-text-tertiary">undefined at zero tracking error</span>
            )}
          </Row>
          <Row label="Beta to benchmark" hint="Not the FF5 market beta — this is against the reference series.">
            {isNum(comparison.beta) ? comparison.beta.toFixed(2) : "—"}
          </Row>
          <Row
            label="Up-capture"
            hint={`Share of the benchmark's rise the book caught, over its ${comparison.up_days ?? 0} up days.`}
          >
            {isNum(up) ? pct(up, 1) : <span className="text-text-tertiary">no up days in sample</span>}
          </Row>
          <Row
            label="Down-capture"
            hint={`Over its ${comparison.down_days ?? 0} down days. Below zero means the book ROSE when the benchmark fell.`}
          >
            {isNum(down) ? (
              <span style={{ color: down < 0 ? "var(--long)" : down > 1 ? "var(--short)" : undefined }}>
                {pct(down, 1)}
              </span>
            ) : (
              <span className="text-text-tertiary">no down days in sample</span>
            )}
          </Row>
        </div>
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
            {isNum(conditionalVol.garch?.annualised_vol) && (
              <span>GARCH(1,1) <span className="num">{pct(conditionalVol.garch!.annualised_vol!)}</span></span>
            )}
          </div>
          <p className="text-[10.5px] text-text-tertiary leading-[1.5] mt-1.5">
            The trailing sample weights a shock 200 sessions ago as heavily as yesterday;
            EWMA and GARCH say what volatility is <em>now</em>. Shown for comparison only —
            position sizing still uses the trailing sample vol, because changing the
            conviction denominator would move every published weight and is a separate
            decision.
            {conditionalVol.garch?.converged === false && (
              <> The GARCH fit did not converge on this sample.</>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
