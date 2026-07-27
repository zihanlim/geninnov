// frontend/components/book/SizingProvenance.tsx
//
// WHICH sizing produced this book, and what the other one would have done.
//
// ADR-0053 records a published book that every surface described as
// conviction-sized while it was in fact hype-sized. Nothing in the data said which
// path had run, so nothing on the page could be wrong about it in a way a reader
// could catch. `sizing_method` is now persisted, and this panel is the surface that
// makes it legible — including, and especially, when the optimizer did NOT run.
//
// The comparison column is the point. A reader told "the optimizer sized this" learns
// almost nothing; a reader shown the conviction book beside it, with the delta and
// what the move costs, can see what the judgement was worth. That is why
// `heuristic_weights` is persisted whether or not it was published (ADR-0107).

"use client";

import type { OptimizerResult, SizingMethod } from "@/lib/book/sizingProvenance";
import {
  describeCrowding,
  describeSizing,
  frontierPath,
  sizingRows,
} from "@/lib/book/sizingProvenance";

function Num({
  value,
  digits = 2,
  suffix = "%",
  signed = false,
  muted = false,
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  signed?: boolean;
  muted?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="num text-text-tertiary">n/a</span>;
  }
  const shown = suffix === "%" ? value * 100 : value;
  const sign = signed && shown > 0 ? "+" : "";
  return (
    <span
      className="num"
      style={muted ? { color: "var(--text-tertiary)" } : undefined}
    >
      {sign}
      {shown.toFixed(digits)}
      {suffix}
    </span>
  );
}

