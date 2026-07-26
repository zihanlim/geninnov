"use client";
// frontend/components/chat/ReasoningStep.tsx
//
// One fetch the agent made, opened up.
//
// "Interact with its reasoning" means this, not a streamed chain-of-thought. A
// model narrating its own thinking is unfalsifiable prose; what a reader can
// actually audit is WHAT WAS READ and WHAT CAME BACK. So a step shows the tool,
// the reason the planner gave for calling it, and — on expand — every value it
// returned next to the `table.column` it was read from.
//
// Collapsed by default per goal 7: dense is right for comparing, wrong for
// hiding the fact someone came for. The answer is the fact; the ledger behind it
// is optional detail, which is precisely what `<details>` is for.

import { DisclosureChevron } from "@/components/DisclosureChevron";
import type { AgentStep } from "@/lib/chat/types";

const fmt = (value: number | string | null, unit?: string): string => {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  switch (unit) {
    case "pct":
      return `${(value * 100).toFixed(2)}%`;
    case "pct_whole":
      return `${value.toFixed(2)}%`;
    case "pct_points":
      return `${value.toFixed(2)}`;
    case "usd":
      return `${value < 0 ? "−" : ""}$${(Math.abs(value) / 1_000_000).toFixed(2)}M`;
    case "usd_price":
      // A per-share price, not a book-scale amount. Rendering a $121.40 close
      // through the `usd` arm produced "$0.00M".
      return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
    case "count":
      return String(value);
    default:
      return String(Number(value.toFixed(4)));
  }
};

export default function ReasoningStep({ step, index }: { step: AgentStep; index: number }) {
  const { result } = step;
  const argEntries = Object.entries(step.args ?? {});

  return (
    <details className="group border border-border rounded-md bg-bg-surface">
      <summary className="flex items-start gap-2 px-3 py-2 cursor-pointer list-none marker:content-none">
        <span className="num text-[10.5px] text-text-tertiary mt-[3px] w-4 shrink-0">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="num text-[12px] text-text-primary">
            {step.tool}
            {argEntries.length > 0 && (
              <span className="text-text-tertiary">
                ({argEntries.map(([k, v]) => `${k}: ${String(v)}`).join(", ")})
              </span>
            )}
          </span>
          {step.because && (
            <span className="block text-[12px] text-text-secondary leading-[1.5] mt-0.5">{step.because}</span>
          )}
        </span>
        <span className="text-[10.5px] text-text-tertiary whitespace-nowrap mt-[3px]">
          {/* The count is the honest headline for a step: a tool that returned
              nothing looks identical to one that returned twenty until you say so. */}
          {result.facts.length} {result.facts.length === 1 ? "value" : "values"}
          {result.ms !== undefined && <span className="num"> · {result.ms}ms</span>}
        </span>
        <DisclosureChevron className="mt-[3px] text-text-tertiary" />
      </summary>

      <div className="px-3 pb-3 pt-1 border-t border-border">
        {result.absence && (
          <p
            className="m-0 mb-2 text-[12px] leading-[1.6] px-2.5 py-2 rounded border"
            style={{ borderColor: "var(--warning)", color: "var(--warning-deep)", background: "var(--bg-elevated)" }}
          >
            {result.absence}
          </p>
        )}

        {result.facts.length > 0 && (
          <table className="w-full text-[11.5px] border-collapse">
            <caption className="sr-only">
              Values returned by {step.tool}, each with the database column it was read from
            </caption>
            <thead>
              <tr className="text-text-tertiary text-left">
                <th scope="col" className="font-medium py-1 pr-2">Value</th>
                <th scope="col" className="font-medium py-1 pr-2 text-right">Figure</th>
                <th scope="col" className="font-medium py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {result.facts.map((f) => (
                <tr key={f.key} className="border-t border-border align-baseline">
                  <td className="py-[5px] pr-2 text-text-secondary">{f.label}</td>
                  <td className="py-[5px] pr-2 num text-right text-text-primary whitespace-nowrap">
                    {fmt(f.value, f.unit)}
                  </td>
                  <td className="py-[5px] num text-[10.5px] text-text-tertiary break-all">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {result.notes && Object.keys(result.notes).length > 0 && (
          <dl className="mt-2 mb-0 text-[12px] leading-[1.6]">
            {Object.entries(result.notes).map(([k, v]) => (
              <div key={k} className="py-[3px] border-t border-border">
                <dt className="text-text-tertiary text-[10.5px] uppercase tracking-[0.08em]">{k.replace(/_/g, " ")}</dt>
                <dd className="m-0 text-text-secondary">{Array.isArray(v) ? v.join(" · ") : v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}