export default function SizingProvenance({
  method,
  reason,
  result,
  frontier,
  heuristicWeights,
  rebalanceCost,
}: {
  method: SizingMethod | null;
  reason: string | null;
  result: OptimizerResult | null;
  frontier: unknown;
  heuristicWeights: Record<string, number> | null;
  rebalanceCost: { total_cost?: number; turnover?: number } | null;
}) {
  const summary = describeSizing(method, reason, result);
  const rows = sizingRows(result, heuristicWeights);
  const path = frontierPath(frontier);
  const crowding = describeCrowding(result?.crowding);

  return (
    <div data-testid="sizing-provenance">
      {/* The method, stated before any number. A reader who reads nothing else
          should still leave knowing which model sized the book they are looking at. */}
      <div
        className="rounded-md px-3 py-2.5 mb-3 border text-[11.5px] leading-[1.55]"
        style={{
          borderColor:
            summary.tone === "fallback" ? "var(--warning)" : "var(--border)",
          background:
            summary.tone === "fallback"
              ? "rgba(210, 153, 34, 0.08)"
              : "var(--bg-elevated)",
          color:
            summary.tone === "fallback"
              ? "var(--warning)"
              : summary.tone === "unrecorded"
                ? "var(--text-tertiary)"
                : "var(--text-secondary)",
        }}
        data-testid="sizing-method-banner"
        data-tone={summary.tone}
      >
        <strong>{summary.headline}</strong> {summary.detail}
      </div>

      {rows.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden mb-3">
          <div
            className="grid px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-text-tertiary border-b border-border"
            style={{ gridTemplateColumns: "1fr auto auto auto" }}
          >
            <span>Position</span>
            <span className="text-right pl-3">Conviction</span>
            <span className="text-right pl-3">Optimizer</span>
            <span className="text-right pl-3">Delta</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.asset}
              className="grid px-3 py-1.5 text-[12px] border-b border-border last:border-b-0 items-baseline"
              style={{ gridTemplateColumns: "1fr auto auto auto" }}
            >
              <span className="text-text-secondary">
                {row.asset}
                {row.zeroed && (
                  // ADR-0058: an empty slot owes an explanation.
                  <span className="text-text-tertiary text-[10.5px] ml-1.5">
                    priced out
                  </span>
                )}
              </span>
              <span className="text-right pl-3">
                <Num value={row.heuristic} signed muted />
              </span>
              <span className="text-right pl-3">
                <Num value={row.optimizer} signed />
              </span>
              <span
                className="text-right pl-3"
                style={{
                  color:
                    row.delta === null
                      ? undefined
                      : row.delta > 0
                        ? "var(--long)"
                        : row.delta < 0
                          ? "var(--short)"
                          : "var(--text-tertiary)",
                }}
              >
                <Num value={row.delta} signed />
              </span>
            </div>
          ))}
        </div>
      )}

      {result?.feasible && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] mb-3">
          <span className="text-text-secondary">Gross deployed</span>
          <span className="text-right">
            <Num value={result.gross} />
          </span>
          <span className="text-text-secondary">Held in cash</span>
          <span className="text-right">
            <Num value={result.cash} />
          </span>
          <span className="text-text-secondary">Ex-ante volatility</span>
          <span className="text-right">
            <Num value={result.volatility} />
          </span>
          <span className="text-text-secondary">Expected return (annualised)</span>
          <span className="text-right">
            <Num value={result.expected_return} digits={3} signed />
          </span>
          {rebalanceCost?.turnover !== undefined && (
            <>
              <span className="text-text-secondary">Turnover vs conviction book</span>
              <span className="text-right">
                <Num value={rebalanceCost.turnover} digits={1} />
              </span>
              <span className="text-text-secondary">Estimated cost of that move</span>
              <span className="text-right num">
                {typeof rebalanceCost.total_cost === "number" &&
                Number.isFinite(rebalanceCost.total_cost)
                  ? rebalanceCost.total_cost.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })
                  : "n/a"}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Crowding, the third sizing input (ADR-0110) ─────────────────────
             Coverage is rendered whether or not anything was tightened, and it is
             rendered FIRST. "Nothing was crowded" and "almost nothing could be
             checked" are the two readings a reader has to be able to tell apart,
             and a verdict without its denominator lets the second read as the
             first — GOAL.md's constraint, stated at the point of use. */}
      {crowding && (
        <div
          className="rounded-md border border-border px-3 py-2.5 mb-3 text-[11.5px] leading-[1.55]"
          data-testid="crowding-sizing"
        >
          <div className="text-text-secondary mb-1">
            <strong>Crowding.</strong> {crowding.coverage}
          </div>
          <div className="text-text-tertiary">{crowding.verdict}</div>
          {crowding.tightened.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 list-none p-0 m-0">
              {crowding.tightened.map((t) => (
                <li key={t.asset} className="text-text-secondary">
                  <span className="num">{t.asset}</span> — book{" "}
                  {t.direction ?? "?"}
                  {t.inverse ? (
                    <>
                      , which is <span className="num">{t.effective_side}</span> the
                      contract (inverse product)
                    </>
                  ) : null}
                  ; specs crowded {t.crowded_side} at{" "}
                  <span className="num">
                    {typeof t.cot_index === "number" ? t.cot_index.toFixed(0) : "—"}
                  </span>
                  . Capped at <span className="num">{(t.cap * 100).toFixed(1)}%</span>.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.binding_constraints && result.binding_constraints.length > 0 && (
        <div className="text-[11px] text-text-tertiary leading-[1.5] mb-3">
          Binding at the solution: {result.binding_constraints.join("; ")}. These are
          the limits that actually decided the sizes — everything else had headroom.
        </div>
      )}

      {/* The frontier, with "you are here". A frontier on its own is decoration; the
          only question a reader has is where this book sits against it. */}
      {/* The svg is capped near its natural size. `w-full` alone stretched a 320-unit
          viewBox across the whole panel — about 1300px — which scales strokeWidth 1.5 to
          ~6px and the 9px label to ~36px type, so the chart swallowed the table it exists
          to annotate. Caught by screenshotting the page, not by any test. */}
      {path && (
        <figure className="m-0">
          <svg
            viewBox={`0 0 ${path.width} ${path.height}`}
            className="w-full max-w-[440px] h-auto"
            role="img"
            aria-label={`Efficient frontier: ${path.points.length} points from ${(path.minVol * 100).toFixed(1)}% to ${(path.maxVol * 100).toFixed(1)}% volatility, with the published book marked.`}
            data-testid="efficient-frontier"
          >
            <polyline
              points={path.polyline}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
            />
            {path.current && (
              <>
                <circle
                  cx={path.current.x}
                  cy={path.current.y}
                  r="4"
                  fill="var(--warning)"
                />
                <text
                  x={path.current.x + 7}
                  y={path.current.y + 3.5}
                  fontSize="9"
                  fill="var(--text-secondary)"
                >
                  this book
                </text>
              </>
            )}
          </svg>
          <figcaption className="text-[10.5px] text-text-tertiary mt-1 leading-[1.5]">
            Volatility (x) against expected return (y), both annualised and both from
            the same covariance and expected returns the sizing used — a frontier drawn
            from different inputs would not be comparable to the book on it.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
